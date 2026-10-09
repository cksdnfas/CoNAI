import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { FileStoreListing, StoredFileEntry, StoredFileOwner, StoredFileText } from '@conai/shared';
import { getUserSettingsDb } from '../database/userSettingsDb';
import { AuthAccount } from '../models/AuthAccount';
import { ensureFileOwnerDirectory, ensureFileStoreDirectories, fileStoreIncoming, migrateFileStoreLayout, storedFilePath, fileStoreThumbnailPath } from './fileStorePaths';

export class FileStoreError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type FileRow = {
  id: string; owner_key: string; parent_id: string | null; name: string; name_key: string;
  kind: 'file' | 'folder'; mime_type: string | null; size: number; created_at: string; updated_at: string;
};

export const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.yaml', '.yml', '.xml', '.html', '.htm', '.svg', '.css', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.sh', '.sql', '.log', '.ini', '.toml', '.srt', '.vtt']);
/** Extensions anyone with `files.edit` may store. Everything else (executables, archives, unknown) is for administrators. */
export const DEFAULT_UPLOAD_EXTENSIONS: ReadonlySet<string> = new Set([
  ...TEXT_EXTENSIONS,
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.ico', '.psd',
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.ogv',
  '.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.weba',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.hwp', '.hwpx', '.odt', '.ods', '.odp', '.rtf', '.epub',
]);
const MAX_DEPTH = 64;
export const MAX_CHAT_ATTACHMENTS = 20;

export function fileOwnerKey(accountId: number | null): string {
  return accountId === null ? 'bootstrap' : `account:${accountId}`;
}

/** Owner keys travel in query strings for cross-account browsing; only the two canonical shapes are accepted. */
export function parseOwnerKey(value: unknown): string {
  if (typeof value !== 'string' || !/^(bootstrap|account:[1-9]\d{0,9})$/.test(value)) throw new FileStoreError('잘못된 계정 키야.');
  return value;
}

/** Judged by extension only; the uploader's MIME is never trusted. A missing extension counts as restricted. */
export function isRestrictedFileName(name: string): boolean {
  const extension = path.extname(name).toLowerCase();
  return !extension || !DEFAULT_UPLOAD_EXTENSIONS.has(extension);
}

export function assertFileTypeAllowed(name: string, allowAnyType: boolean): void {
  if (!allowAnyType && isRestrictedFileName(name)) {
    throw new FileStoreError(`이 형식은 올릴 수 없어: ${name}. 텍스트·이미지·영상·오디오·문서만 가능하고, 그 외는 별도 권한이 필요해.`, 403);
  }
}

export function toEntry(row: FileRow): StoredFileEntry {
  return { id: row.id, parentId: row.parent_id, name: row.name, kind: row.kind, mimeType: row.mime_type,
    size: row.size, createdAt: `${row.created_at.replace(' ', 'T')}Z`, updatedAt: `${row.updated_at.replace(' ', 'T')}Z` };
}

function normalizeName(value: unknown): string {
  if (typeof value !== 'string') throw new FileStoreError('이름을 입력해줘.');
  const name = value.normalize('NFC').trim();
  if (!name || Buffer.byteLength(name, 'utf8') > 240 || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name)
    || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new FileStoreError('사용할 수 없는 이름이야. 경로 문자 없이 240바이트 이내로 입력해줘.');
  }
  return name;
}

/** Browsers send UTF-8 multipart names, which Busboy exposes as Latin-1 by default. */
function uploadedName(value: string): string {
  if ([...value].every((char) => char.charCodeAt(0) <= 255)) {
    try { return normalizeName(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'latin1'))); }
    catch (error) { if (error instanceof FileStoreError) throw error; }
  }
  return normalizeName(value);
}

export function parseFileId(value: unknown, nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) throw new FileStoreError('잘못된 파일 또는 폴더 ID야.');
  return value;
}

function requireRow(owner: string, id: string): FileRow {
  parseFileId(id);
  const row = getUserSettingsDb().prepare('SELECT * FROM stored_file_entries WHERE id = ? AND owner_key = ? AND deleted_at IS NULL').get(id, owner) as FileRow | undefined;
  if (!row) throw new FileStoreError('파일 또는 폴더를 찾을 수 없어.', 404);
  return row;
}

function requireFolder(owner: string, id: string | null) {
  if (id === null) return;
  if (requireRow(owner, id).kind !== 'folder') throw new FileStoreError('대상은 폴더여야 해.');
}

function assertUnique(owner: string, parentId: string | null, name: string, exceptId = '') {
  if (getUserSettingsDb().prepare(`SELECT 1 FROM stored_file_entries
    WHERE owner_key = ? AND parent_id IS ? AND name_key = ? AND id <> ? AND deleted_at IS NULL`).get(owner, parentId, name.toLowerCase(), exceptId)) {
    throw new FileStoreError(`같은 이름의 항목이 있어: ${name}`, 409);
  }
}

function ancestors(owner: string, parentId: string | null): StoredFileEntry[] {
  const result: StoredFileEntry[] = [];
  const seen = new Set<string>();
  while (parentId !== null) {
    if (seen.has(parentId) || result.length >= MAX_DEPTH) throw new FileStoreError('폴더가 너무 깊거나 순환 관계가 있어.');
    seen.add(parentId);
    const entry = requireRow(owner, parentId);
    result.unshift(toEntry(entry));
    parentId = entry.parent_id;
  }
  return result;
}

function insert(owner: string, parentId: string | null, name: string, kind: FileRow['kind'], id: string, size = 0, mime: string | null = null) {
  requireFolder(owner, parentId);
  if (ancestors(owner, parentId).length >= MAX_DEPTH) throw new FileStoreError('폴더는 최대 64단계까지 만들 수 있어.');
  assertUnique(owner, parentId, name);
  getUserSettingsDb().prepare(`INSERT INTO stored_file_entries (id, owner_key, parent_id, name, name_key, kind, size, mime_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, owner, parentId, name, name.toLowerCase(), kind, size, mime);
  return toEntry(requireRow(owner, id));
}

/**
 * What changed in one owner's store, told after the change committed. `previousParentId` / `previousName`: where a
 * moved or renamed entry was. Deleted entries are already gone when this is told.
 */
export type FileStoreChange = {
  owner: string;
  action: 'write' | 'rename' | 'move' | 'delete';
  entries: Array<{ id: string; kind: FileRow['kind']; name: string; parentId: string | null; previousParentId?: string | null; previousName?: string }>;
};
type FileStoreListener = (change: FileStoreChange) => void;
const changeListeners = new Set<FileStoreListener>();

/** A failing listener never fails the change itself; it is logged. */
function notifyChange(change: FileStoreChange) {
  if (change.entries.length === 0) return;
  for (const listener of changeListeners) {
    try { listener(change); }
    catch (error) { console.warn('[file-store] Change hook failed:', error instanceof Error ? error.message : error); }
  }
}

function changedEntry(row: FileRow, previous?: FileRow): FileStoreChange['entries'][number] {
  return { id: row.id, kind: row.kind, name: row.name, parentId: row.parent_id,
    ...(previous ? { previousParentId: previous.parent_id, previousName: previous.name } : {}) };
}

function textMimeType(name: string) {
  const extension = path.extname(name).toLowerCase();
  if (extension === '.json') return 'application/json';
  if (extension === '.md' || extension === '.markdown') return 'text/markdown';
  return 'text/plain';
}

function idsInput(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) throw new FileStoreError('1~200개 항목을 선택해줘.');
  return [...new Set(value.map((id) => parseFileId(id) as string))];
}

export const FileStoreService = {
  attachmentsForThread(threadId: number) {
    const rows = getUserSettingsDb().prepare(`SELECT e.*, a.message_id FROM chat_file_attachments a
      JOIN stored_file_entries e ON e.id = a.file_id AND e.deleted_at IS NULL
      JOIN codex_chat_messages m ON m.id = a.message_id WHERE m.thread_id = ? ORDER BY a.rowid`).all(threadId) as Array<FileRow & { message_id: number }>;
    const result = new Map<number, StoredFileEntry[]>();
    for (const row of rows) result.set(row.message_id, [...(result.get(row.message_id) ?? []), toEntry(row)]);
    return result;
  },

  get(owner: string, id: string) { return toEntry(requireRow(owner, id)); },

  neighbors(owner: string, id: string) {
    const row = requireRow(owner, id);
    const find = (previous: boolean) => {
      const operator = previous ? '<' : '>';
      const direction = previous ? 'DESC' : 'ASC';
      const found = getUserSettingsDb().prepare(`SELECT * FROM stored_file_entries
        WHERE owner_key = ? AND parent_id IS ? AND kind = 'file' AND deleted_at IS NULL
        AND (name_key, id) ${operator} (?, ?) ORDER BY name_key ${direction}, id ${direction} LIMIT 1`)
        .get(owner, row.parent_id, row.name_key, row.id) as FileRow | undefined;
      return found ? toEntry(found) : null;
    };
    return { previous: find(true), next: find(false) };
  },

  list(owner: string, parentId: string | null, offset = 0, limit = 100): FileStoreListing {
    requireFolder(owner, parentId);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new FileStoreError('잘못된 목록 범위야.');
    const db = getUserSettingsDb();
    const rows = db.prepare(`SELECT * FROM stored_file_entries WHERE owner_key = ? AND parent_id IS ? AND deleted_at IS NULL
      ORDER BY kind DESC, name_key, id LIMIT ? OFFSET ?`).all(owner, parentId, limit, offset) as FileRow[];
    const { total } = db.prepare('SELECT COUNT(*) AS total FROM stored_file_entries WHERE owner_key = ? AND parent_id IS ? AND deleted_at IS NULL').get(owner, parentId) as { total: number };
    return { entries: rows.map(toEntry), breadcrumbs: ancestors(owner, parentId), total, offset, limit };
  },

  folders(owner: string) {
    return (getUserSettingsDb().prepare(`SELECT * FROM stored_file_entries WHERE owner_key = ? AND kind = 'folder' AND deleted_at IS NULL ORDER BY name_key, id`).all(owner) as FileRow[]).map(toEntry);
  },

  createFolder(owner: string, parentId: string | null, value: unknown) {
    const name = normalizeName(value);
    return getUserSettingsDb().transaction(() => insert(owner, parentId, name, 'folder', crypto.randomBytes(16).toString('hex'))).immediate();
  },

  /** The caller owns staged files; failed transactions remove all newly allocated blobs. */
  upload(owner: string, parentId: string | null, files: Express.Multer.File[], allowAnyType = false) {
    ensureFileStoreDirectories();
    ensureFileOwnerDirectory(owner);
    const allocated: string[] = [];
    let entries: StoredFileEntry[];
    try {
      entries = getUserSettingsDb().transaction(() => files.map((file) => {
        const name = uploadedName(file.originalname);
        assertFileTypeAllowed(name, allowAnyType);
        const id = crypto.randomBytes(16).toString('hex');
        const entry = insert(owner, parentId, name, 'file', id, file.size,
          /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(file.mimetype) ? file.mimetype : 'application/octet-stream');
        const target = storedFilePath(owner, id);
        // The DB ID is reserved in this transaction, and staging shares the destination volume.
        if (fs.existsSync(target)) throw new FileStoreError('파일 저장 ID가 충돌했어. 다시 시도해줘.', 409);
        fs.renameSync(file.path, target);
        allocated.push(target);
        return entry;
      })).immediate();
    } catch (error) {
      for (const target of allocated) fs.rmSync(target, { force: true });
      throw error;
    }
    notifyChange({ owner, action: 'write', entries: entries.map((entry) => ({ id: entry.id, kind: entry.kind, name: entry.name, parentId: entry.parentId })) });
    return entries;
  },

  /** Renaming is the other way a restricted extension could appear, so files obey the same type policy as uploads. */
  rename(owner: string, id: string, value: unknown, allowAnyType = false) {
    const name = normalizeName(value);
    const [previous, current] = getUserSettingsDb().transaction(() => {
      const row = requireRow(owner, id);
      if (row.kind === 'file' && name.toLowerCase() !== row.name_key) assertFileTypeAllowed(name, allowAnyType);
      assertUnique(owner, row.parent_id, name, id);
      getUserSettingsDb().prepare('UPDATE stored_file_entries SET name = ?, name_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, name.toLowerCase(), id);
      // The extension decides whether the text is searchable; a same-second rename would look unchanged to the cache.
      getUserSettingsDb().prepare("DELETE FROM search_db.search_documents WHERE source = 'file' AND source_id = ?").run(id);
      return [row, requireRow(owner, id)];
    }).immediate();
    notifyChange({ owner, action: 'rename', entries: [changedEntry(current, previous)] });
    return toEntry(current);
  },

  move(owner: string, value: unknown, parentId: string | null) {
    const ids = idsInput(value);
    const moved = getUserSettingsDb().transaction(() => {
      requireFolder(owner, parentId);
      const destinationAncestors = ancestors(owner, parentId);
      const rows = ids.map((id) => requireRow(owner, id));
      if (destinationAncestors.some((entry) => ids.includes(entry.id))) throw new FileStoreError('폴더를 자기 자신이나 하위 폴더로 옮길 수 없어.');
      // Selecting a folder already moves its descendants; do not flatten them accidentally.
      const roots = rows.filter((row) => !ancestors(owner, row.parent_id).some((entry) => ids.includes(entry.id)));
      for (const row of roots) {
        if (row.kind === 'folder') {
          const subtree = getUserSettingsDb().prepare(`WITH RECURSIVE tree(id, depth) AS (
            SELECT id, 1 FROM stored_file_entries WHERE id = ? UNION ALL
            SELECT e.id, tree.depth + 1 FROM stored_file_entries e JOIN tree ON e.parent_id = tree.id WHERE e.deleted_at IS NULL
          ) SELECT MAX(depth) AS depth FROM tree`).get(row.id) as { depth: number };
          if (destinationAncestors.length + subtree.depth > MAX_DEPTH) throw new FileStoreError('폴더는 최대 64단계까지 이동할 수 있어.');
        }
        assertUnique(owner, parentId, row.name, row.id);
        getUserSettingsDb().prepare('UPDATE stored_file_entries SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(parentId, row.id);
      }
      return roots.map((row) => changedEntry({ ...row, parent_id: parentId }, row));
    }).immediate();
    notifyChange({ owner, action: 'move', entries: moved });
  },

  /** Empty folders only. Attachments protect their originals; deleting a chat releases the reference. */
  delete(owner: string, value: unknown) {
    const ids = idsInput(value);
    const db = getUserSettingsDb();
    const removed = db.transaction(() => {
      const rows: FileRow[] = [];
      for (const id of ids) {
        const row = requireRow(owner, id);
        if (row.kind === 'folder' && db.prepare('SELECT 1 FROM stored_file_entries WHERE parent_id = ? AND deleted_at IS NULL').get(id)) {
          throw new FileStoreError('폴더를 비운 다음 삭제해줘.', 409);
        }
        if (db.prepare('SELECT 1 FROM chat_file_attachments WHERE file_id = ?').get(id)) {
          throw new FileStoreError(`채팅에서 참조 중인 파일은 삭제할 수 없어: ${row.name}`, 409);
        }
        if (db.prepare("SELECT 1 FROM post_media_refs WHERE kind = 'file' AND ref = ?").get(id)) {
          throw new FileStoreError(`게시물에서 쓰는 파일은 삭제할 수 없어: ${row.name}`, 409);
        }
        rows.push(row);
      }
      for (const id of ids) db.prepare('UPDATE stored_file_entries SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      return rows;
    }).immediate();
    this.purgeDeleted();
    notifyChange({ owner, action: 'delete', entries: removed.map((row) => changedEntry(row)) });
  },

  /** Listen to writes, renames, moves and deletes (see FileStoreChange). Returns the unsubscribe. */
  onChange(listener: FileStoreListener) {
    changeListeners.add(listener);
    return () => { changeListeners.delete(listener); };
  },

  /** The live entry named `name` directly under `parentId`, or null. */
  findChild(owner: string, parentId: string | null, name: string): StoredFileEntry | null {
    const row = getUserSettingsDb().prepare('SELECT * FROM stored_file_entries WHERE owner_key = ? AND parent_id IS ? AND name_key = ? AND deleted_at IS NULL')
      .get(owner, parentId, name.normalize('NFC').toLowerCase()) as FileRow | undefined;
    return row ? toEntry(row) : null;
  },

  /** The folder `name` under `parentId`, created when missing. A file of that name is a conflict. */
  ensureFolder(owner: string, parentId: string | null, value: unknown): StoredFileEntry {
    const name = normalizeName(value);
    return getUserSettingsDb().transaction(() => {
      const existing = this.findChild(owner, parentId, name);
      if (existing && existing.kind !== 'folder') throw new FileStoreError(`같은 이름의 항목이 있어: ${name}`, 409);
      return existing ?? insert(owner, parentId, name, 'folder', crypto.randomBytes(16).toString('hex'));
    }).immediate();
  },

  /**
   * Create a UTF-8 text file, or replace one in place: the blob is swapped in one rename and the id stays, so links
   * by id survive. `silent` keeps the change listeners out (the caller already accounts for it).
   */
  writeText(owner: string, parentId: string | null, value: unknown, text: string, options: { silent?: boolean } = {}): StoredFileEntry {
    const name = normalizeName(value);
    if (!TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())) throw new FileStoreError('텍스트 파일만 쓸 수 있어.', 415);
    ensureFileStoreDirectories();
    ensureFileOwnerDirectory(owner);
    const data = Buffer.from(text, 'utf8');
    const staged = path.join(fileStoreIncoming, `${crypto.randomBytes(16).toString('hex')}.tmp`);
    fs.writeFileSync(staged, data);
    let row: FileRow;
    try {
      row = getUserSettingsDb().transaction(() => {
        const existing = this.findChild(owner, parentId, name);
        if (existing && existing.kind !== 'file') throw new FileStoreError(`같은 이름의 항목이 있어: ${name}`, 409);
        const id = existing?.id ?? crypto.randomBytes(16).toString('hex');
        if (existing) {
          getUserSettingsDb().prepare('UPDATE stored_file_entries SET size = ?, mime_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(data.length, textMimeType(name), id);
          // A rewrite in the same second at the same size would look unchanged to the search cache.
          getUserSettingsDb().prepare("DELETE FROM search_db.search_documents WHERE source = 'file' AND source_id = ?").run(id);
        } else {
          insert(owner, parentId, name, 'file', id, data.length, textMimeType(name));
        }
        fs.renameSync(staged, storedFilePath(owner, id));
        return requireRow(owner, id);
      }).immediate();
    } finally {
      fs.rmSync(staged, { force: true });
    }
    fs.rmSync(fileStoreThumbnailPath(row.id), { force: true });
    if (!options.silent) notifyChange({ owner, action: 'write', entries: [changedEntry(row)] });
    return toEntry(row);
  },

  /**
   * A copy of one of the owner's files as a new file `name` under `parentId` (a new id; the name must be free). The
   * blob is in place when this returns: a caller whose surrounding transaction rolls back removes it itself.
   */
  copyFile(owner: string, fileId: string, parentId: string | null, value: unknown, options: { silent?: boolean } = {}): StoredFileEntry {
    const name = normalizeName(value);
    const source = requireRow(owner, fileId);
    if (source.kind !== 'file') throw new FileStoreError('파일을 선택해줘.');
    ensureFileStoreDirectories();
    ensureFileOwnerDirectory(owner);
    const staged = path.join(fileStoreIncoming, `${crypto.randomBytes(16).toString('hex')}.tmp`);
    fs.copyFileSync(storedFilePath(owner, source.id), staged);
    let row: FileRow;
    try {
      row = getUserSettingsDb().transaction(() => {
        const id = crypto.randomBytes(16).toString('hex');
        insert(owner, parentId, name, 'file', id, source.size, source.mime_type);
        fs.renameSync(staged, storedFilePath(owner, id));
        return requireRow(owner, id);
      }).immediate();
    } finally {
      fs.rmSync(staged, { force: true });
    }
    if (!options.silent) notifyChange({ owner, action: 'write', entries: [changedEntry(row)] });
    return toEntry(row);
  },

  /** A folder and everything under it. Files a chat message attaches are refused, as with delete. */
  deleteTree(owner: string, folderId: string, options: { silent?: boolean } = {}) {
    const db = getUserSettingsDb();
    const removed = db.transaction(() => {
      if (requireRow(owner, folderId).kind !== 'folder') throw new FileStoreError('대상은 폴더여야 해.');
      const rows = db.prepare(`WITH RECURSIVE tree(id, depth) AS (
        SELECT ?, 0 UNION ALL
        SELECT e.id, tree.depth + 1 FROM stored_file_entries e JOIN tree ON e.parent_id = tree.id WHERE e.deleted_at IS NULL AND tree.depth < ${MAX_DEPTH}
      ) SELECT s.* FROM stored_file_entries s JOIN tree ON s.id = tree.id WHERE s.owner_key = ?`).all(folderId, owner) as FileRow[];
      for (const row of rows) {
        if (db.prepare('SELECT 1 FROM chat_file_attachments WHERE file_id = ?').get(row.id)) {
          throw new FileStoreError(`채팅에서 참조 중인 파일은 삭제할 수 없어: ${row.name}`, 409);
        }
        if (db.prepare("SELECT 1 FROM post_media_refs WHERE kind = 'file' AND ref = ?").get(row.id)) {
          throw new FileStoreError(`게시물에서 쓰는 파일은 삭제할 수 없어: ${row.name}`, 409);
        }
      }
      const mark = db.prepare('UPDATE stored_file_entries SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?');
      for (const row of rows) mark.run(row.id);
      return rows;
    }).immediate();
    // A folder row goes only once its children rows are gone, so purge level by level.
    const exists = db.prepare('SELECT 1 FROM stored_file_entries WHERE id = ?');
    for (let pass = 0; pass < MAX_DEPTH && exists.get(folderId); pass++) this.purgeDeleted();
    if (!options.silent) notifyChange({ owner, action: 'delete', entries: removed.map((row) => changedEntry(row)) });
  },

  /** `a/b/c`: the names from below `ancestorId` down to `id`, or null when `id` is not (live) inside that folder. */
  relativePath(owner: string, ancestorId: string, id: string): string | null {
    const lookup = getUserSettingsDb().prepare('SELECT parent_id, name FROM stored_file_entries WHERE id = ? AND owner_key = ? AND deleted_at IS NULL');
    const names: string[] = [];
    let current: string | null = id;
    while (current !== null && current !== ancestorId) {
      if (names.length >= MAX_DEPTH) return null;
      const row = lookup.get(current, owner) as { parent_id: string | null; name: string } | undefined;
      if (!row) return null;
      names.unshift(row.name);
      current = row.parent_id;
    }
    return current === ancestorId && names.length > 0 ? names.join('/') : null;
  },

  /** The live entry at `a/b/c` below `folderId` (names compared as the store does, case-insensitive), or null. */
  resolvePath(owner: string, folderId: string, relative: string): StoredFileEntry | null {
    let entry: StoredFileEntry | null = null;
    let parentId: string | null = folderId;
    for (const segment of relative.split('/')) {
      if (parentId === null || !segment) return null;
      entry = this.findChild(owner, parentId, segment);
      if (!entry) return null;
      parentId = entry.kind === 'folder' ? entry.id : null;
    }
    return entry;
  },

  /** Tombstones make interrupted filesystem deletion retryable without reviving a half-deleted file. */
  purgeDeleted() {
    const db = getUserSettingsDb();
    const rows = db.prepare(`SELECT id, kind, owner_key FROM stored_file_entries WHERE deleted_at IS NOT NULL LIMIT 200`).all() as Array<{ id: string; kind: string; owner_key: string }>;
    for (const row of rows) {
      try {
        if (row.kind === 'file') {
          fs.rmSync(storedFilePath(row.owner_key, row.id), { force: true });
          fs.rmSync(fileStoreThumbnailPath(row.id), { force: true });
        }
        db.prepare('DELETE FROM stored_file_entries WHERE id = ? AND NOT EXISTS (SELECT 1 FROM stored_file_entries WHERE parent_id = ?)').run(row.id, row.id);
        db.prepare("DELETE FROM search_db.search_documents WHERE source = 'file' AND source_id = ?").run(row.id);
      } catch (error) {
        console.warn('[file-store] Deletion will retry:', row.id, error instanceof Error ? error.message : error);
      }
    }
  },

  resolveFile(owner: string, id: string) {
    const entry = this.get(owner, id);
    if (entry.kind !== 'file') throw new FileStoreError('파일을 선택해줘.');
    ensureFileStoreDirectories();
    const filePath = storedFilePath(owner, id);
    if (!fs.existsSync(filePath)) throw new FileStoreError('원본 파일을 찾을 수 없어.', 404);
    return { entry, filePath };
  },

  /** Every account plus any owner key that still holds files (deleted accounts, bootstrap), for cross-account browsing. */
  owners(selfOwner: string): StoredFileOwner[] {
    const usage = new Map((getUserSettingsDb().prepare(`SELECT owner_key, SUM(kind = 'file') AS files, COALESCE(SUM(size), 0) AS bytes
      FROM stored_file_entries WHERE deleted_at IS NULL GROUP BY owner_key`).all() as Array<{ owner_key: string; files: number; bytes: number }>)
      .map((row) => [row.owner_key, row]));
    const result: StoredFileOwner[] = [];
    const seen = new Set<string>();
    const push = (ownerKey: string, account: { id: number; username: string; account_type: 'admin' | 'guest'; status: 'active' | 'disabled' } | null) => {
      if (seen.has(ownerKey)) return;
      seen.add(ownerKey);
      const used = usage.get(ownerKey);
      result.push({
        ownerKey, accountId: account?.id ?? null, username: account?.username ?? null, accountType: account?.account_type ?? null,
        status: account ? account.status : ownerKey === 'bootstrap' ? 'bootstrap' : 'deleted',
        fileCount: used?.files ?? 0, totalSize: used?.bytes ?? 0, self: ownerKey === selfOwner,
      });
    };
    for (const account of AuthAccount.listAll()) push(fileOwnerKey(account.id), account);
    for (const ownerKey of usage.keys()) push(ownerKey, null);
    if (selfOwner === 'bootstrap') push('bootstrap', null);
    return result.sort((left, right) => Number(right.self) - Number(left.self) || (left.username ?? '').localeCompare(right.username ?? '') || left.ownerKey.localeCompare(right.ownerKey));
  },

  /** One-time move from the flat blob layout into per-owner directories; safe to run on every boot. */
  migrateLayout() {
    const lookup = getUserSettingsDb().prepare('SELECT owner_key FROM stored_file_entries WHERE id = ?');
    return migrateFileStoreLayout((id) => (lookup.get(id) as { owner_key: string } | undefined)?.owner_key ?? null);
  },

  async readText(owner: string, id: string, offset = 0, limit = 16000): Promise<StoredFileText> {
    const { entry, filePath } = this.resolveFile(owner, id);
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) throw new FileStoreError('텍스트 읽기는 UTF-8 텍스트 파일만 지원해. 음성·문서는 별도 변환이 필요해.', 415);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.size || !Number.isSafeInteger(limit) || limit < 4 || limit > 32000) throw new FileStoreError(`잘못된 읽기 범위야 (파일 크기 ${entry.size}바이트).`);
    const handle = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(limit, entry.size - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      // Start on a character: an offset inside a UTF-8 codepoint moves forward past its continuation bytes.
      let skip = 0;
      while (skip < Math.min(bytesRead, 3) && (buffer[skip] & 0xc0) === 0x80) skip++;
      const start = offset + skip;
      // End only on a complete UTF-8 codepoint, so nextOffset can be used losslessly.
      let end = bytesRead;
      if (offset + bytesRead < entry.size) {
        let lead = bytesRead - 1;
        while (lead >= skip && (buffer[lead] & 0xc0) === 0x80) lead--;
        if (lead >= skip) {
          const byte = buffer[lead];
          const width = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4;
          if (lead + width > bytesRead) end = lead;
        }
      }
      const data = buffer.subarray(skip, end);
      if (data.includes(0)) throw new FileStoreError('바이너리 파일은 텍스트로 읽을 수 없어.', 415);
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
      catch { throw new FileStoreError('UTF-8로 저장한 텍스트 파일만 읽을 수 있어.', 415); }
      const next = offset + end;
      return { offset: start, nextOffset: next < entry.size ? next : null, size: entry.size, text };
    } finally { await handle.close(); }
  },

  validateAttachments(owner: string, value: unknown): StoredFileEntry[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_CHAT_ATTACHMENTS) throw new FileStoreError('첨부파일은 최대 20개까지 가능해.');
    return [...new Set(value.map((id) => parseFileId(id) as string))].map((id) => this.resolveFile(owner, id).entry);
  },
};
