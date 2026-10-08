import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// The baseline resolves the default upload folder from the runtime base; keep it in a scratch folder.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-test-migrations-'))
process.env.RUNTIME_BASE_PATH = scratchDir
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import {
  BASELINE_MIGRATION_VERSION,
  MigrationManager,
  SQUASHED_MIGRATION_VERSIONS,
} from '../src/database/migrationManager'

const KEPT_MIGRATIONS = [
  '036_scope_group_name_uniqueness_to_parent',
  '037_add_group_emoticons',
  '038_add_media_pixel_hash',
  '039_drop_civitai_temp_urls',
]

let dbCounter = 0
function openDb(): Database.Database {
  dbCounter += 1
  const db = new Database(path.join(scratchDir, `images-${dbCounter}.db`))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function appliedVersions(db: Database.Database): string[] {
  return (db.prepare('SELECT version FROM migrations ORDER BY version').all() as Array<{ version: string }>).map((row) => row.version)
}

function schemaSnapshot(db: Database.Database): string {
  return JSON.stringify(db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all())
}

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

async function freshDb(): Promise<Database.Database> {
  const db = openDb()
  await new MigrationManager(db).migrate({ requireBaseline: true })
  return db
}

test('a fresh database runs the baseline, records the squashed history and the kept migrations', async () => {
  const db = await freshDb()
  const expected = [BASELINE_MIGRATION_VERSION, ...SQUASHED_MIGRATION_VERSIONS, ...KEPT_MIGRATIONS].sort()
  assert.deepEqual(appliedVersions(db), expected)

  for (const table of ['media_metadata', 'image_files', 'auto_folder_groups', 'model_info', 'backup_sources', 'media_prompt_fts']) {
    assert.ok(hasTable(db, table), `${table} exists`)
  }
  assert.ok(!hasTable(db, 'civitai_temp_urls'), '039 leaves no civitai_temp_urls behind')
  const groupColumns = (db.prepare('PRAGMA table_info(groups)').all() as Array<{ name: string }>).map((column) => column.name)
  assert.ok(groupColumns.includes('emoticon_enabled'), '037 ran on top of the baseline')

  const before = schemaSnapshot(db)
  await new MigrationManager(db).migrate()
  assert.equal(schemaSnapshot(db), before, 'a second run changes nothing')
  assert.deepEqual(appliedVersions(db), expected)
  db.close()
})

test('a database missing a squashed migration is refused before anything changes', async () => {
  const db = await freshDb()
  db.prepare('DELETE FROM migrations WHERE version = ?').run('034_add_background_media_retry_state')
  // Leave real work pending: if the guard let the run through, 039 would drop this table.
  db.prepare('DELETE FROM migrations WHERE version = ?').run('039_drop_civitai_temp_urls')
  db.exec('CREATE TABLE civitai_temp_urls (id INTEGER PRIMARY KEY)')
  const schemaBefore = schemaSnapshot(db)
  const versionsBefore = appliedVersions(db)

  await assert.rejects(
    () => new MigrationManager(db).migrate(),
    (error: Error) => error.message.includes('034_add_background_media_retry_state') && error.message.includes('너무 오래돼서'),
  )
  assert.equal(schemaSnapshot(db), schemaBefore)
  assert.deepEqual(appliedVersions(db), versionsBefore)
  db.close()
})

test('squashed versions that never touched images.db are filled in instead of refused', async () => {
  const db = await freshDb()
  db.prepare('DELETE FROM migrations WHERE version = ?').run('035_add_generation_queue_idempotency')
  await new MigrationManager(db).migrate()
  assert.ok(appliedVersions(db).includes('035_add_generation_queue_idempotency'))
  db.close()
})

test('the baseline never runs over media tables that have no migration history', async () => {
  const db = openDb()
  db.exec('CREATE TABLE media_metadata (composite_hash TEXT PRIMARY KEY)')
  await assert.rejects(() => new MigrationManager(db).migrate(), /baseline/)
  assert.ok(!hasTable(db, 'migrations'), 'the refused run did not even create the migrations table')
  assert.ok(!hasTable(db, 'image_files'))
  db.close()
})

test('a squashed migration cannot be rolled back on its own', async () => {
  const db = await freshDb()
  const before = schemaSnapshot(db)
  await assert.rejects(() => new MigrationManager(db).rollback('034_add_background_media_retry_state'), /롤백할 수 없습니다/)
  assert.equal(schemaSnapshot(db), before)
  db.close()
})
