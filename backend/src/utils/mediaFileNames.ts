import fs from 'fs';
import path from 'path';
import {
  FILE_NAME_ENGINE_INTERNAL,
  FILE_NAME_ENGINE_UPLOAD,
  fileNameCandidates,
  type FileNamingSettings,
} from '@conai/shared';

/**
 * Stored names for new library media: the patterns of settings › 파일 이름, made unique within the target folder
 * (case-insensitively, against the files there and the library rows that still point there), and published with an
 * exclusive write so two saves can never take the same name.
 */

export interface MediaFileNameRequest {
  /** Absolute folder the file is written into (created when missing). */
  directory: string;
  /** Extension of the saved format, with or without the dot. */
  extension: string;
  /**
   * `upload` names from `originalName` with the upload pattern; `generated` uses `requestedName` or the generated
   * pattern; `keep` tries `keepName` as it is first (a restored file).
   */
  kind: 'upload' | 'generated' | 'keep';
  keepName?: string;
  originalName?: string;
  requestedName?: string;
  /** `{engine}`; defaults to `upload` for uploads and `conai` for other unnamed results. */
  engine?: string;
  /** Library rows of this image do not make a name taken (a restored file going back to its own row). */
  ownHash?: string;
}

export interface MediaFileNameDependencies {
  settings?: FileNamingSettings;
  /** Lower-cased names of library rows directly inside `directory`, files present or not, except `ownHash` rows. */
  registeredNames?: (directory: string, ownHash?: string) => Iterable<string>;
  date?: Date;
}

/** Names this process is writing right now, per folder: a folder listing taken a moment earlier cannot see them. */
const writing = new Map<string, Set<string>>();
/** Names this process wrote recently, per folder, for listings that were read before the write finished. */
const written = new Map<string, Map<string, number>>();
const WRITTEN_TTL_MS = 60_000;
const MAX_ATTEMPTS = 100_000;
const ACCESS_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

function recentNames(directory: string, now: number): Map<string, number> {
  const names = written.get(directory) ?? new Map<string, number>();
  for (const [name, until] of names) if (until <= now) names.delete(name);
  written.set(directory, names);
  return names;
}

async function defaultSettings(): Promise<FileNamingSettings> {
  const { settingsService } = await import('../services/settingsService');
  return settingsService.loadSettings().fileNaming;
}

/** Library rows whose stored file sits directly in `directory`; a range scan on the unique path index. */
async function defaultRegisteredNames(directory: string, ownHash?: string): Promise<string[]> {
  const { db } = await import('../database/init');
  const prefix = directory + path.sep;
  const upper = directory + String.fromCharCode(path.sep.charCodeAt(0) + 1);
  let rows: string[];
  try {
    rows = db.prepare(`SELECT original_file_path FROM image_files WHERE original_file_path >= ? AND original_file_path < ?
      AND (? IS NULL OR composite_hash IS NOT ?)`).pluck().all(prefix, upper, ownHash ?? null, ownHash ?? null) as string[];
  } catch (error) {
    // A process that never created the library schema (a standalone tool or test) has no rows to stay clear of.
    if (/no such table: image_files/.test(String((error as Error)?.message))) return [];
    throw error;
  }
  return rows.map((row) => row.slice(prefix.length)).filter((name) => name && !name.includes('/') && !name.includes('\\')).map((name) => name.toLowerCase());
}

/**
 * Write a new file under the first free name and return its absolute path. `writeExclusive` must fail with EEXIST
 * when the target exists (`flag: 'wx'`, `COPYFILE_EXCL`, a link): the next name is tried then.
 */
export async function writeMediaFileWithUniqueName(
  request: MediaFileNameRequest,
  writeExclusive: (targetPath: string) => Promise<void>,
  dependencies: MediaFileNameDependencies = {},
): Promise<string> {
  const directory = path.resolve(request.directory);
  await fs.promises.mkdir(directory, { recursive: true });
  const settings = dependencies.settings ?? await defaultSettings();
  const listing = await fs.promises.readdir(directory);
  const registered = dependencies.registeredNames ? [...dependencies.registeredNames(directory, request.ownHash)] : await defaultRegisteredNames(directory, request.ownHash);
  // Everything below up to the first write runs synchronously, so concurrent saves see each other's reservations.
  const taken = new Set<string>([...listing.map((name) => name.toLowerCase()), ...registered]);
  const reserved = writing.get(directory) ?? new Set<string>();
  writing.set(directory, reserved);
  const candidates = fileNameCandidates({
    settings,
    kind: request.kind,
    keepName: request.keepName,
    originalName: request.originalName,
    requestedName: request.requestedName,
    extension: request.extension,
    engine: request.engine ?? (request.kind === 'upload' ? FILE_NAME_ENGINE_UPLOAD : FILE_NAME_ENGINE_INTERNAL),
    date: dependencies.date,
  });
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const name = candidates.next().value;
      const key = name.toLowerCase();
      if (taken.has(key) || reserved.has(key) || recentNames(directory, Date.now()).has(key)) continue;
      reserved.add(key);
      const target = path.join(directory, name);
      try {
        await writeExclusive(target);
        recentNames(directory, Date.now()).set(key, Date.now() + WRITTEN_TTL_MS);
        return target;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          // An exclusive write that got past creating the file owns it; a half-written file must not stay behind.
          // Access errors can also mean someone else's locked file holds the name, so that one is left alone.
          if (!code || !ACCESS_ERROR_CODES.has(code)) await fs.promises.rm(target, { force: true }).catch(() => undefined);
          throw error;
        }
        taken.add(key);
      } finally {
        reserved.delete(key);
      }
    }
    throw new Error(`No free file name in ${directory}`);
  } finally {
    if (!reserved.size) writing.delete(directory);
    if (!recentNames(directory, Date.now()).size) written.delete(directory);
  }
}

/** Exclusive writers for `writeMediaFileWithUniqueName`. */
export const exclusiveWrites = {
  bytes: (data: Buffer | Uint8Array) => (target: string) => fs.promises.writeFile(target, data, { flag: 'wx' }),
  copy: (source: string) => (target: string) => fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL),
};
