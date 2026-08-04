import type * as BetterSqlite3 from 'better-sqlite3'

export type SqliteConnectionPragmaOptions = {
  label: string
  enableForeignKeys?: boolean
  /** Page-cache budget in MiB. Overrides both the per-database default and env overrides. */
  cacheSizeMb?: number
}

export type SqliteAttachedPragmaOptions = {
  /** Page-cache budget in MiB for the attached schema. Overrides default and env overrides. */
  cacheSizeMb?: number
}

const ONE_KIB = 1024

/**
 * Default page-cache budget per database file, in MiB. `0` keeps the SQLite built-in default
 * (2MiB), which is far too small for the multi-GB images.db that every gallery, search, and
 * queue query reads from on the request path.
 */
const DEFAULT_CACHE_SIZE_MB_BY_DATABASE: Readonly<Record<string, number>> = {
  'images.db': 256,
  'user.db': 64,
  'auth.db': 16,
}

/**
 * Attached schemas get their own pager cache on top of the owning connection's cache, so they
 * stay deliberately smaller than the primary connection budget to keep total memory predictable.
 */
const DEFAULT_ATTACHED_CACHE_SIZE_MB_BY_DATABASE: Readonly<Record<string, number>> = {
  'images.db': 64,
}

/** Parse a non-negative numeric env value; `0` is a valid "leave the SQLite default" signal. */
function parseNonNegativeNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Reduce a "main_db/images.db" style label to the database file name used for defaults/env keys. */
export function resolveSqliteDatabaseKey(label: string): string {
  const segments = label.split('/')
  return segments[segments.length - 1]?.trim() || label
}

/** Build the database-scoped env override name, e.g. `images.db` -> `SQLITE_IMAGES_CACHE_SIZE_MB`. */
function buildCacheSizeEnvName(databaseKey: string, attached: boolean): string {
  const normalized = databaseKey
    .replace(/\.db$/i, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()

  return attached ? `SQLITE_ATTACHED_${normalized}_CACHE_SIZE_MB` : `SQLITE_${normalized}_CACHE_SIZE_MB`
}

/**
 * Resolve the page-cache budget (MiB) for one database.
 * Precedence: explicit option -> database-scoped env -> global env (primary connections only) ->
 * built-in default. Returns `0` when the SQLite default should be left untouched.
 */
export function resolveSqliteCacheSizeMb(
  label: string,
  options: { explicitCacheSizeMb?: number; attached?: boolean } = {},
): number {
  const { explicitCacheSizeMb, attached = false } = options

  if (typeof explicitCacheSizeMb === 'number' && Number.isFinite(explicitCacheSizeMb) && explicitCacheSizeMb >= 0) {
    return explicitCacheSizeMb
  }

  const databaseKey = resolveSqliteDatabaseKey(label)

  const scopedOverride = parseNonNegativeNumber(process.env[buildCacheSizeEnvName(databaseKey, attached)])
  if (scopedOverride !== null) {
    return scopedOverride
  }

  if (!attached) {
    const globalOverride = parseNonNegativeNumber(process.env.SQLITE_CACHE_SIZE_MB)
    if (globalOverride !== null) {
      return globalOverride
    }
  }

  const defaults = attached ? DEFAULT_ATTACHED_CACHE_SIZE_MB_BY_DATABASE : DEFAULT_CACHE_SIZE_MB_BY_DATABASE
  return defaults[databaseKey] ?? 0
}

/** Apply the resolved page-cache budget to one schema of a connection. */
function applyCacheSizePragma(
  db: BetterSqlite3.Database,
  schemaName: string | null,
  label: string,
  options: { explicitCacheSizeMb?: number; attached?: boolean } = {},
): void {
  const cacheSizeMb = resolveSqliteCacheSizeMb(label, options)
  if (cacheSizeMb <= 0) {
    return
  }

  // A negative cache_size is a KiB budget instead of a page count, so it stays correct
  // regardless of the database page size.
  const prefix = schemaName ? `${schemaName}.` : ''

  try {
    db.pragma(`${prefix}cache_size = -${Math.round(cacheSizeMb * ONE_KIB)}`)
  } catch (error) {
    // A rejected cache budget is a performance regression, never a correctness one — the
    // remaining pragmas (notably foreign_keys) must still be applied.
    console.warn(`⚠️ Failed to raise the SQLite page cache for ${label}:`, error)
  }
}

/** Apply concurrency-friendly SQLite pragmas to one database connection. */
export function configureSqliteConnection(db: BetterSqlite3.Database, options: SqliteConnectionPragmaOptions): void {
  const { label } = options

  try {
    const journalMode = db.pragma('journal_mode = WAL', { simple: true })
    db.pragma('synchronous = NORMAL')
    db.pragma('busy_timeout = 60000')
    applyCacheSizePragma(db, null, label, { explicitCacheSizeMb: options.cacheSizeMb })

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
export function configureAttachedSqliteDatabase(
  db: BetterSqlite3.Database,
  schemaName: string,
  label: string,
  options: SqliteAttachedPragmaOptions = {},
): void {
  try {
    const journalMode = db.pragma(`${schemaName}.journal_mode = WAL`, { simple: true })
    db.pragma(`${schemaName}.synchronous = NORMAL`)
    applyCacheSizePragma(db, schemaName, label, { explicitCacheSizeMb: options.cacheSizeMb, attached: true })

    if (String(journalMode).toLowerCase() !== 'wal') {
      console.warn(`⚠️ ${label}: requested SQLite WAL mode for attached database but got ${journalMode}`)
    }
  } catch (error) {
    console.warn(`⚠️ Failed to configure attached SQLite pragmas for ${label}:`, error)
  }
}
