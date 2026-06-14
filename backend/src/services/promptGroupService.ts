import { PromptGroupModel } from '../models/PromptGroup';
import { PromptCollectionModel } from '../models/PromptCollection';
import {
  PromptGroupRecord,
  PromptGroupData,
  PromptGroupWithPrompts,
  GroupReassignmentResult,
  GroupExportData,
  GroupedPromptsResult,
  GroupedPrompts,
  PromptItem,
  PromptBackupItem
} from '../types/promptGroup';
import { db } from '../database/init';
import {
  getPromptCollectionTableName as getPromptTableName,
  getPromptGroupTableName as getTableName,
} from '../utils/promptTables';
import { resolveDanbooruDbInfo } from './danbooruBrowser/dbResolver';
import {
  buildDanbooruGroupName,
  buildDanbooruParentKeyByKey,
  collectDanbooruNodeKeysWithAncestors,
  formatDanbooruCategoryTitle,
  getDanbooruMatchExpression,
  normalizeDanbooruGroupingOptions,
  PROMPT_TYPES,
  resolveDanbooruNodeTitle,
  resolveDynamicCategoryParentKey,
  summarizeDanbooruGrouping,
  type DanbooruGroupingMode,
  type DanbooruGroupingOptions,
  type DanbooruGroupingPreviewResult,
  type DanbooruGroupingTypeResult,
  type DanbooruPromptMatchRow,
  type DanbooruTaxonomyNodeRow,
  type NormalizedDanbooruGroupingOptions,
  type PromptCollectionType,
} from './promptGroups/danbooruGroupingHelpers';
import {
  buildDanbooruAssignmentFilter,
  getDanbooruGroupRootName,
  getDanbooruManagedGroupIds,
  getHiddenDanbooruRootGroupsWithCounts,
  isDanbooruManagedGroupId,
} from './promptGroups/danbooruManagedGroups';

export type { DanbooruGroupingPreviewResult };

function escapeSqliteString(value: string): string {
  return value.replace(/'/g, "''");
}

export class PromptGroupService {
  private static isProtectedLoRAGroup(group: { group_name?: string | null } | null | undefined): boolean {
    return group?.group_name?.trim().toLowerCase() === 'lora';
  }

  /**
   * 모든 그룹 조회 (프롬프트 수 포함)
   */
  static async getAllGroups(
    includeHidden: boolean = false,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<PromptGroupWithPrompts[]> {
    try {
      const groups = await PromptGroupModel.findAllWithCounts(includeHidden, type);
      const visibleGroups = includeHidden ? groups : [...getHiddenDanbooruRootGroupsWithCounts(type), ...groups];

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

      return [unclassifiedGroup, ...visibleGroups];
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
      if (this.isProtectedLoRAGroup({ group_name: data.group_name })) {
        throw new Error('LoRA group is protected');
      }
      if (this.isDanbooruManagedGroupId(data.parent_id, type)) {
        throw new Error('Danbooru auto-groups are managed automatically');
      }
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
      const currentGroup = await PromptGroupModel.findById(id, type);
      if (this.isProtectedLoRAGroup(currentGroup)) {
        throw new Error('LoRA group is protected');
      }
      if (this.isDanbooruManagedGroupId(id, type) || this.isDanbooruManagedGroupId(data.parent_id, type)) {
        throw new Error('Danbooru auto-groups are managed automatically');
      }
      return await PromptGroupModel.update(id, data, type);
    } catch (error) {
      console.error('Error updating group:', error);
      throw error;
    }
  }

  /**
   * 그룹 삭제 (하위 그룹의 프롬프트까지 Unclassified로 이동)
   */
  static async deleteGroup(
    id: number,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<boolean> {
    try {
      const currentGroup = await PromptGroupModel.findById(id, type);
      if (!currentGroup) {
        return false;
      }

      const groupIds = this.getGroupDescendantIds(id, type);
      const protectedGroup = groupIds
        .map((groupId) => PromptGroupModel.findById(groupId, type))
        .find((group) => this.isProtectedLoRAGroup(group));
      if (protectedGroup) {
        throw new Error('LoRA group is protected');
      }

      return db.transaction(() => {
        this.updatePromptGroupIdsByGroupIds(groupIds, null, type);
        this.deleteGroupsByIds(groupIds, type);
        return true;
      })();
    } catch (error) {
      console.error('Error deleting group:', error);
      throw error;
    }
  }

  /**
   * Export a prompt snapshot with groups, hierarchy, and prompt assignments.
   */
  static async exportToJSON(type: 'positive' | 'negative' | 'auto' = 'positive'): Promise<GroupExportData> {
    try {
      const groups = await PromptGroupModel.exportForJSON(type);
      const prompts = PromptCollectionModel.exportAllPrompts(type) as PromptBackupItem[];

      return {
        version: '2.0',
        groups,
        prompts,
        metadata: {
          export_date: new Date().toISOString(),
          total_groups: groups.length,
          total_prompts: prompts.length,
          type
        }
      };
    } catch (error) {
      console.error('Error exporting to JSON:', error);
      throw error;
    }
  }

  /**
   * Restore a prompt snapshot with group remapping and prompt upserts.
   */
  static async importFromJSON(
    importData: GroupExportData,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): Promise<GroupReassignmentResult> {
    try {
      const result = db.transaction(() => {
        const hasPromptSnapshot = Array.isArray(importData.prompts)

        // 1. 그룹 ID 재배치
        const reassignments = PromptGroupModel.reassignGroupIds(importData.groups, type, !hasPromptSnapshot);
        const idMap = new Map(reassignments.map(item => [item.old_id, item.new_id]));

        // 2. 새 포맷이면 프롬프트 스냅샷 자체를 복원
        if (hasPromptSnapshot) {
          const snapshotPrompts = importData.prompts ?? []
          const remappedPrompts = snapshotPrompts.map(prompt => ({
            ...prompt,
            group_id: prompt.group_id == null ? null : (idMap.get(prompt.group_id) ?? null)
          }));

          const restoredPrompts = PromptCollectionModel.importSettings(remappedPrompts, type);

          return {
            success: true,
            reassigned_groups: reassignments,
            updated_prompts: restoredPrompts,
            message: `Successfully imported ${importData.groups.length} groups and restored ${restoredPrompts} prompts`
          } as GroupReassignmentResult;
        }

        // 3. 구버전 포맷은 기존 DB 프롬프트 재할당만 수행
        let updatedPrompts = 0;
        for (const reassignment of reassignments) {
          const count = this.updatePromptGroupIds(
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
          message: `Successfully imported ${importData.groups.length} groups and reassigned ${updatedPrompts} existing prompts`
        } as GroupReassignmentResult;
      })();

      return result;
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
      for (const item of groupOrders) {
        const group = await PromptGroupModel.findById(item.id, type);
        if (this.isProtectedLoRAGroup(group)) {
          throw new Error('LoRA group is protected');
        }
        if (this.isDanbooruManagedGroupId(item.id, type)) {
          throw new Error('Danbooru auto-groups are managed automatically');
        }
      }

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

  private static getGroupDescendantIds(
    rootGroupId: number,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): number[] {
    const tableName = getTableName(type);
    const rows = db.prepare(`SELECT id, parent_id FROM ${tableName}`).all() as Array<{ id: number; parent_id: number | null }>;
    const childIdsByParentId = new Map<number, number[]>();

    for (const row of rows) {
      if (row.parent_id == null) {
        continue;
      }
      const childIds = childIdsByParentId.get(row.parent_id) ?? [];
      childIds.push(row.id);
      childIdsByParentId.set(row.parent_id, childIds);
    }

    const collected: number[] = [];
    const visited = new Set<number>();
    const collect = (groupId: number) => {
      if (visited.has(groupId)) {
        return;
      }
      visited.add(groupId);
      collected.push(groupId);
      for (const childId of childIdsByParentId.get(groupId) ?? []) {
        collect(childId);
      }
    };

    collect(rootGroupId);
    return collected;
  }

  private static updatePromptGroupIdsByGroupIds(
    groupIds: number[],
    newGroupId: number | null,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): number {
    if (groupIds.length === 0) {
      return 0;
    }

    const tableName = getPromptTableName(type);
    const placeholders = groupIds.map(() => '?').join(',');
    const info = db.prepare(`UPDATE ${tableName} SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id IN (${placeholders})`).run(newGroupId, ...groupIds);
    return info.changes;
  }

  private static deleteGroupsByIds(
    groupIds: number[],
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): number {
    if (groupIds.length === 0) {
      return 0;
    }

    const tableName = getTableName(type);
    const placeholders = groupIds.map(() => '?').join(',');
    const info = db.prepare(`DELETE FROM ${tableName} WHERE id IN (${placeholders})`).run(...groupIds);
    return info.changes;
  }

  /**
   * 프롬프트 컬렉션의 group_id 업데이트 (내부 유틸리티)
   */
  private static updatePromptGroupIds(
    oldGroupId: number | null,
    newGroupId: number | null,
    type: 'positive' | 'negative' | 'auto' = 'positive'
  ): number {
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
    limit: number = 20,
    query: string = '',
    sortBy: 'usage_count' | 'created_at' | 'prompt' = 'usage_count',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ prompts: any[], total: number }> {
    try {
      const tableName = getPromptTableName(type);
      const offset = (page - 1) * limit;
      const searchPattern = `%${query}%`;
      const orderBy = sortBy === 'created_at' ? 'created_at' : sortBy === 'prompt' ? 'prompt' : 'usage_count';
      const orderDirection = sortOrder === 'ASC' ? 'ASC' : 'DESC';

      // 총 개수 조회
      let countQuery: string;
      let countParams: any[];

      if (groupId === null || groupId === 0) {
        countQuery = `SELECT COUNT(*) as total FROM ${tableName} WHERE group_id IS NULL AND prompt LIKE ?`;
        countParams = [searchPattern];
      } else {
        countQuery = `SELECT COUNT(*) as total FROM ${tableName} WHERE group_id = ? AND prompt LIKE ?`;
        countParams = [groupId, searchPattern];
      }

      const countRow = db.prepare(countQuery).get(...countParams) as { total: number };
      const total = countRow.total;

      // 데이터 조회
      let dataQuery: string;
      let dataParams: any[];

      if (groupId === null || groupId === 0) {
        dataQuery = `SELECT * FROM ${tableName} WHERE group_id IS NULL AND prompt LIKE ? ORDER BY ${orderBy} ${orderDirection}, prompt ASC LIMIT ? OFFSET ?`;
        dataParams = [searchPattern, limit, offset];
      } else {
        dataQuery = `SELECT * FROM ${tableName} WHERE group_id = ? AND prompt LIKE ? ORDER BY ${orderBy} ${orderDirection}, prompt ASC LIMIT ? OFFSET ?`;
        dataParams = [groupId, searchPattern, limit, offset];
      }

      const rows = db.prepare(dataQuery).all(...dataParams) as any[];
      const prompts = rows.map((row) => ({
        ...row,
        synonyms: row.synonyms ? JSON.parse(row.synonyms) : [],
        type,
      }));

      return {
        prompts,
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

  private static ensureDanbooruDbAttached(): ReturnType<typeof resolveDanbooruDbInfo> {
    const database = resolveDanbooruDbInfo();
    if (!database.available) {
      throw new Error(`Danbooru database not found. Place a DB file matching ${database.filePatterns.join(' or ')} in ${database.expectedDirectory}. Download guide: ${database.downloadUrl}`);
    }

    const rows = db.prepare('PRAGMA database_list').all() as Array<{ name: string; file: string }>;
    const attached = rows.find((row) => row.name === 'danbooru');
    if (attached?.file === database.path) {
      return database;
    }

    if (attached) {
      db.exec('DETACH DATABASE danbooru');
    }

    db.exec(`ATTACH DATABASE '${escapeSqliteString(database.path)}' AS danbooru`);
    return database;
  }

  private static getDanbooruTaxonomyRows(): DanbooruTaxonomyNodeRow[] {
    return db.prepare(`
      SELECT n.id, n.node_key, n.title, nt.translated_title, n.member_tag_count
      FROM danbooru.taxonomy_nodes n
      LEFT JOIN danbooru.taxonomy_node_translations nt ON nt.node_key = n.node_key AND nt.locale = 'ko'
      WHERE n.node_type = 'manual_group'
      ORDER BY n.member_tag_count DESC, n.title ASC
    `).all() as DanbooruTaxonomyNodeRow[];
  }

  static isDanbooruManagedGroupId(groupId: number | null | undefined, type: PromptCollectionType = 'positive'): boolean {
    return isDanbooruManagedGroupId(groupId, type);
  }

  private static getDanbooruPromptMatches(type: PromptCollectionType, options: NormalizedDanbooruGroupingOptions): DanbooruPromptMatchRow[] {
    const tableName = getPromptTableName(type);
    const matchExpression = getDanbooruMatchExpression();
    const assignmentFilter = buildDanbooruAssignmentFilter(type, options);

    return db.prepare(`
      WITH prompt_matches AS (
        SELECT pc.id AS prompt_id, pc.prompt, pc.usage_count, t.id AS tag_id, t.category_name
        FROM ${tableName} pc
        JOIN danbooru.tags t INDEXED BY idx_tags_normalized_name
          ON t.normalized_name = ${matchExpression}
          AND COALESCE(t.is_deprecated, 0) = 0
        WHERE 1 = 1 ${assignmentFilter.sql}
        UNION
        SELECT pc.id AS prompt_id, pc.prompt, pc.usage_count, t.id AS tag_id, t.category_name
        FROM ${tableName} pc
        JOIN danbooru.tags t INDEXED BY idx_tags_name
          ON t.name = ${matchExpression}
          AND COALESCE(t.is_deprecated, 0) = 0
        WHERE 1 = 1 ${assignmentFilter.sql}
      )
      SELECT
        pm.prompt_id,
        pm.prompt,
        pm.usage_count,
        m.taxonomy_node_id,
        COALESCE(
          n.node_key,
          CASE LOWER(COALESCE(pm.category_name, 'other'))
            WHEN 'character' THEN 'category__character__' || COALESCE(cp.normalized_name, 'uncategorized')
            ELSE 'category__' || LOWER(COALESCE(pm.category_name, 'other'))
          END
        ) AS node_key,
        COALESCE(
          n.title,
          CASE LOWER(COALESCE(pm.category_name, 'other'))
            WHEN 'general' THEN 'General Tags'
            WHEN 'artist' THEN 'Artist Tags'
            WHEN 'copyright' THEN 'Copyright Tags'
            WHEN 'character' THEN COALESCE(REPLACE(cp.name, '_', ' '), 'Uncategorized Characters')
            WHEN 'meta' THEN 'Meta Tags'
            ELSE COALESCE(pm.category_name, 'Other') || ' Tags'
          END
        ) AS title,
        COALESCE(
          nt.translated_title,
          CASE LOWER(COALESCE(pm.category_name, 'other'))
            WHEN 'general' THEN '일반 태그'
            WHEN 'artist' THEN '작가 태그'
            WHEN 'copyright' THEN '작품 태그'
            WHEN 'character' THEN COALESCE(cp_tt.translated_name, REPLACE(cp.name, '_', ' '), '미분류 캐릭터')
            WHEN 'meta' THEN '메타 태그'
            ELSE COALESCE(pm.category_name, '기타') || ' 태그'
          END
        ) AS translated_title
      FROM prompt_matches pm
      LEFT JOIN danbooru.taxonomy_tag_memberships m INDEXED BY idx_taxonomy_tag_memberships_tag ON m.tag_id = pm.tag_id
      LEFT JOIN danbooru.taxonomy_nodes n ON n.id = m.taxonomy_node_id AND n.node_type = 'manual_group'
      LEFT JOIN danbooru.taxonomy_node_translations nt ON nt.node_key = n.node_key AND nt.locale = 'ko'
      LEFT JOIN danbooru.character_copyright_links ccl ON ccl.character_tag_id = pm.tag_id AND ccl.is_primary = 1
      LEFT JOIN danbooru.copyrights cp ON cp.tag_id = ccl.copyright_tag_id
      LEFT JOIN danbooru.tag_translations cp_tt ON cp_tt.tag_id = cp.tag_id AND cp_tt.locale = 'ko'
      GROUP BY pm.prompt_id
      ORDER BY pm.usage_count DESC, pm.prompt ASC
    `).all(...assignmentFilter.params, ...assignmentFilter.params) as DanbooruPromptMatchRow[];
  }

  private static getDanbooruGroupingTypePreview(type: PromptCollectionType, options: NormalizedDanbooruGroupingOptions): DanbooruGroupingTypeResult {
    const tableName = getPromptTableName(type);
    const matchExpression = getDanbooruMatchExpression();
    const assignmentFilter = buildDanbooruAssignmentFilter(type, options);
    const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
    const eligibleRow = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} pc WHERE 1=1 ${assignmentFilter.sql}`).get(...assignmentFilter.params) as { count: number };
    const matchedRows = this.getDanbooruPromptMatches(type, options);
    const matchedNodeIds = new Set(matchedRows.map((row) => row.node_key));
    const sampleUnmatchedPrompts = db.prepare(`
      SELECT pc.prompt, pc.usage_count
      FROM ${tableName} pc
      WHERE 1 = 1
        ${assignmentFilter.sql}
        AND NOT EXISTS (
          SELECT 1
          FROM danbooru.tags t INDEXED BY idx_tags_normalized_name
          WHERE t.normalized_name = ${matchExpression}
            AND COALESCE(t.is_deprecated, 0) = 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM danbooru.tags t INDEXED BY idx_tags_name
          WHERE t.name = ${matchExpression}
            AND COALESCE(t.is_deprecated, 0) = 0
        )
      ORDER BY pc.usage_count DESC, pc.prompt ASC
      LIMIT 8
    `).all(...assignmentFilter.params) as Array<{ prompt: string; usage_count: number }>;

    return {
      type,
      totalPrompts: totalRow.count,
      eligiblePrompts: eligibleRow.count,
      matchedPrompts: matchedRows.length,
      assignedPrompts: 0,
      createdGroups: 0,
      reusedGroups: 0,
      matchedGroups: matchedNodeIds.size,
      skippedAssignedPrompts: options.includeAssignedPrompts ? 0 : Math.max(totalRow.count - eligibleRow.count, 0),
      sampleUnmatchedPrompts,
    };
  }

  private static getUnavailableDanbooruGroupingTypePreview(type: PromptCollectionType, options: NormalizedDanbooruGroupingOptions): DanbooruGroupingTypeResult {
    const tableName = getPromptTableName(type);
    const assignmentFilter = buildDanbooruAssignmentFilter(type, options);
    const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
    const eligibleRow = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} pc WHERE 1=1 ${assignmentFilter.sql}`).get(...assignmentFilter.params) as { count: number };

    return {
      type,
      totalPrompts: totalRow.count,
      eligiblePrompts: eligibleRow.count,
      matchedPrompts: 0,
      assignedPrompts: 0,
      createdGroups: 0,
      reusedGroups: 0,
      matchedGroups: 0,
      skippedAssignedPrompts: options.includeAssignedPrompts ? 0 : Math.max(totalRow.count - eligibleRow.count, 0),
      sampleUnmatchedPrompts: [],
    };
  }

  static previewDanbooruGrouping(optionsOrMode?: DanbooruGroupingOptions | DanbooruGroupingMode): DanbooruGroupingPreviewResult {
    const options = normalizeDanbooruGroupingOptions(optionsOrMode);
    const database = resolveDanbooruDbInfo();
    if (!database.available) {
      const byType = PROMPT_TYPES.map((type) => this.getUnavailableDanbooruGroupingTypePreview(type, options));
      return summarizeDanbooruGrouping(options, database, byType);
    }
    this.ensureDanbooruDbAttached();
    const byType = PROMPT_TYPES.map((type) => this.getDanbooruGroupingTypePreview(type, options));
    return summarizeDanbooruGrouping(options, database, byType);
  }

  private static findOrCreateDanbooruGroup(type: PromptCollectionType, groupName: string, parentId: number | null, fallbackSuffix: string, isVisible = true): { id: number; created: boolean } {
    const tableName = getTableName(type);
    const findByName = (name: string) => db.prepare(`SELECT id, parent_id FROM ${tableName} WHERE group_name = ?`).get(name) as { id: number; parent_id: number | null } | undefined;
    const existing = findByName(groupName);
    if (existing && (existing.parent_id ?? null) === parentId) {
      return { id: existing.id, created: false };
    }

    let nextGroupName = existing ? `${groupName} · ${fallbackSuffix}` : groupName;
    const existingFallback = findByName(nextGroupName);
    if (existingFallback && (existingFallback.parent_id ?? null) === parentId) {
      return { id: existingFallback.id, created: false };
    }

    let counter = 2;
    while (findByName(nextGroupName)) {
      nextGroupName = `${groupName} · ${fallbackSuffix} ${counter}`;
      const existingCounterFallback = findByName(nextGroupName);
      if (existingCounterFallback && (existingCounterFallback.parent_id ?? null) === parentId) {
        return { id: existingCounterFallback.id, created: false };
      }
      counter += 1;
    }

    const maxOrderRow = db.prepare(`SELECT COALESCE(MAX(display_order), 0) AS maxOrder FROM ${tableName}`).get() as { maxOrder: number };
    const info = db.prepare(`
      INSERT INTO ${tableName} (group_name, display_order, is_visible, parent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(nextGroupName, maxOrderRow.maxOrder + 1, isVisible ? 1 : 0, parentId);

    return { id: info.lastInsertRowid as number, created: true };
  }

  private static resetDanbooruGroupsForType(type: PromptCollectionType): number {
    const groupIds = getDanbooruManagedGroupIds(type);
    if (groupIds.length === 0) {
      return 0;
    }

    this.updatePromptGroupIdsByGroupIds(groupIds, null, type);
    return this.deleteGroupsByIds(groupIds, type);
  }

  static applyDanbooruGrouping(optionsOrMode?: DanbooruGroupingOptions | DanbooruGroupingMode): DanbooruGroupingPreviewResult {
    const options = normalizeDanbooruGroupingOptions(optionsOrMode);
    const database = resolveDanbooruDbInfo();
    if (!database.available) {
      const byType = PROMPT_TYPES.map((type) => this.getUnavailableDanbooruGroupingTypePreview(type, options));
      return summarizeDanbooruGrouping(options, database, byType);
    }
    this.ensureDanbooruDbAttached();
    const taxonomyRows = this.getDanbooruTaxonomyRows();
    const taxonomyByKey = new Map(taxonomyRows.map((row) => [row.node_key, row] as const));
    const parentKeyByKey = buildDanbooruParentKeyByKey(taxonomyRows);
    const duplicateTitleCounts = taxonomyRows.reduce((map, row) => {
      const key = resolveDanbooruNodeTitle(row, options.language).toLowerCase();
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>());

    const byType = db.transaction(() => PROMPT_TYPES.map((type) => {
      const preview = this.getDanbooruGroupingTypePreview(type, options);
      const matches = this.getDanbooruPromptMatches(type, options);
      this.resetDanbooruGroupsForType(type);
      const matchedNodeKeys = new Set(matches.map((row) => row.node_key));
      for (const match of matches) {
        if (!match.node_key.startsWith('category__')) continue;

        const parts = match.node_key.split('__');
        for (let index = 2; index <= parts.length; index += 1) {
          const nodeKey = parts.slice(0, index).join('__');
          const parentKey = resolveDynamicCategoryParentKey(nodeKey);
          if (parentKey) {
            parentKeyByKey.set(nodeKey, parentKey);
          }
          if (!taxonomyByKey.has(nodeKey)) {
            taxonomyByKey.set(nodeKey, {
              id: -taxonomyByKey.size,
              node_key: nodeKey,
              title: nodeKey === match.node_key ? (match.title || formatDanbooruCategoryTitle(nodeKey, 'en')) : formatDanbooruCategoryTitle(nodeKey, 'en'),
              translated_title: nodeKey === match.node_key ? (match.translated_title || formatDanbooruCategoryTitle(nodeKey, 'ko')) : formatDanbooruCategoryTitle(nodeKey, 'ko'),
              member_tag_count: 0,
            });
          }
        }
      }
      const nodeKeysToCreate = collectDanbooruNodeKeysWithAncestors(matchedNodeKeys, parentKeyByKey);
      const sortedNodeKeys = [...nodeKeysToCreate].sort((left, right) => left.split('__').length - right.split('__').length || left.localeCompare(right));
      const groupIdByNodeKey = new Map<string, number>();
      let createdGroups = 0;
      let reusedGroups = 0;

      if (sortedNodeKeys.length === 0) {
        return {
          ...preview,
          assignedPrompts: 0,
          createdGroups,
          reusedGroups,
        };
      }

      const rootGroup = this.findOrCreateDanbooruGroup(type, getDanbooruGroupRootName(options.language), null, 'root', options.includeAssignedPrompts);
      if (rootGroup.created) createdGroups += 1;
      else reusedGroups += 1;

      for (const nodeKey of sortedNodeKeys) {
        const node = taxonomyByKey.get(nodeKey);
        if (!node) continue;

        const parentKey = parentKeyByKey.get(nodeKey) ?? null;
        const parentId = parentKey ? groupIdByNodeKey.get(parentKey) ?? rootGroup.id : rootGroup.id;
        const group = this.findOrCreateDanbooruGroup(type, buildDanbooruGroupName(node, duplicateTitleCounts, options.language), parentId, node.node_key);
        groupIdByNodeKey.set(nodeKey, group.id);
        if (group.created) createdGroups += 1;
        else reusedGroups += 1;
      }

      const tableName = getPromptTableName(type);
      const update = db.prepare(`UPDATE ${tableName} SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
      let assignedPrompts = 0;
      for (const match of matches) {
        const groupId = groupIdByNodeKey.get(match.node_key);
        if (!groupId) continue;
        assignedPrompts += update.run(groupId, match.prompt_id).changes;
      }

      return {
        ...preview,
        assignedPrompts,
        createdGroups,
        reusedGroups,
      };
    }))();

    return summarizeDanbooruGrouping(options, database, byType);
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
