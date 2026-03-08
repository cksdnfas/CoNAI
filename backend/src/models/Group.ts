import { db } from '../database/init';
import { GroupRecord, ImageGroupRecord, GroupCreateData, GroupUpdateData, GroupWithStats, AutoCollectCondition } from '@conai/shared';
import { ImageMetadataRecord, ImageWithFileView } from '../types/image';
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate';
import { getGroupHierarchyService } from '../services/groupHierarchyService';

export class GroupModel {
  /**
   * 새 그룹 생성
   */
  static create(groupData: GroupCreateData): number {
    const conditionsJson = groupData.auto_collect_conditions ?
      JSON.stringify(groupData.auto_collect_conditions) : null;

    const info = db.prepare(`
      INSERT INTO groups (
        name, description, color, parent_id,
        auto_collect_enabled, auto_collect_conditions
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      groupData.name,
      groupData.description || null,
      groupData.color || null,
      groupData.parent_id || null,
      groupData.auto_collect_enabled ? 1 : 0,
      conditionsJson
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 그룹 조회 (ID)
   */
  static findById(id: number): GroupRecord | null {
    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRecord | undefined;
    return row || null;
  }

  /**
   * 모든 그룹 조회 (통계 포함)
   */
  static findAllWithStats(): GroupWithStats[] {
    const query = `
      SELECT
        g.*,
        COUNT(ig.id) as image_count,
        COUNT(CASE WHEN ig.collection_type = 'auto' THEN 1 END) as auto_collected_count,
        COUNT(CASE WHEN ig.collection_type = 'manual' THEN 1 END) as manual_added_count
      FROM groups g
      LEFT JOIN image_groups ig ON g.id = ig.group_id
      GROUP BY g.id
      ORDER BY g.created_date DESC
    `;

    const rows = db.prepare(query).all() as GroupWithStats[];
    return rows || [];
  }

  /**
   * 자동수집이 활성화된 그룹들 조회
   */
  static findAutoCollectEnabled(): GroupRecord[] {
    const rows = db.prepare(
      'SELECT * FROM groups WHERE auto_collect_enabled = 1 ORDER BY id'
    ).all() as GroupRecord[];
    return rows || [];
  }

  /**
   * 그룹 업데이트
   */
  static update(id: number, groupData: GroupUpdateData): boolean {
    // undefined 값 제거 및 데이터 변환
    const updates = filterDefined({
      name: groupData.name,
      description: groupData.description,
      color: groupData.color,
      parent_id: groupData.parent_id,
      auto_collect_enabled: groupData.auto_collect_enabled !== undefined
        ? (groupData.auto_collect_enabled ? 1 : 0)
        : undefined,
      auto_collect_conditions: groupData.auto_collect_conditions !== undefined
        ? (groupData.auto_collect_conditions ? JSON.stringify(groupData.auto_collect_conditions) : null)
        : undefined,
      updated_date: sqlLiteral('CURRENT_TIMESTAMP'), // SQL 함수 사용
    });

    if (Object.keys(updates).filter(k => k !== 'updated_date').length === 0) {
      return false; // updated_date만 있으면 업데이트 필요 없음
    }

    const { sql, values } = buildUpdateQuery('groups', updates, { id });
    const info = db.prepare(sql).run(...values);
    return info.changes > 0;
  }

  /**
   * 그룹 삭제
   * @param id 삭제할 그룹 ID
   * @param cascade true면 하위 그룹도 재귀적으로 삭제, false면 부모만 삭제 (하위 그룹은 루트로 이동)
   */
  static delete(id: number, cascade: boolean = false): boolean {
    if (cascade) {
      // 캐스케이드 삭제: 모든 하위 그룹도 재귀적으로 삭제
      const hierarchyService = getGroupHierarchyService();
      const descendants = hierarchyService.getDescendants(id);

      // 하위 그룹을 먼저 삭제 (깊이 역순)
      const sortedDescendants = [...descendants].sort((a, b) => b.depth - a.depth);
      for (const node of sortedDescendants) {
        db.prepare('DELETE FROM image_groups WHERE group_id = ?').run(node.id);
        db.prepare('DELETE FROM groups WHERE id = ?').run(node.id);
      }
    }

    // 먼저 관련된 image_groups 레코드 삭제
    db.prepare('DELETE FROM image_groups WHERE group_id = ?').run(id);

    // 그룹 삭제 (cascade=false면 자식들의 parent_id는 ON DELETE SET NULL에 의해 자동으로 NULL이 됨)
    const info = db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 자동수집 마지막 실행 시간 업데이트
   */
  static updateAutoCollectLastRun(id: number): boolean {
    const info = db.prepare(
      'UPDATE groups SET auto_collect_last_run = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(id);
    return info.changes > 0;
  }

  // ===== 계층 구조 관련 메서드 =====

  /**
   * 루트 그룹들 조회 (parent_id가 NULL인 그룹들)
   */
  static findRoots(): GroupWithStats[] {
    const query = `
      SELECT
        g.*,
        COUNT(ig.id) as image_count,
        COUNT(CASE WHEN ig.collection_type = 'auto' THEN 1 END) as auto_collected_count,
        COUNT(CASE WHEN ig.collection_type = 'manual' THEN 1 END) as manual_added_count
      FROM groups g
      LEFT JOIN image_groups ig ON g.id = ig.group_id
      WHERE g.parent_id IS NULL
      GROUP BY g.id
      ORDER BY g.created_date DESC
    `;

    const rows = db.prepare(query).all() as GroupWithStats[];
    return rows || [];
  }

  /**
   * 특정 부모의 자식 그룹들 조회
   */
  static findChildren(parentId: number): GroupWithStats[] {
    const query = `
      SELECT
        g.*,
        COUNT(ig.id) as image_count,
        COUNT(CASE WHEN ig.collection_type = 'auto' THEN 1 END) as auto_collected_count,
        COUNT(CASE WHEN ig.collection_type = 'manual' THEN 1 END) as manual_added_count
      FROM groups g
      LEFT JOIN image_groups ig ON g.id = ig.group_id
      WHERE g.parent_id = ?
      GROUP BY g.id
      ORDER BY g.created_date DESC
    `;

    const rows = db.prepare(query).all(parentId) as GroupWithStats[];
    return rows || [];
  }

  /**
   * 브레드크럼 경로 조회 (현재 그룹에서 루트까지)
   */
  static getBreadcrumbPath(groupId: number): Array<{ id: number; name: string; color: string | null }> {
    const hierarchyService = getGroupHierarchyService();
    const ancestors = hierarchyService.getAncestorPath(groupId);

    // depth 역순으로 정렬 (루트부터 현재까지)
    return ancestors.map(node => ({
      id: node.id,
      name: node.name,
      color: null // 필요하면 추가 쿼리로 조회
    }));
  }

  /**
   * 모든 그룹 조회 (자식 개수 포함)
   */
  static findAllWithHierarchy(): Array<GroupWithStats & { child_count: number; has_children: boolean }> {
    const groups = this.findAllWithStats();
    const hierarchyService = getGroupHierarchyService();

    const groupIds = groups.map(g => g.id);
    const childCountMap = hierarchyService.getChildCountBatch(groupIds);

    return groups.map(group => ({
      ...group,
      child_count: childCountMap.get(group.id) || 0,
      has_children: (childCountMap.get(group.id) || 0) > 0
    }));
  }

  /**
   * 특정 부모의 자식 그룹들 조회 (자식 개수 포함)
   */
  static findChildrenWithHierarchy(parentId: number | null): Array<GroupWithStats & { child_count: number; has_children: boolean }> {
    const groups = parentId === null
      ? this.findRoots()
      : this.findChildren(parentId);

    const hierarchyService = getGroupHierarchyService();
    const groupIds = groups.map(g => g.id);
    const childCountMap = hierarchyService.getChildCountBatch(groupIds);

    return groups.map(group => ({
      ...group,
      child_count: childCountMap.get(group.id) || 0,
      has_children: (childCountMap.get(group.id) || 0) > 0
    }));
  }
}

export class ImageGroupModel {
  /**
   * 이미지를 그룹에 추가 (composite_hash 기반)
   */
  static addImageToGroup(
    groupId: number,
    compositeHash: string,
    collectionType: 'manual' | 'auto' = 'manual',
    orderIndex: number = 0
  ): boolean {
    try {
      db.prepare(`
        INSERT INTO image_groups (
          group_id, composite_hash, order_index, collection_type
        ) VALUES (?, ?, ?, ?)
      `).run(groupId, compositeHash, orderIndex, collectionType);
      return true;
    } catch (error) {
      // UNIQUE 제약 위반 시 (이미 추가됨)
      return false;
    }
  }


  /**
   * 그룹에서 이미지 제거 (composite_hash 기반)
   */
  static removeImageFromGroup(groupId: number, compositeHash: string): boolean {
    const info = db.prepare(
      'DELETE FROM image_groups WHERE group_id = ? AND composite_hash = ?'
    ).run(groupId, compositeHash);
    return info.changes > 0;
  }


  /**
   * 특정 그룹의 모든 자동수집 이미지 제거
   */
  static removeAutoCollectedImages(groupId: number): number {
    const info = db.prepare(
      'DELETE FROM image_groups WHERE group_id = ? AND collection_type = ?'
    ).run(groupId, 'auto');
    return info.changes;
  }

  /**
   * 특정 그룹의 이미지 목록 조회 (메타데이터만)
   */
  static findImagesByGroup(
    groupId: number,
    page: number = 1,
    limit: number = 20,
    collectionType?: 'manual' | 'auto'
  ): { images: ImageWithFileView[], total: number } {
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE ig.group_id = ? AND ig.composite_hash IS NOT NULL';
    let queryParams: (number | string)[] = [groupId];

    if (collectionType) {
      whereClause += ' AND ig.collection_type = ?';
      queryParams.push(collectionType);
    }

    // 총 개수 조회 (composite_hash 있는 것만)
    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM image_groups ig ${whereClause}`
    ).get(...queryParams) as any;
    const total = countRow.total;

    // 메타데이터 조회 (composite_hash 기반, 해시 생성 완료된 이미지만)
    // ✅ 해시당 1개 항목만 반환 (중복 제거)
    // ✅ LEFT JOIN으로 비디오 파일도 포함 (메타데이터 없어도 조회 가능)
    const query = `
      SELECT
        COALESCE(im.composite_hash, ig.composite_hash) as composite_hash,
        im.width,
        im.height,
        im.thumbnail_path,
        im.prompt,
        im.negative_prompt,
        im.seed,
        im.steps,
        im.cfg_scale,
        im.sampler,
        im.model_name as model,
        im.first_seen_date as created_date,
        im.rating_score,
        (SELECT id FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as id,
        (SELECT original_file_path FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as original_file_path,
        (SELECT file_status FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as file_status,
        (SELECT file_type FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as file_type,
        (SELECT file_size FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as file_size,
        (SELECT mime_type FROM image_files WHERE composite_hash = ig.composite_hash AND file_status = 'active' LIMIT 1) as mime_type,
        ig.collection_type
      FROM image_groups ig
      LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
      ${whereClause}
      GROUP BY ig.composite_hash
      ORDER BY ig.order_index ASC, ig.added_date DESC
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(query).all(...queryParams, limit, offset) as ImageWithFileView[];

    // 🔍 DEBUG: Check first row from database
    if (rows.length > 0) {
      console.log('[DEBUG Group.ts:findImagesByGroup] First row from DB:', {
        composite_hash: rows[0].composite_hash,
        id: rows[0].id,
        file_type: rows[0].file_type,
        mime_type: rows[0].mime_type,
        file_size: rows[0].file_size
      });
    }

    return { images: rows, total };
  }

  /**
   * 특정 그룹의 이미지 목록 조회 (파일 경로 포함)
   * 다운로드 기능 등에서 사용
   */
  static findImagesByGroupWithFiles(
    groupId: number,
    page: number = 1,
    limit: number = 20,
    collectionType?: 'manual' | 'auto'
  ): { images: ImageWithFileView[], total: number } {
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE ig.group_id = ? AND ig.composite_hash IS NOT NULL';
    let queryParams: (number | string)[] = [groupId];

    if (collectionType) {
      whereClause += ' AND ig.collection_type = ?';
      queryParams.push(collectionType);
    }

    // 총 개수 조회 (composite_hash 있는 것만)
    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM image_groups ig ${whereClause}`
    ).get(...queryParams) as any;
    const total = countRow.total;

    // 메타데이터 + 파일 정보 조회 (해시 생성 완료된 이미지만)
    const query = `
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_status,
        if.folder_id,
        wf.folder_name
      FROM image_groups ig
      INNER JOIN media_metadata im ON ig.composite_hash = im.composite_hash
      LEFT JOIN image_files if ON if.composite_hash = im.composite_hash AND if.file_status = 'active'
      LEFT JOIN watched_folders wf ON if.folder_id = wf.id
      ${whereClause}
      ORDER BY ig.order_index ASC, ig.added_date DESC
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(query).all(...queryParams, limit, offset) as ImageWithFileView[];

    return { images: rows, total };
  }

  /**
   * 특정 이미지가 속한 그룹들 조회 (composite_hash 기반)
   */
  static findGroupsByImage(compositeHash: string): ImageGroupRecord[] {
    const query = `
      SELECT ig.*, g.name as group_name
      FROM image_groups ig
      INNER JOIN groups g ON ig.group_id = g.id
      WHERE ig.composite_hash = ?
      ORDER BY ig.added_date DESC
    `;

    const rows = db.prepare(query).all(compositeHash) as any[];
    return rows || [];
  }

  /**
   * 이미지가 특정 그룹에 속해있는지 확인 (composite_hash 기반)
   */
  static isImageInGroup(groupId: number, compositeHash: string): boolean {
    const row = db.prepare(
      'SELECT 1 FROM image_groups WHERE group_id = ? AND composite_hash = ?'
    ).get(groupId, compositeHash);
    return !!row;
  }

  /**
   * 이미지의 collection_type 조회 (composite_hash 기반)
   */
  static getCollectionType(groupId: number, compositeHash: string): 'manual' | 'auto' | null {
    const row = db.prepare(
      'SELECT collection_type FROM image_groups WHERE group_id = ? AND composite_hash = ?'
    ).get(groupId, compositeHash) as any;
    return row ? row.collection_type : null;
  }

  /**
   * 자동수집 이미지를 수동 수집으로 변환 (composite_hash 기반)
   */
  static convertToManual(groupId: number, compositeHash: string): boolean {
    const info = db.prepare(`
      UPDATE image_groups
      SET collection_type = 'manual'
      WHERE group_id = ? AND composite_hash = ? AND collection_type = 'auto'
    `).run(groupId, compositeHash);
    return info.changes > 0;
  }

  /**
   * 그룹의 랜덤 이미지 조회 (썸네일용)
   */
  static findRandomImageForGroup(groupId: number): ImageMetadataRecord | null {
    // ✅ LEFT JOIN으로 비디오 파일도 포함
    const query = `
      SELECT
        COALESCE(im.composite_hash, ig.composite_hash) as composite_hash,
        im.width,
        im.height,
        im.format,
        im.thumbnail_path,
        im.prompt,
        im.negative_prompt,
        im.seed,
        im.steps,
        im.cfg_scale,
        im.sampler,
        im.model,
        im.upscaler,
        im.upscale_factor,
        im.denoising_strength,
        im.hires_upscaler,
        im.created_date,
        im.positive_tags,
        im.negative_tags,
        im.caption
      FROM image_groups ig
      LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
      WHERE ig.group_id = ?
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
    // ✅ image_files 테이블과 JOIN하여 파일 정보 포함
    const query = `
      SELECT DISTINCT
        COALESCE(im.composite_hash, ig.composite_hash) as composite_hash,
        im.perceptual_hash,
        im.dhash,
        im.ahash,
        im.color_histogram,
        im.width,
        im.height,
        im.thumbnail_path,
        im.ai_tool,
        im.model_name,
        im.lora_models,
        im.steps,
        im.cfg_scale,
        im.sampler,
        im.seed,
        im.scheduler,
        im.prompt,
        im.negative_prompt,
        im.denoise_strength,
        im.generation_time,
        im.batch_size,
        im.batch_index,
        im.auto_tags,
        im.duration,
        im.fps,
        im.video_codec,
        im.audio_codec,
        im.bitrate,
        im.rating_score,
        im.first_seen_date,
        im.metadata_updated_date,
        if.id as file_id,
        if.original_file_path,
        if.file_status,
        if.file_type,
        if.mime_type,
        if.folder_id,
        f.folder_name
      FROM image_groups ig
      LEFT JOIN media_metadata im ON ig.composite_hash = im.composite_hash
      LEFT JOIN image_files if ON ig.composite_hash = if.composite_hash
        AND if.file_status = 'active'
      LEFT JOIN watched_folders f ON if.folder_id = f.id
      WHERE ig.group_id = ?
      ORDER BY RANDOM()
      LIMIT ?
    `;

    const rows = db.prepare(query).all(groupId, count) as ImageWithFileView[];

    // 이미지가 충분히 있거나, 자식 검색을 안 하면 바로 반환
    if (rows.length > 0 || !includeChildren) {
      return rows;
    }

    // 2. 이미지가 없으면 자식 그룹에서 검색 (재귀)
    const children = GroupModel.findChildren(groupId);

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
   * 그룹에 속한 모든 composite_hash 조회
   */
  static getCompositeHashesForGroup(groupId: number): string[] {
    const query = `
      SELECT composite_hash
      FROM image_groups
      WHERE group_id = ?
      ORDER BY order_index ASC, added_date DESC
    `;

    const rows = db.prepare(query).all(groupId) as { composite_hash: string }[];
    return rows.map(row => row.composite_hash);
  }

  /**
   * 그룹에 속한 모든 image_files.id 조회 (선택 기능용)
   * composite_hash가 같아도 서로 다른 파일로 구분됨
   */
  static getImageFileIdsForGroup(groupId: number): number[] {
    const query = `
      SELECT if.id
      FROM image_groups ig
      INNER JOIN image_files if ON ig.composite_hash = if.composite_hash
      WHERE ig.group_id = ?
        AND if.file_status = 'active'
      ORDER BY ig.order_index ASC, ig.added_date DESC, if.id ASC
    `;

    const rows = db.prepare(query).all(groupId) as { id: number }[];
    return rows.map(row => row.id);
  }
}
