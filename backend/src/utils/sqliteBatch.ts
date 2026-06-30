export const SQLITE_BIND_BATCH_SIZE = 500

export function chunkSqliteValues<T>(values: T[], chunkSize = SQLITE_BIND_BATCH_SIZE) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }
  return chunks
}

export function sqliteInPlaceholders(values: readonly unknown[]) {
  return values.map(() => '?').join(', ')
}

export function compareNewestFirst<T extends { created_date?: string | null; id: number }>(left: T, right: T) {
  const dateOrder = String(right.created_date ?? '').localeCompare(String(left.created_date ?? ''))
  return dateOrder !== 0 ? dateOrder : right.id - left.id
}
