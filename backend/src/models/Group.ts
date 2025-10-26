import { db } from '../database/init';
import { GroupRecord, ImageGroupRecord, GroupCreateData, GroupUpdateData, GroupWithStats, AutoCollectCondition } from '@comfyui-image-manager/shared';

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
   * 이미지를 그룹에 추가
   */
  static async addImageToGroup(
    groupId: number,
    imageId: number,
    collectionType: 'manual' | 'auto' = 'manual',
    orderIndex: number = 0
  ): Promise<number> {
    const autoCollectedDate = collectionType === 'auto' ? new Date().toISOString() : null;

    const info = db.prepare(`
      INSERT OR IGNORE INTO image_groups (
        group_id, image_id, order_index, collection_type, auto_collected_date
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      groupId,
      imageId,
      orderIndex,
      collectionType,
      autoCollectedDate
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 그룹에서 이미지 제거
   */
  static async removeImageFromGroup(groupId: number, imageId: number): Promise<boolean> {
    const info = db.prepare(
      'DELETE FROM image_groups WHERE group_id = ? AND image_id = ?'
    ).run(groupId, imageId);
    return info.changes > 0;
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
   * 특정 그룹의 이미지 목록 조회
   */
  static async findImagesByGroup(
    groupId: number,
    page: number = 1,
    limit: number = 20,
    collectionType?: 'manual' | 'auto'
  ): Promise<{ images: any[], total: number }> {
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

    // 페이지네이션된 데이터 조회
    const query = `
      SELECT
        i.*,
        ig.collection_type,
        ig.added_date,
        ig.auto_collected_date,
        ig.order_index,
        GROUP_CONCAT(g2.id) as group_ids,
        GROUP_CONCAT(g2.name) as group_names,
        GROUP_CONCAT(g2.color) as group_colors,
        GROUP_CONCAT(ig2.collection_type) as collection_types
      FROM image_groups ig
      INNER JOIN images i ON ig.image_id = i.id
      LEFT JOIN image_groups ig2 ON i.id = ig2.image_id
      LEFT JOIN groups g2 ON ig2.group_id = g2.id
      ${whereClause}
      GROUP BY i.id, ig.collection_type, ig.added_date, ig.auto_collected_date, ig.order_index
      ORDER BY ig.order_index ASC, ig.added_date DESC
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(query).all(...queryParams, limit, offset) as any[];

    // 그룹 정보 파싱
    const enrichedImages = rows.map(row => ({
      ...row,
      groups: row.group_names ? row.group_names.split(',').map((name: string, index: number) => ({
        id: parseInt(row.group_ids.split(',')[index]),
        name,
        color: row.group_colors.split(',')[index] || null,
        collection_type: row.collection_types.split(',')[index]
      })) : []
    }));

    return { images: enrichedImages, total };
  }

  /**
   * 특정 이미지가 속한 그룹들 조회
   */
  static async findGroupsByImage(imageId: number): Promise<ImageGroupRecord[]> {
    const query = `
      SELECT ig.*, g.name as group_name
      FROM image_groups ig
      INNER JOIN groups g ON ig.group_id = g.id
      WHERE ig.image_id = ?
      ORDER BY ig.added_date DESC
    `;

    const rows = db.prepare(query).all(imageId) as any[];
    return rows || [];
  }

  /**
   * 이미지가 특정 그룹에 속해있는지 확인
   */
  static async isImageInGroup(groupId: number, imageId: number): Promise<boolean> {
    const row = db.prepare(
      'SELECT 1 FROM image_groups WHERE group_id = ? AND image_id = ?'
    ).get(groupId, imageId);
    return !!row;
  }

  /**
   * 이미지의 collection_type 조회
   */
  static async getCollectionType(groupId: number, imageId: number): Promise<'manual' | 'auto' | null> {
    const row = db.prepare(
      'SELECT collection_type FROM image_groups WHERE group_id = ? AND image_id = ?'
    ).get(groupId, imageId) as any;
    return row ? row.collection_type : null;
  }

  /**
   * 자동수집 이미지를 수동 수집으로 변환
   */
  static async convertToManual(groupId: number, imageId: number): Promise<boolean> {
    const info = db.prepare(`
      UPDATE image_groups
      SET collection_type = 'manual', auto_collected_date = NULL
      WHERE group_id = ? AND image_id = ? AND collection_type = 'auto'
    `).run(groupId, imageId);
    return info.changes > 0;
  }

  /**
   * 그룹의 랜덤 이미지 조회 (썸네일용)
   */
  static async findRandomImageForGroup(groupId: number): Promise<any | null> {
    const query = `
      SELECT i.id, i.filename, i.thumbnail_path, i.file_path
      FROM image_groups ig
      INNER JOIN images i ON ig.image_id = i.id
      WHERE ig.group_id = ?
      ORDER BY RANDOM()
      LIMIT 1
    `;

    const row = db.prepare(query).get(groupId) as any;
    return row || null;
  }

  /**
   * 그룹에 속한 모든 이미지 ID 조회 (랜덤 선택용)
   */
  static async getImageIdsForGroup(groupId: number): Promise<number[]> {
    const query = `
      SELECT i.id
      FROM image_groups ig
      INNER JOIN images i ON ig.image_id = i.id
      WHERE ig.group_id = ?
      ORDER BY ig.order_index ASC, ig.added_date DESC
    `;

    const rows = db.prepare(query).all(groupId) as { id: number }[];
    return rows.map(row => row.id);
  }
}
