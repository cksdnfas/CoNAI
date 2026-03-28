import { db } from '../database/init';
import {
  PromptGroupRecord,
  NegativePromptGroupRecord,
  PromptGroupData,
  PromptGroupWithPrompts,
  GroupImportData
} from '../types/promptGroup';
import { buildUpdateQuery, filterDefined, sqlLiteral } from '../utils/dynamicUpdate';

const getTableName = (type: 'positive' | 'negative' | 'auto'): string => {
  switch (type) {
    case 'auto': return 'auto_prompt_groups';
    case 'negative': return 'negative_prompt_groups';
    case 'positive':
    default: return 'prompt_groups';
  }
};

const getPromptTableName = (type: 'positive' | 'negative' | 'auto'): string => {
  switch (type) {
    case 'auto': return 'auto_prompt_collection';
    case 'negative': return 'negative_prompt_collection';
    case 'positive':
    default: return 'prompt_collection';
  }
};

export class PromptGroupModel {
  /**
   * 새로운 그룹 생성
   */
  static create(data: PromptGroupData, type: 'positive' | 'negative' | 'auto' = 'positive'): number {
    const tableName = getTableName(type);

    // Check if group already exists
    const existing = this.findByName(data.group_name, type);
    if (existing) {
      return existing.id;
    }

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
      INSERT OR IGNORE INTO ${tableName} (group_name, display_order, is_visible, parent_id)
      VALUES (?, ?, ?, ?)
    `).run(
      data.group_name,
      data.display_order || 0,
      data.is_visible !== undefined ? (data.is_visible ? 1 : 0) : 1,
      data.parent_id || null
    );

    // If insert was ignored (duplicate), fetch the existing group ID
    if (info.changes === 0) {
      const existing = db.prepare(`SELECT id FROM ${tableName} WHERE group_name = ?`)
        .get(data.group_name) as { id: number } | undefined;

      if (existing) {
        return existing.id;
      }
    }

    return info.lastInsertRowid as number;
  }

  /**
   * 모든 그룹 조회 (display_order 순)
   */
  static findAll(
    includeHidden: boolean = false,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): PromptGroupRecord[] {
    const tableName = getTableName(type);
    const visibilityFilter = includeHidden ? '' : 'WHERE is_visible = 1';

    const rows = db.prepare(`SELECT * FROM ${tableName} ${visibilityFilter} ORDER BY display_order ASC`).all() as PromptGroupRecord[];
    return rows || [];
  }

  /**
   * 프롬프트 수와 함께 그룹 조회
   */
  static findAllWithCounts(
    includeHidden: boolean = false,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): PromptGroupWithPrompts[] {
    const groupTableName = getTableName(type);
    const promptTableName = getPromptTableName(type);
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
  static findById(
    id: number,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): PromptGroupRecord | null {
    const tableName = getTableName(type);

    const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id) as PromptGroupRecord | undefined;
    return row || null;
  }

  /**
   * 그룹명으로 조회
   */
  static findByName(
    groupName: string,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): PromptGroupRecord | null {
    const tableName = getTableName(type);

    const row = db.prepare(`SELECT * FROM ${tableName} WHERE group_name = ?`).get(groupName) as PromptGroupRecord | undefined;
    return row || null;
  }

  /**
   * 그룹 정보 업데이트
   */
  static update(
    id: number,
    data: Partial<PromptGroupData>,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): boolean {
    const tableName = getTableName(type);

    // is_visible을 boolean에서 number로 변환
    const cleanData: Record<string, any> = {
      ...data,
      is_visible: data.is_visible !== undefined ? (data.is_visible ? 1 : 0) : undefined
    };

    const updates = filterDefined(cleanData);

    if (Object.keys(updates).length === 0) {
      return false;
    }

    // updated_at은 SQL 함수로 직접 삽입
    const finalUpdates = {
      ...updates,
      updated_at: sqlLiteral('CURRENT_TIMESTAMP')
    };

    const { sql, values } = buildUpdateQuery(tableName, finalUpdates, { id });
    const info = db.prepare(sql).run(...values);
    return info.changes > 0;
  }

  /**
   * 그룹 삭제
   */
  static delete(
    id: number,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): boolean {
    const tableName = getTableName(type);

    const info = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  /**
   * 그룹들의 ID 일괄 재배치 (JSON 가져오기용)
   */
  static reassignGroupIds(
    groupData: GroupImportData[],
    type: 'positive' | 'negative' | 'auto' = 'positive',
    preserveExisting: boolean = true
  ): { old_id: number; new_id: number; group_name: string }[] {
    const tableName = getTableName(type);
    const reassignments: { old_id: number; new_id: number; group_name: string }[] = [];
    const pendingParentUpdates: Array<{ id: number; old_parent_id: number | null }> = [];

    // 1. 기존 그룹들 조회
    const existingGroups = this.findAll(true, type);

    // 2. 백업에 없는 기존 그룹만 뒤에 유지
    const jsonGroupNames = new Set(groupData.map(g => g.group_name));
    const existingNonDuplicate = preserveExisting
      ? existingGroups.filter(g => !jsonGroupNames.has(g.group_name))
      : [];

    // 3. 기존 테이블 클리어
    db.prepare(`DELETE FROM ${tableName}`).run();

    // 4. JSON 그룹들을 먼저 삽입하고 parent_id는 2차 remap
    for (const group of groupData) {
      const info = db.prepare(`INSERT INTO ${tableName} (group_name, display_order, is_visible, parent_id, created_at, updated_at)
           VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(
        group.group_name,
        group.display_order,
        group.is_visible ? 1 : 0
      );

      const newId = info.lastInsertRowid as number;
      pendingParentUpdates.push({ id: newId, old_parent_id: group.parent_id ?? null });

      if (group.id) {
        reassignments.push({
          old_id: group.id,
          new_id: newId,
          group_name: group.group_name
        });
      }
    }

    // 5. 기존 그룹들 중 중복되지 않는 것들을 뒤쪽 ID로 삽입
    for (const existingGroup of existingNonDuplicate) {
      const info = db.prepare(`INSERT INTO ${tableName} (group_name, display_order, is_visible, parent_id, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?)`).run(
        existingGroup.group_name,
        existingGroup.display_order,
        existingGroup.is_visible ? 1 : 0,
        existingGroup.created_at,
        existingGroup.updated_at
      );

      const newId = info.lastInsertRowid as number;
      pendingParentUpdates.push({ id: newId, old_parent_id: existingGroup.parent_id ?? null });
      reassignments.push({
        old_id: existingGroup.id,
        new_id: newId,
        group_name: existingGroup.group_name
      });
    }

    // 6. parent_id를 새 ID 기준으로 remap
    const idMap = new Map(reassignments.map(item => [item.old_id, item.new_id]));
    for (const item of pendingParentUpdates) {
      const nextParentId = item.old_parent_id == null ? null : (idMap.get(item.old_parent_id) ?? null);
      db.prepare(`UPDATE ${tableName} SET parent_id = ? WHERE id = ?`).run(nextParentId, item.id);
    }

    return reassignments;
  }

  /**
   * 그룹들을 JSON 내보내기용으로 조회
   */
  static exportForJSON(type: 'positive' | 'negative' | 'auto' = 'positive'): GroupImportData[] {
    const tableName = getTableName(type);

    const rows = db.prepare(`SELECT id, group_name, display_order, is_visible, parent_id
     FROM ${tableName}
     ORDER BY display_order ASC`).all() as GroupImportData[];
    return rows || [];
  }
}
