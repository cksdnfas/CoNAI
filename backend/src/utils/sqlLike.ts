export const SQL_LIKE_ESCAPE_CLAUSE = " ESCAPE '\\'";

export function escapeSqlLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function buildSqlContainsPattern(value: string): string {
  return `%${escapeSqlLikePattern(value)}%`;
}
