import { db } from '../database/init';
import { GroupRecord, ImageGroupRecord, GroupCreateData, GroupUpdateData, GroupWithStats, AutoCollectCondition } from '@comfyui-image-manager/shared';
import { ImageMetadataRecord, ImageWithFileView } from '../types/image';

export class GroupModel {
  /**
   * 새 그룹 생성
   */
  static async create(groupData: GroupCreateData): Promise<number> {
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
  static async findById(id: number): Promise<GroupRecord | null> {
    const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as GroupRecord | undefined;
    return row || null;
  }

  /**
   * 모든 그룹 조회 (통계 포함)
   */
  static async findAllWithStats(): Promise<GroupWithStats[]> {
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
  static async findAutoCollectEnabled(): Promise<GroupRecord[]> {
    const rows = db.prepare(
      'SELECT * FROM groups WHERE auto_collect_enabled = 1 ORDER BY id'
    ).all() as GroupRecord[];
    return rows || [];
  }

  /**
   * 그룹 업데이트
   */
  static async update(id: number, groupData: GroupUpdateData): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (groupData.name !== undefined) {
      fields.push('name = ?');
      values.push(groupData.name);
    }
    if (groupData.description !== undefined) {
      fields.push('description = ?');
      values.push(groupData.description);
    }
    if (groupData.color !== undefined) {
      fields.push('color = ?');
      values.push(groupData.color);
    }
    if (groupData.parent_id !== undefined) {
      fields.push('parent_id = ?');
      values.push(groupData.parent_id);
    }
    if (groupData.auto_collect_enabled !== undefined) {
      fields.push('auto_collect_enabled = ?');
      values.push(groupData.auto_collect_enabled ? 1 : 0);
    }
    if (groupData.auto_collect_conditions !== undefined) {
      fields.push('auto_collect_conditions = ?');
      values.push(groupData.auto_collect_conditions ? JSON.stringify(groupData.auto_collect_conditions) : null);
    }

    if (fields.length === 0) {
      return false;
    }

    fields.push('updated_date = CURRENT_TIMESTAMP');
    values.push(id);

    const query = `UPDATE groups SET ${fields.join(', ')} WHERE id = ?`;
    const info = db.prepare(query).run(...values);
    return info.changes > 0;
  }

  /**
   * 그룹 삭제
   */
  static async delete(id: number): Promise<boolean> {
    // 먼저 관련된 image_groups 레코드 삭제
    db.prepare('DELETE FROM image_groups WHERE group_id = ?').run(id);

    // 그룹 삭제
    const info = db.prepare('DELETE FROM groups WHERE id = ?').run(id);
    return info.changes > 0;
  }

  /**
   * 자동수집 마지막 실행 시간 업데이트
   */
  static async updateAutoCollectLastRun(id: number): Promise<boolean> {
    const info = db.prepare(
      'UPDATE groups SET auto_collect_last_run = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(id);
    return info.changes > 0;
  }
}

export class ImageGroupModel {
  /**
   * 이미지를 그룹에 추가 (composite_hash 기반)
   */
  static async addImageToGroup(
    groupId: number,
    compositeHash: string,
    collectionType: 'manual' | 'auto' = 'manual',
    orderIndex: number = 0
  ): Promise<boolean> {
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
   * 레거시: imageId로 그룹에 추가 (호환성 유지)
   * @deprecated composite_hash 사용 권장
   */
  static async addImageToGroupByImageId(
    groupId: number,
    imageId: number,
    collectionType: 'manual' | 'auto' = 'manual',
    orderIndex: number = 0
  ): Promise<number> {
    // image_files를 통해 composite_hash 조회
    const file = db.prepare(`
      SELECT if.composite_hash
      FROM image_files if
      JOIN images i ON if.original_file_path LIKE '%' || i.file_path
      WHERE i.id = ?
      LIMIT 1
    `).get(imageId) as { composite_hash: string } | undefined;

    if (!file) {
      throw new Error(`이미지 ID ${imageId}에 대한 composite_hash를 찾을 수 없습니다`);
    }

    await this.addImageToGroup(groupId, file.composite_hash, collectionType, orderIndex);
    return 1; // 레거시 호환용
  }

  /**
   * 그룹에서 이미지 제거 (composite_hash 기반)
   */
  static async removeImageFromGroup(groupId: number, compositeHash: string): Promise<boolean> {
    const info = db.prepare(
      'DELETE FROM image_groups WHERE group_id = ? AND composite_hash = ?'
    ).run(groupId, compositeHash);
    return info.changes > 0;
  }

  /**
   * 레거시: imageId로 그룹에서 제거 (호환성 유지)
   * @deprecated composite_hash 사용 권장
   */
  static async removeImageFromGroupByImageId(groupId: number, imageId: number): Promise<boolean> {
    // image_files를 통해 composite_hash 조회
    const file = db.prepare(`
      SELECT if.composite_hash
      FROM image_files if
      JOIN images i ON if.original_file_path LIKE '%' || i.file_path
      WHERE i.id = ?
      LIMIT 1
    `).get(imageId) as { composite_hash: string } | undefined;

    if (!file) {
      return false;
    }

    return await this.removeImageFromGroup(groupId, file.composite_hash);
  }

  /**
   * 특정 그룹의 모든 자동수집 이미지 제거
   */
  static async removeAutoCollectedImages(groupId: number): Promise<number> {
    const info = db.prepare(
      'DELETE FROM image_groups WHERE group_id = ? AND collection_type = ?'
    ).run(groupId, 'auto');
    return info.changes;
  }

  /**
   * 특정 그룹의 이미지 목록 조회 (메타데이터만)
   */
  static async findImagesByGroup(
    groupId: number,
    page: number = 1,
    limit: number = 20,
    collectionType?: 'manual' | 'auto'
  ): Promise<{ images: ImageMetadataRecord[], total: number }> {
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE ig.group_id = ?';
    let queryParams: (number | string)[] = [groupId];

    if (collectionType) {
      whereClause += ' AND ig.collection_type = ?';
      queryParams.push(collectionType);
    }

    // 총 개수 조회
    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM image_groups ig ${whereClause}`
    ).get(...queryParams) as any;
    const total = countRow.total;

    // 메타데이터 조회 (composite_hash 기반)
    const query = `
      SELECT im.*
      FROM image_groups ig
      INNER JOIN image_metadata im ON ig.composite_hash = im.composite_hash
      ${whereClause}
      ORDER BY ig.order_index ASC, ig.added_date DESC
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(query).all(...queryParams, limit, offset) as ImageMetadataRecord[];

    return { images: rows, total };
  }

  /**
   * 특정 그룹의 이미지 목록 조회 (파일 경로 포함)
   * 다운로드 기능 등에서 사용
   */
  static async findImagesByGroupWithFiles(
    groupId: number,
    page: number = 1,
    limit: number = 20,
    collectionType?: 'manual' | 'auto'
  ): Promise<{ images: ImageWithFileView[], total: number }> {
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE ig.group_id = ?';
    let queryParams: (number | string)[] = [groupId];

    if (collectionType) {
      whereClause += ' AND ig.collection_type = ?';
      queryParams.push(collectionType);
    }

    // 총 개수 조회
    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM image_groups ig ${whereClause}`
    ).get(...queryParams) as any;
    const total = countRow.total;

    // 메타데이터 + 파일 정보 조회
    const query = `
      SELECT
        im.*,
        if.id as file_id,
        if.original_file_path,
        if.file_status,
        if.folder_id,
        wf.folder_name
      FROM image_groups ig
      INNER JOIN image_metadata im ON ig.composite_hash = im.composite_hash
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
  static async findGroupsByImage(compositeHash: string): Promise<ImageGroupRecord[]> {
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
  static async isImageInGroup(groupId: number, compositeHash: string): Promise<boolean> {
    const row = db.prepare(
      'SELECT 1 FROM image_groups WHERE group_id = ? AND composite_hash = ?'
    ).get(groupId, compositeHash);
    return !!row;
  }

  /**
   * 이미지의 collection_type 조회 (composite_hash 기반)
   */
  static async getCollectionType(groupId: number, compositeHash: string): Promise<'manual' | 'auto' | null> {
    const row = db.prepare(
      'SELECT collection_type FROM image_groups WHERE group_id = ? AND composite_hash = ?'
    ).get(groupId, compositeHash) as any;
    return row ? row.collection_type : null;
  }

  /**
   * 자동수집 이미지를 수동 수집으로 변환 (composite_hash 기반)
   */
  static async convertToManual(groupId: number, compositeHash: string): Promise<boolean> {
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
  static async findRandomImageForGroup(groupId: number): Promise<ImageMetadataRecord | null> {
    const query = `
      SELECT im.*
      FROM image_groups ig
      INNER JOIN image_metadata im ON ig.composite_hash = im.composite_hash
      WHERE ig.group_id = ?
      ORDER BY RANDOM()
      LIMIT 1
    `;

    const row = db.prepare(query).get(groupId) as ImageMetadataRecord | undefined;
    return row || null;
  }

  /**
   * 그룹에 속한 모든 composite_hash 조회
   */
  static async getCompositeHashesForGroup(groupId: number): Promise<string[]> {
    const query = `
      SELECT composite_hash
      FROM image_groups
      WHERE group_id = ?
      ORDER BY order_index ASC, added_date DESC
    `;

    const rows = db.prepare(query).all(groupId) as { composite_hash: string }[];
    return rows.map(row => row.composite_hash);
  }
}
