import { db } from '../../database/init';
import {
  getPromptCollectionTableName as getPromptTableName,
} from '../../utils/promptTables';
import {
  resolveDanbooruDbInfo,
  type DanbooruBrowserDatabaseInfo,
} from '../danbooruBrowser/dbResolver';
import {
  buildDanbooruAssignmentFilter,
} from './danbooruManagedGroups';
import {
  getDanbooruMatchExpression,
  type DanbooruGroupingTypeResult,
  type DanbooruPromptMatchRow,
  type DanbooruTaxonomyNodeRow,
  type NormalizedDanbooruGroupingOptions,
  type PromptCollectionType,
} from './danbooruGroupingHelpers';

function escapeSqliteString(value: string): string {
  return value.replace(/'/g, "''");
}

export function getDanbooruGroupingDatabaseInfo(): DanbooruBrowserDatabaseInfo {
  return resolveDanbooruDbInfo();
}

export function ensureDanbooruGroupingDbAttached(): DanbooruBrowserDatabaseInfo {
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

export function getDanbooruTaxonomyRows(): DanbooruTaxonomyNodeRow[] {
  return db.prepare(`
    SELECT n.id, n.node_key, n.title, nt.translated_title, n.member_tag_count
    FROM danbooru.taxonomy_nodes n
    LEFT JOIN danbooru.taxonomy_node_translations nt ON nt.node_key = n.node_key AND nt.locale = 'ko'
    WHERE n.node_type = 'manual_group'
    ORDER BY n.member_tag_count DESC, n.title ASC
  `).all() as DanbooruTaxonomyNodeRow[];
}

export function getDanbooruPromptMatches(type: PromptCollectionType, options: NormalizedDanbooruGroupingOptions): DanbooruPromptMatchRow[] {
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

export function getDanbooruGroupingTypePreview(type: PromptCollectionType, options: NormalizedDanbooruGroupingOptions): DanbooruGroupingTypeResult {
  const tableName = getPromptTableName(type);
  const matchExpression = getDanbooruMatchExpression();
  const assignmentFilter = buildDanbooruAssignmentFilter(type, options);
  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  const eligibleRow = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName} pc WHERE 1=1 ${assignmentFilter.sql}`).get(...assignmentFilter.params) as { count: number };
  const matchedRows = getDanbooruPromptMatches(type, options);
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

export function getUnavailableDanbooruGroupingTypePreview(type: PromptCollectionType, options: NormalizedDanbooruGroupingOptions): DanbooruGroupingTypeResult {
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
