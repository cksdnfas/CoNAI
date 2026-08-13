import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MigrationManager } from '../database/migrationManager'
import { up as upInitialSchema } from '../database/migrations/000_create_all_tables'
import { up as upVisibilityIndex } from '../database/migrations/027_add_media_visibility_index'
import { up as upAutoTagState } from '../database/migrations/028_add_media_auto_tag_state'
import { up as upPromptSearchIndex } from '../database/migrations/031_add_media_prompt_search_index'
import { up as upBackgroundMediaRetryState } from '../database/migrations/034_add_background_media_retry_state'
import { resolveBackgroundMediaRetryDelayMs } from '../services/background-media/backgroundMediaRetryPolicy'
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

function assertMigrationStartupLockContracts() {
  const migrationManagerSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/database/migrationManager.ts'),
    'utf8',
  )
  const sqlitePragmasSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/database/sqlitePragmas.ts'),
    'utf8',
  )
  const homeFeedMigrationSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/database/migrations/019_add_home_feed_cursor_index.ts'),
    'utf8',
  )

  assert.match(
    migrationManagerSource,
    /BEGIN IMMEDIATE/,
    'startup migrations should serialize across split API and worker processes',
  )
  assert.match(
    migrationManagerSource,
    /pendingMigrations\.length === 0[\s\S]*?return;/,
    'startup should skip the write lock when there are no pending migrations',
  )
  assert.match(migrationManagerSource, /COMMIT/, 'startup migration lock should commit after pending migrations finish')
  assert.match(migrationManagerSource, /ROLLBACK/, 'startup migration lock should roll back on migration failure')
  assert.match(
    sqlitePragmasSource,
    /busy_timeout = 60000/,
    'SQLite connections should wait long enough for startup migration/index locks',
  )
  assert.doesNotMatch(
    homeFeedMigrationSource,
    /Index creation warning/,
    'home feed index migration must fail instead of marking a missing performance index as applied',
  )
}

/**
 * `000_create_all_tables.ts` is the fresh-database path; 027/028/031 are the
 * upgrade path. Both run on a new install, so the mirrored objects must be
 * re-appliable — and, more importantly, the mirrored SQL *expressions* must stay
 * byte-identical to the incremental migrations:
 *
 *  - The FTS5 index is external-content. If the text the 000 triggers write ever
 *    differs from the text the backfill (and the 031 triggers) write, a `'delete'`
 *    command supplies values that were never inserted and the index corrupts
 *    silently — on new installs only, which is the hardest place to notice it.
 *  - The auto-tag state expressions decide which rows the scheduler can see. A
 *    drift there means a new database quietly stops tagging some media.
 *
 * The migrations cannot share a module (portable/SEA builds ship the compiled
 * migrations directory standalone), so the copies are compared here instead.
 */
function assertInitialSchemaMirrorsPerformanceMigrations() {
  const migrationsDir = path.resolve(process.cwd(), 'src/database/migrations')
  // Normalize line endings: 000 is checked in with CRLF, the newer migrations with LF.
  const read = (file: string) => fs.readFileSync(path.join(migrationsDir, file), 'utf8').replace(/\r\n/g, '\n')

  const initialSchema = read('000_create_all_tables.ts')
  const autoTagStateMigration = read('028_add_media_auto_tag_state.ts')
  const promptSearchMigration = read('031_add_media_prompt_search_index.ts')

  const extractBetween = (source: string, startMarker: string, endMarker: string, label: string) => {
    const start = source.indexOf(startMarker)
    assert.notEqual(start, -1, `missing marker in ${label}: ${startMarker}`)
    const end = source.indexOf(endMarker, start + startMarker.length)
    assert.notEqual(end, -1, `missing end marker in ${label} after: ${startMarker}`)
    return source.slice(start + startMarker.length, end).replace(/\s+/g, ' ').trim()
  }

  const sharedFragments: Array<{ name: string; signature: string; source: string; label: string }> = [
    {
      name: 'needsAutoTagWorkSql',
      signature: 'function needsAutoTagWorkSql(autoTagsExpr: string): string {\n  return `',
      source: autoTagStateMigration,
      label: '028_add_media_auto_tag_state.ts',
    },
    {
      name: 'positiveTextSql',
      signature: 'function positiveTextSql(prefix: string): string {\n  return `',
      source: promptSearchMigration,
      label: '031_add_media_prompt_search_index.ts',
    },
    {
      name: 'negativeTextSql',
      signature: 'function negativeTextSql(prefix: string): string {\n  return `',
      source: promptSearchMigration,
      label: '031_add_media_prompt_search_index.ts',
    },
    {
      name: 'syncGateSql',
      signature: 'function syncGateSql(rowidExpression: string): string {\n  return `',
      source: promptSearchMigration,
      label: '031_add_media_prompt_search_index.ts',
    },
  ]

  for (const fragment of sharedFragments) {
    assert.equal(
      extractBetween(initialSchema, fragment.signature, '`;\n}', '000_create_all_tables.ts'),
      extractBetween(fragment.source, fragment.signature, '`;\n}', fragment.label),
      `000_create_all_tables.ts must mirror ${fragment.name} from ${fragment.label} character for character`,
    )
  }

  for (const capabilitySql of [
    /COALESCE\(\(SELECT tagger_enabled FROM auto_tag_state_meta WHERE id = 1\), 1\) = 1/,
    /COALESCE\(\(SELECT kaloscope_enabled FROM auto_tag_state_meta WHERE id = 1\), 1\) = 1/,
  ]) {
    assert.match(initialSchema, capabilitySql, 'the initial schema must read the same recorded auto-tag capabilities as migration 028')
  }

  // Structural mirror: columns, state tables, indexes and triggers.
  for (const pattern of [
    /auto_tag_state TEXT DEFAULT NULL/,
    /raw_nai_parameters TEXT DEFAULT NULL/,
    /character_prompt_text TEXT DEFAULT NULL/,
    /CREATE TABLE IF NOT EXISTS auto_tag_state_meta/,
    /CREATE TABLE IF NOT EXISTS media_prompt_fts_state/,
    /CREATE VIRTUAL TABLE IF NOT EXISTS media_prompt_fts USING fts5/,
    /idx_media_metadata_visibility/,
    /idx_media_metadata_auto_tag_pending/,
    /tokenize='trigram'/,
  ]) {
    assert.match(initialSchema, pattern, `the initial schema must mirror ${pattern} from migrations 027/028/031`)
  }

  for (const triggerName of [
    'trg_media_metadata_auto_tag_state_insert',
    'trg_media_metadata_auto_tag_state_promote',
    'trg_media_metadata_auto_tag_state_settle',
    'trg_image_files_auto_tag_state_insert',
    'trg_image_files_auto_tag_state_link',
    'trg_media_prompt_fts_insert',
    'trg_media_prompt_fts_delete',
    'trg_media_prompt_fts_update',
  ]) {
    assert.match(
      initialSchema,
      new RegExp(`CREATE TRIGGER ${triggerName}`),
      `a new database must get ${triggerName} from the initial schema, not only from the incremental migration`,
    )
  }

  // The seed decides how the FTS sync gate behaves on a brand new database.
  // 'ready' would arm the triggers over rows the (never-run) backfill does not own,
  // and a missing seed row would keep the gate closed forever.
  assert.match(
    initialSchema,
    /VALUES \(1, 'pending', 0, 0\)/,
    "a fresh prompt index must start pending so search stays on LIKE until the backfill job finishes",
  )
  assert.match(
    initialSchema,
    /INSERT OR IGNORE INTO auto_tag_state_meta \(id, tagger_enabled, kaloscope_enabled\)\s*\n\s*VALUES \(1, NULL, NULL\)/,
    'the auto-tag capability row must be seeded unsynced so the first scheduler pass recomputes it',
  )

  // No backfill may live in the initial schema: a new database has no rows to
  // backfill, and a scan there would slow down (or, for FTS, block) first boot.
  // Prose comments are dropped first so documenting a statement cannot trip the scan.
  const executableSchema = initialSchema
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')

  for (const match of executableSchema.matchAll(/INSERT INTO media_prompt_fts\b/g)) {
    assert.match(
      executableSchema.slice(match.index!, match.index! + 260),
      /\b(NEW|OLD)\.rowid\b/,
      'the initial schema must only write to the prompt index from row triggers',
    )
  }
  assert.doesNotMatch(executableSchema, /'rebuild'/, "the initial schema must not issue an FTS5 'rebuild'")
  for (const match of executableSchema.matchAll(/SET auto_tag_state = 'pending'/g)) {
    assert.match(
      executableSchema.slice(match.index!, match.index! + 260),
      /NEW\.composite_hash/,
      'the initial schema must only set auto_tag_state from row triggers, never as a table-wide backfill',
    )
  }
  assert.doesNotMatch(
    executableSchema,
    /SET auto_tag_state = 'pending'\s*\n\s*WHERE auto_tag_state IS NOT 'pending'\s*\n\s*AND auto_tags IS NULL/,
    'the migration 028 backfill must stay out of the initial schema (a new database has no rows to backfill)',
  )
}

/**
 * A new database is built by 000 *and then* by every incremental migration, so
 * the mirrored objects have to survive being created twice.
 */
async function assertInitialSchemaAndPerformanceMigrationsCompose() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-initial-schema-mirror-'))
  const db = new Database(path.join(tempDir, 'images.db'))

  // Exactly the order MigrationManager applies them in on a fresh install.
  const migrations = [upInitialSchema, upVisibilityIndex, upAutoTagState, upPromptSearchIndex]

  try {
    for (const pass of [1, 2]) {
      for (const migrate of migrations) {
        await migrate(db)
      }

      const columns = getTableColumns(db, 'media_metadata')
      for (const column of ['auto_tag_state', 'raw_nai_parameters', 'character_prompt_text']) {
        assert.equal(columns.has(column), true, `media_metadata.${column} must exist after pass ${pass}`)
      }

      for (const objectName of [
        'idx_media_metadata_visibility',
        'idx_media_metadata_auto_tag_pending',
        'auto_tag_state_meta',
        'media_prompt_fts',
        'media_prompt_fts_state',
        'trg_media_metadata_auto_tag_state_insert',
        'trg_media_metadata_auto_tag_state_promote',
        'trg_media_metadata_auto_tag_state_settle',
        'trg_image_files_auto_tag_state_insert',
        'trg_image_files_auto_tag_state_link',
        'trg_media_prompt_fts_insert',
        'trg_media_prompt_fts_delete',
        'trg_media_prompt_fts_update',
      ]) {
        assert.equal(
          getCount(db, 'SELECT COUNT(*) AS count FROM sqlite_master WHERE name = ?', objectName),
          1,
          `${objectName} must exist exactly once after pass ${pass}`,
        )
      }

      assert.equal(getCount(db, 'SELECT COUNT(*) AS count FROM auto_tag_state_meta'), 1)
      assert.equal(
        getCount(db, "SELECT COUNT(*) AS count FROM media_prompt_fts_state WHERE id = 1 AND status = 'pending' AND last_rowid = 0"),
        1,
        `the prompt index must still be pending with a zero watermark after pass ${pass}`,
      )
    }

    // Writes must work through both trigger families, and the auto-tag scheduler's
    // pending lookup must be answered by the partial index rather than a full scan.
    db.prepare(`
      INSERT INTO media_metadata (composite_hash, prompt, negative_prompt, first_seen_date)
      VALUES ('hash-mirror', 'a mirrored prompt', 'mirrored negative', CURRENT_TIMESTAMP)
    `).run()
    db.prepare(`
      INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_status, file_size, mime_type)
      VALUES ('hash-mirror', 'C:/tmp/mirror.png', 1, 'active', 1, 'image/png')
    `).run()

    assert.equal(
      getCount(db, "SELECT COUNT(*) AS count FROM media_metadata WHERE auto_tag_state = 'pending'"),
      1,
      'the mirrored triggers must mark a newly registered file as pending auto-tag work',
    )

    const pendingPlan = (db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT mm.composite_hash FROM media_metadata mm WHERE mm.auto_tag_state = 'pending'
    `).all() as Array<{ detail: string }>).map((row) => row.detail).join(' | ')
    assert.match(
      pendingPlan,
      /idx_media_metadata_auto_tag_pending/,
      `the pending auto-tag lookup must use the partial index, got: ${pendingPlan}`,
    )

    // The prompt index is still pending, so the sync gate must have kept the row out
    // of the FTS table (writing it would put the watermark and the index out of step).
    assert.equal(
      getCount(db, `SELECT COUNT(*) AS count FROM media_prompt_fts WHERE media_prompt_fts MATCH '{positive_text} : "mirrored"'`),
      0,
      'a pending prompt index must not be written by the sync triggers',
    )

    // Once the backfill has run the index answers searches and stays consistent.
    // The text below is the runtime backfill's expression (PromptSearchIndexService);
    // it has to match what the mirrored triggers write or FTS5 corrupts on delete.
    db.prepare(`
      INSERT INTO media_prompt_fts(rowid, positive_text, negative_text)
      SELECT
        im.rowid,
        (
          COALESCE(im.prompt, '') || char(10) ||
          COALESCE(im.character_prompt_text, '') || char(10) ||
          CASE WHEN json_valid(im.raw_nai_parameters) = 1 THEN COALESCE((
            SELECT group_concat(COALESCE(json_extract(char_item.value, '$.char_caption'), ''), char(10))
            FROM json_each(im.raw_nai_parameters, '$.v4_prompt.caption.char_captions') AS char_item
          ), '') ELSE '' END
        ),
        COALESCE(im.negative_prompt, '')
      FROM media_metadata im
    `).run()
    db.prepare("UPDATE media_prompt_fts_state SET status = 'ready', last_rowid = (SELECT COALESCE(MAX(rowid), 0) FROM media_metadata) WHERE id = 1").run()
    db.prepare(`
      INSERT INTO media_metadata (composite_hash, prompt, first_seen_date)
      VALUES ('hash-mirror-2', 'a second mirrored prompt', CURRENT_TIMESTAMP)
    `).run()
    assert.equal(
      getCount(db, `SELECT COUNT(*) AS count FROM media_prompt_fts WHERE media_prompt_fts MATCH '{positive_text} : "second mirrored"'`),
      1,
      'a live prompt index must pick up rows inserted through the mirrored triggers',
    )
    // The delete half of the update trigger is where a text mismatch would corrupt
    // the external-content index, so exercise it before the integrity check.
    db.prepare("UPDATE media_metadata SET prompt = 'a rewritten mirrored prompt' WHERE composite_hash = 'hash-mirror'").run()
    assert.equal(
      getCount(db, `SELECT COUNT(*) AS count FROM media_prompt_fts WHERE media_prompt_fts MATCH '{positive_text} : "rewritten"'`),
      1,
      'an update must add the new terms through the mirrored trigger',
    )
    assert.equal(
      getCount(db, `SELECT COUNT(*) AS count FROM media_prompt_fts WHERE media_prompt_fts MATCH '{positive_text} : "a mirrored prompt"'`),
      0,
      'an update must remove the stale terms through the mirrored trigger',
    )
    assert.doesNotThrow(
      () => db.prepare(`INSERT INTO media_prompt_fts(media_prompt_fts, rank) VALUES('integrity-check', 0)`).run(),
      'the FTS index built by the initial schema must pass its own integrity check',
    )
  } finally {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
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

async function assertNoPendingMigrationsDoNotRequireWriteLock() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-migration-no-pending-lock-'))
  const migrationsDir = path.join(tempDir, 'migrations')
  const dbPath = path.join(tempDir, 'main.db')
  fs.mkdirSync(migrationsDir)

  fs.writeFileSync(
    path.join(migrationsDir, '001_noop.js'),
    `exports.up = async () => {}; exports.down = async () => {};`,
    'utf-8',
  )

  const setupDb = new Database(dbPath)
  const lockDb = new Database(dbPath)
  const startupDb = new Database(dbPath)

  try {
    setupDb.pragma('journal_mode = WAL')
    setupDb.exec(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version VARCHAR(255) NOT NULL UNIQUE,
        applied_date DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO migrations (version) VALUES ('001_noop');
    `)
    setupDb.close()

    lockDb.pragma('busy_timeout = 50')
    startupDb.pragma('busy_timeout = 50')
    lockDb.exec('BEGIN IMMEDIATE')

    const manager = new MigrationManager(startupDb)
    ;(manager as unknown as { migrationsPath: string }).migrationsPath = migrationsDir

    await manager.migrate()
  } finally {
    try {
      lockDb.exec('ROLLBACK')
    } catch {
      // The lock may not have been acquired if setup failed.
    }
    if (setupDb.open) {
      setupDb.close()
    }
    if (lockDb.open) {
      lockDb.close()
    }
    if (startupDb.open) {
      startupDb.close()
    }
    fs.rmSync(tempDir, { recursive: true, force: true })
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

async function assertMigrationDiscoveryAndBaselineContracts() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-migration-discovery-'))
  const missingDir = path.join(tempDir, 'missing-migrations')
  const emptyDir = path.join(tempDir, 'empty-migrations')
  const nonBaselineDir = path.join(tempDir, 'non-baseline-migrations')
  fs.mkdirSync(emptyDir)
  fs.mkdirSync(nonBaselineDir)
  fs.writeFileSync(
    path.join(nonBaselineDir, '001_noop.js'),
    'exports.up = async () => {}; exports.down = async () => {};',
    'utf8',
  )

  const db = new Database(':memory:')
  try {
    const missingManager = new MigrationManager(db)
    ;(missingManager as unknown as { migrationsPath: string }).migrationsPath = missingDir
    await assert.rejects(
      () => missingManager.migrate(),
      /마이그레이션 폴더를 찾을 수 없습니다/,
      'a missing packaged migrations directory must fail startup',
    )

    const existingManager = new MigrationManager(db)
    ;(existingManager as unknown as { migrationsPath: string }).migrationsPath = emptyDir
    await existingManager.migrate()
    assert.equal(
      getCount(db, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'migrations'"),
      1,
      'an already-initialized deployment may legitimately have no pending migration files',
    )

    const newDb = new Database(':memory:')
    try {
      const noBaselineManager = new MigrationManager(newDb)
      ;(noBaselineManager as unknown as { migrationsPath: string }).migrationsPath = nonBaselineDir
      await assert.rejects(
        () => noBaselineManager.migrate({ requireBaseline: true }),
        /baseline migration\(000_create_all_tables\)/,
        'a new database must refuse an incomplete migration package',
      )
    } finally {
      newDb.close()
    }
  } finally {
    db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function assertBackgroundMediaRetrySchemaContracts() {
  const db = new Database(':memory:')
  try {
    db.exec(`
      CREATE TABLE image_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        composite_hash TEXT,
        file_status TEXT NOT NULL DEFAULT 'active',
        scan_date DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await upBackgroundMediaRetryState(db)
    await upBackgroundMediaRetryState(db)

    const columns = getTableColumns(db, 'image_files')
    for (const column of ['background_attempt_count', 'background_next_retry_at', 'background_last_error']) {
      assert.equal(columns.has(column), true, `image_files.${column} must be available for durable retry state`)
    }
    assert.equal(
      getCount(db, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name = 'idx_files_background_retry'"),
      1,
      'the due-work lookup must have one partial retry index',
    )
  } finally {
    db.close()
  }

  assert.equal(resolveBackgroundMediaRetryDelayMs(1, 5_000, 60_000), 5_000)
  assert.equal(resolveBackgroundMediaRetryDelayMs(4, 5_000, 60_000), 40_000)
  assert.equal(resolveBackgroundMediaRetryDelayMs(10, 5_000, 60_000), 60_000)

  const processorSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/services/backgroundProcessorService.ts'),
    'utf8',
  )
  assert.match(
    processorSource,
    /background_next_retry_at IS NULL[\s\S]*?background_next_retry_at <= CURRENT_TIMESTAMP/,
    'background batches must skip poison rows until their persisted retry time is due',
  )
  assert.match(
    processorSource,
    /SET background_attempt_count = \?[\s\S]*?background_next_retry_at = \?[\s\S]*?background_last_error = \?/,
    'retryable media failures must persist attempt, retry time, and diagnostic state',
  )
}

async function main() {
  assertComfyServerRebuildPreservesRoutingTags()
  assertModuleDefinitionRebuildPreservesExternalSourceColumns()
  assertWildcardLegacyMigrationDropsStaleScratchTable()
  assertWildcardLegacyMigrationFailsAtomically()
  assertMigrationStartupLockContracts()
  assertInitialSchemaMirrorsPerformanceMigrations()
  await assertInitialSchemaAndPerformanceMigrationsCompose()
  await assertLegacyApiHistoryCollisionIsRemapped()
  await assertNoPendingMigrationsDoNotRequireWriteLock()
  await assertMigrationManagerFailsFastAndRollsBack()
  await assertMigrationDiscoveryAndBaselineContracts()
  await assertBackgroundMediaRetrySchemaContracts()

  console.log('✅ DB migration compatibility contracts verified')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
