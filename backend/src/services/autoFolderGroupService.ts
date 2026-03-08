import { db } from '../database/init';
import { AutoFolderGroupModel, AutoFolderGroupImageModel } from '../models/AutoFolderGroup';
import { ImageFileModel } from '../models/Image/ImageFileModel';
import {
  buildFolderPathTree,
  extractRelativePathFromUploads,
  extractFolderPath,
  FolderPathNode
} from '../utils/folderPathParser';
import { runtimePaths } from '../config/runtimePaths';
import { AutoFolderGroupRebuildResult } from '@conai/shared';
import path from 'path';

/**
 * 자동 폴더 그룹 서비스
 * 파일 시스템 구조를 기반으로 읽기 전용 그룹 자동 생성
 */
export class AutoFolderGroupService {
  /**
   * 모든 자동 폴더 그룹 재구축
   * - 기존 그룹 전체 삭제
   * - image_files에서 모든 파일 경로 수집
   * - 폴더 계층 구조 파싱
   * - 그룹 생성 및 이미지 할당
   */
  static async rebuildAllFolderGroups(): Promise<AutoFolderGroupRebuildResult> {
    const startTime = Date.now();
    let groupsCreated = 0;
    let imagesAssigned = 0;

    try {
      console.log('🔄 자동 폴더 그룹 재구축 시작...');

      // 1. 기존 그룹 전체 삭제
      await AutoFolderGroupModel.deleteAll();
      console.log('  ✅ 기존 그룹 삭제 완료');

      // 2. 모든 활성 파일 조회
      const allFiles = db.prepare(`
        SELECT id, composite_hash, original_file_path
        FROM image_files
        WHERE file_status = 'active'
      `).all() as Array<{ id: number; composite_hash: string; original_file_path: string }>;

      console.log(`  📁 총 ${allFiles.length}개 파일 발견`);

      if (allFiles.length === 0) {
        return {
          success: true,
          groups_created: 0,
          images_assigned: 0,
          duration_ms: Date.now() - startTime
        };
      }

      // 3. 폴더 트리 구조 생성
      const filePaths = allFiles.map(f => ({
        path: f.original_file_path,
        hash: f.composite_hash
      }));

      const folderTree = buildFolderPathTree(filePaths);
      console.log(`  🌳 ${folderTree.size}개 폴더 노드 생성 (중간 폴더 포함)`);

      // 4. 폴더를 깊이 순서대로 정렬 (부모 먼저 생성)
      const sortedFolders = Array.from(folderTree.values())
        .sort((a, b) => a.depth - b.depth);

      // 5. 폴더 그룹 생성 (부모 ID 매핑)
      const pathToGroupId = new Map<string, number>();

      for (const node of sortedFolders) {
        const parentId = node.parentPath ? pathToGroupId.get(node.parentPath) : null;
        const absolutePath = path.join(runtimePaths.uploadsDir, node.folderPath);

        const group = await AutoFolderGroupModel.create({
          folder_path: node.folderPath,
          absolute_path: absolutePath,
          display_name: node.displayName,
          parent_id: parentId ?? undefined,
          depth: node.depth,
          has_images: node.compositeHashes.size > 0,
          image_count: node.compositeHashes.size
        });

        pathToGroupId.set(node.folderPath, group.id);
        groupsCreated++;

        // 6. 이미지 할당 (composite_hash 기준)
        for (const hash of node.compositeHashes) {
          await AutoFolderGroupImageModel.addImageToGroup(group.id, hash);
          imagesAssigned++;
        }
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
    if (parentId === null) {
      return await AutoFolderGroupModel.findRoots();
    }
    return await AutoFolderGroupModel.findChildren(parentId);
  }

  /**
   * 그룹 상세 조회
   */
  static async getGroupById(id: number) {
    return await AutoFolderGroupModel.findById(id);
  }

  /**
   * 그룹의 이미지 조회 (페이징)
   */
  static async getGroupImages(groupId: number, page: number = 1, pageSize: number = 50) {
    try {
      console.log('[AutoFolderGroupService] getGroupImages called:', { groupId, page, pageSize });

      const images = await AutoFolderGroupImageModel.findImagesByGroup(groupId, page, pageSize);
      const total = await AutoFolderGroupImageModel.getImageCount(groupId);

      console.log('[AutoFolderGroupService] getGroupImages result:', {
        imagesCount: images.length,
        total,
        page,
        pageSize
      });

      return {
        images,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      };
    } catch (error) {
      console.error('[AutoFolderGroupService] Error in getGroupImages:', error);
      throw error;
    }
  }

  /**
   * 그룹의 랜덤 썸네일 조회
   */
  static async getRandomThumbnail(groupId: number) {
    return await AutoFolderGroupImageModel.findRandomImageForGroup(groupId);
  }

  /**
   * 브레드크럼 경로 조회
   */
  static async getBreadcrumbPath(groupId: number) {
    return await AutoFolderGroupModel.getBreadcrumbPath(groupId);
  }

  /**
   * 모든 그룹 조회 (통계 포함)
   */
  static async getAllGroups() {
    return await AutoFolderGroupModel.findAllWithStats();
  }

  /**
   * 그룹의 composite_hash 목록 조회
   */
  static async getGroupHashes(groupId: number): Promise<string[]> {
    return await AutoFolderGroupImageModel.getCompositeHashesForGroup(groupId);
  }
}
