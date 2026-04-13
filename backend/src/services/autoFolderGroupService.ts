import { db } from '../database/init';
import { AutoFolderGroupModel, AutoFolderGroupImageModel } from '../models/AutoFolderGroup';
import { AutoFolderGroupRebuildResult } from '@conai/shared';
import path from 'path';
import fs from 'fs';
import { normalizePath } from '../utils/pathResolver';

type WatchedFolderRow = {
  id: number;
  folder_path: string;
  folder_name: string | null;
  recursive: number;
};

type ActiveImageRow = {
  composite_hash: string;
  original_file_path: string;
  folder_id: number;
};

type FolderNode = {
  key: string;
  parentKey: string | null;
  absolutePath: string;
  displayName: string;
  depth: number;
  compositeHashes: Set<string>;
};

/**
 * 자동 폴더 그룹 서비스
 * 감시 폴더 루트를 기준으로 실제 폴더 구조를 반영한 읽기 전용 그룹 관리
 */
export class AutoFolderGroupService {
  /** Build a stable synthetic key scoped to one watched folder. */
  private static buildNodeKey(folderId: number, relativePath: string): string {
    return relativePath ? `watch:${folderId}/${relativePath}` : `watch:${folderId}`;
  }

  /** Create a display label for one folder node. */
  private static getDisplayName(absolutePath: string, fallbackName?: string | null): string {
    if (fallbackName && fallbackName.trim().length > 0) {
      return fallbackName.trim();
    }

    const normalized = path.normalize(absolutePath);
    const baseName = path.basename(normalized);
    return baseName || normalized;
  }

  /** Ensure the directory itself and all missing parents exist in the node map. */
  private static ensureDirectoryNode(
    folder: WatchedFolderRow,
    nodes: Map<string, FolderNode>,
    absolutePath: string,
    rootPath: string,
    isRoot: boolean = false,
  ): string {
    const normalizedRootPath = normalizePath(rootPath);
    const normalizedAbsolutePath = normalizePath(absolutePath);
    const relativePath = isRoot
      ? ''
      : path.relative(normalizedRootPath, normalizedAbsolutePath).split(path.sep).join('/');
    const key = this.buildNodeKey(folder.id, relativePath === '.' ? '' : relativePath);

    if (!nodes.has(key)) {
      const parentKey = isRoot || !relativePath || relativePath === '.'
        ? null
        : this.buildNodeKey(folder.id, path.dirname(relativePath).split(path.sep).join('/').replace(/^\.$/, ''));

      nodes.set(key, {
        key,
        parentKey,
        absolutePath: normalizedAbsolutePath,
        displayName: isRoot
          ? this.getDisplayName(normalizedAbsolutePath, folder.folder_name)
          : this.getDisplayName(normalizedAbsolutePath),
        depth: isRoot ? 0 : relativePath.split('/').filter(Boolean).length,
        compositeHashes: new Set(),
      });
    }

    return key;
  }

  /** Walk one watched folder and mirror its real directory tree. */
  private static collectDirectoryNodes(folder: WatchedFolderRow, nodes: Map<string, FolderNode>) {
    const rootPath = normalizePath(folder.folder_path);
    const queue: string[] = [rootPath];

    while (queue.length > 0) {
      const currentPath = queue.shift();
      if (!currentPath) {
        continue;
      }

      const isRoot = normalizePath(currentPath) === rootPath;
      this.ensureDirectoryNode(folder, nodes, currentPath, rootPath, isRoot);

      if (!folder.recursive) {
        continue;
      }

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true });
      } catch (error) {
        console.warn('[AutoFolderGroupService] Failed to read watched folder directory:', currentPath, error);
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const childPath = normalizePath(path.join(currentPath, entry.name));
        this.ensureDirectoryNode(folder, nodes, childPath, rootPath, false);
        queue.push(childPath);
      }
    }
  }

  /** Attach active images to their exact watched-folder directory node. */
  private static attachImagesToNodes(
    folder: WatchedFolderRow,
    nodes: Map<string, FolderNode>,
    images: ActiveImageRow[],
  ) {
    const rootPath = normalizePath(folder.folder_path);

    for (const image of images) {
      const directoryPath = normalizePath(path.dirname(image.original_file_path));
      const isInsideWatchedRoot = directoryPath === rootPath || directoryPath.startsWith(`${rootPath}${path.sep}`);
      const targetDirectory = isInsideWatchedRoot ? directoryPath : rootPath;
      const targetKey = this.ensureDirectoryNode(folder, nodes, targetDirectory, rootPath, targetDirectory === rootPath);
      nodes.get(targetKey)?.compositeHashes.add(image.composite_hash);
    }
  }

  /** Rebuild when there are no folder groups yet or the stored format is legacy. */
  private static async ensureReadableGroups() {
    const groups = await AutoFolderGroupModel.findAllWithStats();
    const hasLegacyShape = groups.length > 0 && groups.some((group) => !group.folder_path.startsWith('watch:'));

    if (groups.length === 0 || hasLegacyShape) {
      await this.rebuildAllFolderGroups();
    }
  }

  /** Ensure readable groups exist before running one read operation. */
  private static async withReadableGroups<T>(operation: () => T | Promise<T>): Promise<T> {
    await this.ensureReadableGroups();
    return await operation();
  }

  /** Load watched folders and keep only existing directories that can be mirrored safely. */
  private static loadReadableWatchedFolders(): WatchedFolderRow[] {
    const watchedFolders = db.prepare(`
      SELECT id, folder_path, folder_name, recursive
      FROM watched_folders
      ORDER BY created_date ASC, id ASC
    `).all() as WatchedFolderRow[];

    return watchedFolders.filter((watchedFolder) => {
      const watchedFolderPath = normalizePath(watchedFolder.folder_path);
      if (!fs.existsSync(watchedFolderPath)) {
        console.warn(`[AutoFolderGroupService] Watched folder missing, skipping: ${watchedFolderPath}`);
        return false;
      }

      try {
        if (!fs.statSync(watchedFolderPath).isDirectory()) {
          console.warn(`[AutoFolderGroupService] Watched folder is not a directory, skipping: ${watchedFolderPath}`);
          return false;
        }
      } catch (error) {
        console.warn(`[AutoFolderGroupService] Failed to stat watched folder: ${watchedFolderPath}`, error);
        return false;
      }

      return true;
    });
  }

  /** Persist one watched folder tree in stable parent-first order. */
  private static async createGroupsFromNodes(
    nodes: Map<string, FolderNode>,
    pathToGroupId: Map<string, number>,
  ) {
    let groupsCreated = 0;
    let imagesAssigned = 0;

    const sortedNodes = Array.from(nodes.values())
      .sort((left, right) => left.depth - right.depth || left.absolutePath.localeCompare(right.absolutePath));

    for (const node of sortedNodes) {
      const parentId = node.parentKey ? pathToGroupId.get(node.parentKey) : null;
      const group = await AutoFolderGroupModel.create({
        folder_path: node.key,
        absolute_path: node.absolutePath,
        display_name: node.displayName,
        parent_id: parentId ?? undefined,
        depth: node.depth,
        has_images: node.compositeHashes.size > 0,
        image_count: node.compositeHashes.size,
      });

      pathToGroupId.set(node.key, group.id);
      groupsCreated++;

      for (const hash of node.compositeHashes) {
        await AutoFolderGroupImageModel.addImageToGroup(group.id, hash);
        imagesAssigned++;
      }
    }

    return { groupsCreated, imagesAssigned };
  }

  /**
   * 모든 자동 폴더 그룹 재구축
   * - 감시 폴더를 루트 그룹으로 생성
   * - 실제 폴더 구조를 그대로 반영
   * - 활성 이미지들을 정확한 실제 폴더 노드에 할당
   */
  static async rebuildAllFolderGroups(): Promise<AutoFolderGroupRebuildResult> {
    const startTime = Date.now();
    let groupsCreated = 0;
    let imagesAssigned = 0;

    try {
      console.log('🔄 자동 폴더 그룹 재구축 시작...');

      await AutoFolderGroupModel.deleteAll();
      console.log('  ✅ 기존 그룹 삭제 완료');

      const watchedFolders = this.loadReadableWatchedFolders();

      if (watchedFolders.length === 0) {
        return {
          success: true,
          groups_created: 0,
          images_assigned: 0,
          duration_ms: Date.now() - startTime
        };
      }

      const activeImages = db.prepare(`
        SELECT composite_hash, original_file_path, folder_id
        FROM image_files
        WHERE file_status = 'active'
      `).all() as ActiveImageRow[];

      const pathToGroupId = new Map<string, number>();

      for (const watchedFolder of watchedFolders) {
        const nodes = new Map<string, FolderNode>();
        const folderImages = activeImages.filter((image) => image.folder_id === watchedFolder.id);

        this.collectDirectoryNodes(watchedFolder, nodes);
        this.attachImagesToNodes(watchedFolder, nodes, folderImages);

        const result = await this.createGroupsFromNodes(nodes, pathToGroupId);
        groupsCreated += result.groupsCreated;
        imagesAssigned += result.imagesAssigned;
      }

      const durationMs = Date.now() - startTime;
      console.log(`  ✅ 재구축 완료: ${groupsCreated}개 그룹, ${imagesAssigned}개 이미지 할당`);
      console.log(`  ⏱️  소요 시간: ${durationMs}ms`);

      return {
        success: true,
        groups_created: groupsCreated,
        images_assigned: imagesAssigned,
        duration_ms: durationMs
      };

    } catch (error) {
      console.error('❌ 자동 폴더 그룹 재구축 실패:', error);
      return {
        success: false,
        groups_created: groupsCreated,
        images_assigned: imagesAssigned,
        duration_ms: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 특정 부모의 자식 그룹 조회
   * null = 루트 레벨
   */
  static async getChildGroups(parentId: number | null) {
    return this.withReadableGroups(async () => {
      if (parentId === null) {
        return AutoFolderGroupModel.findRoots();
      }
      return AutoFolderGroupModel.findChildren(parentId);
    });
  }

  /**
   * 그룹 상세 조회
   */
  static async getGroupById(id: number) {
    return this.withReadableGroups(() => AutoFolderGroupModel.findById(id));
  }

  /**
   * 그룹의 이미지 조회 (페이징)
   */
  static async getGroupImages(groupId: number, page: number = 1, pageSize: number = 50) {
    return this.withReadableGroups(async () => {
      const images = await AutoFolderGroupImageModel.findImagesByGroup(groupId, page, pageSize);
      const total = await AutoFolderGroupImageModel.getImageCount(groupId);

      return {
        images,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      };
    });
  }

  /**
   * 그룹의 랜덤 썸네일 조회
   */
  static async getRandomThumbnail(groupId: number) {
    return this.withReadableGroups(() => AutoFolderGroupImageModel.findRandomImageForGroup(groupId));
  }

  /**
   * 브레드크럼 경로 조회
   */
  static async getBreadcrumbPath(groupId: number) {
    return this.withReadableGroups(() => AutoFolderGroupModel.getBreadcrumbPath(groupId));
  }

  /**
   * 모든 그룹 조회 (통계 포함)
   */
  static async getAllGroups() {
    return this.withReadableGroups(() => AutoFolderGroupModel.findAllWithStats());
  }

  /**
   * 그룹의 composite_hash 목록 조회
   */
  static async getGroupHashes(groupId: number): Promise<string[]> {
    return this.withReadableGroups(() => AutoFolderGroupImageModel.getCompositeHashesForGroup(groupId));
  }
}
