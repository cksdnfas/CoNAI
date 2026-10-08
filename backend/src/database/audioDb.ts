import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import { ensureAudioSchema } from './audioSchema';
import { configureSqliteConnection } from './sqlitePragmas';

export const AUDIO_DB_PATH = path.join(runtimePaths.databaseDir, 'audio.db');

let audioDb: Database.Database | null = null;

/** Open audio.db and ensure its schema. Safe to call again; later calls reuse the open connection. */
export function initializeAudioDb(): Database.Database {
  if (audioDb) return audioDb;
  fs.mkdirSync(path.dirname(AUDIO_DB_PATH), { recursive: true });
  const isNew = !fs.existsSync(AUDIO_DB_PATH);
  const db = new Database(AUDIO_DB_PATH);
  configureSqliteConnection(db, { label: 'audio.db', cacheSizeMb: 16 });
  ensureAudioSchema(db);
  audioDb = db;
  console.log(isNew ? '✅ New audio database created' : '✅ Connected to audio database');
  return db;
}

/**
 * The open audio.db connection. Opens it on first use, so runtime-job subprocesses and the stdio MCP server, which
 * only initialise the databases they always need, can still reach the audio workspace.
 */
export function getAudioDb(): Database.Database {
  return audioDb ?? initializeAudioDb();
}

export function isAudioDbOpen(): boolean {
  return audioDb !== null;
}

/**
 * Whether there is an audio workspace to maintain. Maintenance passes (backup, orphan sweep, verification, retention)
 * check this first so they never create an empty audio.db, or hold one open, in a process that has none.
 */
export function hasAudioDb(): boolean {
  return audioDb !== null || fs.existsSync(AUDIO_DB_PATH);
}

export function closeAudioDb(): void {
  if (!audioDb) return;
  audioDb.close();
  audioDb = null;
  console.log('Audio database connection closed');
}
