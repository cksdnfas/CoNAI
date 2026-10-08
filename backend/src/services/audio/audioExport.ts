import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ZipArchive } from 'archiver';
import { runtimePaths } from '../../config/runtimePaths';
import { getAudioDb } from '../../database/audioDb';
import { audioBlobPath } from './audioStore';
import { audioExportFileName } from './audioNaming';
import {
  AudioServiceError,
  audioCandidateFile,
  getAudioGroup,
  getAudioProject,
} from './audioService';
import { audioRenderSlots, runAudioFfmpeg } from './audioFfmpeg';

/**
 * Export of selected takes, ported from the SFX manager (`sfx/audio.py` export, `sfx/service.py` export_plan /
 * export_selected): WAV or OGG, per-file EBU R128 loudness normalisation (two-pass linear loudnorm, or a plain gain
 * when loudnorm would fall back to its dynamic mode), optional resample / channel change, and group label file names.
 * Stored files are never rewritten; every export renders a new file.
 */

export type AudioExportFormat = 'wav' | 'ogg';
export const AUDIO_EXPORT_SAMPLE_RATES = [0, 22050, 44100, 48000] as const;

export interface AudioExportOptions {
  format: AudioExportFormat;
  quality: number;
  normalize: boolean;
  target_lufs: number;
  peak_db: number;
  loudness_range: number;
  sample_rate: number;
  channels: number;
}

export const DEFAULT_AUDIO_EXPORT_OPTIONS: AudioExportOptions = {
  format: 'ogg', quality: 3, normalize: true, target_lufs: -16, peak_db: -1.5, loudness_range: 7, sample_rate: 0, channels: 0,
};

const OPTION_KEYS = Object.keys(DEFAULT_AUDIO_EXPORT_OPTIONS) as Array<keyof AudioExportOptions>;
const SETTINGS_KEY = 'export_options';
/** Up to this many files a ZIP is built inside the request; more run as an 'audio-export' runtime job. */
export const AUDIO_EXPORT_INLINE_MAX_FILES = 20;

function invalid(key: string, rule: string): never {
  throw new AudioServiceError(`${key}: ${rule}`, 422);
}

function numberValue(key: string, raw: unknown, min: number, max: number, integer = false): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    invalid(key, `${min} ~ ${max}${integer ? ' 사이의 정수' : ' 사이'}여야 해.`);
  }
  return value;
}

function boolValue(key: string, raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  const text = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'off'].includes(text)) return false;
  return invalid(key, 'true 또는 false여야 해.');
}

/** Validate the options that are present (query string, JSON body or MCP args); absent ones are left out. */
export function parseAudioExportOverrides(input: unknown): Partial<AudioExportOptions> {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const result: Partial<AudioExportOptions> = {};
  const present = (key: keyof AudioExportOptions) => source[key] !== undefined && source[key] !== null && source[key] !== '';
  if (present('format')) {
    const format = String(source.format).toLowerCase();
    if (format !== 'wav' && format !== 'ogg') invalid('format', 'wav 또는 ogg야.');
    result.format = format;
  }
  if (present('quality')) result.quality = numberValue('quality', source.quality, 0, 10, true);
  if (present('normalize')) result.normalize = boolValue('normalize', source.normalize);
  if (present('target_lufs')) result.target_lufs = numberValue('target_lufs', source.target_lufs, -70, -5);
  if (present('peak_db')) result.peak_db = numberValue('peak_db', source.peak_db, -9, 0);
  if (present('loudness_range')) result.loudness_range = numberValue('loudness_range', source.loudness_range, 1, 50);
  if (present('sample_rate')) {
    const rate = numberValue('sample_rate', source.sample_rate, 0, 48000, true);
    if (!(AUDIO_EXPORT_SAMPLE_RATES as readonly number[]).includes(rate)) invalid('sample_rate', '원본(0), 22050, 44100, 48000 중 하나야.');
    result.sample_rate = rate;
  }
  if (present('channels')) result.channels = numberValue('channels', source.channels, 0, 2, true);
  return result;
}

export function getSavedAudioExportOptions(): AudioExportOptions {
  const row = getAudioDb().prepare('SELECT value FROM audio_settings WHERE key = ?').get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return { ...DEFAULT_AUDIO_EXPORT_OPTIONS };
  try {
    return { ...DEFAULT_AUDIO_EXPORT_OPTIONS, ...parseAudioExportOverrides(JSON.parse(row.value)) };
  } catch {
    return { ...DEFAULT_AUDIO_EXPORT_OPTIONS };
  }
}

/** Saved defaults for every export (web, API and MCP); the input is merged over the current defaults. */
export function saveAudioExportOptions(input: unknown): AudioExportOptions {
  const options = { ...getSavedAudioExportOptions(), ...parseAudioExportOverrides(input) };
  getAudioDb().prepare(`INSERT INTO audio_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(SETTINGS_KEY, JSON.stringify(options));
  return options;
}

/** The options an export runs with: the saved defaults overridden by what the request set. */
export function resolveAudioExportOptions(input: unknown): AudioExportOptions {
  return { ...getSavedAudioExportOptions(), ...parseAudioExportOverrides(input) };
}

export function audioExportOptionsQuery(options: AudioExportOptions): string {
  return OPTION_KEYS.map((key) => `${key}=${encodeURIComponent(String(options[key]))}`).join('&');
}

/* ------------------------------------------------------------------------------------------- one file */

export type AudioExportBranch = 'no_normalize' | 'unmeasurable_no_gain' | 'linear_gain_fallback' | 'two_pass_linear_loudnorm';

export interface AudioExportRenderPlan {
  branch: AudioExportBranch;
  /** Final `-af` chain. */
  chain: string;
  rate: number;
  measured: Record<string, string> | null;
}

const MEASURED_FIELDS: Array<[string, string]> = [
  ['measured_I', 'input_i'], ['measured_LRA', 'input_lra'], ['measured_TP', 'input_tp'], ['measured_thresh', 'input_thresh'], ['offset', 'target_offset'],
];

/** The JSON loudnorm prints last on stderr (`print_format=json`). */
export function parseLoudnormReport(stderr: string): Record<string, string> {
  const start = stderr.lastIndexOf('{');
  const end = start >= 0 ? stderr.indexOf('}', start) : -1;
  if (start < 0 || end < 0) throw new AudioServiceError('음량 측정 결과를 읽을 수 없어.', 422);
  try {
    return JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
  } catch {
    throw new AudioServiceError('음량 측정 결과를 읽을 수 없어.', 422);
  }
}

/** The original's branch for a loudnorm measurement; pure, so it can be tested against the recorded measurements. */
export function decideAudioExportChain(options: AudioExportOptions, base: string[], measured: Record<string, string>, duration: number): { branch: AudioExportBranch; chain: string[] } {
  const padded = [...base, 'apad=whole_dur=0.4'];
  const loudnorm = `loudnorm=I=${options.target_lufs}:LRA=${options.loudness_range}:TP=${options.peak_db}`;
  const inputI = Number(measured.input_i);
  const inputTp = Number(measured.input_tp);
  // Silence or below-gate material has no usable loudness or peak measurement.
  if (!Number.isFinite(inputI) || !Number.isFinite(inputTp)) return { branch: 'unmeasurable_no_gain', chain: base };
  const gain = options.target_lufs - inputI;
  const headroom = options.peak_db - inputTp;
  if (gain > headroom || Number(measured.input_lra) > options.loudness_range || !MEASURED_FIELDS.every(([, key]) => Number.isFinite(Number(measured[key])))) {
    // Loudnorm's dynamic fallback can make peak-limited SFX much quieter.
    return { branch: 'linear_gain_fallback', chain: [...base, `volume=${Math.min(gain, headroom)}dB`] };
  }
  const values = MEASURED_FIELDS.map(([name, key]) => `${name}=${measured[key]}`).join(':');
  return { branch: 'two_pass_linear_loudnorm', chain: [...padded, `${loudnorm}:linear=true:${values}`, `atrim=duration=${duration}`] };
}

function baseChain(options: AudioExportOptions, rate: number): string[] {
  const chain = [`aresample=${rate}`];
  if (options.channels) {
    // Pin the downmix sample format so the loudnorm measurement and the gain-only render hear the same mix.
    chain.push(`aformat=sample_fmts=dbl:channel_layouts=${options.channels === 1 ? 'mono' : 'stereo'}`);
  }
  return chain;
}

/** Measure (when normalising) and decide the final chain for one file. */
export async function planAudioFileExport(source: string, options: AudioExportOptions, meta: { duration: number; sampleRate: number }, signal?: AbortSignal): Promise<AudioExportRenderPlan> {
  const rate = options.sample_rate || meta.sampleRate;
  const base = baseChain(options, rate);
  if (!options.normalize) return { branch: 'no_normalize', chain: base.join(','), rate, measured: null };
  const loudnorm = `loudnorm=I=${options.target_lufs}:LRA=${options.loudness_range}:TP=${options.peak_db}`;
  // EBU measurement needs a 400 ms block, even for a shorter one-shot.
  const measure = [...base, 'apad=whole_dur=0.4', `${loudnorm}:print_format=json`].join(',');
  const { stderr } = await runAudioFfmpeg(['-nostdin', '-v', 'info', '-i', source, '-map', '0:a:0', '-vn', '-af', measure, '-f', 'null', '-'], { signal });
  const measured = parseLoudnormReport(stderr);
  const decided = decideAudioExportChain(options, base, measured, meta.duration);
  return { branch: decided.branch, chain: decided.chain.join(','), rate, measured };
}

/**
 * Render one export. OGG gets `+bitexact` (an improvement over the original): without it the ogg muxer picks a random
 * stream serial, so the same export never had the same bytes twice.
 */
export async function renderAudioFileExport(source: string, destination: string, options: AudioExportOptions, meta: { duration: number; sampleRate: number }, signal?: AbortSignal): Promise<AudioExportRenderPlan> {
  return audioRenderSlots.run(async () => {
    const plan = await planAudioFileExport(source, options, meta, signal);
    const codec = options.format === 'ogg'
      ? ['-c:a', 'libvorbis', '-q:a', String(options.quality), '-fflags', '+bitexact', '-flags:a', '+bitexact']
      : ['-c:a', 'pcm_s24le'];
    await runAudioFfmpeg(['-nostdin', '-v', 'error', '-y', '-i', source, '-map', '0:a:0', '-vn', '-map_metadata', '-1', '-af', plan.chain,
      '-ar', String(plan.rate), ...codec, destination], { signal });
    return plan;
  });
}

function safeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[/\\]/g, '-').replace(/[<>:"|?*\u0000-\u001f]/g, '_');
}

/** Export one candidate into `directory`. A stored WAV exported as plain WAV is copied as is (fast path). */
export async function exportAudioCandidateFile(candidateId: string, options: AudioExportOptions, directory: string, fileName: string, signal?: AbortSignal): Promise<{ path: string; branch: AudioExportBranch | 'stored' }> {
  const { candidate, file } = audioCandidateFile(candidateId);
  if (candidate.deleted_at) throw new AudioServiceError('삭제된 후보야.', 404);
  const source = audioBlobPath(file.hash, file.ext);
  if (!fs.existsSync(source)) throw new AudioServiceError('오디오 파일을 찾을 수 없어.', 404);
  const target = path.join(directory, fileName);
  if (file.ext === 'wav' && options.format === 'wav' && !options.normalize && !options.sample_rate && !options.channels) {
    await fs.promises.copyFile(source, target);
    return { path: target, branch: 'stored' };
  }
  if (file.sample_rate === null || file.duration === null) throw new AudioServiceError('오디오 정보를 알 수 없는 파일이야.', 422);
  try {
    const plan = await renderAudioFileExport(source, target, options, { duration: file.duration, sampleRate: file.sample_rate }, signal);
    return { path: target, branch: plan.branch };
  } catch (error) {
    await fs.promises.rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
}

/* ------------------------------------------------------------------------------------------- plan */

export interface AudioExportPlanFile {
  id: string;
  group_id: string;
  group_name: string;
  label: string | null;
  filename: string;
}

export interface AudioExportPlan {
  project_name: string;
  count: number;
  files: AudioExportPlanFile[];
  download_url: string;
  options: AudioExportOptions;
}

/** Python's str.casefold() for the collision check (ß folds to ss; the rest of Latin/Korean is plain lowercase). */
const casefold = (value: string) => value.toLowerCase().replace(/ß/g, 'ss');

/**
 * The selected, non-deleted takes of a project (or one of its groups) with their export names. Order: group creation,
 * then candidate creation (insertion order breaks same-millisecond ties). Two files with the same name (ignoring case) are a conflict, never an overwrite. Takes in
 * the inbox group (no label) keep their candidate name.
 */
export function audioExportPlan(projectId: string, groupId: string | null, options: AudioExportOptions): AudioExportPlan {
  const project = getAudioProject(projectId);
  if (groupId && getAudioGroup(groupId).project_id !== project.id) throw new AudioServiceError('이 프로젝트의 그룹이 아니야.', 404);
  const selected = getAudioDb().prepare(`
    SELECT c.id, c.group_id, c.name, g.name AS group_name, g.label
    FROM audio_candidates c JOIN audio_groups g ON g.id = c.group_id
    WHERE g.project_id = ? AND c.deleted_at IS NULL AND c.review = 'selected' AND (? IS NULL OR g.id = ?)
    ORDER BY g.created_at, g.rowid, c.created_at, c.rowid
  `).all(project.id, groupId, groupId) as Array<{ id: string; group_id: string; name: string; group_name: string; label: string | null }>;
  if (selected.length === 0) throw new AudioServiceError('채택된 파일이 없어.', 409);
  const counts = new Map<string, number>();
  for (const item of selected) counts.set(item.group_id, (counts.get(item.group_id) ?? 0) + 1);
  const indices = new Map<string, number>();
  const names = new Map<string, string>();
  const files: AudioExportPlanFile[] = [];
  for (const item of selected) {
    const index = (indices.get(item.group_id) ?? 0) + 1;
    indices.set(item.group_id, index);
    const filename = item.label
      ? audioExportFileName(item.label, index, counts.get(item.group_id)!, options.format)
      : `${safeFileName(item.name)}.${options.format}`;
    const key = casefold(filename);
    const taken = names.get(key);
    if (taken !== undefined) {
      throw new AudioServiceError(`파일명 충돌: ${filename} — ${taken} / ${item.group_name}. 그룹 라벨을 수정해 주세요.`, 409);
    }
    names.set(key, item.group_name);
    files.push({ id: item.id, group_id: item.group_id, group_name: item.group_name, label: item.label, filename });
  }
  const base = groupId ? `/api/audio/groups/${groupId}/export` : `/api/audio/projects/${project.id}/export`;
  return { project_name: project.name, count: files.length, files, download_url: `${base}?${audioExportOptionsQuery(options)}`, options };
}

/** A single candidate's download name: a selected take follows its group's label rule, anything else its own name. */
export function audioCandidateExportName(candidateId: string, options: AudioExportOptions): string {
  const { candidate } = audioCandidateFile(candidateId);
  if (candidate.review === 'selected' && !candidate.deleted_at) {
    try {
      const plan = audioExportPlan(candidate.project_id, candidate.group_id, options);
      const match = plan.files.find((entry) => entry.id === candidate.id);
      if (match) return match.filename;
    } catch (error) {
      if (!(error instanceof AudioServiceError) || error.status !== 409) throw error;
    }
  }
  return `${safeFileName(candidate.name)}.${options.format}`;
}

/* ------------------------------------------------------------------------------------------- workspaces */

const EXPORT_TTL_MS = 60 * 60 * 1000;
const OWNER_FILE = 'owner.json';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AudioExportOwner {
  accountId: number | null;
  accountType: string | null;
}

export interface AudioExportWorkspace {
  id: string;
  dir: string;
  owner: AudioExportOwner & { createdAt: string; fileName: string | null };
}

export function audioExportRoot(): string {
  return path.join(runtimePaths.tempDir, 'audio-exports');
}

/** Owner or admin; unbound MCP keys (no account) own their own null-owner exports. */
export function canAccessAudioExport(owner: { accountId: number | null }, requester: AudioExportOwner): boolean {
  return requester.accountType === 'admin' || owner.accountId === requester.accountId;
}

function pruneAudioExports(now = Date.now()): void {
  const root = audioExportRoot();
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    let used = 0;
    try { used = fs.statSync(path.join(dir, OWNER_FILE)).mtimeMs; } catch { /* no owner file: stale */ }
    if (now - used > EXPORT_TTL_MS) fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function createAudioExportWorkspace(owner: AudioExportOwner): AudioExportWorkspace {
  pruneAudioExports();
  const id = crypto.randomUUID();
  const dir = path.join(audioExportRoot(), id);
  fs.mkdirSync(dir, { recursive: true });
  const record = { accountId: owner.accountId, accountType: owner.accountType, createdAt: new Date().toISOString(), fileName: null as string | null };
  fs.writeFileSync(path.join(dir, OWNER_FILE), JSON.stringify(record));
  return { id, dir, owner: record };
}

function setWorkspaceFile(workspace: AudioExportWorkspace, fileName: string): void {
  workspace.owner.fileName = fileName;
  fs.writeFileSync(path.join(workspace.dir, OWNER_FILE), JSON.stringify(workspace.owner));
}

export function getAudioExportWorkspace(id: string): AudioExportWorkspace | null {
  if (!ID_PATTERN.test(id)) return null;
  const dir = path.join(audioExportRoot(), id);
  const ownerPath = path.join(dir, OWNER_FILE);
  if (!fs.existsSync(ownerPath)) return null;
  try {
    if (Date.now() - fs.statSync(ownerPath).mtimeMs > EXPORT_TTL_MS) {
      fs.rmSync(dir, { recursive: true, force: true });
      return null;
    }
    return { id, dir, owner: JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as AudioExportWorkspace['owner'] };
  } catch {
    return null;
  }
}

/** The finished file of an export workspace, or null while it is still being built / after it expired. */
export function audioExportResultFile(workspace: AudioExportWorkspace): { path: string; fileName: string } | null {
  const fileName = workspace.owner.fileName;
  if (!fileName) return null;
  const filePath = path.join(workspace.dir, fileName);
  if (path.dirname(filePath) !== workspace.dir || !fs.existsSync(filePath)) return null;
  return { path: filePath, fileName };
}

export function removeAudioExportWorkspace(id: string): void {
  if (ID_PATTERN.test(id)) fs.rmSync(path.join(audioExportRoot(), id), { recursive: true, force: true });
}

/* ------------------------------------------------------------------------------------------- build */

export interface AudioExportResult {
  export_id: string;
  file_name: string;
  mime_type: string;
  count: number;
  size_bytes: number;
  download_path: string;
  plan: AudioExportPlan;
}

export function audioExportMimeType(fileName: string): string {
  if (fileName.endsWith('.zip')) return 'application/zip';
  if (fileName.endsWith('.ogg')) return 'audio/ogg';
  return 'audio/wav';
}

function archiveName(plan: AudioExportPlan, groupId: string | null): string {
  const base = groupId ? (plan.files[0]?.group_name ?? plan.project_name) : plan.project_name;
  return `${safeFileName(base)}-selected.zip`;
}

/**
 * Build an export of a project or group into a new workspace: one file stays a single WAV/OGG, several become a
 * stored (uncompressed) ZIP with the files at its root. Any file failing fails the export.
 */
export async function buildAudioExport(
  projectId: string,
  groupId: string | null,
  options: AudioExportOptions,
  owner: AudioExportOwner,
  hooks: { signal?: AbortSignal; progress?: (processed: number, total: number) => void } = {},
): Promise<AudioExportResult> {
  const plan = audioExportPlan(projectId, groupId, options);
  const workspace = createAudioExportWorkspace(owner);
  try {
    let fileName: string;
    if (plan.count === 1) {
      fileName = plan.files[0].filename;
      await exportAudioCandidateFile(plan.files[0].id, options, workspace.dir, fileName, hooks.signal);
      hooks.progress?.(1, 1);
    } else {
      const parts = path.join(workspace.dir, 'parts');
      fs.mkdirSync(parts, { recursive: true });
      const rendered: Array<{ path: string; name: string }> = [];
      for (const [index, item] of plan.files.entries()) {
        const partName = `${String(index).padStart(4, '0')}.${options.format}`;
        rendered.push({ path: (await exportAudioCandidateFile(item.id, options, parts, partName, hooks.signal)).path, name: item.filename });
        hooks.progress?.(index + 1, plan.count);
      }
      fileName = archiveName(plan, groupId);
      await new Promise<void>((resolve, reject) => {
        const stream = fs.createWriteStream(path.join(workspace.dir, fileName));
        const archive = new ZipArchive({ store: true });
        archive.once('error', reject);
        stream.once('error', reject);
        stream.once('close', () => resolve());
        archive.pipe(stream);
        // append() keeps plan order; file() stats in parallel and can reorder entries.
        for (const part of rendered) archive.append(fs.createReadStream(part.path), { name: part.name });
        void archive.finalize();
      });
      fs.rmSync(parts, { recursive: true, force: true });
    }
    setWorkspaceFile(workspace, fileName);
    return {
      export_id: workspace.id,
      file_name: fileName,
      mime_type: audioExportMimeType(fileName),
      count: plan.count,
      size_bytes: fs.statSync(path.join(workspace.dir, fileName)).size,
      download_path: `/api/audio/exports/${workspace.id}/download`,
      plan,
    };
  } catch (error) {
    removeAudioExportWorkspace(workspace.id);
    throw error;
  }
}
