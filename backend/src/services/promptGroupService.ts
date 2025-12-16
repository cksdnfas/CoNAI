import { PromptGroupModel } from '../models/PromptGroup';
import { PromptCollectionModel } from '../models/PromptCollection';
import {
  PromptGroupRecord,
  PromptGroupData,
  PromptGroupWithPrompts,
  GroupReassignmentResult,
  GroupImportData,
  GroupExportData,
  GroupedPromptsResult,
  GroupedPrompts,
  PromptItem
} from '../types/promptGroup';
import { db } from '../database/init';

// Helper to get table name
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

export class PromptGroupService {
  /**
   * 모든 그룹 조회 (프롬프트 수 포함)
   */
  static async getAllGroups(
    includeHidden: boolean = false,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<PromptGroupWithPrompts[]> {
    try {
      const groups = await PromptGroupModel.findAllWithCounts(includeHidden, type);

      // "Unclassified" 그룹 추가 (group_id가 NULL인 프롬프트들)
      const unclassifiedCount = await this.getUnclassifiedPromptCount(type);

      const unclassifiedGroup: PromptGroupWithPrompts = {
        id: 0, // 특별한 ID
        group_name: 'Unclassified',
        display_order: -1, // 항상 맨 앞에 표시
        is_visible: true,
        parent_id: null,
        prompt_count: unclassifiedCount,
        created_at: '',
        updated_at: ''
      };

      return [unclassifiedGroup, ...groups];
    } catch (error) {
      console.error('Error getting all groups:', error);
      throw error;
    }
  }

  /**
   * 특정 그룹 조회 (NULL일 경우 "Unclassified" 반환)
   */
  static async getGroupById(
    id: number | null,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<PromptGroupRecord | { id: 0; group_name: 'Unclassified' } | null> {
    try {
      if (id === null || id === 0) {
        return {
          id: 0,
          group_name: 'Unclassified'
        };
      }

      return await PromptGroupModel.findById(id, type);
    } catch (error) {
      console.error('Error getting group by ID:', error);
      throw error;
    }
  }

  /**
   * 새 그룹 생성
   */
  static async createGroup(
    data: PromptGroupData,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<number> {
    try {
      return await PromptGroupModel.create(data, type);
    } catch (error) {
      console.error('Error creating group:', error);
      throw error;
    }
  }

  /**
   * 그룹 업데이트
   */
  static async updateGroup(
    id: number,
    data: Partial<PromptGroupData>,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<boolean> {
    try {
      return await PromptGroupModel.update(id, data, type);
    } catch (error) {
      console.error('Error updating group:', error);
      throw error;
    }
  }

  /**
   * 그룹 삭제 (관련 프롬프트들은 Unclassified로 이동)
   */
  static async deleteGroup(
    id: number,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<boolean> {
    try {
      // 먼저 해당 그룹의 프롬프트들을 NULL로 변경
      await this.updatePromptGroupIds(id, null, type);

      // 그룹 삭제
      return await PromptGroupModel.delete(id, type);
    } catch (error) {
      console.error('Error deleting group:', error);
      throw error;
    }
  }

  /**
   * JSON으로 그룹 설정 내보내기
   */
  static async exportToJSON(type: 'positive' | 'negative' | 'auto' = 'positive'): Promise<GroupExportData> {
    try {
      const groups = await PromptGroupModel.exportForJSON(type);

      return {
        groups,
        metadata: {
          export_date: new Date().toISOString(),
          total_groups: groups.length,
          type
        }
      };
    } catch (error) {
      console.error('Error exporting to JSON:', error);
      throw error;
    }
  }

  /**
   * JSON에서 그룹 설정 가져오기 (복잡한 ID 재배치 로직)
   */
  static async importFromJSON(
    importData: GroupExportData,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<GroupReassignmentResult> {
    try {
      // 1. 그룹 ID 재배치
      const reassignments = await PromptGroupModel.reassignGroupIds(importData.groups, type);

      // 2. 프롬프트 컬렉션의 group_id 업데이트
      let updatedPrompts = 0;
      for (const reassignment of reassignments) {
        const count = await this.updatePromptGroupIds(
          reassignment.old_id,
          reassignment.new_id,
          type
        );
        updatedPrompts += count;
      }

      return {
        success: true,
        reassigned_groups: reassignments,
        updated_prompts: updatedPrompts,
        message: `Successfully imported ${importData.groups.length} groups and updated ${updatedPrompts} prompts`
      };
    } catch (error) {
      console.error('Error importing from JSON:', error);
      return {
        success: false,
        reassigned_groups: [],
        updated_prompts: 0,
        message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * 그룹 순서 일괄 업데이트
   */
  static async updateGroupOrders(
    groupOrders: { id: number; display_order: number }[],
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<number> {
    try {
      let updatedCount = 0;

      for (const item of groupOrders) {
        const success = await PromptGroupModel.update(
          item.id,
          { display_order: item.display_order },
          type
        );
        if (success) updatedCount++;
      }

      return updatedCount;
    } catch (error) {
      console.error('Error updating group orders:', error);
      throw error;
    }
  }

  /**
   * 프롬프트 컬렉션의 group_id 업데이트 (내부 유틸리티)
   */
  private static async updatePromptGroupIds(
    oldGroupId: number | null,
    newGroupId: number | null,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<number> {
    const tableName = getPromptTableName(type);

    let query: string;
    let params: any[];

    if (oldGroupId === null) {
      query = `UPDATE ${tableName} SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id IS NULL`;
      params = [newGroupId];
    } else {
      query = `UPDATE ${tableName} SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?`;
      params = [newGroupId, oldGroupId];
    }

    const info = db.prepare(query).run(...params);
    return info.changes;
  }

  /**
   * Unclassified 프롬프트 개수 조회 (내부 유틸리티)
   */
  private static async getUnclassifiedPromptCount(type: 'positive' | 'negative' | 'auto' = 'positive'): Promise<number> {
    const tableName = getPromptTableName(type);

    const row = db.prepare(`SELECT COUNT(*) as count FROM ${tableName} WHERE group_id IS NULL`).get() as { count: number };
    return row.count || 0;
  }

  /**
   * 특정 그룹의 프롬프트 목록 조회
   */
  static async getPromptsInGroup(
    groupId: number | null,
    type: 'positive' | 'negative' | 'auto' = 'positive',
    page: number = 1,
    limit: number = 20
  ): Promise<{ prompts: any[], total: number }> {
    try {
      const tableName = getPromptTableName(type);
      const offset = (page - 1) * limit;

      // 총 개수 조회
      let countQuery: string;
      let countParams: any[];

      if (groupId === null || groupId === 0) {
        countQuery = `SELECT COUNT(*) as total FROM ${tableName} WHERE group_id IS NULL`;
        countParams = [];
      } else {
        countQuery = `SELECT COUNT(*) as total FROM ${tableName} WHERE group_id = ?`;
        countParams = [groupId];
      }

      const countRow = db.prepare(countQuery).get(...countParams) as { total: number };
      const total = countRow.total;

      // 데이터 조회
      let dataQuery: string;
      let dataParams: any[];

      if (groupId === null || groupId === 0) {
        dataQuery = `SELECT * FROM ${tableName} WHERE group_id IS NULL ORDER BY usage_count DESC, prompt ASC LIMIT ? OFFSET ?`;
        dataParams = [limit, offset];
      } else {
        dataQuery = `SELECT * FROM ${tableName} WHERE group_id = ? ORDER BY usage_count DESC, prompt ASC LIMIT ? OFFSET ?`;
        dataParams = [groupId, limit, offset];
      }

      const rows = db.prepare(dataQuery).all(...dataParams) as any[];

      return {
        prompts: rows || [],
        total
      };
    } catch (error) {
      console.error('Error getting prompts in group:', error);
      throw error;
    }
  }

  /**
   * 프롬프트를 다른 그룹으로 이동
   */
  static async movePromptToGroup(
    promptId: number,
    targetGroupId: number | null,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<boolean> {
    try {
      return await PromptCollectionModel.setGroupId(promptId, targetGroupId, type);
    } catch (error) {
      console.error('Error moving prompt to group:', error);
      throw error;
    }
  }

  /**
   * 그룹별로 묶인 프롬프트 조회 (배지 표시용)
   */
  static async getGroupedPrompts(
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<GroupedPromptsResult> {
    try {
      const tableName = getPromptTableName(type);
      const groupTableName = getTableName(type);

      // 먼저 모든 visible한 그룹들을 조회
      const groupQuery = `
        SELECT id, group_name, display_order, is_visible, parent_id
        FROM ${groupTableName}
        WHERE is_visible = 1
        ORDER BY display_order ASC
      `;

      const groupRows = db.prepare(groupQuery).all() as any[];

      const groups: GroupedPrompts[] = [];

      // 각 그룹별 프롬프트 조회
      for (const group of groupRows) {
        const promptQuery = `
          SELECT id, prompt, usage_count, synonyms
          FROM ${tableName}
          WHERE group_id = ?
          ORDER BY usage_count DESC, prompt ASC
        `;

        const promptRows = db.prepare(promptQuery).all(group.id) as any[];

        const prompts: PromptItem[] = promptRows.map(row => ({
          id: row.id,
          prompt: row.prompt,
          usage_count: row.usage_count,
          synonyms: row.synonyms ? JSON.parse(row.synonyms) : undefined
        }));

        groups.push({
          id: group.id,
          group_name: group.group_name,
          display_order: group.display_order,
          is_visible: group.is_visible,
          parent_id: group.parent_id,
          prompts
        });
      }

      // Unclassified 프롬프트들 조회
      const unclassifiedQuery = `
        SELECT id, prompt, usage_count, synonyms
        FROM ${tableName}
        WHERE group_id IS NULL
        ORDER BY usage_count DESC, prompt ASC
      `;

      const unclassifiedRows = db.prepare(unclassifiedQuery).all() as any[];

      const unclassifiedPrompts: PromptItem[] = unclassifiedRows.map(row => ({
        id: row.id,
        prompt: row.prompt,
        usage_count: row.usage_count,
        synonyms: row.synonyms ? JSON.parse(row.synonyms) : undefined
      }));

      // display_order로 정렬
      groups.sort((a, b) => a.display_order - b.display_order);

      return {
        groups,
        unclassified_prompts: unclassifiedPrompts
      };
    } catch (error) {
      console.error('Error getting grouped prompts:', error);
      throw error;
    }
  }
}
