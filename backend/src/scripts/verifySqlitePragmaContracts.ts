import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import Database = require('better-sqlite3')
import {
  configureAttachedSqliteDatabase,
  configureSqliteConnection,
  resolveSqliteCacheSizeMb,
} from '../database/sqlitePragmas'

const ONE_KIB = 1024
const IMAGES_DEFAULT_CACHE_SIZE_MB = 256
const ATTACHED_IMAGES_DEFAULT_CACHE_SIZE_MB = 64

function assertConnectionPragmas(db: Database.Database, label: string) {
  assert.equal(String(db.pragma('journal_mode', { simple: true })).toLowerCase(), 'wal', `${label} must use WAL journal mode`)
  assert.equal(Number(db.pragma('synchronous', { simple: true })), 1, `${label} must use synchronous=NORMAL`)
  assert.equal(Number(db.pragma('busy_timeout', { simple: true })), 60000, `${label} must keep a 60000ms busy timeout`)
}

function readCacheSize(db: Database.Database, schemaName?: string): number {
  return Number(db.pragma(`${schemaName ? `${schemaName}.` : ''}cache_size`, { simple: true }))
}

/** The page-cache budget must be resolvable without opening a database. */
function assertCacheSizeResolution() {
  const scopedEnvName = 'SQLITE_IMAGES_CACHE_SIZE_MB'
  const attachedEnvName = 'SQLITE_ATTACHED_IMAGES_CACHE_SIZE_MB'
  const globalEnvName = 'SQLITE_CACHE_SIZE_MB'
  const previousScoped = process.env[scopedEnvName]
  const previousAttached = process.env[attachedEnvName]
  const previousGlobal = process.env[globalEnvName]

  delete process.env[scopedEnvName]
  delete process.env[attachedEnvName]
  delete process.env[globalEnvName]

  try {
    assert.equal(
      resolveSqliteCacheSizeMb('images.db'),
      IMAGES_DEFAULT_CACHE_SIZE_MB,
      'images.db must raise its page cache well above the 2MiB SQLite default',
    )
    assert.equal(
      resolveSqliteCacheSizeMb('main_db/images.db', { attached: true }),
      ATTACHED_IMAGES_DEFAULT_CACHE_SIZE_MB,
      'attached images.db must get its own bounded page cache',
    )
    assert.equal(
      resolveSqliteCacheSizeMb('unknown-runtime.db'),
      0,
      'unmapped databases must keep the SQLite built-in page cache default',
    )

    process.env[globalEnvName] = '128'
    assert.equal(resolveSqliteCacheSizeMb('images.db'), 128, 'SQLITE_CACHE_SIZE_MB must override primary defaults')
    assert.equal(
      resolveSqliteCacheSizeMb('main_db/images.db', { attached: true }),
      ATTACHED_IMAGES_DEFAULT_CACHE_SIZE_MB,
      'the global override must not silently multiply attached-schema caches',
    )

    process.env[scopedEnvName] = '64'
    assert.equal(resolveSqliteCacheSizeMb('images.db'), 64, 'SQLITE_IMAGES_CACHE_SIZE_MB must win over the global override')

    process.env[attachedEnvName] = '32'
    assert.equal(
      resolveSqliteCacheSizeMb('main_db/images.db', { attached: true }),
      32,
      'SQLITE_ATTACHED_IMAGES_CACHE_SIZE_MB must override the attached default',
    )

    assert.equal(
      resolveSqliteCacheSizeMb('images.db', { explicitCacheSizeMb: 8 }),
      8,
      'an explicit option must win over every environment override',
    )
  } finally {
    if (previousScoped === undefined) delete process.env[scopedEnvName]
    else process.env[scopedEnvName] = previousScoped
    if (previousAttached === undefined) delete process.env[attachedEnvName]
    else process.env[attachedEnvName] = previousAttached
    if (previousGlobal === undefined) delete process.env[globalEnvName]
    else process.env[globalEnvName] = previousGlobal
  }
}

/** The resolved budget must reach the connection as a KiB-denominated cache_size pragma. */
function assertCacheSizePragmaApplied(tempDir: string) {
  const imagesDb = new Database(path.join(tempDir, 'images.db'))
  try {
    configureSqliteConnection(imagesDb, { label: 'images.db' })
    assertConnectionPragmas(imagesDb, 'images temp db')
    assert.equal(
      readCacheSize(imagesDb),
      -IMAGES_DEFAULT_CACHE_SIZE_MB * ONE_KIB,
      'images.db must express its cache budget in KiB (negative cache_size)',
    )

    const attachedImagesPath = path.join(tempDir, 'attached-images.db').replace(/'/g, "''")
    imagesDb.exec(`ATTACH DATABASE '${attachedImagesPath}' AS main_db`)
    configureAttachedSqliteDatabase(imagesDb, 'main_db', 'main_db/images.db')
    assert.equal(
      readCacheSize(imagesDb, 'main_db'),
      -ATTACHED_IMAGES_DEFAULT_CACHE_SIZE_MB * ONE_KIB,
      'an attached images.db must get its own KiB-denominated cache budget',
    )
  } finally {
    imagesDb.close()
  }

  const explicitDb = new Database(path.join(tempDir, 'explicit.db'))
  try {
    configureSqliteConnection(explicitDb, { label: 'images.db', cacheSizeMb: 4 })
    assert.equal(readCacheSize(explicitDb), -4 * ONE_KIB, 'an explicit cache budget must be applied verbatim')
  } finally {
    explicitDb.close()
  }
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-sqlite-pragmas-'))
  const mainPath = path.join(tempDir, 'main.db')
  const attachedPath = path.join(tempDir, 'attached.db')
  const db = new Database(mainPath)

  try {
    configureSqliteConnection(db, { label: 'pragma-contract-main.db' })
    assertConnectionPragmas(db, 'main temp db')

    const escapedAttachedPath = attachedPath.replace(/'/g, "''")
    db.exec(`ATTACH DATABASE '${escapedAttachedPath}' AS attached_db`)
    configureAttachedSqliteDatabase(db, 'attached_db', 'attached temp db')

    assert.equal(String(db.pragma('attached_db.journal_mode', { simple: true })).toLowerCase(), 'wal', 'attached temp db must use WAL journal mode')
    assert.equal(Number(db.pragma('attached_db.synchronous', { simple: true })), 1, 'attached temp db must use synchronous=NORMAL')

    db.close()

    assertCacheSizeResolution()
    assertCacheSizePragmaApplied(tempDir)

    console.log('✅ SQLite pragma contracts passed (WAL, synchronous=NORMAL, busy timeout, page-cache budget)')
  } finally {
    if (db.open) {
      db.close()
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

main()
