/**
 * The Home gallery can leave out the media of chosen custom groups and every group under them (`exclude_group_ids`).
 * The feed, its total and the gallery searches share this parser and SQL so they agree on the excluded set.
 */

export const EXCLUDE_GROUP_IDS_LIMIT = 500;
export const EXCLUDE_GROUP_IDS_ERROR = `exclude_group_ids must be at most ${EXCLUDE_GROUP_IDS_LIMIT} positive group ids`;

/**
 * Read `exclude_group_ids` (a comma-separated query value or a JSON array) as sorted, unique group ids, so equal
 * sets build equal SQL and cache keys. Returns null when the value is not such a list.
 */
export function parseExcludedGroupIds(value: unknown): number[] | null {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  const parts: unknown[] | null = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!parts || parts.length > EXCLUDE_GROUP_IDS_LIMIT) {
    return null;
  }

  const ids = parts.map((part) => (typeof part === 'string' && part.trim() !== '' ? Number(part) : part));
  if (!ids.every((id): id is number => Number.isSafeInteger(id) && (id as number) > 0)) {
    return null;
  }

  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * `<hashColumn> IN (media of these custom groups and of every group under them)`; bind `groupIds` in order. Negate it
 * with `NOT (...)` to exclude. A hidden parent hides its whole subtree, subgroups made later included; UNION stops the
 * walk even on a malformed parent cycle. image_groups.composite_hash is NOT NULL, so the negated form has no NULL
 * pitfall.
 */
export function buildInGroupsSql(hashColumn: string, groupIds: readonly number[]): string {
  return `${hashColumn} IN (
    SELECT composite_hash FROM image_groups WHERE group_id IN (
      WITH RECURSIVE excluded_group_tree(id) AS (
        SELECT id FROM groups WHERE id IN (${groupIds.map(() => '?').join(', ')})
        UNION
        SELECT child.id FROM groups child JOIN excluded_group_tree parent ON child.parent_id = parent.id
      )
      SELECT id FROM excluded_group_tree
    )
  )`;
}
