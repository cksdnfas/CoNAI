import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { runtimePaths } from '../../config/runtimePaths';
import { getAudioDb } from '../../database/audioDb';
import { relocateFile } from '../../utils/recycleBin';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobeStatic = require('ffprobe-static') as { path?: string };

/**
 * Content-addressed store for the audio workspace: `<uploads>/audio/<h0h1>/<h2h3>/<sha256>.<ext>`.
 *
 * Files only enter through `ingestAudioFile` (uploads, file-store imports, generation results, rendered edits). The
 * store is private to the audio routes: `/uploads/audio` is not served statically and the image scanner skips it.
 */

export const AUDIO_STORE_DIR = path.join(runtimePaths.uploadsDir, 'audio');
export const AUDIO_MAX_FILE_BYTES = 200 * 1024 * 1024;
export const AUDIO_EXTENSIONS = ['flac', 'wav', 'mp3', 'ogg', 'opus', 'm4a', 'aac', 'weba'] as const;
const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_EXTENSIONS);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const FFPROBE_TIMEOUT_MS = 30_000;

export const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  flac: 'audio/flac', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm',
};

export class AudioStoreError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface AudioFileRecord {
  hash: string;
  ext: string;
  size: number;
  duration: number | null;
  sample_rate: number | null;
  channels: number | null;
  codec: string | null;
  created_at: string;
}

export interface AudioProbe {
  duration: number | null;
  sampleRate: number | null;
  channels: number | null;
  codec: string | null;
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** True for anything inside the audio store, so library scanners and watchers can leave it alone. */
export function isAudioStorePath(candidate: string): boolean {
  return within(path.resolve(AUDIO_STORE_DIR), path.resolve(candidate));
}

export function isAudioHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_PATTERN.test(value);
}

export function normalizeAudioExtension(fileName: string): string {
  return path.extname(fileName).replace(/^\./, '').toLowerCase();
}

export function isAllowedAudioExtension(ext: string): boolean {
  return AUDIO_EXTENSION_SET.has(ext.toLowerCase());
}

/** Absolute path of a blob; the hash and extension are validated, never taken from user input as a path. */
export function audioBlobPath(hash: string, ext: string): string {
  if (!isAudioHash(hash)) throw new AudioStoreError('잘못된 오디오 해시야.');
  if (!isAllowedAudioExtension(ext)) throw new AudioStoreError('지원하지 않는 오디오 형식이야.');
  return path.join(AUDIO_STORE_DIR, hash.slice(0, 2), hash.slice(2, 4), `${hash}.${ext.toLowerCase()}`);
}

/** Parse `<hash>.<ext>` from a store file name, or null when it is not a store blob name. */
export function parseAudioBlobName(fileName: string): { hash: string; ext: string } | null {
  const match = /^([a-f0-9]{64})\.([a-z0-9]+)$/.exec(fileName);
  if (!match || !isAllowedAudioExtension(match[2])) return null;
  return { hash: match[1], ext: match[2] };
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

function ffprobePath(): string {
  return ffprobeStatic?.path && fs.existsSync(ffprobeStatic.path) ? ffprobeStatic.path : 'ffprobe';
}

/** ffprobe the first audio stream; throws AudioStoreError when the file has none or cannot be read. */
export async function probeAudioFile(filePath: string): Promise<AudioProbe> {
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(ffprobePath(), [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration',
      '-of', 'json',
      filePath,
    ], { timeout: FFPROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, out) => {
      if (error) reject(new AudioStoreError('오디오 파일을 읽을 수 없어.'));
      else resolve(out);
    });
  });
  let data: { streams?: Array<{ codec_name?: string; sample_rate?: string; channels?: number }>; format?: { duration?: string } };
  try { data = JSON.parse(stdout); } catch { throw new AudioStoreError('오디오 파일을 읽을 수 없어.'); }
  const stream = data.streams?.[0];
  if (!stream) throw new AudioStoreError('오디오 스트림이 없는 파일이야.');
  const number = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    duration: number(data.format?.duration),
    sampleRate: number(stream.sample_rate),
    channels: number(stream.channels),
    codec: stream.codec_name ?? null,
  };
}

export function getAudioFile(hash: string): AudioFileRecord | null {
  return (getAudioDb().prepare('SELECT * FROM audio_files WHERE hash = ?').get(hash) as AudioFileRecord | undefined) ?? null;
}

export interface IngestedAudio {
  file: AudioFileRecord;
  /** False when the same bytes were already stored. */
  created: boolean;
}

/**
 * Move a staged file into the store under its content hash and register it. The staged file is consumed: moved into
 * place, or removed when the same content is already stored. `originalName` only decides the extension.
 */
export async function ingestAudioFile(stagedPath: string, originalName: string): Promise<IngestedAudio> {
  try {
    const ext = normalizeAudioExtension(originalName);
    if (!isAllowedAudioExtension(ext)) throw new AudioStoreError(`지원하지 않는 오디오 형식이야: .${ext || '?'}`);
    const stat = await fs.promises.stat(stagedPath);
    if (!stat.isFile() || stat.size === 0) throw new AudioStoreError('빈 파일이야.');
    if (stat.size > AUDIO_MAX_FILE_BYTES) throw new AudioStoreError('오디오 파일은 200MB까지 올릴 수 있어.', 413);
    const probe = await probeAudioFile(stagedPath);
    const hash = await sha256File(stagedPath);

    const existing = getAudioFile(hash);
    if (existing && fs.existsSync(audioBlobPath(hash, existing.ext))) {
      return { file: existing, created: false };
    }

    const target = audioBlobPath(hash, ext);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) {
      // Same content already on disk without a row (e.g. restored from the RecycleBin): keep it, register it.
    } else {
      await relocateFile(stagedPath, target);
    }
    const now = new Date().toISOString();
    getAudioDb().prepare(`
      INSERT INTO audio_files (hash, ext, size, duration, sample_rate, channels, codec, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hash) DO UPDATE SET ext = excluded.ext, size = excluded.size, duration = excluded.duration,
        sample_rate = excluded.sample_rate, channels = excluded.channels, codec = excluded.codec
    `).run(hash, ext, stat.size, probe.duration, probe.sampleRate, probe.channels, probe.codec, existing?.created_at ?? now);
    return { file: getAudioFile(hash)!, created: !existing };
  } finally {
    await fs.promises.rm(stagedPath, { force: true }).catch(() => undefined);
  }
}

/** Copy a file (that must stay where it is) into the staging area, then ingest the copy. */
export async function ingestAudioCopy(sourcePath: string, originalName: string): Promise<IngestedAudio> {
  const staged = await stageAudioPath(normalizeAudioExtension(originalName));
  await fs.promises.copyFile(sourcePath, staged, fs.constants.COPYFILE_EXCL);
  return ingestAudioFile(staged, originalName);
}

/** Write bytes (a decoded data URL) to staging, then ingest them. */
export async function ingestAudioBuffer(data: Buffer, originalName: string): Promise<IngestedAudio> {
  if (data.length > AUDIO_MAX_FILE_BYTES) throw new AudioStoreError('오디오 파일은 200MB까지 올릴 수 있어.', 413);
  const staged = await stageAudioPath(normalizeAudioExtension(originalName));
  await fs.promises.writeFile(staged, data, { flag: 'wx' });
  return ingestAudioFile(staged, originalName);
}

async function stageAudioPath(ext: string): Promise<string> {
  const directory = path.join(runtimePaths.tempDir, 'audio-incoming');
  await fs.promises.mkdir(directory, { recursive: true });
  return path.join(directory, `${crypto.randomUUID()}.${/^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin'}`);
}
