export type SqlSortDirection = 'ASC' | 'DESC';

/**
 * ORDER BY cannot take a bound parameter, so a request's direction is spliced into the SQL as a keyword. A
 * TypeScript union does not check what an HTTP body or query string actually holds: only the two directions pass.
 */
export function sqlSortDirection(value: unknown, fallback: SqlSortDirection = 'DESC'): SqlSortDirection {
  const direction = typeof value === 'string' ? value.toUpperCase() : '';
  return direction === 'ASC' || direction === 'DESC' ? direction : fallback;
}
