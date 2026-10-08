import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import { ensureRecycleBinSchema } from '../database/recycleBinSchema';
import { getUserSettingsDb } from '../database/userSettingsDb';
import { normalizeFilename } from './pathResolver';

/**
 * RecycleBin 유틸리티
 * 삭제된 파일을 RecycleBin 폴더로 이동하여 복구 가능하도록 관리
 */

// RecycleBin 폴더 경로 (runtimePaths를 통해 중앙 관리)
export const RECYCLE_BIN_PATH = runtimePaths.recycleBinDir;
const RETRYABLE_UNLINK_ERROR_CODES = new Set(['EBUSY', 'EPERM']);
const UNLINK_RETRY_DELAYS_MS = [100, 250, 500, 1000, 2000, 4000, 8000];
// rename 실패 중 복사+삭제로 되살릴 수 있는 코드들.
// EXDEV는 다른 볼륨, 나머지는 Windows에서 다른 핸들(탐색기 미리보기, 백신,
// 진행 중인 sharp 읽기)이 파일을 잡고 있을 때 흔히 나온다.
const RENAME_FALLBACK_ERROR_CODES = new Set(['EXDEV', 'EPERM', 'EBUSY', 'EACCES', 'ENOTSUP']);
/** Keeps `<timestamp>-<token>_<name>` well under the 255-byte file name limit of NTFS and ext4. */
const MAX_BIN_NAME_BYTES = 200;

/** What sent a file to the RecycleBin; shown to administrators next to the original location. */
export type RecycleBinSource =
  | 'library'
  | 'metadata-edit'
  | 'workflow-output'
  | 'workflow-compaction'
  | 'workflow-retention'
  | 'audio';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableUnlinkError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && RETRYABLE_UNLINK_ERROR_CODES.has(String((error as NodeJS.ErrnoException).code));
}

export async function unlinkWithTransientLockRetry(filePath: string): Promise<void> {
  for (let attempt = 0; attempt <= UNLINK_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await fs.promises.unlink(filePath);
      return;
    } catch (error) {
      if (!isRetryableUnlinkError(error) || attempt === UNLINK_RETRY_DELAYS_MS.length) {
        throw error;
      }

      await sleep(UNLINK_RETRY_DELAYS_MS[attempt]);
    }
  }
}

/** Trim the name part (never the extension) until it fits the byte budget. */
function fitFileName(fileName: string, maxBytes: number): string {
  if (Buffer.byteLength(fileName, 'utf8') <= maxBytes) return fileName;
  const extension = path.extname(fileName).slice(0, 16);
  let stem = fileName.slice(0, fileName.length - path.extname(fileName).length);
  while (stem.length > 1 && Buffer.byteLength(stem + extension, 'utf8') > maxBytes) stem = stem.slice(0, -1);
  return stem + extension;
}

/**
 * RecycleBin용 파일명 생성
 * 형식: {timestamp}-{token}_{original_filename}
 * The timestamp prefix keeps names in deletion order; the random token keeps two same-named files deleted in the
 * same millisecond (e.g. every copy of one image) from landing on the same name.
 *
 * @example
 * generateRecycleBinFileName('uploads/2025-01-15/한글_이미지.png')
 * // Returns: '2025-01-15T12-30-45-123Z-k3f9a2_한글_이미지.png'
 */
export function generateRecycleBinFileName(originalPath: string, now = new Date()): string {
  // ISO 8601 타임스탬프 생성 (콜론과 점을 하이픈으로 변경하여 파일명 호환성 확보)
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const token = crypto.randomBytes(4).readUInt32BE(0).toString(36).padStart(6, '0').slice(-6);
  const prefix = `${timestamp}-${token}_`;
  const fileName = normalizeFilename(path.basename(originalPath)) || 'file';
  return prefix + fitFileName(fileName, MAX_BIN_NAME_BYTES - Buffer.byteLength(prefix, 'utf8'));
}

const BIN_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-[a-z0-9]{6})?_(.+)$/;

/** Deletion time and original name read back from a RecycleBin file name (current and pre-token formats). */
export function parseRecycleBinFileName(binName: string): { deletedAt: string | null; originalName: string } {
  const match = BIN_NAME_PATTERN.exec(binName);
  if (!match) return { deletedAt: null, originalName: binName };
  const [, date, hours, minutes, seconds, millis, originalName] = match;
  return { deletedAt: `${date}T${hours}:${minutes}:${seconds}.${millis}Z`, originalName };
}

/** A fresh RecycleBin path that no existing file occupies. */
function reserveRecycleBinPath(filePath: string): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = path.join(RECYCLE_BIN_PATH, generateRecycleBinFileName(filePath));
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not reserve a unique RecycleBin file name');
}

let recycleBinSchemaDb: unknown = null;

function recycleBinDb() {
  const db = getUserSettingsDb();
  if (recycleBinSchemaDb !== db) {
    ensureRecycleBinSchema(db);
    recycleBinSchemaDb = db;
  }
  return db;
}

/** Best effort: a file that reached the RecycleBin stays there even when its origin cannot be recorded. */
function recordOrigin(binPath: string, originalPath: string, size: number, source: RecycleBinSource | null) {
  try {
    recycleBinDb().prepare(`INSERT OR REPLACE INTO recycle_bin_entries (bin_name, original_path, size, source)
      VALUES (?, ?, ?, ?)`).run(path.basename(binPath), path.resolve(originalPath), size, source);
  } catch (error) {
    console.warn('⚠️ Could not record the RecycleBin origin:', error instanceof Error ? error.message : error);
  }
}

export type RecycleBinOrigin = { binName: string; originalPath: string; size: number; source: string | null; deletedAt: string };

/** Recorded origins for these RecycleBin file names (files deleted before origins were recorded have none). */
export function readRecycleBinOrigins(binNames: readonly string[]): Map<string, RecycleBinOrigin> {
  const result = new Map<string, RecycleBinOrigin>();
  if (binNames.length === 0) return result;
  const db = recycleBinDb();
  const select = db.prepare('SELECT bin_name, original_path, size, source, deleted_at FROM recycle_bin_entries WHERE bin_name = ?');
  for (const name of binNames) {
    const row = select.get(name) as { bin_name: string; original_path: string; size: number; source: string | null; deleted_at: string } | undefined;
    if (row) result.set(name, { binName: row.bin_name, originalPath: row.original_path, size: row.size, source: row.source, deletedAt: `${row.deleted_at.replace(' ', 'T')}Z` });
  }
  return result;
}

export function forgetRecycleBinOrigins(binNames: readonly string[]): void {
  if (binNames.length === 0) return;
  const db = recycleBinDb();
  const remove = db.prepare('DELETE FROM recycle_bin_entries WHERE bin_name = ?');
  db.transaction(() => { for (const name of binNames) remove.run(name); })();
}

/**
 * Drop recorded origins whose file is gone from the RecycleBin. Checked per record against the directory as it is
 * now, so a file moved in while the bin was being emptied keeps its origin.
 */
export function forgetMissingRecycleBinOrigins(directory: string): void {
  const db = recycleBinDb();
  const names = (db.prepare('SELECT bin_name FROM recycle_bin_entries').all() as Array<{ bin_name: string }>).map((row) => row.bin_name);
  forgetRecycleBinOrigins(names.filter((name) => !fs.existsSync(path.join(directory, name))));
}

/**
 * Move one file, renaming when possible. A rename across volumes or blocked by another handle falls back to an
 * exclusive copy (never overwriting `target`) followed by a retried unlink of `source`.
 */
export async function relocateFile(source: string, target: string): Promise<void> {
  // 같은 볼륨이면 rename이 복사+삭제보다 훨씬 빠르므로 rename을 먼저 시도.
  // 다른 볼륨(EXDEV)이거나 잠금성 오류(EPERM/EBUSY/EACCES/ENOTSUP)면
  // 복사 후 재시도 unlink 경로로 폴백한다.
  try {
    await fs.promises.rename(source, target);
    return;
  } catch (renameError) {
    const renameErrorCode = String((renameError as NodeJS.ErrnoException).code);
    if (!RENAME_FALLBACK_ERROR_CODES.has(renameErrorCode)) {
      throw renameError;
    }
  }

  await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);

  try {
    await unlinkWithTransientLockRetry(source);
  } catch (error) {
    if (fs.existsSync(target)) {
      try {
        await fs.promises.unlink(target);
      } catch (cleanupError) {
        console.error(`⚠️ Failed to cleanup copied file:`, cleanupError);
      }
    }

    throw error;
  }
}

/** Hard links are not available here (another volume, FAT/exFAT, some network shares): copy instead. */
const LINK_FALLBACK_ERROR_CODES = new Set(['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK']);

/**
 * Move one file without ever replacing `target`: rename would overwrite a file created there in the meantime, so the
 * file is hard-linked (or exclusively copied) to `target` first, which fails with EEXIST when the name is taken, and
 * only then removed from `source`. On failure `source` is left in place.
 */
export async function moveFileWithoutReplacing(source: string, target: string): Promise<void> {
  try {
    await fs.promises.link(source, target);
  } catch (linkError) {
    if (!LINK_FALLBACK_ERROR_CODES.has(String((linkError as NodeJS.ErrnoException).code))) throw linkError;
    await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  }

  try {
    await unlinkWithTransientLockRetry(source);
  } catch (error) {
    await fs.promises.unlink(target).catch((cleanupError) => {
      console.error(`⚠️ Failed to remove the restored copy after the move failed:`, cleanupError);
    });
    throw error;
  }
}

/**
 * 파일을 RecycleBin으로 복사 (원본은 그대로 둔다)
 *
 * @param filePath - 복사할 파일의 전체 경로
 * @returns RecycleBin에 저장된 파일의 전체 경로
 *
 * @throws 파일이 존재하지 않거나 복사 실패 시 에러
 */
export async function copyToRecycleBin(filePath: string, source: RecycleBinSource | null = null): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  await fs.promises.mkdir(RECYCLE_BIN_PATH, { recursive: true });
  const recycleBinFilePath = reserveRecycleBinPath(filePath);
  await fs.promises.copyFile(filePath, recycleBinFilePath, fs.constants.COPYFILE_EXCL);
  recordOrigin(recycleBinFilePath, filePath, stats.size, source);
  return recycleBinFilePath;
}

async function moveToRecycleBin(filePath: string, source: RecycleBinSource | null): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  await fs.promises.mkdir(RECYCLE_BIN_PATH, { recursive: true });
  const recycleBinFilePath = reserveRecycleBinPath(filePath);

  try {
    await relocateFile(filePath, recycleBinFilePath);
  } catch (error) {
    console.error(`❌ Failed to move file to RecycleBin:`, error);
    throw error;
  }

  recordOrigin(recycleBinFilePath, filePath, stats.size, source);
  console.log(`♻️ Moved to RecycleBin: ${path.basename(filePath)} → ${path.basename(recycleBinFilePath)}`);
  return recycleBinFilePath;
}

/**
 * 파일을 완전히 삭제
 * RecycleBin을 사용하지 않고 즉시 삭제
 *
 * @param filePath - 삭제할 파일의 전체 경로
 *
 * @throws 파일이 존재하지 않거나 삭제 실패 시 에러
 */
async function deleteFilePermanently(filePath: string): Promise<void> {
  // 파일 존재 확인
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ File not found (skipping): ${filePath}`);
    return;
  }

  // 파일인지 확인 (디렉토리는 제외)
  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile()) {
    console.warn(`⚠️ Not a file (skipping): ${filePath}`);
    return;
  }

  try {
    await unlinkWithTransientLockRetry(filePath);
    console.log(`🗑️ Permanently deleted: ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`❌ Failed to delete file:`, error);
    throw error;
  }
}

/**
 * 파일 삭제 (설정에 따라 RecycleBin 이동 또는 완전 삭제)
 *
 * @param filePath - 삭제할 파일의 전체 경로
 * @param useRecycleBin - RecycleBin 사용 여부
 * @param source - RecycleBin에 기록할 삭제 출처 (복원 화면에 표시)
 * @returns RecycleBin 사용 시 RecycleBin 경로, 완전 삭제 시 undefined
 */
export async function deleteFile(
  filePath: string,
  useRecycleBin: boolean,
  source: RecycleBinSource | null = null
): Promise<string | undefined> {
  if (useRecycleBin) {
    return await moveToRecycleBin(filePath, source);
  } else {
    await deleteFilePermanently(filePath);
    return undefined;
  }
}
