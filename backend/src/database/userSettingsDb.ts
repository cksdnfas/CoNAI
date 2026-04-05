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
import { ensureUserSettingsCompatibility, migrateExistingUserSettingsTables } from './userSettingsCompatibility';
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
  migrateExistingUserSettingsTables(userSettingsDb);
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
    ensureUserSettingsCompatibility(userSettingsDb);
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
    ensureUserSettingsCompatibility(userSettingsDb);
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

  ensureUserSettingsCompatibility(userSettingsDb);
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

