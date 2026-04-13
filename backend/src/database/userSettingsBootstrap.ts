import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runtimePaths } from '../config/runtimePaths';

export const USER_DB_PATH = path.join(runtimePaths.databaseDir, 'user.db');
const LEGACY_USER_SETTINGS_DB_PATH = path.join(runtimePaths.databaseDir, 'user-settings.db');
const LEGACY_API_GENERATION_DB_PATH = path.join(runtimePaths.databaseDir, 'api-generation-history.db');

/** Resolve the user-settings migrations directory across dev, dist, and portable layouts. */
function getUserSettingsMigrationsPath(): string {
  const possiblePaths = [
    path.join(__dirname, '../../src/database/migrations/user-settings'),
    path.join(__dirname, 'migrations/user-settings'),
    path.join(process.cwd(), 'app', 'migrations', 'user-settings'),
    path.join(path.dirname(process.argv[1] || ''), 'migrations', 'user-settings'),
    path.join(__dirname, '../migrations/user-settings'),
  ];

  for (const candidatePath of possiblePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return possiblePaths[0];
}

export const USER_SETTINGS_MIGRATIONS_PATH = getUserSettingsMigrationsPath();

export type UnifiedUserDbBootstrapResult = {
  copiedLegacyUserSettingsDb: boolean;
};

/** Copy the legacy user-settings.db into the unified user.db on first startup. */
export function bootstrapUnifiedUserDb(): UnifiedUserDbBootstrapResult {
  if (fs.existsSync(USER_DB_PATH)) {
    return { copiedLegacyUserSettingsDb: false };
  }

  if (!fs.existsSync(LEGACY_USER_SETTINGS_DB_PATH)) {
    return { copiedLegacyUserSettingsDb: false };
  }

  fs.copyFileSync(LEGACY_USER_SETTINGS_DB_PATH, USER_DB_PATH);
  console.log('🔄 Copied legacy user-settings.db to unified user.db');

  return { copiedLegacyUserSettingsDb: true };
}

/** Attach images.db as main_db so user.db can query the main media tables. */
export function attachMainImagesDatabase(userSettingsDb: Database.Database): void {
  const attachedDatabases = userSettingsDb.prepare('PRAGMA database_list').all() as Array<{ name: string }>;
  if (attachedDatabases.some((database) => database.name === 'main_db')) {
    return;
  }

  const mainDbPath = runtimePaths.databaseFile;
  if (!fs.existsSync(mainDbPath)) {
    console.warn('⚠️ images.db not found, skipping main_db attach for user.db');
    return;
  }

  const escapedPath = mainDbPath.replace(/'/g, "''");
  userSettingsDb.exec(`ATTACH DATABASE '${escapedPath}' AS main_db`);
}

/** Ensure the unified user.db contains the API generation history table and indexes. */
export function ensureApiGenerationHistoryTable(userSettingsDb: Database.Database): void {
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS api_generation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL CHECK(service_type IN ('comfyui', 'novelai')),
      generation_status TEXT NOT NULL DEFAULT 'pending' CHECK(generation_status IN ('pending', 'processing', 'completed', 'failed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      comfyui_workflow TEXT,
      comfyui_prompt_id TEXT,
      workflow_id INTEGER,
      workflow_name TEXT,
      group_id INTEGER,
      nai_model TEXT,
      nai_sampler TEXT,
      nai_seed INTEGER,
      nai_steps INTEGER,
      nai_scale REAL,
      nai_parameters TEXT,
      positive_prompt TEXT,
      negative_prompt TEXT,
      width INTEGER,
      height INTEGER,
      original_path TEXT,
      file_size INTEGER,
      assigned_group_id INTEGER,
      composite_hash TEXT,
      error_message TEXT,
      metadata TEXT,
      queue_job_id INTEGER,
      requested_by_account_id INTEGER,
      requested_by_account_type TEXT,
      server_id INTEGER
    )
  `);

  const hasColumn = (tableName: string, columnName: string): boolean => {
    const pragma = userSettingsDb.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return pragma.some((column) => column.name === columnName);
  };

  if (!hasColumn('api_generation_history', 'queue_job_id')) {
    userSettingsDb.exec('ALTER TABLE api_generation_history ADD COLUMN queue_job_id INTEGER');
  }
  if (!hasColumn('api_generation_history', 'requested_by_account_id')) {
    userSettingsDb.exec('ALTER TABLE api_generation_history ADD COLUMN requested_by_account_id INTEGER');
  }
  if (!hasColumn('api_generation_history', 'requested_by_account_type')) {
    userSettingsDb.exec('ALTER TABLE api_generation_history ADD COLUMN requested_by_account_type TEXT');
  }
  if (!hasColumn('api_generation_history', 'server_id')) {
    userSettingsDb.exec('ALTER TABLE api_generation_history ADD COLUMN server_id INTEGER');
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_api_gen_service_type ON api_generation_history(service_type)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_status ON api_generation_history(generation_status)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_created_at ON api_generation_history(created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_composite_hash ON api_generation_history(composite_hash)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_workflow_id ON api_generation_history(workflow_id)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_group_id ON api_generation_history(group_id)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_queue_job_id ON api_generation_history(queue_job_id)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_requested_by_account_id ON api_generation_history(requested_by_account_id)',
    'CREATE INDEX IF NOT EXISTS idx_api_gen_server_id ON api_generation_history(server_id)',
    'CREATE INDEX IF NOT EXISTS idx_api_generation_history_status_created ON api_generation_history(generation_status, created_at DESC)',
  ];

  indexes.forEach((sql) => userSettingsDb.exec(sql));
}

/** Merge rows from the legacy api-generation-history.db into user.db, then remove the old file. */
export function migrateLegacyApiGenerationHistory(userSettingsDb: Database.Database): boolean {
  if (!fs.existsSync(LEGACY_API_GENERATION_DB_PATH)) {
    return false;
  }

  const escapedPath = LEGACY_API_GENERATION_DB_PATH.replace(/'/g, "''");
  const attachedDatabases = userSettingsDb.prepare('PRAGMA database_list').all() as Array<{ name: string }>;
  if (attachedDatabases.some((database) => database.name === 'legacy_api_generation')) {
    userSettingsDb.exec('DETACH DATABASE legacy_api_generation');
  }

  let shouldDeleteLegacyFile = false;

  try {
    userSettingsDb.exec(`ATTACH DATABASE '${escapedPath}' AS legacy_api_generation`);

    const legacyTable = userSettingsDb.prepare(`
      SELECT name
      FROM legacy_api_generation.sqlite_master
      WHERE type = 'table' AND name = 'api_generation_history'
    `).get() as { name: string } | undefined;

    if (!legacyTable) {
      shouldDeleteLegacyFile = true;
      return shouldDeleteLegacyFile;
    }

    const legacyCount = (userSettingsDb.prepare('SELECT COUNT(*) AS count FROM legacy_api_generation.api_generation_history').get() as { count: number }).count;

    if (legacyCount > 0) {
      userSettingsDb.exec('BEGIN');
      try {
        userSettingsDb.exec(`
          INSERT OR IGNORE INTO api_generation_history (
            id,
            service_type,
            generation_status,
            created_at,
            completed_at,
            comfyui_workflow,
            comfyui_prompt_id,
            workflow_id,
            workflow_name,
            group_id,
            nai_model,
            nai_sampler,
            nai_seed,
            nai_steps,
            nai_scale,
            nai_parameters,
            positive_prompt,
            negative_prompt,
            width,
            height,
            original_path,
            file_size,
            assigned_group_id,
            composite_hash,
            error_message,
            metadata
          )
          SELECT
            id,
            service_type,
            generation_status,
            created_at,
            completed_at,
            comfyui_workflow,
            comfyui_prompt_id,
            workflow_id,
            workflow_name,
            group_id,
            nai_model,
            nai_sampler,
            nai_seed,
            nai_steps,
            nai_scale,
            nai_parameters,
            positive_prompt,
            negative_prompt,
            width,
            height,
            original_path,
            file_size,
            assigned_group_id,
            composite_hash,
            error_message,
            metadata
          FROM legacy_api_generation.api_generation_history
        `);
        userSettingsDb.exec('COMMIT');
      } catch (error) {
        userSettingsDb.exec('ROLLBACK');
        throw error;
      }
    }

    const missingCount = (userSettingsDb.prepare(`
      SELECT COUNT(*) AS count
      FROM legacy_api_generation.api_generation_history legacy
      LEFT JOIN api_generation_history current ON current.id = legacy.id
      WHERE current.id IS NULL
    `).get() as { count: number }).count;

    if (missingCount > 0) {
      throw new Error(`Failed to migrate ${missingCount} api_generation_history rows into user.db`);
    }

    shouldDeleteLegacyFile = true;
    return shouldDeleteLegacyFile;
  } finally {
    const databasesAfterMigration = userSettingsDb.prepare('PRAGMA database_list').all() as Array<{ name: string }>;
    if (databasesAfterMigration.some((database) => database.name === 'legacy_api_generation')) {
      userSettingsDb.exec('DETACH DATABASE legacy_api_generation');
    }

    if (shouldDeleteLegacyFile) {
      try {
        fs.unlinkSync(LEGACY_API_GENERATION_DB_PATH);
        console.log('🧹 Removed legacy api-generation-history.db after user.db migration');
      } catch (error) {
        console.warn('⚠️ Failed to remove legacy api-generation-history.db:', error instanceof Error ? error.message : error);
      }
    }
  }
}

/** Remove the copied legacy user-settings.db after the unified db is verified. */
export function cleanupLegacyUserSettingsDb(copiedLegacyUserSettingsDb: boolean): void {
  if (!copiedLegacyUserSettingsDb || !fs.existsSync(LEGACY_USER_SETTINGS_DB_PATH)) {
    return;
  }

  try {
    fs.unlinkSync(LEGACY_USER_SETTINGS_DB_PATH);
    console.log('🧹 Removed legacy user-settings.db after user.db bootstrap');
  } catch (error) {
    console.warn('⚠️ Failed to remove legacy user-settings.db:', error instanceof Error ? error.message : error);
  }
}
