import { db } from '../database/init';
import { GroupRecord, ImageGroupRecord, GroupCreateData, GroupUpdateData, GroupWithStats, AutoCollectCondition } from '../types/group';

export class GroupModel {
  /**
   * 새 그룹 생성
   */
  static create(groupData: GroupCreateData): Promise<number> {
    return new Promise((resolve, reject) => {
      const conditionsJson = groupData.auto_collect_conditions ?
        JSON.stringify(groupData.auto_collect_conditions) : null;

      const stmt = db.prepare(`
        INSERT INTO groups (
          name, description, color, parent_id,
          auto_collect_enabled, auto_collect_conditions
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run([
        groupData.name,
        groupData.description || null,
        groupData.color || null,
        groupData.parent_id || null,
        groupData.auto_collect_enabled ? 1 : 0,
        conditionsJson
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });

      stmt.finalize();
    });
  }

  /**
   * 그룹 조회 (ID)
   */
  static findById(id: number): Promise<GroupRecord | null> {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM groups WHERE id = ?',
        [id],
        (err, row: GroupRecord) => {
          if (err) {
            reject(err);
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * 모든 그룹 조회 (통계 포함)
   */
  static findAllWithStats(): Promise<GroupWithStats[]> {
    return new Promise((resolve, reject) => {
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

      db.all(query, (err, rows: GroupWithStats[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * 자동수집이 활성화된 그룹들 조회
   */
  static findAutoCollectEnabled(): Promise<GroupRecord[]> {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM groups WHERE auto_collect_enabled = 1 ORDER BY id',
        (err, rows: GroupRecord[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * 그룹 업데이트
   */
  static update(id: number, groupData: GroupUpdateData): Promise<boolean> {
    return new Promise((resolve, reject) => {
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
        resolve(false);
        return;
      }

      fields.push('updated_date = CURRENT_TIMESTAMP');
      values.push(id);

      const query = `UPDATE groups SET ${fields.join(', ')} WHERE id = ?`;

      db.run(query, values, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  /**
   * 그룹 삭제
   */
  static delete(id: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // 먼저 관련된 image_groups 레코드 삭제
      db.run('DELETE FROM image_groups WHERE group_id = ?', [id], (err) => {
        if (err) {
          reject(err);
          return;
        }

        // 그룹 삭제
        db.run('DELETE FROM groups WHERE id = ?', [id], function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        });
      });
    });
  }

  /**
   * 자동수집 마지막 실행 시간 업데이트
   */
  static updateAutoCollectLastRun(id: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE groups SET auto_collect_last_run = CURRENT_TIMESTAMP WHERE id = ?',
        [id],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
  }
}

export class ImageGroupModel {
  /**
   * 이미지를 그룹에 추가
   * - INSERT OR IGNORE를 사용하여 기존 레코드의 collection_type을 보존
   * - 이미 존재하는 이미지는 추가하지 않음 (manual/auto 관계없이)
   */
  static addImageToGroup(
    groupId: number,
    imageId: number,
    collectionType: 'manual' | 'auto' = 'manual',
    orderIndex: number = 0
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const autoCollectedDate = collectionType === 'auto' ? new Date().toISOString() : null;

      const stmt = db.prepare(`
        INSERT OR IGNORE INTO image_groups (
          group_id, image_id, order_index, collection_type, auto_collected_date
        ) VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run([
        groupId,
        imageId,
        orderIndex,
        collectionType,
        autoCollectedDate
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });

      stmt.finalize();
    });
  }

  /**
   * 그룹에서 이미지 제거
   */
  static removeImageFromGroup(groupId: number, imageId: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM image_groups WHERE group_id = ? AND image_id = ?',
        [groupId, imageId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  /**
   * 특정 그룹의 모든 자동수집 이미지 제거
   */
  static removeAutoCollectedImages(groupId: number): Promise<number> {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM image_groups WHERE group_id = ? AND collection_type = ?',
        [groupId, 'auto'],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
  }

  /**
   * 특정 그룹의 이미지 목록 조회
   */
  static findImagesByGroup(
    groupId: number,
    page: number = 1,
    limit: number = 20,
    collectionType?: 'manual' | 'auto'
  ): Promise<{ images: any[], total: number }> {
    return new Promise((resolve, reject) => {
      const offset = (page - 1) * limit;
      let whereClause = 'WHERE ig.group_id = ?';
      let queryParams: (number | string)[] = [groupId];

      if (collectionType) {
        whereClause += ' AND ig.collection_type = ?';
        queryParams.push(collectionType);
      }

      // 총 개수 조회
      db.get(
        `SELECT COUNT(*) as total FROM image_groups ig ${whereClause}`,
        queryParams,
        (err, countRow: any) => {
          if (err) {
            reject(err);
            return;
          }

          const total = countRow.total;

          // 페이지네이션된 데이터 조회 (그룹 정보 포함)
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

          db.all(
            query,
            [...queryParams, limit, offset],
            (err, rows: any[]) => {
              if (err) {
                reject(err);
              } else {
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

                resolve({ images: enrichedImages, total });
              }
            }
          );
        }
      );
    });
  }

  /**
   * 특정 이미지가 속한 그룹들 조회
   */
  static findGroupsByImage(imageId: number): Promise<ImageGroupRecord[]> {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT ig.*, g.name as group_name
        FROM image_groups ig
        INNER JOIN groups g ON ig.group_id = g.id
        WHERE ig.image_id = ?
        ORDER BY ig.added_date DESC
      `;

      db.all(query, [imageId], (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * 이미지가 특정 그룹에 속해있는지 확인
   */
  static isImageInGroup(groupId: number, imageId: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT 1 FROM image_groups WHERE group_id = ? AND image_id = ?',
        [groupId, imageId],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(!!row);
          }
        }
      );
    });
  }

  /**
   * 이미지의 collection_type 조회
   */
  static getCollectionType(groupId: number, imageId: number): Promise<'manual' | 'auto' | null> {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT collection_type FROM image_groups WHERE group_id = ? AND image_id = ?',
        [groupId, imageId],
        (err, row: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(row ? row.collection_type : null);
          }
        }
      );
    });
  }

  /**
   * 자동수집 이미지를 수동 수집으로 변환
   * - 사용자가 자동수집된 이미지를 수동으로 추가할 때 사용
   * - 이후 자동수집 조건 변경 시에도 유지됨
   */
  static convertToManual(groupId: number, imageId: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE image_groups
         SET collection_type = 'manual', auto_collected_date = NULL
         WHERE group_id = ? AND image_id = ? AND collection_type = 'auto'`,
        [groupId, imageId],
        function(err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes > 0);
          }
        }
      );
    });
  }

  /**
   * 그룹의 랜덤 이미지 조회 (썸네일용)
   */
  static findRandomImageForGroup(groupId: number): Promise<any | null> {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT i.id, i.filename, i.thumbnail_path, i.file_path
        FROM image_groups ig
        INNER JOIN images i ON ig.image_id = i.id
        WHERE ig.group_id = ?
        ORDER BY RANDOM()
        LIMIT 1
      `;

      db.get(query, [groupId], (err, row: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(row || null);
        }
      });
    });
  }
}