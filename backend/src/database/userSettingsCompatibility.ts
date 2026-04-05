import type Database from 'better-sqlite3';
import { ensureBuiltinSystemModules as ensureBuiltinSystemModulesInDb } from './userSettingsBuiltinModules';

/** Run legacy table migrations that still require imperative schema changes. */
export function migrateExistingUserSettingsTables(db: Database.Database): void {
  console.log('🔄 Checking for complex schema migrations...');

  try {
    const hasColumn = (tableName: string, columnName: string): boolean => {
      const pragma = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
      return pragma.some((column) => column.name === columnName);
    };

    if (hasColumn('wildcard_items', 'item_text')) {
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

    if (!hasColumn('wildcard_items', 'weight')) {
      console.log('  Migrating wildcard_items: adding weight column');
      db.exec('ALTER TABLE wildcard_items ADD COLUMN weight REAL DEFAULT 1.0');
    }

    console.log('  ✅ Schema migration complete');
  } catch (error) {
    console.error('  ⚠️ Error during schema migration:', error);
  }
}

/** Recreate module_definitions when an older database still restricts engine_type to nai/comfyui. */
export function ensureModuleDefinitionsSupportsSystemEngine(db: Database.Database): void {
  const schemaRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='module_definitions'")
    .get() as { sql?: string } | undefined;

  if (!schemaRow?.sql || schemaRow.sql.includes("'system'")) {
    return;
  }

  console.log('🔧 Updating module_definitions schema to support system engine...');

  try {
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE module_definitions__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        engine_type TEXT NOT NULL CHECK(engine_type IN ('nai', 'comfyui', 'system')),
        authoring_source TEXT NOT NULL CHECK(authoring_source IN ('nai_form_snapshot', 'comfyui_workflow_wrap', 'manual')),
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
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (source_workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
      );

      INSERT INTO module_definitions__new (
        id, name, description, engine_type, authoring_source, category, source_workflow_id,
        template_defaults, exposed_inputs, output_ports, internal_fixed_values, ui_schema,
        version, is_active, color, created_date, updated_date
      )
      SELECT
        id, name, description, engine_type, authoring_source, category, source_workflow_id,
        template_defaults, exposed_inputs, output_ports, internal_fixed_values, ui_schema,
        version, is_active, color, created_date, updated_date
      FROM module_definitions;

      DROP TABLE module_definitions;
      ALTER TABLE module_definitions__new RENAME TO module_definitions;
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
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
  ensureModuleDefinitionsSupportsSystemEngine(db);
  ensureGraphWorkflowsAllowDuplicateNames(db);
  ensureBuiltinSystemModulesInDb(db);
}
