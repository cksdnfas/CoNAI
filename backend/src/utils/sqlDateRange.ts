/**
 * Calendar-day bounds on a stored timestamp column, written so an index on the column can serve them.
 *
 * `DATE(column) >= DATE(?)` / `DATE(column) <= DATE(?)` wrap the column in a function, which forces a scan of every
 * row. Stored timestamps start with the canonical `YYYY-MM-DD` date (`CURRENT_TIMESTAMP` writes
 * `YYYY-MM-DD HH:MM:SS`), and for any such text value the half-open text range below holds exactly the rows the
 * DATE() form held:
 *
 * - `DATE(col) >= D`  <=>  `col >= D`              (`D` is a prefix of every value on day D, and sorts before it)
 * - `DATE(col) <= D`  <=>  `col < DATE(D, '+1 day')`
 *
 * The parameter still goes through `DATE(?)`, so a value with a time part is truncated the same way, and an invalid
 * value still yields NULL (no rows), as before. NULL columns match neither form.
 */
export function buildOnOrAfterDateSql(column: string): string {
  return `${column} >= DATE(?)`;
}

export function buildOnOrBeforeDateSql(column: string): string {
  return `${column} < DATE(?, '+1 day')`;
}
