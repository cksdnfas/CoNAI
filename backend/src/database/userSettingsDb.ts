import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
  attachMainImagesDatabase,
  bootstrapUnifiedUserDb,
  cleanupLegacyUserSettingsDb,
  ensureApiGenerationHistoryTable,
  migrateLegacyApiGenerationHistory,
  USER_DB_PATH,
  USER_SETTINGS_MIGRATIONS_PATH,
} from './userSettingsBootstrap';
import { ensureBuiltinSystemModules as ensureBuiltinSystemModulesInDb } from './userSettingsBuiltinModules';
import { createUserSettingsSchema } from './userSettingsSchema';

export let userSettingsDb: Database.Database;


/**
 * Initialize User Settings database
 */
export function initializeUserSettingsDb(): void {
  try {
    // Ensure database directory exists
    const dbDir = path.dirname(USER_DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const bootstrapResult = bootstrapUnifiedUserDb();
    const isNewDatabase = !fs.existsSync(USER_DB_PATH);

    userSettingsDb = new Database(USER_DB_PATH);

    if (isNewDatabase) {
      console.log('✅ New unified user database created');
    } else {
      console.log('✅ Connected to existing unified user database');
    }

    runMigrations();
    attachMainImagesDatabase(userSettingsDb);
    ensureApiGenerationHistoryTable(userSettingsDb);
    migrateLegacyApiGenerationHistory(userSettingsDb);
    cleanupLegacyUserSettingsDb(bootstrapResult.copiedLegacyUserSettingsDb);
  } catch (error) {
    console.error('Failed to initialize unified user database:', error);
    throw error;
  }
}

/**
 * Create migrations tracking table
 */
function createMigrationsTable(): void {
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS user_settings_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version VARCHAR(255) NOT NULL UNIQUE,
      applied_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Get list of applied migrations
 */
function getAppliedMigrations(): string[] {
  const rows = userSettingsDb.prepare('SELECT version FROM user_settings_migrations ORDER BY version').all() as { version: string }[];
  return rows.map(row => row.version);
}

/**
 * Record a migration as applied
 */
function recordMigration(version: string): void {
  userSettingsDb.prepare('INSERT INTO user_settings_migrations (version) VALUES (?)').run(version);
}

/**
 * Create all user settings tables if they don't exist
 */
function createTables(): void {
  createUserSettingsSchema(userSettingsDb);
  migrateExistingTables();
}

/**
 * Migrate existing tables to new schema
 * Handles complex schema migrations that require table recreation
 * Note: Simple column additions are now handled in createTables() before index creation
 */
function migrateExistingTables(): void {
  console.log('🔄 Checking for complex schema migrations...');

  try {
    // Helper function to check if column exists
    const hasColumn = (tableName: string, columnName: string): boolean => {
      const pragma = userSettingsDb.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
      return pragma.some((col: any) => col.name === columnName);
    };

    // Migrate wildcard_items table - check if old schema exists
    if (hasColumn('wildcard_items', 'item_text')) {
      console.log('  Migrating wildcard_items table to new schema...');

      // Create temporary table with new schema
      userSettingsDb.exec(`
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

      // Copy data from old table to new (assuming all items are comfyui by default)
      userSettingsDb.exec(`
        INSERT INTO wildcard_items_new (id, wildcard_id, tool, content, order_index, created_date)
        SELECT id, wildcard_id, 'comfyui', item_text, 0, created_at
        FROM wildcard_items
      `);

      // Drop old table and rename new one
      userSettingsDb.exec('DROP TABLE wildcard_items');
      userSettingsDb.exec('ALTER TABLE wildcard_items_new RENAME TO wildcard_items');

      // Recreate index
      userSettingsDb.exec('CREATE INDEX IF NOT EXISTS idx_wildcard_items_wildcard_id ON wildcard_items(wildcard_id)');
      userSettingsDb.exec('CREATE INDEX IF NOT EXISTS idx_wildcard_items_tool ON wildcard_items(tool)');

      console.log('  ✅ wildcard_items table migrated successfully');
    } else {
      console.log('  ✓ No complex migrations needed');
    }

    // Migrate wildcard_items table - add weight column if missing
    if (!hasColumn('wildcard_items', 'weight')) {
      console.log('  Migrating wildcard_items: adding weight column');
      userSettingsDb.exec('ALTER TABLE wildcard_items ADD COLUMN weight REAL DEFAULT 1.0');
    }

    console.log('  ✅ Schema migration complete');
  } catch (error) {
    console.error('  ⚠️ Error during schema migration:', error);
    // Don't throw - let the app continue with existing schema
  }
}

/**
 * Recreate module_definitions when an older database still restricts engine_type to nai/comfyui.
 */
function ensureModuleDefinitionsSupportsSystemEngine(): void {
  const schemaRow = userSettingsDb
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='module_definitions'")
    .get() as { sql?: string } | undefined;

  if (!schemaRow?.sql || schemaRow.sql.includes("'system'")) {
    return;
  }

  console.log('🔧 Updating module_definitions schema to support system engine...');

  try {
    userSettingsDb.exec(`
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
    userSettingsDb.exec('ROLLBACK;');
    throw error;
  }
}

/**
 * Recreate graph_workflows when an older database still enforces unique workflow names.
 */
function ensureGraphWorkflowsAllowDuplicateNames(): void {
  const schemaRow = userSettingsDb
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='graph_workflows'")
    .get() as { sql?: string } | undefined;

  if (!schemaRow?.sql || !schemaRow.sql.toUpperCase().includes('NAME TEXT NOT NULL UNIQUE')) {
    return;
  }

  console.log('🔧 Updating graph_workflows schema to allow duplicate workflow names...');

  userSettingsDb.exec('PRAGMA foreign_keys = OFF;');

  try {
    userSettingsDb.exec(`
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
    userSettingsDb.exec('ROLLBACK;');
    throw error;
  } finally {
    userSettingsDb.exec('PRAGMA foreign_keys = ON;');
  }
}

/**
 * Seed built-in system-native workflow modules that should always be available.
 */
function ensureBuiltinSystemModules(): void {
  ensureBuiltinSystemModulesInDb(userSettingsDb);
}

/**
 * Run all migration files in order
 */
function runMigrations(): void {
  // Create migrations tracking table
  createMigrationsTable();

  // Check if migrations folder exists
  if (!fs.existsSync(USER_SETTINGS_MIGRATIONS_PATH)) {
    console.log('ℹ️  User settings SQL migrations are not packaged here; using built-in schema bootstrap.');
    createTables();
    ensureModuleDefinitionsSupportsSystemEngine();
    ensureGraphWorkflowsAllowDuplicateNames();
    ensureBuiltinSystemModules();
    return;
  }

  console.log(`📂 Using user settings migrations from: ${USER_SETTINGS_MIGRATIONS_PATH}`);

  // Get already applied migrations
  const appliedMigrations = getAppliedMigrations();

  const files = fs.readdirSync(USER_SETTINGS_MIGRATIONS_PATH)
    .filter(file => file.endsWith('.sql'))
    .sort();

  // Filter out already applied migrations
  const pendingMigrations = files.filter(file => !appliedMigrations.includes(file));

  if (pendingMigrations.length === 0) {
    console.log('  ✓ All migrations already applied');
    ensureModuleDefinitionsSupportsSystemEngine();
    ensureGraphWorkflowsAllowDuplicateNames();
    ensureBuiltinSystemModules();
    return;
  }

  for (const file of pendingMigrations) {
    const filePath = path.join(USER_SETTINGS_MIGRATIONS_PATH, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    try {
      userSettingsDb.exec(sql);
      recordMigration(file);
      console.log(`  ✓ Migration applied: ${file}`);
    } catch (error) {
      console.error(`  ✗ Migration failed: ${file}`, error);
      throw error;
    }
  }

  ensureModuleDefinitionsSupportsSystemEngine();
  ensureGraphWorkflowsAllowDuplicateNames();
  ensureBuiltinSystemModules();
}

/**
 * Close database connection
 */
export function closeUserSettingsDb(): void {
  if (userSettingsDb) {
    userSettingsDb.close();
    console.log('User Settings database connection closed');
  }
}

/**
 * Get database instance (use with caution)
 */
export function getUserSettingsDb(): Database.Database {
  if (!userSettingsDb) {
    throw new Error('User Settings database not initialized');
  }
  return userSettingsDb;
}

