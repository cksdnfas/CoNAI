import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runtimePaths } from '../config/runtimePaths';

const AUTH_DB_PATH = path.join(runtimePaths.databaseDir, 'auth.db');

/**
 * Authentication Database Instance
 * Separated from the unified user database for easy account recovery
 * Contains only: auth_credentials, sessions
 *
 * Recovery: Simply delete auth.db and restart server
 */
export let authDb: Database.Database;

/**
 * Initialize Authentication Database
 * - Creates database file if not exists
 * - Creates auth tables automatically
 * - Handles migration from legacy user database files if needed
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

    // Migrate from legacy user database files if needed
    migrateFromLegacyUserDbs();
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
 * Migrate authentication data from legacy user database files to auth.db.
 * This checks both user.db and user-settings.db so upgrades stay safe and idempotent.
 */
function migrateFromLegacyUserDbs(): void {
  try {
    const candidatePaths = [
      path.join(runtimePaths.databaseDir, 'user.db'),
      path.join(runtimePaths.databaseDir, 'user-settings.db'),
    ];

    for (const candidatePath of candidatePaths) {
      if (!fs.existsSync(candidatePath)) {
        continue;
      }

      const userSettingsDb = new Database(candidatePath);

      try {
        const tables = userSettingsDb.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name='auth_credentials'
        `).all();

        if (tables.length === 0) {
          continue;
        }

        const authData = userSettingsDb.prepare('SELECT * FROM auth_credentials WHERE id = 1').get() as any;
        if (!authData) {
          continue;
        }

        const existingAuth = authDb.prepare('SELECT * FROM auth_credentials WHERE id = 1').get();
        if (existingAuth) {
          console.log(`  ℹ️  Authentication data already exists in auth.db, skipping migration from ${path.basename(candidatePath)}`);
          continue;
        }

        console.log(`🔄 Migrating authentication data from ${path.basename(candidatePath)} to auth.db...`);
        authDb.prepare(`
          INSERT INTO auth_credentials (id, username, password_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(authData.id, authData.username, authData.password_hash, authData.created_at, authData.updated_at);

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
        console.log(`  🧹 Removing old authentication tables from ${path.basename(candidatePath)}...`);
        userSettingsDb.exec('DROP TABLE IF EXISTS auth_credentials');
        userSettingsDb.exec('DROP TABLE IF EXISTS sessions');
        console.log('  ✅ Old authentication tables removed');
        return;
      } finally {
        userSettingsDb.close();
      }
    }
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
