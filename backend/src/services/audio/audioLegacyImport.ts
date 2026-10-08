import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import { runtimePaths } from '../../config/runtimePaths';
import { getAudioDb } from '../../database/audioDb';
import { WorkflowModel } from '../../models/Workflow';
import type { MarkedField } from '../../types/workflow';
import { ingestAudioCopy, isAllowedAudioExtension, normalizeAudioExtension } from './audioStore';
import { AudioServiceError, createAudioGroup, createAudioProject } from './audioService';
import { listAudioWorkflows, saveAudioWorkflowBinding, getDefaultAudioWorkflowBinding, type AudioWorkflowSummary } from './audioWorkflows';

/**
 * Import from the old standalone SFX manager (stable-audio-sfx-manager): its data dir is `sfx.sqlite3` + `audio/`.
 *
 * The source is only read: the database file (and its WAL) is copied into a work directory before it is opened, and
 * audio files are copied into the content-hash store. Running the import again adds only what is new:
 * - projects / groups / comments: remembered by old id in `audio_legacy_import_map`; an unmapped project is matched by
 *   name, an unmapped group by its label inside the project (merged, not duplicated);
 * - candidates: `source_key = 'legacy:<old id>'`.
 * Tombstoned candidates whose file is still there come in soft-deleted (restorable); their files are usually gone
 * (the old app unlinked them), and those are only counted. Workflows are kept in `audio_legacy_workflows` until an
 * admin registers one; servers, queues, tokens and auth settings are not imported; `export_options` is copied when
 * this app has none yet.
 */

export const LEGACY_IMPORT_ZIP_MAX_BYTES = 1024 * 1024 * 1024;
const WORK_ROOT = () => path.join(runtimePaths.tempDir, 'audio-legacy-import');
export const LEGACY_UPLOAD_DIR = () => path.join(WORK_ROOT(), 'uploads');
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_WARNINGS = 40;

export type LegacyImportSource = { path: string } | { uploadId: string };

export interface LegacyImportParams {
  source: LegacyImportSource;
  dryRun: boolean;
  accountId: number | null;
}

export interface LegacyWorkflowInfo {
  legacy_id: string;
  name: string;
  version: number;
  deleted: boolean;
  node_count: number;
  mapping: Record<string, unknown>;
  registered_workflow_id: number | null;
}

export interface LegacyImportResult {
  dry_run: boolean;
  source: { kind: 'path' | 'upload'; label: string };
  projects: { total: number; created: number; existing: number };
  groups: { total: number; created: number; existing: number; failed: number };
  candidates: { total: number; imported: number; already_imported: number; soft_deleted: number; missing_file: number; deleted_without_file: number; failed: number };
  files: { new: number; reused: number; bytes: number };
  comments: { total: number; imported: number; already_imported: number };
  workflows: LegacyWorkflowInfo[];
  export_options: 'imported' | 'kept' | 'none';
  warnings: string[];
}

export interface LegacyImportHooks {
  progress?: (processed: number, total: number) => void;
  phase?: (phase: string) => void;
  throwIfCancelled?: () => void;
  yield?: () => Promise<void>;
}

export class LegacyImportError extends AudioServiceError {}

const db = () => getAudioDb();
const now = () => new Date().toISOString();
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/* ------------------------------------------------------------------------------------------------ source */

/** The directory that holds `sfx.sqlite3` (the root or up to two levels down, e.g. a zip of the `data` folder). */
function findDataRoot(root: string): string | null {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (fs.existsSync(path.join(dir, 'sfx.sqlite3'))) return dir;
    if (depth >= 2) continue;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return null;
}

/** Validate an admin-typed server path: absolute, an existing directory with the old app's database inside. */
export function resolveLegacyPath(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new LegacyImportError('가져올 폴더 경로를 입력해줘.');
  const value = input.trim();
  if (!path.isAbsolute(value)) throw new LegacyImportError('절대 경로로 입력해줘.');
  const resolved = path.resolve(value);
  let stat: fs.Stats;
  try { stat = fs.statSync(resolved); } catch { throw new LegacyImportError('그 경로가 없어.', 404); }
  if (!stat.isDirectory()) throw new LegacyImportError('폴더 경로를 입력해줘.');
  const root = findDataRoot(resolved);
  if (!root) throw new LegacyImportError('sfx.sqlite3가 있는 폴더가 아니야.');
  return root;
}

export function resolveLegacyUpload(uploadId: unknown): { id: string; zipPath: string; extractDir: string } {
  if (typeof uploadId !== 'string' || !UPLOAD_ID.test(uploadId)) throw new LegacyImportError('업로드 ID가 잘못됐어.');
  const zipPath = path.join(LEGACY_UPLOAD_DIR(), `${uploadId}.zip`);
  const extractDir = path.join(LEGACY_UPLOAD_DIR(), uploadId);
  if (!fs.existsSync(zipPath) && !fs.existsSync(extractDir)) throw new LegacyImportError('업로드한 파일이 없어. 다시 올려줘.', 404);
  return { id: uploadId, zipPath, extractDir };
}

/** Register a staged zip under a fresh id; staged uploads older than a day are removed. */
export function stageLegacyUpload(stagedPath: string): { upload_id: string; size: number } {
  pruneLegacyUploads();
  const id = crypto.randomUUID();
  const target = path.join(LEGACY_UPLOAD_DIR(), `${id}.zip`);
  fs.mkdirSync(LEGACY_UPLOAD_DIR(), { recursive: true });
  fs.renameSync(stagedPath, target);
  return { upload_id: id, size: fs.statSync(target).size };
}

export function pruneLegacyUploads(nowMs = Date.now()): void {
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(LEGACY_UPLOAD_DIR(), { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(LEGACY_UPLOAD_DIR(), entry.name);
    try {
      if (nowMs - fs.statSync(full).mtimeMs > UPLOAD_TTL_MS) fs.rmSync(full, { recursive: true, force: true });
    } catch { /* gone already */ }
  }
}

export function removeLegacyUpload(uploadId: string): void {
  if (!UPLOAD_ID.test(uploadId)) return;
  fs.rmSync(path.join(LEGACY_UPLOAD_DIR(), `${uploadId}.zip`), { force: true });
  fs.rmSync(path.join(LEGACY_UPLOAD_DIR(), uploadId), { recursive: true, force: true });
}

/** True when `name` (a zip entry) would land outside `root`: absolute paths, drive letters and `..` segments. */
export function isUnsafeZipEntry(root: string, name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').some((part) => part === '..')) return true;
  const target = path.resolve(root, normalized);
  const relative = path.relative(path.resolve(root), target);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

/** Unpack a zip into `dir`, refusing the whole archive when any entry points outside it (zip-slip). */
export async function extractLegacyZip(zipPath: string, dir: string, hooks: LegacyImportHooks = {}): Promise<void> {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const unsafe = entries.find((entry) => isUnsafeZipEntry(dir, entry.entryName));
  if (unsafe) throw new LegacyImportError(`압축 파일에 폴더 밖을 가리키는 경로가 있어: ${unsafe.entryName}`);
  fs.mkdirSync(dir, { recursive: true });
  let count = 0;
  for (const entry of entries) {
    hooks.throwIfCancelled?.();
    const target = path.resolve(dir, entry.entryName.replace(/\\/g, '/'));
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData(), { flag: 'wx' });
    }
    if (++count % 50 === 0) await (hooks.yield ?? yieldToEventLoop)();
  }
}

/* ------------------------------------------------------------------------------------------------ legacy reading */

interface LegacyData {
  projects: Array<{ id: string; name: string; description: string }>;
  groups: Array<{ id: string; project_id: string; name: string; label: string; description: string }>;
  candidates: LegacyCandidate[];
  comments: Array<{ id: string; group_id: string; text: string; status: string; revision: number; completed_at: string | null; completion_note: string; created: string; updated: string }>;
  workflows: Array<{ id: string; name: string; version: number; prompt: string; mapping: string; deleted: number }>;
  exportOptions: string | null;
}

interface LegacyCandidate {
  id: string;
  group_id: string;
  parent_id: string | null;
  name: string;
  file: string;
  review: string;
  notes: string;
  edit: string | null;
  created: string;
  deleted: number;
  job_id: string | null;
  job_text: string | null;
  job_seconds: number | null;
  job_seed: number | null;
  job_order_id: string | null;
  job_prompt: string | null;
  workflow_name: string | null;
  workflow_version: number | null;
  server_name: string | null;
}

function columns(legacy: Database.Database, table: string): Set<string> {
  return new Set((legacy.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
}

function hasTable(legacy: Database.Database, table: string): boolean {
  return Boolean(legacy.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
}

/** Read everything the import uses, tolerating the older schema versions of the app (no label / deleted / status). */
function readLegacy(dataRoot: string, workDir: string): LegacyData {
  fs.mkdirSync(workDir, { recursive: true });
  // Copy the database (and a pending WAL) first: opening the original could create -shm/-wal files next to it.
  const copy = path.join(workDir, 'sfx.sqlite3');
  fs.copyFileSync(path.join(dataRoot, 'sfx.sqlite3'), copy);
  for (const suffix of ['-wal']) {
    const side = path.join(dataRoot, `sfx.sqlite3${suffix}`);
    if (fs.existsSync(side)) fs.copyFileSync(side, `${copy}${suffix}`);
  }
  const legacy = new Database(copy, { fileMustExist: true });
  try {
    for (const table of ['projects', 'groups', 'candidates']) {
      if (!hasTable(legacy, table)) throw new LegacyImportError(`이전 오디오 앱 DB가 아니야 (${table} 테이블 없음).`);
    }
    const groupColumns = columns(legacy, 'groups');
    const candidateColumns = columns(legacy, 'candidates');
    const hasJobs = hasTable(legacy, 'jobs');
    const hasWorkflows = hasTable(legacy, 'workflows');
    const hasServers = hasTable(legacy, 'servers');
    const projects = legacy.prepare(`SELECT id, name, description FROM projects ORDER BY created, id`).all() as LegacyData['projects'];
    const groups = legacy.prepare(`
      SELECT id, project_id, name, ${groupColumns.has('label') ? 'label' : 'name AS label'}, description FROM groups ORDER BY created, id
    `).all() as LegacyData['groups'];
    const candidates = legacy.prepare(`
      SELECT c.id, c.group_id, c.parent_id, c.name, c.file, c.review, c.notes, c.edit, c.created,
        ${candidateColumns.has('deleted') ? 'c.deleted' : '0 AS deleted'},
        ${hasJobs ? 'j.id AS job_id, j.text AS job_text, j.seconds AS job_seconds, j.seed AS job_seed, j.order_id AS job_order_id, j.prompt AS job_prompt' : 'NULL AS job_id, NULL AS job_text, NULL AS job_seconds, NULL AS job_seed, NULL AS job_order_id, NULL AS job_prompt'},
        ${hasJobs && hasWorkflows ? 'w.name AS workflow_name, w.version AS workflow_version' : 'NULL AS workflow_name, NULL AS workflow_version'},
        ${hasJobs && hasServers ? 's.name AS server_name' : 'NULL AS server_name'}
      FROM candidates c
      ${hasJobs ? 'LEFT JOIN jobs j ON j.id = c.job_id' : ''}
      ${hasJobs && hasWorkflows ? 'LEFT JOIN workflows w ON w.id = j.workflow_id' : ''}
      ${hasJobs && hasServers ? 'LEFT JOIN servers s ON s.id = j.server_id' : ''}
      ORDER BY c.created, c.rowid
    `).all() as LegacyCandidate[];
    let comments: LegacyData['comments'] = [];
    if (hasTable(legacy, 'group_comments')) {
      const commentColumns = columns(legacy, 'group_comments');
      const pick = (name: string, fallback: string) => (commentColumns.has(name) ? name : `${fallback} AS ${name}`);
      comments = legacy.prepare(`
        SELECT id, group_id, text, ${pick('status', "'pending'")}, ${pick('revision', '1')}, ${pick('completed_at', 'NULL')},
          ${pick('completion_note', "''")}, created, updated
        FROM group_comments ORDER BY created, id
      `).all() as LegacyData['comments'];
    }
    let workflows: LegacyData['workflows'] = [];
    if (hasWorkflows) {
      const workflowColumns = columns(legacy, 'workflows');
      workflows = legacy.prepare(`
        SELECT id, name, version, prompt, mapping, ${workflowColumns.has('deleted') ? 'deleted' : '0 AS deleted'} FROM workflows ORDER BY name, version
      `).all() as LegacyData['workflows'];
    }
    const exportOptions = hasTable(legacy, 'settings')
      ? (legacy.prepare(`SELECT value FROM settings WHERE key = 'export_options'`).get() as { value: string } | undefined)?.value ?? null
      : null;
    return { projects, groups, candidates, comments, workflows, exportOptions };
  } finally {
    legacy.close();
  }
}

function parseObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------ mapping */

function mapped(kind: 'project' | 'group' | 'comment', legacyId: string): string | null {
  return (db().prepare('SELECT new_id FROM audio_legacy_import_map WHERE kind = ? AND legacy_id = ?').get(kind, legacyId) as { new_id: string } | undefined)?.new_id ?? null;
}

function remember(kind: 'project' | 'group' | 'comment', legacyId: string, newId: string): void {
  db().prepare(`INSERT INTO audio_legacy_import_map (kind, legacy_id, new_id, imported_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(kind, legacy_id) DO UPDATE SET new_id = excluded.new_id, imported_at = excluded.imported_at`)
    .run(kind, legacyId, newId, now());
}

function existingProjectId(legacy: { id: string; name: string }): string | null {
  const byMap = mapped('project', legacy.id);
  if (byMap && db().prepare('SELECT 1 FROM audio_projects WHERE id = ?').get(byMap)) return byMap;
  return (db().prepare('SELECT id FROM audio_projects WHERE name = ? COLLATE NOCASE').get(legacy.name) as { id: string } | undefined)?.id ?? null;
}

function existingGroupId(legacy: { id: string; label: string }, projectId: string | null): string | null {
  const byMap = mapped('group', legacy.id);
  if (byMap && db().prepare('SELECT 1 FROM audio_groups WHERE id = ?').get(byMap)) return byMap;
  if (!projectId) return null;
  return (db().prepare('SELECT id FROM audio_groups WHERE project_id = ? AND label = ? COLLATE NOCASE').get(projectId, legacy.label) as { id: string } | undefined)?.id ?? null;
}

function candidateBySourceKey(legacyId: string): string | null {
  return (db().prepare('SELECT id FROM audio_candidates WHERE source_key = ?').get(`legacy:${legacyId}`) as { id: string } | undefined)?.id ?? null;
}

/** Old candidate file names are bare names inside `audio/`; anything else is refused. */
function legacyFilePath(dataRoot: string, file: string): string | null {
  if (!file || file !== path.basename(file) || file.includes('..')) return null;
  if (!isAllowedAudioExtension(normalizeAudioExtension(file))) return null;
  const full = path.join(dataRoot, 'audio', file);
  return fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
}

/** Parents before children, so an edit's parent is already imported when the edit comes. */
function orderParentsFirst(candidates: LegacyCandidate[]): LegacyCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const ordered: LegacyCandidate[] = [];
  const done = new Set<string>();
  const visit = (candidate: LegacyCandidate, trail: Set<string>) => {
    if (done.has(candidate.id)) return;
    const parent = candidate.parent_id ? byId.get(candidate.parent_id) : undefined;
    if (parent && !trail.has(parent.id)) visit(parent, new Set([...trail, candidate.id]));
    done.add(candidate.id);
    ordered.push(candidate);
  };
  for (const candidate of candidates) visit(candidate, new Set());
  return ordered;
}

function legacyProvenance(candidate: LegacyCandidate): Record<string, unknown> {
  return {
    source: 'legacy-sfx-manager',
    prompt: candidate.job_text,
    seconds: candidate.job_seconds,
    seed: candidate.job_seed,
    workflow_name: candidate.workflow_name,
    workflow_version: candidate.workflow_version,
    server_name: candidate.server_name,
    legacy: {
      candidate_id: candidate.id,
      parent_id: candidate.parent_id,
      job_id: candidate.job_id,
      order_id: candidate.job_order_id,
      file: candidate.file,
      prompt_snapshot: parseObject(candidate.job_prompt),
    },
  };
}

/* ------------------------------------------------------------------------------------------------ run */

function emptyResult(dryRun: boolean, source: LegacyImportResult['source']): LegacyImportResult {
  return {
    dry_run: dryRun,
    source,
    projects: { total: 0, created: 0, existing: 0 },
    groups: { total: 0, created: 0, existing: 0, failed: 0 },
    candidates: { total: 0, imported: 0, already_imported: 0, soft_deleted: 0, missing_file: 0, deleted_without_file: 0, failed: 0 },
    files: { new: 0, reused: 0, bytes: 0 },
    comments: { total: 0, imported: 0, already_imported: 0 },
    workflows: [],
    export_options: 'none',
    warnings: [],
  };
}

function warn(result: LegacyImportResult, message: string): void {
  if (result.warnings.length < MAX_WARNINGS) result.warnings.push(message);
}

/** Resolve the data dir of a source (extracting an uploaded zip once) and a scratch dir for the database copy. */
async function prepareSource(source: LegacyImportSource, workDir: string, hooks: LegacyImportHooks): Promise<{ dataRoot: string; label: string; kind: 'path' | 'upload' }> {
  if ('path' in source) {
    const dataRoot = resolveLegacyPath(source.path);
    return { dataRoot, label: dataRoot, kind: 'path' };
  }
  const upload = resolveLegacyUpload(source.uploadId);
  if (!fs.existsSync(upload.extractDir)) {
    hooks.phase?.('extract');
    const partial = `${upload.extractDir}.partial-${crypto.randomUUID()}`;
    try {
      await extractLegacyZip(upload.zipPath, partial, hooks);
      fs.renameSync(partial, upload.extractDir);
    } finally {
      fs.rmSync(partial, { recursive: true, force: true });
    }
  }
  const dataRoot = findDataRoot(upload.extractDir);
  if (!dataRoot) throw new LegacyImportError('압축 파일 안에 sfx.sqlite3가 없어.');
  return { dataRoot, label: `upload:${upload.id}`, kind: 'upload' };
}

export async function runLegacyAudioImport(params: LegacyImportParams, hooks: LegacyImportHooks = {}): Promise<LegacyImportResult> {
  const workDir = path.join(WORK_ROOT(), 'work', crypto.randomUUID());
  try {
    const prepared = await prepareSource(params.source, workDir, hooks);
    hooks.phase?.('read');
    const legacy = readLegacy(prepared.dataRoot, workDir);
    const result = emptyResult(params.dryRun, { kind: prepared.kind, label: prepared.label });
    const total = legacy.candidates.length + legacy.comments.length;
    let processed = 0;
    const step = async () => {
      processed += 1;
      hooks.progress?.(processed, total);
      if (processed % 25 === 0) {
        hooks.throwIfCancelled?.();
        await (hooks.yield ?? yieldToEventLoop)();
      }
    };
    hooks.progress?.(0, total);

    // ---- projects
    hooks.phase?.('projects');
    const projectIds = new Map<string, string>();
    result.projects.total = legacy.projects.length;
    for (const project of legacy.projects) {
      const existing = existingProjectId(project);
      if (existing) {
        result.projects.existing += 1;
        projectIds.set(project.id, existing);
        if (!params.dryRun) remember('project', project.id, existing);
        continue;
      }
      result.projects.created += 1;
      if (!params.dryRun) {
        const created = createAudioProject({ name: project.name, description: project.description ?? '' }, params.accountId);
        projectIds.set(project.id, created.id);
        remember('project', project.id, created.id);
      }
    }

    // ---- groups
    hooks.phase?.('groups');
    const groupIds = new Map<string, string>();
    result.groups.total = legacy.groups.length;
    for (const group of legacy.groups) {
      const projectId = projectIds.get(group.project_id) ?? null;
      const existing = existingGroupId(group, projectId);
      if (existing) {
        result.groups.existing += 1;
        groupIds.set(group.id, existing);
        if (!params.dryRun) remember('group', group.id, existing);
        continue;
      }
      if (params.dryRun) {
        result.groups.created += 1;
        groupIds.set(group.id, `dry:${group.id}`);
        continue;
      }
      if (!projectId) {
        result.groups.failed += 1;
        warn(result, `그룹 ${group.name}: 프로젝트를 찾을 수 없어.`);
        continue;
      }
      try {
        const created = createAudioGroup(projectId, { name: group.name, label: group.label, description: group.description ?? '' });
        groupIds.set(group.id, created.id);
        remember('group', group.id, created.id);
        result.groups.created += 1;
      } catch (error) {
        result.groups.failed += 1;
        warn(result, `그룹 ${group.name} (${group.label}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // ---- candidates (parents first)
    hooks.phase?.('candidates');
    const candidateIds = new Map<string, string>();
    result.candidates.total = legacy.candidates.length;
    for (const candidate of orderParentsFirst(legacy.candidates)) {
      await step();
      const already = candidateBySourceKey(candidate.id);
      if (already) {
        result.candidates.already_imported += 1;
        candidateIds.set(candidate.id, already);
        continue;
      }
      const filePath = legacyFilePath(prepared.dataRoot, candidate.file);
      if (!filePath) {
        if (candidate.deleted) result.candidates.deleted_without_file += 1;
        else {
          result.candidates.missing_file += 1;
          warn(result, `후보 ${candidate.name}: 파일 ${candidate.file}이(가) 없어.`);
        }
        continue;
      }
      const groupId = groupIds.get(candidate.group_id);
      if (!groupId) {
        result.candidates.failed += 1;
        warn(result, `후보 ${candidate.name}: 그룹을 가져오지 못했어.`);
        continue;
      }
      result.files.bytes += fs.statSync(filePath).size;
      if (params.dryRun) {
        result.candidates.imported += 1;
        if (candidate.deleted) result.candidates.soft_deleted += 1;
        candidateIds.set(candidate.id, `dry:${candidate.id}`);
        continue;
      }
      try {
        const { file, created } = await ingestAudioCopy(filePath, candidate.file);
        if (created) result.files.new += 1;
        else result.files.reused += 1;
        const parentId = candidate.parent_id ? candidateIds.get(candidate.parent_id) ?? null : null;
        const isEdit = Boolean(candidate.parent_id) || Boolean(candidate.edit);
        const review = ['pending', 'selected', 'rejected'].includes(candidate.review) ? candidate.review : 'pending';
        const at = now();
        const id = crypto.randomUUID();
        db().prepare(`
          INSERT INTO audio_candidates (id, group_id, file_hash, parent_id, origin, name, review, notes, edit_json, provenance_json,
            source_key, created_by_account_id, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, groupId, file.hash, parentId, isEdit ? 'edited' : 'generated', candidate.name || '오디오', review,
          candidate.notes ?? '', candidate.edit ?? null, JSON.stringify(legacyProvenance(candidate)), `legacy:${candidate.id}`,
          params.accountId, candidate.created || at, at, candidate.deleted ? at : null);
        candidateIds.set(candidate.id, id);
        result.candidates.imported += 1;
        if (candidate.deleted) result.candidates.soft_deleted += 1;
      } catch (error) {
        if ((error as Error)?.name === 'RuntimeJobCancelledError') throw error;
        result.candidates.failed += 1;
        warn(result, `후보 ${candidate.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // ---- comments
    hooks.phase?.('comments');
    result.comments.total = legacy.comments.length;
    for (const comment of legacy.comments) {
      await step();
      const existing = mapped('comment', comment.id);
      if (existing && db().prepare('SELECT 1 FROM audio_group_comments WHERE id = ?').get(existing)) {
        result.comments.already_imported += 1;
        continue;
      }
      const groupId = groupIds.get(comment.group_id);
      if (!groupId) continue;
      result.comments.imported += 1;
      if (params.dryRun) continue;
      const id = crypto.randomUUID();
      const status = comment.status === 'completed' ? 'completed' : 'pending';
      db().transaction(() => {
        db().prepare(`
          INSERT INTO audio_group_comments (id, group_id, text, status, revision, completion_note, completed_at, author_account_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(id, groupId, comment.text, status, Math.max(1, Number(comment.revision) || 1), comment.completion_note ?? '',
          status === 'completed' ? comment.completed_at : null, comment.created || now(), comment.updated || comment.created || now());
        remember('comment', comment.id, id);
      }).immediate();
    }

    // ---- workflows (kept, not registered)
    hooks.phase?.('workflows');
    for (const workflow of legacy.workflows) {
      const mapping = parseObject(workflow.mapping) ?? {};
      const graph = parseObject(workflow.prompt) ?? {};
      if (!params.dryRun) {
        db().prepare(`
          INSERT INTO audio_legacy_workflows (legacy_id, name, version, prompt_json, mapping_json, deleted, imported_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(legacy_id) DO UPDATE SET name = excluded.name, version = excluded.version, prompt_json = excluded.prompt_json,
            mapping_json = excluded.mapping_json, deleted = excluded.deleted
        `).run(workflow.id, workflow.name, Number(workflow.version) || 1, workflow.prompt, workflow.mapping, workflow.deleted ? 1 : 0, now());
      }
      const registered = params.dryRun ? null : legacyWorkflowRow(workflow.id)?.registered_workflow_id ?? null;
      result.workflows.push({
        legacy_id: workflow.id,
        name: workflow.name,
        version: Number(workflow.version) || 1,
        deleted: Boolean(workflow.deleted),
        node_count: Object.keys(graph).length,
        mapping,
        registered_workflow_id: registered,
      });
    }

    // ---- export defaults
    if (legacy.exportOptions && parseObject(legacy.exportOptions)) {
      const has = db().prepare(`SELECT 1 FROM audio_settings WHERE key = 'export_options'`).get();
      result.export_options = has ? 'kept' : 'imported';
      if (!has && !params.dryRun) {
        db().prepare(`INSERT INTO audio_settings (key, value) VALUES ('export_options', ?)`).run(legacy.exportOptions);
      }
    }

    hooks.progress?.(total, total);
    if (!params.dryRun && 'uploadId' in params.source) removeLegacyUpload(params.source.uploadId);
    return result;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------------------------------------ workflows */

interface LegacyWorkflowRow {
  legacy_id: string;
  name: string;
  version: number;
  prompt_json: string;
  mapping_json: string;
  deleted: number;
  registered_workflow_id: number | null;
  imported_at: string;
}

function legacyWorkflowRow(legacyId: string): LegacyWorkflowRow | null {
  return (db().prepare('SELECT * FROM audio_legacy_workflows WHERE legacy_id = ?').get(legacyId) as LegacyWorkflowRow | undefined) ?? null;
}

export function listLegacyAudioWorkflows(): LegacyWorkflowInfo[] {
  const rows = db().prepare('SELECT * FROM audio_legacy_workflows ORDER BY name, version').all() as LegacyWorkflowRow[];
  return rows.map((row) => ({
    legacy_id: row.legacy_id,
    name: row.name,
    version: row.version,
    deleted: Boolean(row.deleted),
    node_count: Object.keys(parseObject(row.prompt_json) ?? {}).length,
    mapping: parseObject(row.mapping_json) ?? {},
    registered_workflow_id: row.registered_workflow_id && WorkflowModel.findById(row.registered_workflow_id) ? row.registered_workflow_id : null,
  }));
}

function mappingTarget(mapping: Record<string, unknown>, key: string): { nodeId: string; input: string } | null {
  const value = mapping[key];
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [nodeId, input] = value;
  return typeof input === 'string' && (typeof nodeId === 'string' || typeof nodeId === 'number') ? { nodeId: String(nodeId), input } : null;
}

/**
 * Register one imported legacy workflow on the generation side as an audio workflow: its graph with batch size 1,
 * marked fields for the prompt / seconds / seed inputs its mapping named, and the audio binding. A second call
 * returns the workflow registered before (while it still exists).
 */
export async function registerLegacyAudioWorkflow(legacyId: unknown): Promise<AudioWorkflowSummary> {
  if (typeof legacyId !== 'string' || !legacyId) throw new LegacyImportError('legacy_workflow_id가 필요해.');
  const row = legacyWorkflowRow(legacyId);
  if (!row) throw new LegacyImportError('가져온 워크플로가 아니야.', 404);
  const summaryOf = (id: number) => listAudioWorkflows().find((entry) => entry.id === id);
  if (row.registered_workflow_id && WorkflowModel.findById(row.registered_workflow_id)) {
    const summary = summaryOf(row.registered_workflow_id);
    if (summary) return summary;
  }
  const graph = parseObject(row.prompt_json);
  const mapping = parseObject(row.mapping_json);
  if (!graph || !mapping) throw new LegacyImportError('워크플로 데이터가 손상됐어.');
  const roles = { prompt: mappingTarget(mapping, 'text'), seconds: mappingTarget(mapping, 'seconds'), seed: mappingTarget(mapping, 'seed') };
  for (const [role, target] of Object.entries(roles)) {
    const node = target ? graph[target.nodeId] as { class_type?: string; inputs?: Record<string, unknown> } | undefined : undefined;
    if (!target || !node || typeof node !== 'object') throw new LegacyImportError(`매핑의 ${role} 노드가 그래프에 없어.`);
  }
  const batch = mappingTarget(mapping, 'batch_size');
  const batchNode = batch ? graph[batch.nodeId] as { inputs?: Record<string, unknown> } | undefined : undefined;
  if (batch && batchNode?.inputs) batchNode.inputs[batch.input] = 1;
  const nodeOf = (target: { nodeId: string }) => graph[target.nodeId] as { class_type?: string; inputs?: Record<string, unknown> };
  const value = (target: { nodeId: string; input: string }) => nodeOf(target).inputs?.[target.input];
  const seedNode = nodeOf(roles.seed!);
  const fields: MarkedField[] = [
    { id: 'prompt', label: '효과음 설명', jsonPath: `${roles.prompt!.nodeId}.inputs.${roles.prompt!.input}`, type: 'textarea', required: true, default_value: '', source_node_id: roles.prompt!.nodeId, node_class_type: nodeOf(roles.prompt!).class_type },
    { id: 'seconds', label: '길이(초)', jsonPath: `${roles.seconds!.nodeId}.inputs.${roles.seconds!.input}`, type: 'number', default_value: typeof value(roles.seconds!) === 'number' ? value(roles.seconds!) as number : 3, min: 0.1, step: 0.1, source_node_id: roles.seconds!.nodeId, node_class_type: nodeOf(roles.seconds!).class_type },
    { id: 'seed', label: 'seed', jsonPath: `${roles.seed!.nodeId}.inputs.${roles.seed!.input}`, type: 'number', default_value: 0, min: 0, max: seedNode.class_type === 'Seed (rgthree)' ? 1125899906842624 : Number.MAX_SAFE_INTEGER, step: 1, source_node_id: roles.seed!.nodeId, node_class_type: seedNode.class_type },
  ];
  const base = `${row.name} v${row.version}`;
  let name = base;
  for (let suffix = 2; WorkflowModel.existsByName(name); suffix += 1) name = `${base} (${suffix})`;
  const id = WorkflowModel.create({
    name,
    description: '이전 오디오 앱에서 가져온 워크플로',
    workflow_json: JSON.stringify(graph, null, 2),
    marked_fields: fields,
    is_active: true,
    kind: 'audio',
  });
  db().prepare('UPDATE audio_legacy_workflows SET registered_workflow_id = ? WHERE legacy_id = ?').run(id, legacyId);
  await saveAudioWorkflowBinding(id, { prompt_field_id: 'prompt', seconds_field_id: 'seconds', seed_field_id: 'seed', is_default: !getDefaultAudioWorkflowBinding() });
  const summary = summaryOf(id);
  if (!summary) throw new LegacyImportError('등록한 워크플로를 찾을 수 없어.', 500);
  return summary;
}

