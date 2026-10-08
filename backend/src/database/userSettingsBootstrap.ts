import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runtimePaths } from '../config/runtimePaths';
import { configureAttachedSqliteDatabase } from './sqlitePragmas';

export const USER_DB_PATH = path.join(runtimePaths.databaseDir, 'user.db');

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
  configureAttachedSqliteDatabase(userSettingsDb, 'main_db', 'main_db/images.db');
}

/** Ensure the unified user.db contains the API generation history table and indexes. */
export function ensureApiGenerationHistoryTable(userSettingsDb: Database.Database): void {
  userSettingsDb.exec(`
    CREATE TABLE IF NOT EXISTS api_generation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL CHECK(service_type IN ('comfyui', 'novelai', 'codex')),
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
