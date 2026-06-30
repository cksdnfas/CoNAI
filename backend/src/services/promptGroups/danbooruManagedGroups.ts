import { db } from '../../database/init';
import type { PromptGroupWithPrompts } from '../../types/promptGroup';
import {
  getPromptCollectionTableName as getPromptTableName,
  getPromptGroupTableName as getTableName,
} from '../../utils/promptTables';
import {
  DANBOORU_GROUP_ROOT_NAME_EN,
  DANBOORU_GROUP_ROOT_NAME_KO,
  DANBOORU_GROUP_ROOT_NAMES,
  danbooruRootNamePlaceholders,
  type DanbooruGroupingLanguage,
  type NormalizedDanbooruGroupingOptions,
  type PromptCollectionType,
} from './danbooruGroupingHelpers';

export function getDanbooruGroupRootName(language: DanbooruGroupingLanguage): string {
  return language === 'ko' ? DANBOORU_GROUP_ROOT_NAME_KO : DANBOORU_GROUP_ROOT_NAME_EN;
}

export function getHiddenDanbooruRootGroupsWithCounts(type: PromptCollectionType): PromptGroupWithPrompts[] {
  const groupTableName = getTableName(type);
  const promptTableName = getPromptTableName(type);
  const placeholders = danbooruRootNamePlaceholders();
  return db.prepare(`
    SELECT
      g.*,
      COUNT(p.id) as prompt_count
    FROM ${groupTableName} g
    LEFT JOIN ${promptTableName} p ON g.id = p.group_id
    WHERE g.is_visible = 0
      AND g.parent_id IS NULL
      AND g.group_name IN (${placeholders})
    GROUP BY g.id
    ORDER BY g.display_order ASC
  `).all(...DANBOORU_GROUP_ROOT_NAMES) as PromptGroupWithPrompts[];
}

function getDanbooruRootGroupIds(type: PromptCollectionType): number[] {
  const tableName = getTableName(type);
  const placeholders = danbooruRootNamePlaceholders();
  const rows = db.prepare(`SELECT id FROM ${tableName} WHERE parent_id IS NULL AND group_name IN (${placeholders})`).all(...DANBOORU_GROUP_ROOT_NAMES) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

export function getDanbooruManagedGroupIds(type: PromptCollectionType): number[] {
  const tableName = getTableName(type);
  const rootIds = getDanbooruRootGroupIds(type);
  if (rootIds.length === 0) {
    return [];
  }

  const rows = db.prepare(`SELECT id, parent_id FROM ${tableName}`).all() as Array<{ id: number; parent_id: number | null }>;
  const childrenByParentId = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parent_id == null) continue;
    const children = childrenByParentId.get(row.parent_id) ?? [];
    children.push(row.id);
    childrenByParentId.set(row.parent_id, children);
  }

  const ids: number[] = [];
  const visited = new Set<number>();
  const collect = (groupId: number) => {
    if (visited.has(groupId)) return;
    visited.add(groupId);
    ids.push(groupId);
    for (const childId of childrenByParentId.get(groupId) ?? []) {
      collect(childId);
    }
  };
  for (const rootId of rootIds) collect(rootId);
  return ids;
}

export function isDanbooruManagedGroupId(groupId: number | null | undefined, type: PromptCollectionType = 'positive'): boolean {
  if (groupId == null) {
    return false;
  }
  return getDanbooruManagedGroupIds(type).includes(groupId);
}

export function buildDanbooruAssignmentFilter(type: PromptCollectionType, options: NormalizedDanbooruGroupingOptions, alias: string = 'pc'): { sql: string; params: number[] } {
  const groupTableName = getTableName(type);
  const loraFilter = `AND NOT EXISTS (SELECT 1 FROM ${groupTableName} pg_lora WHERE pg_lora.id = ${alias}.group_id AND LOWER(TRIM(pg_lora.group_name)) = 'lora')`;

  if (options.includeAssignedPrompts) {
    return { sql: loraFilter, params: [] };
  }

  const danbooruGroupIds = getDanbooruManagedGroupIds(type);
  if (danbooruGroupIds.length === 0) {
    return { sql: `${loraFilter} AND ${alias}.group_id IS NULL`, params: [] };
  }

  const placeholders = danbooruGroupIds.map(() => '?').join(',');
  return {
    sql: `${loraFilter} AND (${alias}.group_id IS NULL OR ${alias}.group_id IN (${placeholders}))`,
    params: danbooruGroupIds,
  };
}
