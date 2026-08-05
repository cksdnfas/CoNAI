import { buildSqlContainsPattern, SQL_LIKE_ESCAPE_CLAUSE } from '../../utils/sqlLike';
import { PromptSearchIndexService } from '../../services/promptSearchIndexService';
import { requestPromptSearchIndexBackfill } from '../../services/runtimeJobs/handlers/promptSearchIndexHandlers';

/**
 * How aggressively a query may lean on the prompt index.
 *
 * `'auto'` is for `ORDER BY … LIMIT` queries that can terminate early on their own;
 * `'always'` is for queries that must visit every match anyway (totals, id sweeps),
 * where the index is faster at any match width; `'off'` reproduces the pre-index SQL.
 */
export type PromptIndexMode = 'auto' | 'always' | 'off';

/**
 * Add the FTS5 prompt-index prefilter in front of a LIKE condition (HEAVY-1).
 *
 * The LIKE predicate is **kept**, always. The trigram index returns a superset of
 * the LIKE matches, so intersecting the two yields exactly the pre-index result
 * set — literal `%` / `_` semantics included — while the index does the scanning.
 * When the index cannot help (backfill unfinished, needle under three characters,
 * candidate set too wide to beat an ordered scan) the prefilter is simply omitted
 * and the query is byte-for-byte the one that ran before.
 */
function appendPromptIndexPrefilter(
  conditions: string[],
  params: any[],
  column: 'positive_text' | 'negative_text',
  needle: string,
  tableAlias: string,
  mode: PromptIndexMode = 'auto',
): void {
  if (mode === 'off') {
    return;
  }

  const prefilter = PromptSearchIndexService.buildPrefilter(column, needle, tableAlias, { mode });
  if (!prefilter) {
    // First search on a database that has the index but no content yet: ask for
    // the backfill so later searches can use it. Never blocks this request.
    requestPromptSearchIndexBackfill();
    return;
  }

  conditions.push(prefilter.sql);
  params.push(...prefilter.params);
}

/** Shared search input shape used by ImageSearchModel query builders. */
export interface ImageSearchParamsInput {
  search_text?: string;
  negative_text?: string;
  ai_tool?: string;
  model_name?: string;
  min_width?: number;
  max_width?: number;
  min_height?: number;
  max_height?: number;
  min_file_size?: number;
  max_file_size?: number;
  start_date?: string;
  end_date?: string;
  group_id?: number;
}

/** Append the positive-prompt search clause including NAI character prompt fallback fields. */
export function appendPositivePromptSearchCondition(
  conditions: string[],
  params: any[],
  searchText: string,
  tableAlias: string = 'im',
  promptIndexMode: PromptIndexMode = 'auto',
): void {
  const pattern = buildSqlContainsPattern(searchText);

  appendPromptIndexPrefilter(conditions, params, 'positive_text', searchText, tableAlias, promptIndexMode);

  conditions.push(`(
    ${tableAlias}.prompt LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}
    OR ${tableAlias}.character_prompt_text LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}
    OR (
      json_valid(${tableAlias}.raw_nai_parameters) = 1
      AND EXISTS (
        SELECT 1
        FROM json_each(${tableAlias}.raw_nai_parameters, '$.v4_prompt.caption.char_captions') AS char_item
        WHERE COALESCE(json_extract(char_item.value, '$.char_caption'), '') LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}
      )
    )
  )`);

  params.push(pattern, pattern, pattern);
}

/**
 * How the "has an active file" requirement is expressed.
 *
 * `'join'` keeps the historic `if.file_status = ?` predicate, which needs the
 * `image_files` join in the FROM clause and makes the planner drive the query from
 * `image_files` — a full scan of every active file even for a one-row result.
 *
 * `'exists'` states the same requirement as a correlated `EXISTS`, which leaves the
 * planner free to drive from `media_metadata` and stop at the page limit. Only
 * usable when nothing else in the query needs `image_files` columns.
 */
export type ActiveFileMode = 'join' | 'exists';

const ACTIVE_FILE_EXISTS_SQL = `EXISTS (
    SELECT 1 FROM image_files af
    WHERE af.composite_hash = im.composite_hash
      AND af.file_status = 'active'
  )`;

export interface ImageSearchFilterParts {
  conditions: string[];
  params: any[];
  groupJoinClause: string;
  /** True when a condition references the `if` alias, so the join must stay in FROM. */
  requiresFileJoin: boolean;
  /** True when a join in this query can emit more than one row per composite hash. */
  canDuplicateRows: boolean;
}

/** Build repeated WHERE/JOIN fragments for image search queries. */
export function buildImageSearchFilterParts(
  searchParams: ImageSearchParamsInput,
  options?: {
    requireCompositeHash?: boolean;
    requireActiveFile?: boolean;
    activeFileMode?: ActiveFileMode;
    promptIndexMode?: PromptIndexMode;
  },
): ImageSearchFilterParts {
  const conditions: string[] = [];
  const params: any[] = [];
  const promptIndexMode = options?.promptIndexMode ?? 'auto';

  // File-size filters read `if.file_size`, so they pin the query to the join form
  // no matter what the caller asked for.
  const needsFileSizeColumns = searchParams.min_file_size !== undefined || searchParams.max_file_size !== undefined;
  const activeFileMode: ActiveFileMode = options?.activeFileMode === 'exists' && !needsFileSizeColumns
    ? 'exists'
    : 'join';

  if (options?.requireCompositeHash) {
    conditions.push('im.composite_hash IS NOT NULL');
  }
  if (options?.requireActiveFile) {
    if (activeFileMode === 'exists') {
      conditions.push(ACTIVE_FILE_EXISTS_SQL);
    } else {
      conditions.push('if.file_status = ?');
      params.push('active');
    }
  }

  if (searchParams.search_text) {
    appendPositivePromptSearchCondition(conditions, params, searchParams.search_text, 'im', promptIndexMode);
  }
  if (searchParams.negative_text) {
    appendPromptIndexPrefilter(conditions, params, 'negative_text', searchParams.negative_text, 'im', promptIndexMode);
    conditions.push(`im.negative_prompt LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`);
    params.push(buildSqlContainsPattern(searchParams.negative_text));
  }
  if (searchParams.ai_tool) {
    conditions.push('im.ai_tool = ?');
    params.push(searchParams.ai_tool);
  }
  if (searchParams.model_name) {
    conditions.push(`im.model_name LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`);
    params.push(buildSqlContainsPattern(searchParams.model_name));
  }
  if (searchParams.min_width) {
    conditions.push('im.width >= ?');
    params.push(searchParams.min_width);
  }
  if (searchParams.max_width) {
    conditions.push('im.width <= ?');
    params.push(searchParams.max_width);
  }
  if (searchParams.min_height) {
    conditions.push('im.height >= ?');
    params.push(searchParams.min_height);
  }
  if (searchParams.max_height) {
    conditions.push('im.height <= ?');
    params.push(searchParams.max_height);
  }
  if (searchParams.min_file_size) {
    conditions.push('if.file_size >= ?');
    params.push(searchParams.min_file_size);
  }
  if (searchParams.max_file_size) {
    conditions.push('if.file_size <= ?');
    params.push(searchParams.max_file_size);
  }
  if (searchParams.start_date) {
    conditions.push('DATE(im.first_seen_date) >= DATE(?)');
    params.push(searchParams.start_date);
  }
  if (searchParams.end_date) {
    conditions.push('DATE(im.first_seen_date) <= DATE(?)');
    params.push(searchParams.end_date);
  }

  let groupJoinClause = '';
  // An INNER JOIN on image_groups can emit one row per membership, so a query that
  // uses it still needs the historic GROUP BY / COUNT(DISTINCT) collapse.
  let canDuplicateRows = activeFileMode === 'join';
  if (searchParams.group_id !== undefined) {
    if (searchParams.group_id === 0) {
      groupJoinClause = 'LEFT JOIN image_groups ig_filter ON im.composite_hash = ig_filter.composite_hash';
      conditions.push('ig_filter.composite_hash IS NULL');
    } else {
      groupJoinClause = 'INNER JOIN image_groups ig_filter ON im.composite_hash = ig_filter.composite_hash';
      conditions.push('ig_filter.group_id = ?');
      params.push(searchParams.group_id);
      canDuplicateRows = true;
    }
  }

  return {
    conditions,
    params,
    groupJoinClause,
    requiresFileJoin: activeFileMode === 'join' || needsFileSizeColumns,
    canDuplicateRows,
  };
}

/** Map grouped SQL rows into the legacy image payload shape with groups[]. */
export function mapGroupedImageRows(rows: any[]): any[] {
  return rows.map((row) => {
    const groupNames = row.group_names ? String(row.group_names).split(',') : [];
    const groupIds = row.group_ids ? String(row.group_ids).split(',') : [];
    const groupColors = row.group_colors ? String(row.group_colors).split(',') : [];
    const collectionTypes = row.collection_types ? String(row.collection_types).split(',') : [];

    return {
      ...row,
      id: row.composite_hash,
      upload_date: row.first_seen_date,
      groups: groupNames.map((name: string, index: number) => ({
        id: parseInt(groupIds[index] ?? '0', 10),
        name,
        color: groupColors[index] || null,
        collection_type: collectionTypes[index] || null,
      })),
    };
  });
}
