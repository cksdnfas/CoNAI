import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import { configureAttachedSqliteDatabase } from './sqlitePragmas';

/**
 * Derived search text, attached to user.db as `search_db`. Nothing here is original data: it is rebuilt from the
 * sources on demand, kept out of database backups, and a broken file is simply deleted and recreated.
 */
export const SEARCH_DB_PATH = path.join(runtimePaths.databaseDir, 'search.db');

/**
 * One searchable document per (source, source_id): `file` = a file store entry id (later `post`, …). `revision`
 * is whatever the source uses to tell its text changed (files: `size|updated_at`); a mismatch means re-read.
 */
function ensureSearchSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_db.search_documents (
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      owner_key TEXT,
      revision TEXT NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (source, source_id)
    );
    CREATE INDEX IF NOT EXISTS search_db.idx_search_documents_owner ON search_documents(source, owner_key);
  `);
}

export function attachSearchDatabase(db: Database.Database): void {
  if ((db.prepare('PRAGMA database_list').all() as Array<{ name: string }>).some((entry) => entry.name === 'search_db')) return;
  const attach = () => {
    db.exec(`ATTACH DATABASE '${SEARCH_DB_PATH.replace(/'/g, "''")}' AS search_db`);
    configureAttachedSqliteDatabase(db, 'search_db', 'search_db/search.db', { cacheSizeMb: 8 });
    ensureSearchSchema(db);
  };
  try {
    attach();
  } catch (error) {
    console.warn('⚠️ search.db unusable, recreating it:', error instanceof Error ? error.message : error);
    try { db.exec('DETACH DATABASE search_db'); } catch { /* not attached */ }
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${SEARCH_DB_PATH}${suffix}`, { force: true });
    attach();
  }
}
