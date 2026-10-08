/**
 * Split values for `IN (?, ?, …)` lists. SQLite caps bound parameters per statement (32766 in current builds, 999 in
 * older ones), so a caller-sized list can fail outright; 900 leaves room for a few extra parameters in the same
 * statement on any build.
 */
export const SQL_IN_CHUNK_SIZE = 900;

/**
 * Unique values in ascending (binary) order, in chunks. A single `IN` lookup through an index returns rows in index
 * order, so querying sorted chunks one after another and concatenating gives the same order as one big query.
 */
export function sortedUniqueChunks(values: readonly string[], size: number = SQL_IN_CHUNK_SIZE): string[][] {
  const unique = Array.from(new Set(values)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += size) {
    chunks.push(unique.slice(start, start + size));
  }
  return chunks;
}

export function placeholdersFor(values: readonly unknown[]): string {
  return values.map(() => '?').join(',');
}
