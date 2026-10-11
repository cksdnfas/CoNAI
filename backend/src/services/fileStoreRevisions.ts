import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import type { FileWriteSource, StoredFileRevision } from '@conai/shared';
import { getUserSettingsDb } from '../database/userSettingsDb';
import { fileOwnerDirectoryName, fileStoreRoot } from './fileStorePaths';

/**
 * Earlier versions of text files. Each time a text file is replaced in place, the text it had is kept here before the
 * new one lands, with who wrote that text and who replaced it (a person in the editor, a chat character's tool, the
 * MCP tools), so a document a bot rewrote can be read as it was and put back. The newest REVISIONS_PER_FILE stay per
 * file; a deleted file takes its versions with it.
 */

export const REVISIONS_PER_FILE = 30;
/** Bigger files (only uploads get there) are not versioned. */
export const MAX_REVISION_BYTES = 2 * 1024 * 1024;

const revisionRoot = path.join(fileStoreRoot, '.revisions');

const ensured = new WeakSet<Database.Database>();
/** Created on first use, like the chat's own tables. */
function db() {
  const database = getUserSettingsDb();
  if (!ensured.has(database)) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS stored_file_revisions (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        owner_key TEXT NOT NULL,
        size INTEGER NOT NULL,
        written_at TEXT NOT NULL,
        written_by TEXT,
        replaced_at TEXT NOT NULL DEFAULT (datetime('now')),
        replaced_by TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_stored_file_revisions_file ON stored_file_revisions(file_id, replaced_at DESC);
      CREATE TABLE IF NOT EXISTS stored_file_writers (
        file_id TEXT PRIMARY KEY,
        written_by TEXT
      );
    `);
    ensured.add(database);
  }
  return database;
}

function revisionPath(owner: string, id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid revision ID');
  return path.join(revisionRoot, fileOwnerDirectoryName(owner), `${id}.bin`);
}

function parseSource(value: string | null): FileWriteSource | null {
  if (!value) return null;
  try { return JSON.parse(value) as FileWriteSource; } catch { return null; }
}

function isoDate(value: string) {
  return `${value.replace(' ', 'T')}Z`;
}

type RevisionRow = { id: string; file_id: string; owner_key: string; size: number; written_at: string; written_by: string | null; replaced_at: string; replaced_by: string | null };

function toRevision(row: RevisionRow): StoredFileRevision {
  return { id: row.id, fileId: row.file_id, size: row.size, writtenAt: isoDate(row.written_at), writtenBy: parseSource(row.written_by), replacedAt: isoDate(row.replaced_at), replacedBy: parseSource(row.replaced_by) };
}

export const FileStoreRevisions = {
  /** Who wrote the file's current text (null: not known, e.g. written before versions existed). */
  writer(fileId: string): FileWriteSource | null {
    return parseSource((db().prepare('SELECT written_by FROM stored_file_writers WHERE file_id = ?').get(fileId) as { written_by: string | null } | undefined)?.written_by ?? null);
  },

  /**
   * Keep the file's current text as a version, just before `replacedBy` replaces it. Runs inside the replacing
   * transaction; the returned blob path is for the caller to remove when that transaction rolls back.
   */
  keep(owner: string, file: { id: string; size: number; updated_at: string }, currentPath: string, replacedBy: FileWriteSource | null): string | null {
    if (file.size > MAX_REVISION_BYTES || !fs.existsSync(currentPath)) return null;
    const id = crypto.randomBytes(16).toString('hex');
    const target = revisionPath(owner, id);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(currentPath, target);
    const writer = (db().prepare('SELECT written_by FROM stored_file_writers WHERE file_id = ?').get(file.id) as { written_by: string | null } | undefined)?.written_by ?? null;
    db().prepare('INSERT INTO stored_file_revisions (id, file_id, owner_key, size, written_at, written_by, replaced_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, file.id, owner, file.size, file.updated_at, writer, replacedBy ? JSON.stringify(replacedBy) : null);
    return target;
  },

  /** Remember who wrote the file's text now (after a create or replace committed). */
  setWriter(fileId: string, source: FileWriteSource | null) {
    db().prepare('INSERT INTO stored_file_writers (file_id, written_by) VALUES (?, ?) ON CONFLICT(file_id) DO UPDATE SET written_by = excluded.written_by')
      .run(fileId, source ? JSON.stringify(source) : null);
  },

  /** Drop the oldest versions past REVISIONS_PER_FILE. */
  trim(owner: string, fileId: string) {
    const old = db().prepare('SELECT id FROM stored_file_revisions WHERE file_id = ? ORDER BY replaced_at DESC, rowid DESC LIMIT -1 OFFSET ?').all(fileId, REVISIONS_PER_FILE) as Array<{ id: string }>;
    for (const row of old) {
      fs.rmSync(revisionPath(owner, row.id), { force: true });
      db().prepare('DELETE FROM stored_file_revisions WHERE id = ?').run(row.id);
    }
  },

  /** The file's versions, newest first. */
  list(owner: string, fileId: string): StoredFileRevision[] {
    return (db().prepare('SELECT * FROM stored_file_revisions WHERE file_id = ? AND owner_key = ? ORDER BY replaced_at DESC, rowid DESC').all(fileId, owner) as RevisionRow[]).map(toRevision);
  },

  find(owner: string, fileId: string, revisionId: string): StoredFileRevision | null {
    const row = db().prepare('SELECT * FROM stored_file_revisions WHERE id = ? AND file_id = ? AND owner_key = ?').get(revisionId, fileId, owner) as RevisionRow | undefined;
    return row ? toRevision(row) : null;
  },

  /** One version's text (versions are UTF-8 text files up to MAX_REVISION_BYTES). */
  readText(owner: string, fileId: string, revisionId: string): string | null {
    if (!/^[a-f0-9]{32}$/.test(revisionId) || !FileStoreRevisions.find(owner, fileId, revisionId)) return null;
    const target = revisionPath(owner, revisionId);
    if (!fs.existsSync(target)) return null;
    return new TextDecoder('utf-8').decode(fs.readFileSync(target));
  },

  /** The version a reply's first change replaced: what the file was before that reply touched it. */
  beforeReply(owner: string, fileId: string, threadId: number, replyId: string): StoredFileRevision | null {
    const rows = db().prepare(`SELECT * FROM stored_file_revisions WHERE file_id = ? AND owner_key = ?
      AND json_extract(replaced_by, '$.threadId') = ? AND json_extract(replaced_by, '$.replyId') = ? ORDER BY replaced_at ASC, rowid ASC LIMIT 1`)
      .all(fileId, owner, threadId, replyId) as RevisionRow[];
    return rows[0] ? toRevision(rows[0]) : null;
  },

  /** Forget a purged file's versions and writer. */
  purge(owner: string, fileId: string) {
    const rows = db().prepare('SELECT id FROM stored_file_revisions WHERE file_id = ?').all(fileId) as Array<{ id: string }>;
    for (const row of rows) fs.rmSync(revisionPath(owner, row.id), { force: true });
    db().prepare('DELETE FROM stored_file_revisions WHERE file_id = ?').run(fileId);
    db().prepare('DELETE FROM stored_file_writers WHERE file_id = ?').run(fileId);
  },
};
