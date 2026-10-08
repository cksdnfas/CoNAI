import { db } from '../database/init';
import { AutoFolderGroupModel, AutoFolderGroupImageModel } from '../models/AutoFolderGroup';
import { AutoFolderGroupRebuildResult } from '@conai/shared';
import path from 'path';
import fs from 'fs';
import { normalizePath } from '../utils/pathResolver';
import { maybeTruncateImagesWal } from '../database/walMaintenance';
import { LIBRARY_BATCH_SIZE, chunkArray, pageBoundary, placeholders, type LibraryBatchHooks } from './maintenance/libraryBatch';

type WatchedFolderRow = {
  id: number;
  folder_path: string;
  folder_name: string | null;
  recursive: number;
};

type ActiveImageRow = {
  composite_hash: string | null;
  original_file_path: string;
  folder_id: number;
};

type FolderNode = {
  key: string;
  parentKey: string | null;
  absolutePath: string;
  displayName: string;
  depth: number;
};

/** image_files rows read per staging page (reads only; the staged writes go to TEMP). */
const STAGE_PAGE_SIZE = LIBRARY_BATCH_SIZE * 10;

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

  /** Find (creating if needed) the exact watched-folder directory node one active image belongs to. */
  private static resolveImageNodeKey(
    folder: WatchedFolderRow,
    nodes: Map<string, FolderNode>,
    image: ActiveImageRow,
  ): string {
    const rootPath = normalizePath(folder.folder_path);
    const directoryPath = normalizePath(path.dirname(image.original_file_path));
    const isInsideWatchedRoot = directoryPath === rootPath || directoryPath.startsWith(`${rootPath}${path.sep}`);
    const targetDirectory = isInsideWatchedRoot ? directoryPath : rootPath;
    return this.ensureDirectoryNode(folder, nodes, targetDirectory, rootPath, targetDirectory === rootPath);
  }

  /** Report unreadable stored shape without mutating DB from read routes. */
  private static async ensureReadableGroups() {
    const groups = await AutoFolderGroupModel.findAllWithStats();
    const hasLegacyShape = groups.length > 0 && groups.some((group) => !group.folder_path.startsWith('watch:'));

    if (hasLegacyShape) {
      console.warn('[AutoFolderGroupService] Legacy folder group rows found; use explicit rebuild to refresh watched-folder groups.');
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

  /**
   * 모든 자동 폴더 그룹 재구축
   * - 감시 폴더를 루트 그룹으로 생성
   * - 실제 폴더 구조를 그대로 반영
   * - 활성 이미지들을 정확한 실제 폴더 노드에 할당
   *
   * 원하는 트리(폴더 노드 + 노드별 이미지)를 먼저 이 연결의 TEMP 테이블에 쌓고, 실제 테이블에는 차이만
   * 500행 이하 트랜잭션으로 반영한다. 예전에는 전체 활성 파일을 메모리에 올린 뒤 트랜잭션 하나 안에서
   * 전부 지우고 행마다 prepare 하며 다시 넣었다 — 그동안 다른 쓰기는 모두 잠금을 기다렸다.
   * 노드는 folder_path(감시 폴더 id + 상대 경로)로 맞추므로, 바뀌지 않은 그룹은 id 가 그대로 남는다.
   */
  static async rebuildAllFolderGroups(hooks: LibraryBatchHooks = {}): Promise<AutoFolderGroupRebuildResult> {
    const startTime = Date.now();
    let groupsCreated = 0;
    let imagesAssigned = 0;

    try {
      console.log('🔄 자동 폴더 그룹 재구축 시작...');

      const watchedFolders = this.loadReadableWatchedFolders();
      const folderById = new Map(watchedFolders.map((folder) => [folder.id, folder]));
      const nodeMaps = new Map<number, Map<string, FolderNode>>();
      for (const watchedFolder of watchedFolders) {
        const nodes = new Map<string, FolderNode>();
        this.collectDirectoryNodes(watchedFolder, nodes);
        nodeMaps.set(watchedFolder.id, nodes);
      }

      await this.stageFolderMembers(folderById, nodeMaps, hooks);

      const desiredNodes = Array.from(nodeMaps.values())
        .flatMap((nodes) => Array.from(nodes.values()))
        .sort((left, right) => left.depth - right.depth || left.absolutePath.localeCompare(right.absolutePath));
      const imageCounts = new Map(
        (db.prepare(`
          SELECT node_key, COUNT(*) AS image_count FROM temp_auto_folder_members GROUP BY node_key
        `).all() as Array<{ node_key: string; image_count: number }>).map((row) => [row.node_key, row.image_count]),
      );

      await this.applyFolderNodes(desiredNodes, imageCounts, hooks);
      await this.applyFolderMembers(hooks);
      await this.removeObsoleteFolderGroups(new Set(desiredNodes.map((node) => node.key)), hooks);
      db.prepare('DELETE FROM temp_auto_folder_members').run();

      groupsCreated = (db.prepare('SELECT COUNT(*) AS c FROM auto_folder_groups').get() as { c: number }).c;
      imagesAssigned = (db.prepare('SELECT COUNT(*) AS c FROM auto_folder_group_images').get() as { c: number }).c;
      maybeTruncateImagesWal('auto-folder-group-rebuild');
      console.log('  ✅ 자동 폴더 그룹 차이 반영 완료');

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

  /** Stage `(node key, composite_hash)` for every active, hashed file in a readable watched folder (TEMP only). */
  private static async stageFolderMembers(
    folderById: Map<number, WatchedFolderRow>,
    nodeMaps: Map<number, Map<string, FolderNode>>,
    hooks: LibraryBatchHooks,
  ): Promise<void> {
    db.exec(`
      CREATE TEMP TABLE IF NOT EXISTS temp_auto_folder_members (
        node_key TEXT NOT NULL,
        composite_hash TEXT NOT NULL,
        PRIMARY KEY (node_key, composite_hash)
      ) WITHOUT ROWID
    `);
    db.prepare('DELETE FROM temp_auto_folder_members').run();

    const nextPage = db.prepare(`
      SELECT id, composite_hash, original_file_path, folder_id
      FROM image_files
      WHERE file_status = 'active' AND id > ?
      ORDER BY id
      LIMIT ${STAGE_PAGE_SIZE}
    `);
    const stage = db.prepare('INSERT OR IGNORE INTO temp_auto_folder_members (node_key, composite_hash) VALUES (?, ?)');
    const stagePage = db.transaction((rows: Array<ActiveImageRow & { id: number }>) => {
      for (const row of rows) {
        const folder = folderById.get(row.folder_id);
        const nodes = nodeMaps.get(row.folder_id);
        // Unhashed files cannot be group members (the membership row needs a media row).
        if (!folder || !nodes || !row.composite_hash) {
          continue;
        }
        stage.run(this.resolveImageNodeKey(folder, nodes, row), row.composite_hash);
      }
    });

    let cursor = 0;
    for (;;) {
      hooks.throwIfCancelled?.();
      const rows = nextPage.all(cursor) as Array<ActiveImageRow & { id: number }>;
      if (rows.length === 0) {
        return;
      }
      cursor = rows[rows.length - 1].id;
      // Writes go to the TEMP schema only, so this transaction never takes the images.db write lock.
      stagePage(rows);
      await pageBoundary(hooks);
    }
  }

  /** Insert new folder nodes and update changed ones, parents first, one page of nodes per transaction. */
  private static async applyFolderNodes(
    desiredNodes: FolderNode[],
    imageCounts: Map<string, number>,
    hooks: LibraryBatchHooks,
  ): Promise<void> {
    const existing = new Map(
      (db.prepare(`
        SELECT id, folder_path, absolute_path, display_name, parent_id, depth, has_images, image_count
        FROM auto_folder_groups
      `).all() as Array<{
        id: number;
        folder_path: string;
        absolute_path: string;
        display_name: string;
        parent_id: number | null;
        depth: number;
        has_images: number;
        image_count: number;
      }>).map((row) => [row.folder_path, row]),
    );
    const idByKey = new Map<string, number>(Array.from(existing.values()).map((row) => [row.folder_path, row.id]));

    const insertGroup = db.prepare(`
      INSERT INTO auto_folder_groups (folder_path, absolute_path, display_name, parent_id, depth, has_images, image_count, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `);
    const updateGroup = db.prepare(`
      UPDATE auto_folder_groups
      SET absolute_path = ?, display_name = ?, parent_id = ?, depth = ?, has_images = ?, image_count = ?, last_updated = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const applyPage = db.transaction((nodes: FolderNode[]) => {
      for (const node of nodes) {
        const parentId = node.parentKey ? idByKey.get(node.parentKey) ?? null : null;
        const imageCount = imageCounts.get(node.key) ?? 0;
        const hasImages = imageCount > 0 ? 1 : 0;
        const current = existing.get(node.key);
        if (!current) {
          idByKey.set(node.key, Number(insertGroup.run(node.key, node.absolutePath, node.displayName, parentId, node.depth, hasImages, imageCount).lastInsertRowid));
          continue;
        }
        if (
          current.absolute_path !== node.absolutePath
          || current.display_name !== node.displayName
          || current.parent_id !== parentId
          || current.depth !== node.depth
          || Number(current.has_images) !== hasImages
          || current.image_count !== imageCount
        ) {
          updateGroup.run(node.absolutePath, node.displayName, parentId, node.depth, hasImages, imageCount, current.id);
        }
      }
    });

    for (const page of chunkArray(desiredNodes)) {
      hooks.throwIfCancelled?.();
      applyPage(page);
      await pageBoundary(hooks);
    }
  }

  /** Drop memberships the staged tree no longer has, then add the missing ones, one page per transaction. */
  private static async applyFolderMembers(hooks: LibraryBatchHooks): Promise<void> {
    const staleIds = db.prepare(`
      SELECT i.id
      FROM auto_folder_group_images i
      JOIN auto_folder_groups g ON g.id = i.group_id
      WHERE i.id > ?
        AND NOT EXISTS (
          SELECT 1 FROM temp_auto_folder_members t
          WHERE t.node_key = g.folder_path AND t.composite_hash = i.composite_hash
        )
      ORDER BY i.id
      LIMIT ${LIBRARY_BATCH_SIZE}
    `);
    let idCursor = 0;
    for (;;) {
      hooks.throwIfCancelled?.();
      const ids = (staleIds.all(idCursor) as Array<{ id: number }>).map((row) => row.id);
      if (ids.length === 0) {
        break;
      }
      idCursor = ids[ids.length - 1];
      db.prepare(`DELETE FROM auto_folder_group_images WHERE id IN (${placeholders(ids.length)})`).run(...ids);
      await pageBoundary(hooks);
    }

    const missing = db.prepare(`
      SELECT t.node_key, t.composite_hash
      FROM temp_auto_folder_members t
      WHERE (t.node_key, t.composite_hash) > (?, ?)
        AND NOT EXISTS (
          SELECT 1 FROM auto_folder_groups g
          JOIN auto_folder_group_images i ON i.group_id = g.id AND i.composite_hash = t.composite_hash
          WHERE g.folder_path = t.node_key
        )
      ORDER BY t.node_key, t.composite_hash
      LIMIT ${LIBRARY_BATCH_SIZE}
    `);
    const insertMember = db.prepare(`
      INSERT OR IGNORE INTO auto_folder_group_images (group_id, composite_hash)
      SELECT g.id, ? FROM auto_folder_groups g
      WHERE g.folder_path = ?
        AND EXISTS (SELECT 1 FROM media_metadata m WHERE m.composite_hash = ?)
    `);
    const insertPage = db.transaction((rows: Array<{ node_key: string; composite_hash: string }>) => {
      for (const row of rows) {
        insertMember.run(row.composite_hash, row.node_key, row.composite_hash);
      }
    });
    let keyCursor = '';
    let hashCursor = '';
    for (;;) {
      hooks.throwIfCancelled?.();
      const rows = missing.all(keyCursor, hashCursor) as Array<{ node_key: string; composite_hash: string }>;
      if (rows.length === 0) {
        return;
      }
      keyCursor = rows[rows.length - 1].node_key;
      hashCursor = rows[rows.length - 1].composite_hash;
      insertPage(rows);
      await pageBoundary(hooks);
    }
  }

  /** Delete groups whose folder is gone (or legacy-shaped rows), deepest first, memberships before groups. */
  private static async removeObsoleteFolderGroups(desiredKeys: Set<string>, hooks: LibraryBatchHooks): Promise<void> {
    const obsolete = (db.prepare('SELECT id, folder_path, depth FROM auto_folder_groups ORDER BY depth DESC, id')
      .all() as Array<{ id: number; folder_path: string; depth: number }>)
      .filter((row) => !desiredKeys.has(row.folder_path))
      .map((row) => row.id);

    const membersOf = db.prepare(`SELECT id FROM auto_folder_group_images WHERE group_id = ? LIMIT ${LIBRARY_BATCH_SIZE}`);
    for (const groupId of obsolete) {
      for (;;) {
        const ids = (membersOf.all(groupId) as Array<{ id: number }>).map((row) => row.id);
        if (ids.length === 0) {
          break;
        }
        db.prepare(`DELETE FROM auto_folder_group_images WHERE id IN (${placeholders(ids.length)})`).run(...ids);
        await pageBoundary(hooks);
      }
    }

    for (const page of chunkArray(obsolete)) {
      hooks.throwIfCancelled?.();
      db.prepare(`DELETE FROM auto_folder_groups WHERE id IN (${placeholders(page.length)})`).run(...page);
      await pageBoundary(hooks);
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
  static async getGroupImages(
    groupId: number,
    page: number = 1,
    pageSize: number = 50,
    options?: { useCursor?: boolean; cursorDate?: string; cursorHash?: string; includeTotal?: boolean; includeChildren?: boolean },
  ) {
    return this.withReadableGroups(async () => {
      const result = await AutoFolderGroupImageModel.findImagesByGroup(groupId, page, pageSize, options);
      const totalKnown = options?.includeTotal !== false;
      const total = totalKnown ? await AutoFolderGroupImageModel.getImageCount(groupId, options?.includeChildren) : 0;

      return {
        images: result.images,
        total,
        page,
        pageSize,
        totalPages: totalKnown ? Math.ceil(total / pageSize) : 0,
        totalKnown,
        hasMore: result.hasMore,
        nextCursorDate: result.nextCursorDate,
        nextCursorHash: result.nextCursorHash,
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
