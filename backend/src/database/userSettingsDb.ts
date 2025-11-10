import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runtimePaths } from '../config/runtimePaths';

const USER_SETTINGS_DB_PATH = path.join(runtimePaths.databaseDir, 'user-settings.db');

// Migration path resolution with multiple fallback strategies
const getMigrationsPath = (): string => {
  const possiblePaths = [
    // Development: source files
    path.join(__dirname, '../../src/database/migrations/user-settings'),
    // Production: compiled in dist
    path.join(__dirname, 'migrations/user-settings'),
    // Portable: app/migrations/user-settings
    path.join(process.cwd(), 'app', 'migrations', 'user-settings'),
    // Bundle: relative to bundle location
    path.join(path.dirname(process.argv[1] || ''), 'migrations', 'user-settings'),
    // Alternative relative path
    path.join(__dirname, '../migrations/user-settings')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Return first path as fallback (will cause warning later)
  return possiblePaths[0];
};

const MIGRATIONS_PATH = getMigrationsPath();

/**
 * User Settings Database Instance
 * Uses better-sqlite3 for synchronous operations
 * Separated from main images.db for user settings management
 * Tables: workflows, comfyui_servers, workflow_servers, user_preferences
 */
export let userSettingsDb: Database.Database;

/**
 * Initialize User Settings Database
 * - Creates database file if not exists
 * - Runs migrations automatically
 * - Synchronous operation (better-sqlite3 style)
 */
export function initializeUserSettingsDb(): void {
  try {
    // Ensure database directory exists
    const dbDir = path.dirname(USER_SETTINGS_DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Check if database is new
    const isNewDatabase = !fs.existsSync(USER_SETTINGS_DB_PATH);

    // Create database connection
    userSettingsDb = new Database(USER_SETTINGS_DB_PATH);

    if (isNewDatabase) {
      console.log('✅ New user settings database created');
    } else {
      console.log('✅ Connected to existing user settings database');
    }

    // Run migrations
    runMigrations();
  } catch (error) {
    console.error('Failed to initialize user settings database:', error);
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
  const rows = userSettingsDb.prepare('SELECT version FROM user_settings_migrations ORDER BY version').all() as any[];
  return rows.map(row => row.version);
}

/**
 * Record a migration as applied
 */
function recordMigration(version: string): void {
  userSettingsDb.prepare('INSERT INTO user_settings_migrations (version) VALUES (?)').run(version);
}

/**
 * Create all tables directly (no migration files needed)
 */
function createTables(): void {
  console.log('📊 Creating user settings tables...');

  // 1. Workflows table
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      workflow_json TEXT NOT NULL,
      marked_fields TEXT,
      api_endpoint VARCHAR(500) DEFAULT 'http://127.0.0.1:8188',
      is_active BOOLEAN DEFAULT 1,
      color VARCHAR(10) DEFAULT '#2196f3',
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. ComfyUI servers table
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS comfyui_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      endpoint VARCHAR(500) NOT NULL,
      description TEXT,
      is_active BOOLEAN DEFAULT 1,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 3. Workflow-Server junction table
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS workflow_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id INTEGER NOT NULL,
      server_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
      FOREIGN KEY (server_id) REFERENCES comfyui_servers(id) ON DELETE CASCADE,
      UNIQUE(workflow_id, server_id)
    )
  `);

  // 4. User preferences table
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 5. Wildcards table
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS wildcards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT DEFAULT 'uncategorized',
      content TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      is_active BOOLEAN DEFAULT 1,
      usage_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 6. Wildcard items table (for structured wildcards)
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS wildcard_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wildcard_id INTEGER NOT NULL,
      item_text TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (wildcard_id) REFERENCES wildcards(id) ON DELETE CASCADE
    )
  `);

  // 7. Custom dropdown lists table (for reusable dropdown options)
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS custom_dropdown_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      description TEXT,
      items TEXT NOT NULL,
      is_auto_collected INTEGER DEFAULT 0,
      source_path TEXT,
      created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 8. Authentication credentials table (single user)
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS auth_credentials (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 9. Sessions table (express-session storage)
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire INTEGER NOT NULL
    )
  `);

  // Migrate existing custom_dropdown_lists table if needed
  // Check if is_auto_collected column exists
  const tableInfo = userSettingsDb.prepare(`PRAGMA table_info(custom_dropdown_lists)`).all() as any[];
  const hasAutoCollectedColumn = tableInfo.some((col: any) => col.name === 'is_auto_collected');

  if (!hasAutoCollectedColumn) {
    console.log('Migrating custom_dropdown_lists table: adding is_auto_collected and source_path columns');
    userSettingsDb.exec(`ALTER TABLE custom_dropdown_lists ADD COLUMN is_auto_collected INTEGER DEFAULT 0`);
    userSettingsDb.exec(`ALTER TABLE custom_dropdown_lists ADD COLUMN source_path TEXT`);
  }

  // Create indexes
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_workflows_name ON workflows(name)',
    'CREATE INDEX IF NOT EXISTS idx_workflows_is_active ON workflows(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_workflows_created_date ON workflows(created_date)',
    'CREATE INDEX IF NOT EXISTS idx_comfyui_servers_name ON comfyui_servers(name)',
    'CREATE INDEX IF NOT EXISTS idx_comfyui_servers_active ON comfyui_servers(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_servers_workflow ON workflow_servers(workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_workflow_servers_server ON workflow_servers(server_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_preferences_key ON user_preferences(key)',
    'CREATE INDEX IF NOT EXISTS idx_wildcards_name ON wildcards(name)',
    'CREATE INDEX IF NOT EXISTS idx_wildcards_category ON wildcards(category)',
    'CREATE INDEX IF NOT EXISTS idx_wildcards_is_active ON wildcards(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_wildcards_usage_count ON wildcards(usage_count)',
    'CREATE INDEX IF NOT EXISTS idx_wildcard_items_wildcard_id ON wildcard_items(wildcard_id)',
    'CREATE INDEX IF NOT EXISTS idx_custom_dropdown_lists_name ON custom_dropdown_lists(name)',
    'CREATE INDEX IF NOT EXISTS idx_custom_dropdown_lists_created_date ON custom_dropdown_lists(created_date)',
    'CREATE INDEX IF NOT EXISTS idx_custom_dropdown_lists_is_auto_collected ON custom_dropdown_lists(is_auto_collected)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire)'
  ];

  indexes.forEach(sql => userSettingsDb.exec(sql));

  // Insert default language setting
  userSettingsDb.prepare(`INSERT OR IGNORE INTO user_preferences (key, value) VALUES (?, ?)`)
    .run('language', 'ko');

  console.log('  ✅ User settings tables created (9 tables + indexes)');
}

/**
 * Run all migration files in order
 */
function runMigrations(): void {
  // Create migrations tracking table
  createMigrationsTable();

  // Check if migrations folder exists
  if (!fs.existsSync(MIGRATIONS_PATH)) {
    console.log('📊 No migrations folder found, creating tables directly...');
    createTables();
    return;
  }

  console.log(`📂 Using user settings migrations from: ${MIGRATIONS_PATH}`);

  // Get already applied migrations
  const appliedMigrations = getAppliedMigrations();

  const files = fs.readdirSync(MIGRATIONS_PATH)
    .filter(file => file.endsWith('.sql'))
    .sort();

  // Filter out already applied migrations
  const pendingMigrations = files.filter(file => !appliedMigrations.includes(file));

  if (pendingMigrations.length === 0) {
    console.log('  ✓ All migrations already applied');
    return;
  }

  for (const file of pendingMigrations) {
    const filePath = path.join(MIGRATIONS_PATH, file);
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
