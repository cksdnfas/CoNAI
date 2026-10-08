import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { attachMainImagesDatabase, ensureApiGenerationHistoryTable, USER_DB_PATH } from './userSettingsBootstrap';
import { ensureUserSettingsCompatibility } from './userSettingsCompatibility';
import { createUserSettingsSchema } from './userSettingsSchema';
import { configureSqliteConnection } from './sqlitePragmas';

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

    const isNewDatabase = !fs.existsSync(USER_DB_PATH);
    userSettingsDb = new Database(USER_DB_PATH);
    configureSqliteConnection(userSettingsDb, { label: 'user.db' });

    if (isNewDatabase) {
      console.log('✅ New unified user database created');
    } else {
      console.log('✅ Connected to existing unified user database');
    }

    createUserSettingsSchema(userSettingsDb);
    ensureUserSettingsCompatibility(userSettingsDb);
    attachMainImagesDatabase(userSettingsDb);
    ensureApiGenerationHistoryTable(userSettingsDb);
  } catch (error) {
    console.error('Failed to initialize unified user database:', error);
    throw error;
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

