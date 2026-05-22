import type * as BetterSqlite3 from 'better-sqlite3'

export type SqliteConnectionPragmaOptions = {
  label: string
  enableForeignKeys?: boolean
}

/** Apply concurrency-friendly SQLite pragmas to one database connection. */
export function configureSqliteConnection(db: BetterSqlite3.Database, options: SqliteConnectionPragmaOptions): void {
  const { label } = options

  try {
    const journalMode = db.pragma('journal_mode = WAL', { simple: true })
    db.pragma('synchronous = NORMAL')
    db.pragma('busy_timeout = 5000')

    if (options.enableForeignKeys !== false) {
      db.pragma('foreign_keys = ON')
    }

    if (String(journalMode).toLowerCase() !== 'wal') {
      console.warn(`⚠️ ${label}: requested SQLite WAL mode but got ${journalMode}`)
    }
  } catch (error) {
    console.warn(`⚠️ Failed to configure SQLite pragmas for ${label}:`, error)
  }
}

/** Apply WAL pragmas to an attached SQLite database schema on an existing connection. */
export function configureAttachedSqliteDatabase(db: BetterSqlite3.Database, schemaName: string, label: string): void {
  try {
    const journalMode = db.pragma(`${schemaName}.journal_mode = WAL`, { simple: true })
    db.pragma(`${schemaName}.synchronous = NORMAL`)

    if (String(journalMode).toLowerCase() !== 'wal') {
      console.warn(`⚠️ ${label}: requested SQLite WAL mode for attached database but got ${journalMode}`)
    }
  } catch (error) {
    console.warn(`⚠️ Failed to configure attached SQLite pragmas for ${label}:`, error)
  }
}
