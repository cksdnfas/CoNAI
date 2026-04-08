import type Database from 'better-sqlite3';
import { ensureBuiltinSystemModules as ensureBuiltinSystemModulesInDb } from './userSettingsBuiltinModules';

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const pragma = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return pragma.some((column) => column.name === columnName);
}

/** Rebuild legacy comfyui_servers tables so endpoint becomes the single canonical URL column. */
function ensureComfyUIServersUseEndpointSchema(db: Database.Database): void {
  const schemaRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='comfyui_servers'")
    .get() as { sql?: string } | undefined;

  if (!schemaRow?.sql) {
    return;
  }

  const hasEndpoint = hasColumn(db, 'comfyui_servers', 'endpoint');
  const hasUrl = hasColumn(db, 'comfyui_servers', 'url');

  if (hasEndpoint && !hasUrl) {
    return;
  }

  console.log('🔧 Updating comfyui_servers schema to endpoint-only layout...');

  const endpointExpr = hasEndpoint && hasUrl
    ? "COALESCE(NULLIF(TRIM(endpoint), ''), NULLIF(TRIM(url), ''))"
    : hasEndpoint
      ? "NULLIF(TRIM(endpoint), '')"
      : hasUrl
        ? "NULLIF(TRIM(url), '')"
        : 'NULL';

  const descriptionExpr = hasColumn(db, 'comfyui_servers', 'description') ? 'description' : 'NULL';
  const isActiveExpr = hasColumn(db, 'comfyui_servers', 'is_active') ? 'COALESCE(is_active, 1)' : '1';
  const isDefaultExpr = hasColumn(db, 'comfyui_servers', 'is_default') ? 'COALESCE(is_default, 0)' : '0';
  const createdDateExpr = hasColumn(db, 'comfyui_servers', 'created_date')
    ? 'COALESCE(created_date, CURRENT_TIMESTAMP)'
    : hasColumn(db, 'comfyui_servers', 'created_at')
      ? 'COALESCE(created_at, CURRENT_TIMESTAMP)'
      : 'CURRENT_TIMESTAMP';
  const updatedDateExpr = hasColumn(db, 'comfyui_servers', 'updated_date')
    ? 'COALESCE(updated_date, CURRENT_TIMESTAMP)'
    : hasColumn(db, 'comfyui_servers', 'updated_at')
      ? 'COALESCE(updated_at, CURRENT_TIMESTAMP)'
      : 'CURRENT_TIMESTAMP';

  db.exec('PRAGMA foreign_keys = OFF;');

  try {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE comfyui_servers__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name VARCHAR(255) NOT NULL UNIQUE,
        endpoint VARCHAR(500) NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT 1,
        is_default BOOLEAN DEFAULT 0,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO comfyui_servers__new (
        id, name, endpoint, description, is_active, is_default, created_date, updated_date
      )
      SELECT
        id,
        name,
        ${endpointExpr} AS endpoint,
        ${descriptionExpr} AS description,
        ${isActiveExpr} AS is_active,
        ${isDefaultExpr} AS is_default,
        ${createdDateExpr} AS created_date,
        ${updatedDateExpr} AS updated_date
      FROM comfyui_servers
      WHERE NULLIF(TRIM(name), '') IS NOT NULL
        AND ${endpointExpr} IS NOT NULL;

      DROP TABLE comfyui_servers;
      ALTER TABLE comfyui_servers__new RENAME TO comfyui_servers;
      CREATE INDEX IF NOT EXISTS idx_comfyui_servers_active ON comfyui_servers(is_active);
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

/** Run legacy table migrations that still require imperative schema changes. */
export function migrateExistingUserSettingsTables(db: Database.Database): void {
  console.log('🔄 Checking for complex schema migrations...');

  try {
    if (hasColumn(db, 'wildcard_items', 'item_text')) {
      console.log('  Migrating wildcard_items table to new schema...');

      db.exec(`
        CREATE TABLE IF NOT EXISTS wildcard_items_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          wildcard_id INTEGER NOT NULL,
          tool TEXT NOT NULL CHECK(tool IN ('comfyui', 'nai')) DEFAULT 'comfyui',
          content TEXT NOT NULL,
          order_index INTEGER NOT NULL DEFAULT 0,
          created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (wildcard_id) REFERENCES wildcards(id) ON DELETE CASCADE
        )
      `);

      db.exec(`
        INSERT INTO wildcard_items_new (id, wildcard_id, tool, content, order_index, created_date)
        SELECT id, wildcard_id, 'comfyui', item_text, 0, created_at
        FROM wildcard_items
      `);

      db.exec('DROP TABLE wildcard_items');
      db.exec('ALTER TABLE wildcard_items_new RENAME TO wildcard_items');
      db.exec('CREATE INDEX IF NOT EXISTS idx_wildcard_items_wildcard_id ON wildcard_items(wildcard_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_wildcard_items_tool ON wildcard_items(tool)');

      console.log('  ✅ wildcard_items table migrated successfully');
    } else {
      console.log('  ✓ No complex migrations needed');
    }

    if (!hasColumn(db, 'wildcard_items', 'weight')) {
      console.log('  Migrating wildcard_items: adding weight column');
      db.exec('ALTER TABLE wildcard_items ADD COLUMN weight REAL DEFAULT 1.0');
    }

    console.log('  ✅ Schema migration complete');
  } catch (error) {
    console.error('  ⚠️ Error during schema migration:', error);
  }
}

/** Recreate module_definitions when an older database is missing current custom-node columns or enum values. */
export function ensureModuleDefinitionsSupportsCurrentShape(db: Database.Database): void {
  const schemaRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='module_definitions'")
    .get() as { sql?: string } | undefined;

  const normalizedSql = schemaRow?.sql?.toLowerCase() ?? '';
  if (
    !normalizedSql ||
    (normalizedSql.includes("'custom_js'") &&
      normalizedSql.includes("'custom_node_fs'") &&
      normalizedSql.includes('external_key') &&
      normalizedSql.includes('source_path') &&
      normalizedSql.includes('source_hash'))
  ) {
    return;
  }

  console.log('🔧 Updating module_definitions schema to support current custom-node shape...');

  try {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE module_definitions__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        engine_type TEXT NOT NULL CHECK(engine_type IN ('nai', 'comfyui', 'system', 'custom_js')),
        authoring_source TEXT NOT NULL CHECK(authoring_source IN ('nai_form_snapshot', 'comfyui_workflow_wrap', 'manual', 'custom_node_fs')),
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
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
      );

      INSERT INTO module_definitions__new (
        id, name, description, engine_type, authoring_source, category, source_workflow_id,
        template_defaults, exposed_inputs, output_ports, internal_fixed_values, ui_schema,
        version, is_active, color, external_key, source_path, source_hash, created_date, updated_date
      )
      SELECT
        id, name, description, engine_type, authoring_source, category, source_workflow_id,
        template_defaults, exposed_inputs, output_ports, internal_fixed_values, ui_schema,
        version, is_active, color,
        NULL AS external_key,
        NULL AS source_path,
        NULL AS source_hash,
        created_date, updated_date
      FROM module_definitions;

      DROP TABLE module_definitions;
      ALTER TABLE module_definitions__new RENAME TO module_definitions;
      CREATE INDEX IF NOT EXISTS idx_module_definitions_name ON module_definitions(name);
      CREATE INDEX IF NOT EXISTS idx_module_definitions_engine_type ON module_definitions(engine_type);
      CREATE INDEX IF NOT EXISTS idx_module_definitions_source_workflow ON module_definitions(source_workflow_id);
      CREATE INDEX IF NOT EXISTS idx_module_definitions_active ON module_definitions(is_active);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_module_definitions_external_key ON module_definitions(external_key);
      CREATE INDEX IF NOT EXISTS idx_module_definitions_authoring_source ON module_definitions(authoring_source);
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

/** Ensure custom-node related module_definition indexes exist after schema reconciliation. */
function ensureModuleDefinitionCompatibilityIndexes(db: Database.Database): void {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_module_definitions_external_key ON module_definitions(external_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_module_definitions_authoring_source ON module_definitions(authoring_source)');
}

/** Recreate graph_workflows when an older database still enforces unique workflow names. */
export function ensureGraphWorkflowsAllowDuplicateNames(db: Database.Database): void {
  const schemaRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='graph_workflows'")
    .get() as { sql?: string } | undefined;

  if (!schemaRow?.sql || !schemaRow.sql.toUpperCase().includes('NAME TEXT NOT NULL UNIQUE')) {
    return;
  }

  console.log('🔧 Updating graph_workflows schema to allow duplicate workflow names...');

  db.exec('PRAGMA foreign_keys = OFF;');

  try {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE graph_workflows__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        graph_json TEXT NOT NULL,
        folder_id INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (folder_id) REFERENCES graph_workflow_folders(id) ON DELETE SET NULL
      );

      INSERT INTO graph_workflows__new (
        id, name, description, graph_json, folder_id, version, is_active, created_date, updated_date
      )
      SELECT
        id, name, description, graph_json, folder_id, version, is_active, created_date, updated_date
      FROM graph_workflows;

      DROP TABLE graph_workflows;
      ALTER TABLE graph_workflows__new RENAME TO graph_workflows;
      CREATE INDEX IF NOT EXISTS idx_graph_workflows_name ON graph_workflows(name);
      CREATE INDEX IF NOT EXISTS idx_graph_workflows_folder_id ON graph_workflows(folder_id);
      CREATE INDEX IF NOT EXISTS idx_graph_workflows_active ON graph_workflows(is_active);
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

/** Apply all post-migration compatibility fixes for older user database schemas. */
export function ensureUserSettingsCompatibility(db: Database.Database): void {
  ensureComfyUIServersUseEndpointSchema(db);
  ensureModuleDefinitionsSupportsCurrentShape(db);
  ensureModuleDefinitionCompatibilityIndexes(db);
  ensureGraphWorkflowsAllowDuplicateNames(db);
  ensureBuiltinSystemModulesInDb(db);
}
