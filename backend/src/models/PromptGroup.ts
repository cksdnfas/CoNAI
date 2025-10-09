import { db } from '../database/init';
import {
  PromptGroupRecord,
  NegativePromptGroupRecord,
  PromptGroupData,
  PromptGroupWithPrompts,
  GroupImportData
} from '../types/promptGroup';

export class PromptGroupModel {
  /**
   * 새로운 그룹 생성
   */
  static create(data: PromptGroupData, type: 'positive' | 'negative' = 'positive'): Promise<number> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';

      // display_order가 없으면 자동으로 최대값 + 1
      if (data.display_order === undefined) {
        db.get(
          `SELECT MAX(display_order) as max_order FROM ${tableName}`,
          [],
          (err, row: any) => {
            if (err) {
              reject(err);
              return;
            }

            const nextOrder = (row.max_order || 0) + 1;
            this.insertGroup(tableName, { ...data, display_order: nextOrder }, resolve, reject);
          }
        );
      } else {
        this.insertGroup(tableName, data, resolve, reject);
      }
    });
  }

  private static insertGroup(
    tableName: string,
    data: PromptGroupData,
    resolve: (id: number) => void,
    reject: (error: Error) => void
  ) {
    const stmt = db.prepare(`
      INSERT INTO ${tableName} (group_name, display_order, is_visible)
      VALUES (?, ?, ?)
    `);

    stmt.run([
      data.group_name,
      data.display_order || 0,
      data.is_visible !== undefined ? data.is_visible : true
    ], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.lastID);
      }
    });

    stmt.finalize();
  }

  /**
   * 모든 그룹 조회 (display_order 순)
   */
  static findAll(
    includeHidden: boolean = false,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupRecord[]> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';
      const visibilityFilter = includeHidden ? '' : 'WHERE is_visible = 1';

      db.all(
        `SELECT * FROM ${tableName} ${visibilityFilter} ORDER BY display_order ASC`,
        [],
        (err, rows: PromptGroupRecord[]) => {
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
   * 프롬프트 수와 함께 그룹 조회
   */
  static findAllWithCounts(
    includeHidden: boolean = false,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupWithPrompts[]> {
    return new Promise((resolve, reject) => {
      const groupTableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';
      const promptTableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';
      const visibilityFilter = includeHidden ? '' : 'WHERE g.is_visible = 1';

      db.all(
        `SELECT
           g.*,
           COUNT(p.id) as prompt_count
         FROM ${groupTableName} g
         LEFT JOIN ${promptTableName} p ON g.id = p.group_id
         ${visibilityFilter}
         GROUP BY g.id
         ORDER BY g.display_order ASC`,
        [],
        (err, rows: PromptGroupWithPrompts[]) => {
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
   * 특정 그룹 조회
   */
  static findById(
    id: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupRecord | null> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';

      db.get(
        `SELECT * FROM ${tableName} WHERE id = ?`,
        [id],
        (err, row: PromptGroupRecord | undefined) => {
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
   * 그룹명으로 조회
   */
  static findByName(
    groupName: string,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupRecord | null> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';

      db.get(
        `SELECT * FROM ${tableName} WHERE group_name = ?`,
        [groupName],
        (err, row: PromptGroupRecord | undefined) => {
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
   * 그룹 정보 업데이트
   */
  static update(
    id: number,
    data: Partial<PromptGroupData>,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';

      const updateFields: string[] = [];
      const values: any[] = [];

      if (data.group_name !== undefined) {
        updateFields.push('group_name = ?');
        values.push(data.group_name);
      }

      if (data.display_order !== undefined) {
        updateFields.push('display_order = ?');
        values.push(data.display_order);
      }

      if (data.is_visible !== undefined) {
        updateFields.push('is_visible = ?');
        values.push(data.is_visible);
      }

      if (updateFields.length === 0) {
        resolve(false);
        return;
      }

      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      db.run(
        `UPDATE ${tableName} SET ${updateFields.join(', ')} WHERE id = ?`,
        values,
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
   * 그룹 삭제
   */
  static delete(
    id: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';

      db.run(
        `DELETE FROM ${tableName} WHERE id = ?`,
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

  /**
   * 그룹들의 ID 일괄 재배치 (JSON 가져오기용)
   */
  static reassignGroupIds(
    groupData: GroupImportData[],
    type: 'positive' | 'negative' = 'positive'
  ): Promise<{ old_id: number; new_id: number; group_name: string }[]> {
    return new Promise(async (resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';
      const reassignments: { old_id: number; new_id: number; group_name: string }[] = [];

      try {
        // 1. 기존 그룹들 조회
        const existingGroups = await this.findAll(true, type);

        // 2. 임시 테이블 생성 및 기존 데이터 백업
        await new Promise<void>((res, rej) => {
          db.run(`CREATE TEMPORARY TABLE temp_${tableName} AS SELECT * FROM ${tableName}`, (err) => {
            if (err) rej(err);
            else res();
          });
        });

        // 3. 기존 테이블 클리어
        await new Promise<void>((res, rej) => {
          db.run(`DELETE FROM ${tableName}`, (err) => {
            if (err) rej(err);
            else res();
          });
        });

        // 4. JSON 그룹들을 우선 삽입
        for (const group of groupData) {
          const newId = await new Promise<number>((res, rej) => {
            db.run(
              `INSERT INTO ${tableName} (group_name, display_order, is_visible, created_at, updated_at)
               VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              [group.group_name, group.display_order, group.is_visible],
              function(err) {
                if (err) rej(err);
                else res(this.lastID);
              }
            );
          });

          if (group.id) {
            reassignments.push({
              old_id: group.id,
              new_id: newId,
              group_name: group.group_name
            });
          }
        }

        // 5. 기존 그룹들 중 중복되지 않는 것들을 뒤쪽 ID로 삽입
        const jsonGroupNames = new Set(groupData.map(g => g.group_name));
        const existingNonDuplicate = existingGroups.filter(g => !jsonGroupNames.has(g.group_name));

        for (const existingGroup of existingNonDuplicate) {
          const newId = await new Promise<number>((res, rej) => {
            db.run(
              `INSERT INTO ${tableName} (group_name, display_order, is_visible, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)`,
              [
                existingGroup.group_name,
                existingGroup.display_order,
                existingGroup.is_visible,
                existingGroup.created_at,
                existingGroup.updated_at
              ],
              function(err) {
                if (err) rej(err);
                else res(this.lastID);
              }
            );
          });

          reassignments.push({
            old_id: existingGroup.id,
            new_id: newId,
            group_name: existingGroup.group_name
          });
        }

        // 6. 임시 테이블 삭제
        await new Promise<void>((res, rej) => {
          db.run(`DROP TABLE temp_${tableName}`, (err) => {
            if (err) rej(err);
            else res();
          });
        });

        resolve(reassignments);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 그룹들을 JSON 내보내기용으로 조회
   */
  static exportForJSON(type: 'positive' | 'negative' = 'positive'): Promise<GroupImportData[]> {
    return new Promise((resolve, reject) => {
      const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';

      db.all(
        `SELECT id, group_name, display_order, is_visible
         FROM ${tableName}
         ORDER BY display_order ASC`,
        [],
        (err, rows: any[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }
}