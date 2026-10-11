import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import { configureAttachedSqliteDatabase } from './sqlitePragmas';

/**
 * Embedding vectors, attached to user.db as `vector_db`. Derived data like search.db: rebuilt from the sources by
 * the AI worker, kept out of database backups, and a broken file is deleted and recreated.
 */
export const VECTOR_DB_PATH = path.join(runtimePaths.databaseDir, 'vectors.db');

/**
 * One row per (space, source_key, chunk). `space` names what was embedded and how (`media-style`, `chat-summary`,
 * …); `model_key` names the model + settings that made the vector, so rows from another model are never compared.
 * `owner_key` scopes searches (a chat, an account). `span_start` / `span_end`: the chunk's character range in the
 * source text (null for a whole source). Vectors are little-endian float32, L2-normalized.
 */
function ensureVectorSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vector_db.vectors (
      space TEXT NOT NULL,
      source_key TEXT NOT NULL,
      chunk INTEGER NOT NULL DEFAULT 0,
      model_key TEXT NOT NULL,
      dim INTEGER NOT NULL,
      owner_key TEXT,
      content_hash TEXT,
      span_start INTEGER,
      span_end INTEGER,
      vector BLOB NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (space, source_key, chunk)
    );
    CREATE INDEX IF NOT EXISTS vector_db.idx_vectors_space_model ON vectors(space, model_key);
    CREATE INDEX IF NOT EXISTS vector_db.idx_vectors_space_owner ON vectors(space, owner_key);
  `);
  const columns = new Set((db.prepare('PRAGMA vector_db.table_info(vectors)').all() as Array<{ name: string }>).map((column) => column.name));
  for (const column of ['span_start', 'span_end']) {
    if (!columns.has(column)) db.exec(`ALTER TABLE vector_db.vectors ADD COLUMN ${column} INTEGER`);
  }
}

export function attachVectorDatabase(db: Database.Database): void {
  if ((db.prepare('PRAGMA database_list').all() as Array<{ name: string }>).some((entry) => entry.name === 'vector_db')) return;
  const attach = () => {
    db.exec(`ATTACH DATABASE '${VECTOR_DB_PATH.replace(/'/g, "''")}' AS vector_db`);
    configureAttachedSqliteDatabase(db, 'vector_db', 'vector_db/vectors.db', { cacheSizeMb: 16 });
    ensureVectorSchema(db);
  };
  try {
    attach();
  } catch (error) {
    console.warn('⚠️ vectors.db unusable, recreating it:', error instanceof Error ? error.message : error);
    try { db.exec('DETACH DATABASE vector_db'); } catch { /* not attached */ }
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${VECTOR_DB_PATH}${suffix}`, { force: true });
    attach();
  }
}
