import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { REFMOD_ENTRY_FILE_REF_KIND, type RefModEntryFileRef } from '@conai/shared';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { MAX_UPLOAD_FILE_SIZE_BYTES } from '../../middleware/upload';
import { validateUploadedMediaFile } from '../../routes/images/uploadSecurity';
import { WINDOWS_RESERVED_NAME } from '../../utils/pathResolver';
import { FileStoreService } from '../fileStoreService';
import { ensureFileStoreDirectories, fileStoreIncoming } from '../fileStorePaths';
import { refModMediaExtension, safeMediaMime } from './refmodRecords';

/**
 * Owners that keep their own copies in the shared file store (RefMod entries, art styles): one folder per owner under
 * a root folder, an ownership table (`<ownerColumn>, file_id`) naming the copies, and the kind's own errors. Every
 * helper below takes the kind, so the owners share one implementation.
 */
export type OwnedFileKind = {
  /** The top folder under the store's root, e.g. "RefMod". */
  rootFolder: string;
  /** The folder names below the root for one owner's name (each is made a valid folder name). */
  folderSegments: (name: string) => string[];
  /** The ownership table and its owner column (constants, never input). */
  table: string;
  ownerColumn: string;
  /** mkdtemp prefix under the store's incoming directory. */
  stagingPrefix: string;
  /** Console tag for files a release had to keep. */
  logTag: string;
  error: (message: string, status?: number) => Error;
  messages: { tooLarge: string; unsupported: string; noBytes: string; unreadable: string };
};

/** Entry sources live in the shared file store under "RefMod/<entry name>/" (a folder per "/" segment). */
export const REFMOD_FILE_ROOT_FOLDER = 'RefMod';

export class RefModEntryError extends Error {
  constructor(message: string, readonly status = 400, readonly extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RefModEntryError';
  }
}

export const REFMOD_FILE_KIND: OwnedFileKind = {
  rootFolder: REFMOD_FILE_ROOT_FOLDER,
  folderSegments: (name) => name.split('/'),
  table: 'refmod_entry_files',
  ownerColumn: 'entry_id',
  stagingPrefix: 'refmod-',
  logTag: '[RefMod]',
  error: (message, status) => new RefModEntryError(message, status),
  messages: {
    tooLarge: 'RefMod 소스 파일이 너무 커.',
    unsupported: 'RefMod source media type is unsupported or does not match its kind.',
    noBytes: 'RefMod source has no bytes.',
    unreadable: 'RefMod source media could not be read.',
  },
};

export function isRefModEntryFileRef(value: unknown): value is RefModEntryFileRef {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).__ref === REFMOD_ENTRY_FILE_REF_KIND
    && typeof (value as Record<string, unknown>).id === 'string' && /^[a-f0-9]{32}$/.test((value as Record<string, string>).id);
}

/** One folder name the file store accepts, from one segment of an owner's name. */
function folderSegment(value: string): string {
  let name = value.normalize('NFC').replace(/[<>:"\/\\|?*\u0000-\u001f\u007f]/g, '_').trim().replace(/[. ]+$/, '');
  while (Buffer.byteLength(name, 'utf8') > 200) name = name.slice(0, -1);
  if (!name) name = '_';
  return WINDOWS_RESERVED_NAME.test(name) ? `_${name}` : name;
}

/** The owner's own folder (kept while it exists), else "<root>/<name segments>/" created as needed. */
export function ensureOwnedFolder(kind: OwnedFileKind, owner: string, ownerName: string, currentFolderId: string | null): string {
  if (currentFolderId) {
    try {
      const folder = FileStoreService.get(owner, currentFolderId);
      if (folder.kind === 'folder') return folder.id;
    } catch { /* gone: recreated below */ }
  }
  let parentId = FileStoreService.ensureFolder(owner, null, kind.rootFolder).id;
  for (const segment of kind.folderSegments(ownerName)) parentId = FileStoreService.ensureFolder(owner, parentId, folderSegment(segment)).id;
  return parentId;
}

function cappedStream(kind: OwnedFileKind, maxBytes: number) {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      callback(total > maxBytes ? kind.error(kind.messages.tooLarge, 413) : null, chunk);
    },
  });
}

export type StoredOwnedFile = { fileId: string; fileName: string; mimeType: string; bytes: number };

/**
 * Store one source as a new file of the owner's folder: staged under the store's incoming directory, checked for its
 * kind, MIME and content exactly as record capture checks sources, then installed by FileStoreService. Always a copy.
 */
export async function storeOwnedFile(kind: OwnedFileKind, owner: string, folderId: string, source: { filePath?: string; buffer?: Buffer; stream?: Readable }, input: {
  kind: string; mimeType: unknown; fileName?: string | null;
}): Promise<StoredOwnedFile> {
  const mime = safeMediaMime(input.mimeType, input.kind);
  if (!mime) throw kind.error(kind.messages.unsupported);
  ensureFileStoreDirectories();
  const staging = await fs.promises.mkdtemp(path.join(fileStoreIncoming, kind.stagingPrefix));
  const staged = path.join(staging, 'source.part');
  try {
    if (source.filePath) await fs.promises.copyFile(source.filePath, staged);
    else if (source.buffer) await fs.promises.writeFile(staged, source.buffer, { flag: 'wx' });
    else if (source.stream) await pipeline(source.stream, cappedStream(kind, MAX_UPLOAD_FILE_SIZE_BYTES), fs.createWriteStream(staged, { flags: 'wx' }));
    else throw kind.error(kind.messages.noBytes);
    try {
      await validateUploadedMediaFile({ path: staged, mimetype: mime });
    } catch (error) {
      throw kind.error(error instanceof Error ? error.message : kind.messages.unreadable);
    }
    const bytes = (await fs.promises.stat(staged)).size;
    const extension = refModMediaExtension(mime);
    const original = typeof input.fileName === 'string' && input.fileName.trim() ? input.fileName.trim() : `${input.kind}.${extension}`;
    const base = path.basename(original, path.extname(original)).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || input.kind;
    // The stored name's extension follows the validated MIME, never the name the source came with.
    const storedName = `${base}-${crypto.randomBytes(3).toString('hex')}.${extension}`;
    const [entry] = FileStoreService.upload(owner, folderId, [{
      path: staged, originalname: Buffer.from(storedName, 'utf8').toString('latin1'), mimetype: mime, size: bytes,
    } as Express.Multer.File], false);
    return { fileId: entry.id, fileName: original, mimeType: mime, bytes };
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true });
  }
}

export function ownsOwnedFile(kind: OwnedFileKind, ownerId: number, fileId: string): boolean {
  return Boolean(getUserSettingsDb().prepare(`SELECT 1 FROM ${kind.table} WHERE ${kind.ownerColumn} = ? AND file_id = ?`).get(ownerId, fileId));
}

/** An owner's file on disk with its validated MIME; null unless the owner holds that file (and it is still there). */
export function resolveOwnedFile(kind: OwnedFileKind, ownerId: number, fileId: string) {
  if (!/^[a-f0-9]{32}$/.test(fileId) || !ownsOwnedFile(kind, ownerId, fileId)) return null;
  try {
    const { entry, filePath } = FileStoreService.resolveFile('bootstrap', fileId);
    const mediaKind = entry.mimeType?.split('/')[0] ?? '';
    const mimeType = safeMediaMime(entry.mimeType, mediaKind);
    return mimeType ? { entry, filePath, mimeType, kind: mediaKind } : null;
  } catch {
    return null;
  }
}

/**
 * Delete copies that no owner of the kind references any more (their reference rows are already gone). A file chat or
 * a post still uses stays; that and any other failure is only logged.
 */
export function releaseOwnedFiles(kind: OwnedFileKind, owner: string, fileIds: Iterable<string>) {
  const stillUsed = getUserSettingsDb().prepare(`SELECT 1 FROM ${kind.table} WHERE file_id = ? LIMIT 1`);
  for (const fileId of new Set(fileIds)) {
    if (stillUsed.get(fileId)) continue;
    try { FileStoreService.delete(owner, [fileId]); }
    catch (error) { console.warn(`${kind.logTag} Kept file ${fileId}:`, error instanceof Error ? error.message : error); }
  }
}

/** Remove an emptied owner folder (and empty parents below the root); a folder that still holds anything stays. */
export function releaseOwnedFolder(kind: OwnedFileKind, owner: string, folderId: string | null) {
  let current = folderId;
  for (let depth = 0; current && depth < 64; depth += 1) {
    let parentId: string | null;
    try {
      const folder = FileStoreService.get(owner, current);
      if (folder.kind !== 'folder') return;
      parentId = folder.parentId;
      if (folder.name === kind.rootFolder && parentId === null) return;
      FileStoreService.delete(owner, [current]);
    } catch {
      return;
    }
    current = parentId;
  }
}

// ---------------------------------------------------------------- RefMod entries

/** The entry's own folder (kept while it exists), else "RefMod/<name segments>/" created as needed. */
export function ensureRefModEntryFolder(owner: string, entryName: string, currentFolderId: string | null): string {
  return ensureOwnedFolder(REFMOD_FILE_KIND, owner, entryName, currentFolderId);
}

export type StoredRefModSource = StoredOwnedFile;

/** One entry source as a new file of the entry's folder (see storeOwnedFile). Always a copy. */
export function storeRefModSource(owner: string, folderId: string, source: { filePath?: string; buffer?: Buffer; stream?: Readable }, input: {
  kind: string; mimeType: unknown; fileName?: string | null;
}): Promise<StoredRefModSource> {
  return storeOwnedFile(REFMOD_FILE_KIND, owner, folderId, source, input);
}

export function refModEntryFileRef(entryId: number, stored: StoredRefModSource): RefModEntryFileRef {
  return { __ref: REFMOD_ENTRY_FILE_REF_KIND, entryId, id: stored.fileId, fileName: stored.fileName, mimeType: stored.mimeType, bytes: stored.bytes };
}

export function entryOwnsFile(entryId: number, fileId: string): boolean {
  return ownsOwnedFile(REFMOD_FILE_KIND, entryId, fileId);
}

/** An entry's file on disk with its validated MIME; null unless the entry holds that file. */
export function resolveRefModEntryFile(entryId: number, fileId: string) {
  return resolveOwnedFile(REFMOD_FILE_KIND, entryId, fileId);
}

/** Delete entry copies that no entry references any more (see releaseOwnedFiles). */
export function releaseRefModFiles(owner: string, fileIds: Iterable<string>) {
  releaseOwnedFiles(REFMOD_FILE_KIND, owner, fileIds);
}

/** Remove an emptied entry folder (and empty "RefMod/…" parents); a folder that still holds anything stays. */
export function releaseRefModFolder(owner: string, folderId: string | null) {
  releaseOwnedFolder(REFMOD_FILE_KIND, owner, folderId);
}
