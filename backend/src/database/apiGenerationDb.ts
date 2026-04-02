import Database from 'better-sqlite3';
import { getUserSettingsDb } from './userSettingsDb';

/**
 * Backward-compatible alias for the unified user.db connection.
 * API generation history now lives in user.db instead of a separate database file.
 */
export let apiGenDb: Database.Database;

/**
 * Initialize the API generation database alias.
 * The unified user.db must already be initialized first.
 */
export function initializeApiGenerationDb(): void {
  apiGenDb = getUserSettingsDb();
  console.log('✅ API generation history now uses the unified user database');
}

/**
 * Close database connection.
 * api_generation_history shares the user.db connection, so closing is handled there.
 */
export function closeApiGenerationDb(): void {
  console.log('API generation history shares the unified user database connection');
}

/**
 * Get database instance (use with caution).
 */
export function getApiGenDb(): Database.Database {
  return getUserSettingsDb();
}
