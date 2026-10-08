import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../../config/runtimePaths';
import { audioBlobPath, ingestAudioFile } from './audioStore';
import {
  AudioServiceError,
  audioCandidateFile,
  findEditedAudioCandidate,
  registerEditedAudioCandidate,
  type AudioCandidate,
} from './audioService';
import { audioRenderSlots, runAudioFfmpeg } from './audioFfmpeg';

/**
 * Non-destructive edits, ported from the SFX manager (`sfx/audio.py` `filters` / `render`, `sfx/models.py` EditInput):
 * trim, gain, duration-preserving pitch (Rubber Band), speed, fades and a final limiter. Saving renders a new 24-bit
 * WAV into the audio store as a child candidate of the source; the source file is never touched.
 */

export interface AudioEditParams {
  start: number;
  end: number;
  gain_db: number;
  pitch_semitones: number;
  speed: number;
  fade_in: number;
  fade_out: number;
}

const OUT_OF_RANGE = '잘라낼 구간이 오디오 길이를 벗어났습니다.';
const FADES_TOO_LONG = '페이드 길이의 합이 속도 적용 후 길이보다 깁니다.';

function numberField(input: Record<string, unknown>, key: keyof AudioEditParams, fallback: number | undefined, check: (value: number) => boolean, rule: string): number {
  const raw = input[key];
  if (raw === undefined || raw === null || raw === '') {
    if (fallback === undefined) throw new AudioServiceError(`${key}: 값이 필요해.`, 422);
    return fallback;
  }
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || !check(value)) throw new AudioServiceError(`${key}: ${rule}`, 422);
  return value;
}

/** EditInput validation: the same defaults and bounds as the original pydantic model. */
export function parseAudioEditParams(body: unknown): AudioEditParams {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  return {
    start: numberField(input, 'start', 0, (v) => v >= 0, '0 이상이어야 해.'),
    end: numberField(input, 'end', undefined, (v) => v > 0, '0보다 커야 해.'),
    gain_db: numberField(input, 'gain_db', 0, (v) => v >= -60 && v <= 24, '-60 ~ 24 사이여야 해.'),
    pitch_semitones: numberField(input, 'pitch_semitones', 0, (v) => v >= -24 && v <= 24, '-24 ~ 24 사이여야 해.'),
    speed: numberField(input, 'speed', 1, (v) => v >= 0.25 && v <= 4, '0.25 ~ 4 사이여야 해.'),
    fade_in: numberField(input, 'fade_in', 0.005, (v) => v >= 0 && v <= 5, '0 ~ 5 사이여야 해.'),
    fade_out: numberField(input, 'fade_out', 0.01, (v) => v >= 0 && v <= 5, '0 ~ 5 사이여야 해.'),
  };
}

/** Length of the rendered result in seconds (trim, then speed). */
export function audioEditResultLength(edit: AudioEditParams, duration: number): number {
  return (Math.min(edit.end, duration) - edit.start) / edit.speed;
}

/**
 * The `-af` chain. Trim uses source time, fades post-speed time. When speed or pitch change, Rubber Band's buffered
 * tail is flushed with a second of padding and trimmed back to the expected length.
 */
export function buildAudioEditFilterChain(edit: AudioEditParams, duration: number): string {
  if (edit.start >= edit.end || edit.start >= duration || edit.end > duration + 0.025) {
    throw new AudioServiceError(OUT_OF_RANGE, 422);
  }
  const length = audioEditResultLength(edit, duration);
  if (edit.fade_in + edit.fade_out > length) {
    throw new AudioServiceError(FADES_TOO_LONG, 422);
  }
  const chain = [`atrim=start=${edit.start}:end=${edit.end}`, 'asetpts=PTS-STARTPTS'];
  if (edit.speed !== 1 || edit.pitch_semitones !== 0) {
    chain.push('apad=pad_dur=1', `rubberband=tempo=${edit.speed}:pitch=${2 ** (edit.pitch_semitones / 12)}`, `atrim=duration=${length}`);
  }
  chain.push(
    `volume=${edit.gain_db}dB`,
    `afade=t=in:d=${edit.fade_in}`,
    `afade=t=out:st=${length - edit.fade_out}:d=${edit.fade_out}`,
    'alimiter=limit=0.99:level=false:latency=true',
  );
  return chain.join(',');
}

/** Render an edit of `source` into a new 24-bit WAV at `destination`. */
export async function renderAudioEdit(source: string, destination: string, edit: AudioEditParams, duration: number, signal?: AbortSignal): Promise<void> {
  const chain = buildAudioEditFilterChain(edit, duration);
  await audioRenderSlots.run(() => runAudioFfmpeg(['-nostdin', '-v', 'error', '-y', '-i', source, '-vn', '-af', chain, '-c:a', 'pcm_s24le', destination], { signal }));
}

function scratchDir(name: string): string {
  const dir = path.join(runtimePaths.tempDir, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sourceOf(candidateId: string): { candidate: AudioCandidate; sourcePath: string; duration: number } {
  const { candidate, file } = audioCandidateFile(candidateId);
  if (candidate.deleted_at) throw new AudioServiceError('지운 후보는 편집할 수 없어.', 409);
  const sourcePath = audioBlobPath(file.hash, file.ext);
  if (!fs.existsSync(sourcePath)) throw new AudioServiceError('오디오 파일을 찾을 수 없어.', 404);
  if (file.duration === null || !Number.isFinite(file.duration) || file.duration <= 0) {
    throw new AudioServiceError('오디오 길이를 알 수 없는 파일이야.', 422);
  }
  return { candidate, sourcePath, duration: file.duration };
}

/** Render a preview into a temp WAV. The caller streams it and must remove it (`path`). */
export async function renderAudioEditPreview(candidateId: string, body: unknown): Promise<{ path: string; edit: AudioEditParams }> {
  const edit = parseAudioEditParams(body);
  const { sourcePath, duration } = sourceOf(candidateId);
  buildAudioEditFilterChain(edit, duration);
  const target = path.join(scratchDir('audio-preview'), `${crypto.randomUUID()}.wav`);
  try {
    await renderAudioEdit(sourcePath, target, edit, duration);
    return { path: target, edit };
  } catch (error) {
    await fs.promises.rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
}

function sameEdit(stored: unknown, edit: AudioEditParams): boolean {
  if (!stored || typeof stored !== 'object') return false;
  const record = stored as Record<string, unknown>;
  return (Object.keys(edit) as Array<keyof AudioEditParams>).every((key) => record[key] === edit[key]);
}

/**
 * Save an edit as a new candidate (origin 'edited', child of the source, review pending). With a `requestKey` the
 * same request returns the candidate it already made; the same key with other parameters is a conflict.
 */
export async function saveAudioEdit(
  candidateId: string,
  body: unknown,
  options: { accountId: number | null; requestKey?: unknown },
): Promise<AudioCandidate> {
  const edit = parseAudioEditParams(body);
  const requestKey = options.requestKey === undefined || options.requestKey === null || options.requestKey === '' ? null : String(options.requestKey);
  if (requestKey !== null && (requestKey.length < 8 || requestKey.length > 128)) {
    throw new AudioServiceError('request_key는 8~128자여야 해.', 422);
  }
  const { candidate, sourcePath, duration } = sourceOf(candidateId);
  const sourceKey = requestKey === null ? null : `edit:${options.accountId ?? 'none'}:${candidate.id}:${requestKey}`;
  if (sourceKey) {
    const existing = findEditedAudioCandidate(sourceKey);
    if (existing) {
      if (!sameEdit(existing.edit, edit)) throw new AudioServiceError('같은 request_key로 다른 편집을 저장할 수 없어.', 409);
      return existing;
    }
  }
  buildAudioEditFilterChain(edit, duration);
  const staged = path.join(scratchDir('audio-incoming'), `${crypto.randomUUID()}.wav`);
  try {
    await renderAudioEdit(sourcePath, staged, edit, duration);
    const { file } = await ingestAudioFile(staged, `${candidate.id}.wav`);
    return registerEditedAudioCandidate({ sourceId: candidate.id, file, edit, accountId: options.accountId, sourceKey });
  } finally {
    await fs.promises.rm(staged, { force: true }).catch(() => undefined);
  }
}
