import crypto from 'crypto';
import fs from 'fs';
import type { FileWriteSource, StoredFileRevision } from '@conai/shared';
import { getUserSettingsDb as db } from '../database/userSettingsDb';
import { storedRevisionPath } from './fileStorePaths';
import { copyStoredRevision, retireStoredRevision } from './fileStoreWriteTransaction';

/**
 * Earlier versions of text files. Each time a text file is replaced in place, the text it had is kept here before the
 * new one lands, with who wrote that text and who replaced it (a person in the editor, a chat character's tool, the
 * MCP tools), so a document a bot rewrote can be read as it was and put back. The newest REVISIONS_PER_FILE stay per
 * file; a deleted file takes its versions with it.
 */

export const REVISIONS_PER_FILE = 30;
/** Bigger files (only uploads get there) are not versioned. */
export const MAX_REVISION_BYTES = 2 * 1024 * 1024;

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
  /** Preserve writer identity and before-reply undo when an automation's result moves to a durable chat. */
  moveChatReply(fileIds: string[], fromThreadId: number, threadId: number, replyId: string) {
    const database = db();
    for (const fileId of fileIds) {
      for (const [table, column] of [['stored_file_revisions', 'written_by'], ['stored_file_revisions', 'replaced_by'], ['stored_file_writers', 'written_by']]) {
        database.prepare(`UPDATE ${table} SET ${column} = json_set(${column}, '$.threadId', ?, '$.replyId', ?)
          WHERE file_id = ? AND json_valid(${column}) AND json_extract(${column}, '$.via') = 'chat'
            AND json_extract(${column}, '$.threadId') = ?`).run(threadId, replyId, fileId, fromThreadId);
      }
    }
  },

  /** Who wrote the file's current text (null: not known, e.g. written before versions existed). */
  writer(fileId: string): FileWriteSource | null {
    return parseSource((db().prepare('SELECT written_by FROM stored_file_writers WHERE file_id = ?').get(fileId) as { written_by: string | null } | undefined)?.written_by ?? null);
  },

  /**
   * Keep the file's current text as a version, just before `replacedBy` replaces it. Runs inside the replacing
   * transaction; a rollback also removes the retained copy.
   */
  keep(owner: string, file: { id: string; size: number; updated_at: string }, currentPath: string, replacedBy: FileWriteSource | null): string | null {
    if (file.size > MAX_REVISION_BYTES || !fs.existsSync(currentPath)) return null;
    const id = crypto.randomBytes(16).toString('hex');
    const target = copyStoredRevision(currentPath, id);
    const writer = (db().prepare('SELECT written_by FROM stored_file_writers WHERE file_id = ?').get(file.id) as { written_by: string | null } | undefined)?.written_by ?? null;
    db().prepare('INSERT INTO stored_file_revisions (id, file_id, owner_key, size, written_at, written_by, replaced_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, file.id, owner, file.size, file.updated_at, writer, replacedBy ? JSON.stringify(replacedBy) : null);
    return target;
  },

  /** Store the writer in the same transaction as the file bytes. */
  setWriter(fileId: string, source: FileWriteSource | null) {
    db().prepare('INSERT INTO stored_file_writers (file_id, written_by) VALUES (?, ?) ON CONFLICT(file_id) DO UPDATE SET written_by = excluded.written_by')
      .run(fileId, source ? JSON.stringify(source) : null);
  },

  /** Drop the oldest versions past REVISIONS_PER_FILE. */
  trim(fileId: string) {
    const old = db().prepare('SELECT id FROM stored_file_revisions WHERE file_id = ? ORDER BY replaced_at DESC, rowid DESC LIMIT -1 OFFSET ?').all(fileId, REVISIONS_PER_FILE) as Array<{ id: string }>;
    for (const row of old) {
      retireStoredRevision(row.id);
      db().prepare('DELETE FROM stored_file_revisions WHERE id = ?').run(row.id);
    }
  },

  /** The file's versions, newest first. */
  list(owner: string, fileId: string): StoredFileRevision[] {
    return (db().prepare('SELECT * FROM stored_file_revisions WHERE file_id = ? ORDER BY replaced_at DESC, rowid DESC').all(fileId) as RevisionRow[]).map(toRevision);
  },

  find(owner: string, fileId: string, revisionId: string): StoredFileRevision | null {
    const row = db().prepare('SELECT * FROM stored_file_revisions WHERE id = ? AND file_id = ?').get(revisionId, fileId) as RevisionRow | undefined;
    return row ? toRevision(row) : null;
  },

  /** One version's text (versions are UTF-8 text files up to MAX_REVISION_BYTES). */
  readText(owner: string, fileId: string, revisionId: string): string | null {
    if (!/^[a-f0-9]{32}$/.test(revisionId) || !FileStoreRevisions.find(owner, fileId, revisionId)) return null;
    const target = storedRevisionPath(revisionId);
    if (!fs.existsSync(target)) return null;
    return new TextDecoder('utf-8').decode(fs.readFileSync(target));
  },

  /** The version a reply's first change replaced: what the file was before that reply touched it. */
  beforeReply(owner: string, fileId: string, threadId: number, replyId: string): StoredFileRevision | null {
    const rows = db().prepare(`SELECT * FROM stored_file_revisions WHERE file_id = ?
      AND json_extract(replaced_by, '$.threadId') = ? AND json_extract(replaced_by, '$.replyId') = ? ORDER BY replaced_at ASC, rowid ASC LIMIT 1`)
      .all(fileId, threadId, replyId) as RevisionRow[];
    return rows[0] ? toRevision(rows[0]) : null;
  },

  /** Forget a purged file's versions and writer. */
  purge(owner: string, fileId: string) {
    const rows = db().prepare('SELECT id FROM stored_file_revisions WHERE file_id = ?').all(fileId) as Array<{ id: string }>;
    for (const row of rows) fs.rmSync(storedRevisionPath(row.id), { force: true });
    db().prepare('DELETE FROM stored_file_revisions WHERE file_id = ?').run(fileId);
    db().prepare('DELETE FROM stored_file_writers WHERE file_id = ?').run(fileId);
  },
};
