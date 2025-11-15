import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runtimePaths } from '../config/runtimePaths';

const AUTH_DB_PATH = path.join(runtimePaths.databaseDir, 'auth.db');

/**
 * Authentication Database Instance
 * Separated from user-settings.db for easy account recovery
 * Contains only: auth_credentials, sessions
 *
 * Recovery: Simply delete auth.db and restart server
 */
export let authDb: Database.Database;

/**
 * Initialize Authentication Database
 * - Creates database file if not exists
 * - Creates auth tables automatically
 * - Handles migration from user-settings.db if needed
 */
export function initializeAuthDb(): void {
  try {
    // Ensure database directory exists
    const dbDir = path.dirname(AUTH_DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Check if database is new
    const isNewDatabase = !fs.existsSync(AUTH_DB_PATH);

    // Create database connection
    authDb = new Database(AUTH_DB_PATH);

    if (isNewDatabase) {
      console.log('✅ New authentication database created');
    } else {
      console.log('✅ Connected to existing authentication database');
    }

    // Create tables
    createAuthTables();

    // Migrate from user-settings.db if needed
    migrateFromUserSettingsDb();
  } catch (error) {
    console.error('Failed to initialize authentication database:', error);
    throw error;
  }
}

/**
 * Create authentication tables
 */
function createAuthTables(): void {
  // 1. Authentication credentials table (single user)
  authDb.exec(`
    CREATE TABLE IF NOT EXISTS auth_credentials (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Sessions table (express-session storage)
  authDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire INTEGER NOT NULL
    )
  `);

  // Create index for session expiration
  authDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire)
  `);
}

/**
 * Migrate authentication data from user-settings.db to auth.db
 * This handles existing installations that have auth data in the old location
 */
function migrateFromUserSettingsDb(): void {
  try {
    const userSettingsDbPath = path.join(runtimePaths.databaseDir, 'user-settings.db');

    // Check if user-settings.db exists
    if (!fs.existsSync(userSettingsDbPath)) {
      return; // No migration needed
    }

    // Open user-settings.db temporarily
    const userSettingsDb = new Database(userSettingsDbPath);

    // Check if auth_credentials table exists in user-settings.db
    const tables = userSettingsDb.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='auth_credentials'
    `).all();

    if (tables.length === 0) {
      userSettingsDb.close();
      return; // No migration needed
    }

    // Check if there's any auth data to migrate
    const authData = userSettingsDb.prepare('SELECT * FROM auth_credentials WHERE id = 1').get() as any;

    if (!authData) {
      userSettingsDb.close();
      return; // No data to migrate
    }

    // Check if already migrated
    const existingAuth = authDb.prepare('SELECT * FROM auth_credentials WHERE id = 1').get();
    if (existingAuth) {
      console.log('  ℹ️  Authentication data already exists in auth.db, skipping migration');
      userSettingsDb.close();
      return;
    }

    // Migrate auth_credentials
    console.log('🔄 Migrating authentication data from user-settings.db to auth.db...');
    authDb.prepare(`
      INSERT INTO auth_credentials (id, username, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(authData.id, authData.username, authData.password_hash, authData.created_at, authData.updated_at);

    // Migrate sessions (if any)
    const sessions = userSettingsDb.prepare('SELECT * FROM sessions').all();
    if (sessions.length > 0) {
      const insertSession = authDb.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expire) VALUES (?, ?, ?)');
      const insertMany = authDb.transaction((sessionList: any[]) => {
        for (const session of sessionList) {
          insertSession.run(session.sid, session.sess, session.expire);
        }
      });
      insertMany(sessions);
      console.log(`  ✅ Migrated ${sessions.length} session(s)`);
    }

    console.log('  ✅ Authentication data migrated successfully');

    // Clean up old tables from user-settings.db
    console.log('  🧹 Removing old authentication tables from user-settings.db...');
    userSettingsDb.exec('DROP TABLE IF EXISTS auth_credentials');
    userSettingsDb.exec('DROP TABLE IF EXISTS sessions');
    console.log('  ✅ Old authentication tables removed');

    userSettingsDb.close();
  } catch (error) {
    console.error('  ⚠️  Error during authentication data migration:', error);
    // Don't throw - allow app to continue even if migration fails
  }
}

/**
 * Close database connection
 */
export function closeAuthDb(): void {
  if (authDb) {
    authDb.close();
    console.log('Authentication database connection closed');
  }
}

/**
 * Get database instance (use with caution)
 */
export function getAuthDb(): Database.Database {
  if (!authDb) {
    throw new Error('Authentication database not initialized');
  }
  return authDb;
}

/**
 * Get authentication database file path
 */
export function getAuthDbPath(): string {
  return AUTH_DB_PATH;
}
