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
 * Run all migration files in order
 */
function runMigrations(): void {
  if (!fs.existsSync(MIGRATIONS_PATH)) {
    console.warn(`⚠️  No migrations directory found for user settings DB`);
    console.warn(`   Searched path: ${MIGRATIONS_PATH}`);
    console.warn(`   User settings features may not work correctly`);
    return;
  }

  console.log(`📂 Using user settings migrations from: ${MIGRATIONS_PATH}`);

  // Create migrations tracking table
  createMigrationsTable();

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
