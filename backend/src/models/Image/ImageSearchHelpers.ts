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
): void {
  const pattern = `%${searchText}%`;

  conditions.push(`(
    ${tableAlias}.prompt LIKE ?
    OR ${tableAlias}.character_prompt_text LIKE ?
    OR (
      json_valid(${tableAlias}.raw_nai_parameters) = 1
      AND EXISTS (
        SELECT 1
        FROM json_each(${tableAlias}.raw_nai_parameters, '$.v4_prompt.caption.char_captions') AS char_item
        WHERE COALESCE(json_extract(char_item.value, '$.char_caption'), '') LIKE ?
      )
    )
  )`);

  params.push(pattern, pattern, pattern);
}

/** Build repeated WHERE/JOIN fragments for image search queries. */
export function buildImageSearchFilterParts(
  searchParams: ImageSearchParamsInput,
  options?: {
    requireCompositeHash?: boolean;
    requireActiveFile?: boolean;
  },
): { conditions: string[]; params: any[]; groupJoinClause: string } {
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.requireCompositeHash) {
    conditions.push('im.composite_hash IS NOT NULL');
  }
  if (options?.requireActiveFile) {
    conditions.push('if.file_status = ?');
    params.push('active');
  }

  if (searchParams.search_text) {
    appendPositivePromptSearchCondition(conditions, params, searchParams.search_text, 'im');
  }
  if (searchParams.negative_text) {
    conditions.push('im.negative_prompt LIKE ?');
    params.push(`%${searchParams.negative_text}%`);
  }
  if (searchParams.ai_tool) {
    conditions.push('im.ai_tool = ?');
    params.push(searchParams.ai_tool);
  }
  if (searchParams.model_name) {
    conditions.push('im.model_name LIKE ?');
    params.push(`%${searchParams.model_name}%`);
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
  if (searchParams.group_id !== undefined) {
    if (searchParams.group_id === 0) {
      groupJoinClause = 'LEFT JOIN image_groups ig_filter ON im.composite_hash = ig_filter.composite_hash';
      conditions.push('ig_filter.composite_hash IS NULL');
    } else {
      groupJoinClause = 'INNER JOIN image_groups ig_filter ON im.composite_hash = ig_filter.composite_hash';
      conditions.push('ig_filter.group_id = ?');
      params.push(searchParams.group_id);
    }
  }

  return { conditions, params, groupJoinClause };
}

/** Map grouped SQL rows into the legacy image payload shape with groups[]. */
export function mapGroupedImageRows(rows: any[]): any[] {
  return rows.map((row) => ({
    ...row,
    id: row.composite_hash,
    upload_date: row.first_seen_date,
    groups: row.group_names ? row.group_names.split(',').map((name: string, index: number) => ({
      id: parseInt(row.group_ids.split(',')[index]),
      name,
      color: row.group_colors.split(',')[index] || null,
      collection_type: row.collection_types.split(',')[index],
    })) : [],
  }));
}
