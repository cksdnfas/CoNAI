import { db } from '../database/init';
import { ImageSafetyService } from '../services/imageSafetyService';
import { AutoFolderGroup,
CreateAutoFolderGroupData,
AutoFolderGroupWithStats } from '@conai/shared';
import { ImageMetadataRecord, ImageWithFileView } from '../types/image';

/**
 * 자동 폴더 그룹 모델
 * 파일 시스템 폴더 구조를 반영한 읽기 전용 그룹 관리
 */
const VISIBLE_AUTO_FOLDER_IMAGE_CONDITION = ImageSafetyService.buildVisibleScoreCondition('m.rating_score');

export class AutoFolderGroupModel {
  /**
   * 새 자동 폴더 그룹 생성
   */
  static create(data: CreateAutoFolderGroupData): AutoFolderGroup {
    const info = db.prepare(`
      INSERT INTO auto_folder_groups (
        folder_path, absolute_path, display_name, parent_id,
        depth, has_images, image_count, color
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.folder_path,
      data.absolute_path,
      data.display_name,
      data.parent_id ?? null,
      data.depth,
      data.has_images ? 1 : 0,
      data.image_count ?? 0,
      data.color ?? null
    );

    const id = info.lastInsertRowid as number;
    const group = this.findById(id);
    if (!group) {
      throw new Error('Failed to create auto folder group');
    }
    return group;
  }

  /**
   * 그룹 조회 (ID)
   */
  static findById(id: number): AutoFolderGroup | null {
    const row = db.prepare('SELECT * FROM auto_folder_groups WHERE id = ?')
      .get(id) as AutoFolderGroup | undefined;
    return row || null;
  }

  /**
   * 그룹 조회 (folder_path)
   */
  static findByFolderPath(folderPath: string): AutoFolderGroup | null {
    const row = db.prepare('SELECT * FROM auto_folder_groups WHERE folder_path = ?')
      .get(folderPath) as AutoFolderGroup | undefined;
    return row || null;
  }

  /**
   * 루트 그룹들 조회 (parent_id가 NULL)
   */
  static findRoots(): AutoFolderGroupWithStats[] {
    const query = `
      SELECT
        afg.*,
        (SELECT COUNT(*) FROM auto_folder_groups WHERE parent_id = afg.id) as child_count
      FROM auto_folder_groups afg
      WHERE afg.parent_id IS NULL
      ORDER BY afg.display_name ASC
    `;

    const rows = db.prepare(query).all() as AutoFolderGroupWithStats[];
    return rows || [];
  }

  /**
   * 특정 부모의 자식 그룹들 조회
   */
  static findChildren(parentId: number): AutoFolderGroupWithStats[] {
    const query = `
      SELECT
        afg.*,
        (SELECT COUNT(*) FROM auto_folder_groups WHERE parent_id = afg.id) as child_count
      FROM auto_folder_groups afg
      WHERE afg.parent_id = ?
      ORDER BY afg.display_name ASC
    `;

    const rows = db.prepare(query).all(parentId) as AutoFolderGroupWithStats[];
    return rows || [];
  }

  /**
   * 모든 그룹 조회 (통계 포함)
   */
  static findAllWithStats(): AutoFolderGroupWithStats[] {
    const query = `
      SELECT
        afg.*,
        (SELECT COUNT(*) FROM auto_folder_groups WHERE parent_id = afg.id) as child_count
      FROM auto_folder_groups afg
      ORDER BY afg.depth ASC, afg.display_name ASC
    `;

    const rows = db.prepare(query).all() as AutoFolderGroupWithStats[];
    return rows || [];
  }

  /**
   * 모든 그룹 삭제 (rebuild 전용)
   */
  static deleteAll(): void {
    // CASCADE로 인해 auto_folder_group_images도 자동 삭제됨
    db.prepare('DELETE FROM auto_folder_groups').run();
  }

  /**
   * 그룹 삭제
   */
  static delete(id: number): boolean {
    const info = db.prepare('DELETE FROM auto_folder_groups WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 그룹의 이미지 개수 업데이트
   */
  static updateImageCount(id: number, count: number): boolean {
    const info = db.prepare(`
      UPDATE auto_folder_groups
      SET image_count = ?, last_updated = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(count, id);
    return info.changes > 0;
  }

  /**
   * 브레드크럼 경로 조회 (현재 그룹에서 루트까지)
   * CTE 재귀 쿼리로 O(1) 성능 - N+1 문제 해결
   */
  static getBreadcrumbPath(groupId: number): Array<{ id: number; name: string; folder_path: string }> {
    const query = `
      WITH RECURSIVE ancestor_path AS (
        -- Base case: 시작 노드 (현재 그룹)
        SELECT id, display_name, folder_path, parent_id, 0 as depth
        FROM auto_folder_groups
        WHERE id = ?

        UNION ALL

        -- Recursive case: 부모 노드들
        SELECT g.id, g.display_name, g.folder_path, g.parent_id, ap.depth + 1
        FROM auto_folder_groups g
        INNER JOIN ancestor_path ap ON g.id = ap.parent_id
      )
      SELECT id, display_name as name, folder_path
      FROM ancestor_path
      ORDER BY depth DESC
    `;

    const rows = db.prepare(query).all(groupId) as Array<{ id: number; name: string; folder_path: string }>;
    return rows;
  }
}

/**
 * 자동 폴더 그룹 이미지 연결 모델
 */
export class AutoFolderGroupImageModel {
  /**
   * 이미지를 폴더 그룹에 추가 (composite_hash 기반)
   */
  static addImageToGroup(groupId: number, compositeHash: string): boolean {
    try {
      db.prepare(`
        INSERT INTO auto_folder_group_images (group_id, composite_hash)
        VALUES (?, ?)
      `).run(groupId, compositeHash);
      return true;
    } catch (error) {
      // UNIQUE 제약 위반 시 (이미 추가됨)
      return false;
    }
  }

  /**
   * 그룹의 모든 이미지 제거
   */
  static removeAllImagesFromGroup(groupId: number): void {
    db.prepare('DELETE FROM auto_folder_group_images WHERE group_id = ?').run(groupId);
  }

  /**
   * 그룹의 이미지 조회 (페이징 지원, 메타데이터 포함)
   */
  static findImagesByGroup(
    groupId: number,
    page: number = 1,
    pageSize: number = 50
  ): ImageMetadataRecord[] {
    const offset = Math.floor((page - 1) * pageSize);

    try {
      console.log('[AutoFolderGroup] findImagesByGroup params:', {
        groupId,
        groupIdType: typeof groupId,
        page,
        pageSize,
        offset,
        offsetType: typeof offset
      });

      const query = `
        SELECT m.*,
        (SELECT id FROM image_files WHERE composite_hash = m.composite_hash AND file_status = 'active' LIMIT 1) as id,
        (SELECT file_type FROM image_files WHERE composite_hash = m.composite_hash AND file_status = 'active' LIMIT 1) as file_type,
        (SELECT mime_type FROM image_files WHERE composite_hash = m.composite_hash AND file_status = 'active' LIMIT 1) as mime_type,
        (SELECT file_size FROM image_files WHERE composite_hash = m.composite_hash AND file_status = 'active' LIMIT 1) as file_size,
        (SELECT original_file_path FROM image_files WHERE composite_hash = m.composite_hash AND file_status = 'active' LIMIT 1) as original_file_path
        FROM auto_folder_group_images afgi
        INNER JOIN media_metadata m ON afgi.composite_hash = m.composite_hash
        WHERE afgi.group_id = ?
        ORDER BY m.first_seen_date DESC
        LIMIT ? OFFSET ?
      `;

      const rows = db.prepare(query).all(groupId, pageSize, offset) as ImageMetadataRecord[];
      console.log('[AutoFolderGroup] findImagesByGroup result:', { rowCount: rows.length });
      return rows || [];
    } catch (error) {
      console.error('[AutoFolderGroup] Error in findImagesByGroup:', {
        groupId,
        groupIdType: typeof groupId,
        page,
        pageSize,
        offset,
        offsetType: typeof offset,
        error: error instanceof Error ? error.message : error
      });
      throw error;
    }
  }

  /**
   * 그룹의 총 이미지 개수
   */
  static getImageCount(groupId: number): number {
    const result = db.prepare(`
      SELECT COUNT(*) as count
      FROM auto_folder_group_images
      WHERE group_id = ?
    `).get(groupId) as { count: number };

    return result?.count || 0;
  }

  /**
   * 그룹의 랜덤 이미지 조회 (썸네일용)
   */
  static findRandomImageForGroup(groupId: number): ImageMetadataRecord | null {
    const query = `
      SELECT m.*
      FROM auto_folder_group_images afgi
      INNER JOIN media_metadata m ON afgi.composite_hash = m.composite_hash
      WHERE afgi.group_id = ? AND ${VISIBLE_AUTO_FOLDER_IMAGE_CONDITION}
      ORDER BY RANDOM()
      LIMIT 1
    `;

    const row = db.prepare(query).get(groupId) as ImageMetadataRecord | undefined;
    return row || null;
  }

  /**
   * 그룹의 미리보기 이미지들 조회 (회전 표시용, 최대 N개)
   * 현재 그룹에 이미지가 없으면 자식 그룹에서 검색 (재귀)
   */
  static findPreviewImages(
    groupId: number,
    count: number = 8,
    includeChildren: boolean = true
  ): ImageWithFileView[] {
    // 1. 현재 그룹에서 랜덤 이미지 조회
    const query = `
      SELECT DISTINCT
        COALESCE(m.composite_hash, afgi.composite_hash) as composite_hash,
        m.perceptual_hash,
        m.dhash,
        m.ahash,
        m.color_histogram,
        m.width,
        m.height,
        m.thumbnail_path,
        m.ai_tool,
        m.model_name,
        m.lora_models,
        m.steps,
        m.cfg_scale,
        m.sampler,
        m.seed,
        m.scheduler,
        m.prompt,
        m.negative_prompt,
        m.denoise_strength,
        m.generation_time,
        m.batch_size,
        m.batch_index,
        m.auto_tags,
        m.duration,
        m.fps,
        m.video_codec,
        m.audio_codec,
        m.bitrate,
        m.rating_score,
        m.first_seen_date,
        m.metadata_updated_date,
        if.id as file_id,
        if.original_file_path,
        if.file_status,
        if.file_type,
        if.mime_type,
        if.folder_id,
        f.folder_name
      FROM auto_folder_group_images afgi
      LEFT JOIN media_metadata m ON afgi.composite_hash = m.composite_hash
      LEFT JOIN image_files if ON afgi.composite_hash = if.composite_hash
        AND if.file_status = 'active'
      LEFT JOIN watched_folders f ON if.folder_id = f.id
      WHERE afgi.group_id = ? AND ${VISIBLE_AUTO_FOLDER_IMAGE_CONDITION}
      ORDER BY RANDOM()
      LIMIT ?
    `;

    const rows = db.prepare(query).all(groupId, count) as ImageWithFileView[];

    // 이미지가 충분히 있거나, 자식 검색을 안 하면 바로 반환
    if (rows.length > 0 || !includeChildren) {
      return rows;
    }

    // 2. 이미지가 없으면 자식 그룹에서 검색 (재귀)
    const children = AutoFolderGroupModel.findChildren(groupId);

    // 자식이 없으면 빈 배열 반환
    if (children.length === 0) {
      return [];
    }

    // 첫 번째 이미지를 가진 자식 그룹 찾기
    for (const child of children) {
      const childImages = this.findPreviewImages(child.id, count, true);
      if (childImages.length > 0) {
        return childImages;
      }
    }

    // 모든 자식 그룹에도 이미지가 없음
    return [];
  }

  /**
   * 그룹의 모든 composite_hash 조회
   */
  static getCompositeHashesForGroup(groupId: number): string[] {
    const rows = db.prepare(`
      SELECT composite_hash
      FROM auto_folder_group_images
      WHERE group_id = ?
    `).all(groupId) as Array<{ composite_hash: string }>;

    return rows.map(r => r.composite_hash);
  }

  /**
   * 특정 이미지가 속한 모든 폴더 그룹 조회
   */
  static findGroupsByImage(compositeHash: string): AutoFolderGroup[] {
    const query = `
      SELECT afg.*
      FROM auto_folder_groups afg
      INNER JOIN auto_folder_group_images afgi ON afg.id = afgi.group_id
      WHERE afgi.composite_hash = ?
      ORDER BY afg.folder_path ASC
    `;

    const rows = db.prepare(query).all(compositeHash) as AutoFolderGroup[];
    return rows || [];
  }
}
