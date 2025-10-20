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
  static async create(data: PromptGroupData, type: 'positive' | 'negative' = 'positive'): Promise<number> {
    const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';

    // display_order가 없으면 자동으로 최대값 + 1
    if (data.display_order === undefined) {
      const row = db.prepare(`SELECT MAX(display_order) as max_order FROM ${tableName}`).get() as { max_order: number | null };
      const nextOrder = (row.max_order || 0) + 1;
      return this.insertGroup(tableName, { ...data, display_order: nextOrder });
    } else {
      return this.insertGroup(tableName, data);
    }
  }

  private static insertGroup(
    tableName: string,
    data: PromptGroupData
  ): number {
    const info = db.prepare(`
      INSERT INTO ${tableName} (group_name, display_order, is_visible)
      VALUES (?, ?, ?)
    `).run(
      data.group_name,
      data.display_order || 0,
      data.is_visible !== undefined ? (data.is_visible ? 1 : 0) : 1
    );

    return info.lastInsertRowid as number;
  }

  /**
   * 모든 그룹 조회 (display_order 순)
   */
  static async findAll(
    includeHidden: boolean = false,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupRecord[]> {
    const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';
    const visibilityFilter = includeHidden ? '' : 'WHERE is_visible = 1';

    const rows = db.prepare(`SELECT * FROM ${tableName} ${visibilityFilter} ORDER BY display_order ASC`).all() as PromptGroupRecord[];
    return rows || [];
  }

  /**
   * 프롬프트 수와 함께 그룹 조회
   */
  static async findAllWithCounts(
    includeHidden: boolean = false,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupWithPrompts[]> {
    const groupTableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';
    const promptTableName = type === 'positive' ? 'prompt_collection' : 'negative_prompt_collection';
    const visibilityFilter = includeHidden ? '' : 'WHERE g.is_visible = 1';

    const rows = db.prepare(`SELECT
       g.*,
       COUNT(p.id) as prompt_count
     FROM ${groupTableName} g
     LEFT JOIN ${promptTableName} p ON g.id = p.group_id
     ${visibilityFilter}
     GROUP BY g.id
     ORDER BY g.display_order ASC`).all() as PromptGroupWithPrompts[];
    return rows || [];
  }

  /**
   * 특정 그룹 조회
   */
  static async findById(
    id: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupRecord | null> {
    const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';

    const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id) as PromptGroupRecord | undefined;
    return row || null;
  }

  /**
   * 그룹명으로 조회
   */
  static async findByName(
    groupName: string,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<PromptGroupRecord | null> {
    const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';

    const row = db.prepare(`SELECT * FROM ${tableName} WHERE group_name = ?`).get(groupName) as PromptGroupRecord | undefined;
    return row || null;
  }

  /**
   * 그룹 정보 업데이트
   */
  static async update(
    id: number,
    data: Partial<PromptGroupData>,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<boolean> {
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
      values.push(data.is_visible ? 1 : 0);
    }

    if (updateFields.length === 0) {
      return false;
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const info = db.prepare(`UPDATE ${tableName} SET ${updateFields.join(', ')} WHERE id = ?`).run(...values);
    return info.changes > 0;
  }

  /**
   * 그룹 삭제
   */
  static async delete(
    id: number,
    type: 'positive' | 'negative' = 'positive'
  ): Promise<boolean> {
    const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';

    const info = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  /**
   * 그룹들의 ID 일괄 재배치 (JSON 가져오기용)
   */
  static async reassignGroupIds(
    groupData: GroupImportData[],
    type: 'positive' | 'negative' = 'positive'
  ): Promise<{ old_id: number; new_id: number; group_name: string }[]> {
    const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';
    const reassignments: { old_id: number; new_id: number; group_name: string }[] = [];

    // 1. 기존 그룹들 조회
    const existingGroups = await this.findAll(true, type);

    // 2. 임시 테이블 생성 및 기존 데이터 백업
    db.prepare(`CREATE TEMPORARY TABLE temp_${tableName} AS SELECT * FROM ${tableName}`).run();

    // 3. 기존 테이블 클리어
    db.prepare(`DELETE FROM ${tableName}`).run();

    // 4. JSON 그룹들을 우선 삽입
    for (const group of groupData) {
      const info = db.prepare(`INSERT INTO ${tableName} (group_name, display_order, is_visible, created_at, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(
        group.group_name,
        group.display_order,
        group.is_visible ? 1 : 0
      );

      const newId = info.lastInsertRowid as number;

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
      const info = db.prepare(`INSERT INTO ${tableName} (group_name, display_order, is_visible, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`).run(
        existingGroup.group_name,
        existingGroup.display_order,
        existingGroup.is_visible ? 1 : 0,
        existingGroup.created_at,
        existingGroup.updated_at
      );

      const newId = info.lastInsertRowid as number;

      reassignments.push({
        old_id: existingGroup.id,
        new_id: newId,
        group_name: existingGroup.group_name
      });
    }

    // 6. 임시 테이블 삭제
    db.prepare(`DROP TABLE temp_${tableName}`).run();

    return reassignments;
  }

  /**
   * 그룹들을 JSON 내보내기용으로 조회
   */
  static async exportForJSON(type: 'positive' | 'negative' = 'positive'): Promise<GroupImportData[]> {
    const tableName = type === 'positive' ? 'prompt_groups' : 'negative_prompt_groups';

    const rows = db.prepare(`SELECT id, group_name, display_order, is_visible
     FROM ${tableName}
     ORDER BY display_order ASC`).all() as GroupImportData[];
    return rows || [];
  }
}
