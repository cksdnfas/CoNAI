import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MigrationManager } from '../database/migrationManager'
import { ensureUserSettingsCompatibility, migrateExistingUserSettingsTables } from '../database/userSettingsCompatibility'
import { createUserSettingsSchema } from '../database/userSettingsSchema'

function getTableColumns(db: Database.Database, tableName: string) {
  return new Set((db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name))
}

function getCount(db: Database.Database, sql: string, ...values: unknown[]) {
  return (db.prepare(sql).get(...values) as { count: number }).count
}

function createCurrentSchemaDb() {
  const db = new Database(':memory:')
  createUserSettingsSchema(db)
  return db
}

function assertComfyServerRebuildPreservesRoutingTags() {
  const db = createCurrentSchemaDb()
  try {
    db.exec(`
      DROP TABLE comfyui_servers;
      CREATE TABLE comfyui_servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(255) NOT NULL UNIQUE,
        url VARCHAR(500),
        endpoint VARCHAR(500),
        backend_type TEXT NOT NULL DEFAULT 'comfyui',
        capacity INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        routing_tags_json TEXT,
        is_active BOOLEAN DEFAULT 1,
        is_default BOOLEAN DEFAULT 0,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)
    db.prepare(`
      INSERT INTO comfyui_servers (
        id, name, url, endpoint, backend_type, capacity, description, routing_tags_json, is_active, is_default
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(1, 'Tagged local', 'http://legacy:8188', 'http://current:8188', 'comfyui', 2, 'tagged server', '["sdxl","fast"]', 1, 1)

    ensureUserSettingsCompatibility(db)

    const columns = getTableColumns(db, 'comfyui_servers')
    assert.equal(columns.has('url'), false, 'Legacy url column must be removed')
    assert.equal(columns.has('routing_tags_json'), true, 'routing_tags_json column must survive endpoint rebuild')

    const row = db.prepare('SELECT endpoint, routing_tags_json FROM comfyui_servers WHERE id = 1').get() as {
      endpoint: string
      routing_tags_json: string | null
    }
    assert.equal(row.endpoint, 'http://current:8188')
    assert.equal(row.routing_tags_json, '["sdxl","fast"]')
  } finally {
    db.close()
  }
}

function assertModuleDefinitionRebuildPreservesExternalSourceColumns() {
  const db = createCurrentSchemaDb()
  try {
    db.exec(`
      DROP TABLE module_definitions;
      CREATE TABLE module_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        engine_type TEXT NOT NULL CHECK(engine_type IN ('nai', 'codex', 'comfyui', 'system', 'custom_js')),
        authoring_source TEXT NOT NULL CHECK(authoring_source IN ('nai_form_snapshot', 'codex_form_snapshot', 'comfyui_workflow_wrap', 'manual')),
        category TEXT,
        source_workflow_id INTEGER,
        template_defaults TEXT NOT NULL,
        exposed_inputs TEXT NOT NULL,
        output_ports TEXT NOT NULL,
        internal_fixed_values TEXT,
        ui_schema TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        color TEXT DEFAULT '#7c4dff',
        external_key TEXT,
        source_path TEXT,
        source_hash TEXT,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `)
    db.prepare(`
      INSERT INTO module_definitions (
        id, name, description, engine_type, authoring_source, category, template_defaults, exposed_inputs,
        output_ports, internal_fixed_values, ui_schema, version, is_active, color,
        external_key, source_path, source_hash, created_date, updated_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      1,
      'Custom Node',
      'legacy custom node',
      'custom_js',
      'manual',
      'custom',
      '{}',
      '[]',
      '[]',
      '{}',
      '{}',
      3,
      1,
      '#123456',
      'node:custom',
      'custom/node.js',
      'abc123',
      '2026-05-01 00:00:00',
      '2026-05-02 00:00:00',
    )

    ensureUserSettingsCompatibility(db)

    const row = db.prepare(`
      SELECT external_key, source_path, source_hash
      FROM module_definitions
      WHERE id = 1
    `).get() as { external_key: string | null; source_path: string | null; source_hash: string | null }
    assert.deepEqual(row, {
      external_key: 'node:custom',
      source_path: 'custom/node.js',
      source_hash: 'abc123',
    })
  } finally {
    db.close()
  }
}

function assertWildcardLegacyMigrationFailsAtomically() {
  const db = new Database(':memory:')
  try {
    db.exec(`
      CREATE TABLE wildcard_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wildcard_id INTEGER NOT NULL,
        item_text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO wildcard_items (id, wildcard_id, item_text, created_at)
      VALUES (1, 1, NULL, '2026-05-01 00:00:00');
    `)

    assert.throws(
      () => migrateExistingUserSettingsTables(db),
      /NOT NULL|constraint/i,
      'Legacy wildcard migration must fail fast on invalid data',
    )
    assert.equal(getCount(db, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'wildcard_items_new'"), 0)
    assert.equal(getCount(db, 'SELECT COUNT(*) AS count FROM wildcard_items WHERE item_text IS NULL'), 1)
  } finally {
    db.close()
  }
}

function assertWildcardLegacyMigrationDropsStaleScratchTable() {
  const db = new Database(':memory:')
  try {
    db.exec(`
      CREATE TABLE wildcard_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wildcard_id INTEGER NOT NULL,
        item_text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE wildcard_items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wildcard_id INTEGER NOT NULL,
        tool TEXT NOT NULL CHECK(tool IN ('general', 'comfyui', 'nai')) DEFAULT 'comfyui',
        content TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO wildcard_items (id, wildcard_id, item_text, created_at)
      VALUES (1, 1, 'fresh item', '2026-05-01 00:00:00');
      INSERT INTO wildcard_items_new (id, wildcard_id, tool, content, order_index, created_date)
      VALUES (99, 9, 'nai', 'stale sentinel', 9, '2026-04-01 00:00:00');
    `)

    migrateExistingUserSettingsTables(db)

    assert.equal(getCount(db, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'wildcard_items_new'"), 0)
    assert.equal(getCount(db, "SELECT COUNT(*) AS count FROM wildcard_items WHERE content = 'fresh item'"), 1)
    assert.equal(getCount(db, "SELECT COUNT(*) AS count FROM wildcard_items WHERE content = 'stale sentinel'"), 0)
  } finally {
    db.close()
  }
}

async function assertLegacyApiHistoryCollisionIsRemapped() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-api-history-migration-'))
  process.env.RUNTIME_BASE_PATH = tempRoot
  process.env.RUNTIME_DATABASE_DIR = path.join(tempRoot, 'database')
  fs.mkdirSync(process.env.RUNTIME_DATABASE_DIR, { recursive: true })

  const { ensureApiGenerationHistoryTable, migrateLegacyApiGenerationHistory } = await import('../database/userSettingsBootstrap')
  const userDbPath = path.join(process.env.RUNTIME_DATABASE_DIR, 'user.db')
  const legacyDbPath = path.join(process.env.RUNTIME_DATABASE_DIR, 'api-generation-history.db')
  const userDb = new Database(userDbPath)
  const legacyDb = new Database(legacyDbPath)

  try {
    ensureApiGenerationHistoryTable(userDb)
    ensureApiGenerationHistoryTable(legacyDb)

    userDb.prepare(`
      INSERT INTO api_generation_history (id, service_type, generation_status, positive_prompt, metadata)
      VALUES (1, 'comfyui', 'completed', 'same prompt', '{"source":"same"}')
    `).run()
    userDb.prepare(`
      INSERT INTO api_generation_history (
        id, service_type, generation_status, positive_prompt, metadata,
        queue_job_id, requested_by_account_id, requested_by_account_type, server_id
      ) VALUES (2, 'comfyui', 'completed', 'duplicate prompt', '{"source":"duplicate"}', 99, 8, 'guest', 4)
    `).run()
    legacyDb.prepare(`
      INSERT INTO api_generation_history (
        id, service_type, generation_status, positive_prompt, metadata,
        queue_job_id, requested_by_account_id, requested_by_account_type, server_id
      ) VALUES (1, 'comfyui', 'completed', 'same prompt', '{"source":"same"}', 42, 7, 'user', 3)
    `).run()
    legacyDb.prepare(`
      INSERT INTO api_generation_history (
        id, service_type, generation_status, positive_prompt, metadata,
        queue_job_id, requested_by_account_id, requested_by_account_type, server_id
      ) VALUES (2, 'comfyui', 'completed', 'duplicate prompt', '{"source":"duplicate"}', 99, 8, 'guest', 4)
    `).run()
    legacyDb.prepare(`
      INSERT INTO api_generation_history (
        id, service_type, generation_status, positive_prompt, metadata,
        queue_job_id, requested_by_account_id, requested_by_account_type, server_id
      ) VALUES (5, 'novelai', 'completed', 'non-colliding prompt', '{"source":"legacy-only"}', 123, 10, 'user', 6)
    `).run()
    legacyDb.close()

    const removedLegacy = migrateLegacyApiGenerationHistory(userDb)
    assert.equal(removedLegacy, true)
    assert.equal(getCount(userDb, 'SELECT COUNT(*) AS count FROM api_generation_history'), 5)
    assert.equal(
      getCount(
        userDb,
        `SELECT COUNT(*) AS count
         FROM api_generation_history
         WHERE queue_job_id = 42
           AND requested_by_account_id = 7
           AND requested_by_account_type = 'user'
           AND server_id = 3`,
      ),
      1,
    )
    assert.equal(
      getCount(
        userDb,
        `SELECT COUNT(*) AS count
         FROM api_generation_history
         WHERE positive_prompt = 'duplicate prompt'
           AND queue_job_id = 99
           AND requested_by_account_id = 8
           AND requested_by_account_type = 'guest'
           AND server_id = 4`,
      ),
      2,
    )
    assert.equal(
      getCount(
        userDb,
        `SELECT COUNT(*) AS count
         FROM api_generation_history
         WHERE id = 5
           AND positive_prompt = 'non-colliding prompt'
           AND queue_job_id = 123
           AND requested_by_account_id = 10
           AND requested_by_account_type = 'user'
           AND server_id = 6`,
      ),
      1,
    )
    assert.equal(fs.existsSync(legacyDbPath), false, 'Legacy API history db should be removed only after all rows migrate')
  } finally {
    try {
      userDb.close()
    } catch {
      // ignore cleanup errors
    }
    if (legacyDb.open) {
      legacyDb.close()
    }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

async function assertMigrationManagerFailsFastAndRollsBack() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-migration-manager-'))
  const migrationsDir = path.join(tempDir, 'migrations')
  fs.mkdirSync(migrationsDir)
  const db = new Database(path.join(tempDir, 'main.db'))

  try {
    fs.writeFileSync(
      path.join(migrationsDir, '001_partial.js'),
      `exports.up = async (db) => { db.exec("CREATE TABLE partial_apply (id INTEGER PRIMARY KEY);"); throw new Error('partial boom'); }; exports.down = async () => {};`,
      'utf-8',
    )

    const manager = new MigrationManager(db)
    ;(manager as unknown as { migrationsPath: string }).migrationsPath = migrationsDir

    await assert.rejects(() => manager.migrate(), /partial boom/)
    assert.equal(getCount(db, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'partial_apply'"), 0)
    assert.equal(getCount(db, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'migrations'"), 1)
    assert.equal(getCount(db, 'SELECT COUNT(*) AS count FROM migrations'), 0)

    fs.rmSync(path.join(migrationsDir, '001_partial.js'))
    fs.writeFileSync(
      path.join(migrationsDir, '001_success.js'),
      `exports.up = async (db) => { db.exec("CREATE TABLE successful_apply (id INTEGER PRIMARY KEY);"); }; exports.down = async (db) => { db.exec("CREATE TABLE partial_rollback (id INTEGER PRIMARY KEY);"); throw new Error('rollback boom'); };`,
      'utf-8',
    )

    await manager.migrate()
    assert.equal(getCount(db, 'SELECT COUNT(*) AS count FROM migrations'), 1)
    await assert.rejects(() => manager.rollback(), /rollback boom/)
    assert.equal(getCount(db, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'partial_rollback'"), 0)
    assert.equal(getCount(db, 'SELECT COUNT(*) AS count FROM migrations'), 1)

    fs.rmSync(path.join(migrationsDir, '001_success.js'))
    fs.writeFileSync(
      path.join(migrationsDir, '001_load_error.js'),
      `throw new Error('load boom'); exports.up = async () => {}; exports.down = async () => {};`,
      'utf-8',
    )

    await assert.rejects(() => manager.status(), /load boom/)
  } finally {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  assertComfyServerRebuildPreservesRoutingTags()
  assertModuleDefinitionRebuildPreservesExternalSourceColumns()
  assertWildcardLegacyMigrationDropsStaleScratchTable()
  assertWildcardLegacyMigrationFailsAtomically()
  await assertLegacyApiHistoryCollisionIsRemapped()
  await assertMigrationManagerFailsFastAndRollsBack()

  console.log('✅ DB migration compatibility contracts verified')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
