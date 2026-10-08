import crypto from 'crypto';
import path from 'path';
import { getAudioDb } from '../../database/audioDb';
import { FileStoreService } from '../fileStoreService';
import { validateAudioLabel } from './audioNaming';
import {
  AUDIO_MIME_BY_EXTENSION,
  getAudioFile,
  ingestAudioBuffer,
  ingestAudioCopy,
  ingestAudioFile,
  normalizeAudioExtension,
  type AudioFileRecord,
} from './audioStore';
import { releaseUnreferencedAudioBlobs } from './audioMaintenance';

/**
 * The sound-effect workspace: projects → groups → candidates (generated takes, uploads, edits), group comments.
 * Business rules live here; the REST routes and MCP tools are thin callers.
 *
 * Review (selected / rejected) is a human decision: only the `/api/audio` route calls `setReview`, and no MCP tool does.
 */

export const AUDIO_INBOX_GROUP_NAME = '받은 파일';
export const AUDIO_REVIEW_STATES = ['pending', 'selected', 'rejected'] as const;
export const AUDIO_CANDIDATE_ORIGINS = ['generated', 'uploaded', 'edited', 'imported'] as const;
export const AUDIO_COMMENT_STATES = ['pending', 'completed'] as const;
export type AudioReview = (typeof AUDIO_REVIEW_STATES)[number];
export type AudioCandidateOrigin = (typeof AUDIO_CANDIDATE_ORIGINS)[number];
export type AudioCommentStatus = (typeof AUDIO_COMMENT_STATES)[number];
export type AudioGroupFilter = 'unselected' | 'has_comments' | 'pending_comments' | 'completed_comments';

export class AudioServiceError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface AudioProject {
  id: string;
  name: string;
  description: string;
  created_by_account_id: number | null;
  created_at: string;
  updated_at: string;
  group_count: number;
  candidate_count: number;
  inbox_group_id: string | null;
}

export interface AudioGroup {
  id: string;
  project_id: string;
  name: string;
  label: string | null;
  description: string;
  is_inbox: boolean;
  created_at: string;
  updated_at: string;
  candidate_count: number;
  selected_count: number;
  pending_review_count: number;
  comment_count: number;
  pending_comment_count: number;
  completed_comment_count: number;
}

export interface AudioCandidate {
  id: string;
  group_id: string;
  project_id: string;
  file_hash: string;
  parent_id: string | null;
  origin: AudioCandidateOrigin;
  name: string;
  review: AudioReview;
  notes: string;
  edit: unknown;
  provenance: unknown;
  order_id: string | null;
  job_id: string | null;
  created_by_account_id: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  file: {
    ext: string;
    mime_type: string;
    size: number;
    duration: number | null;
    sample_rate: number | null;
    channels: number | null;
    codec: string | null;
  };
}

export interface AudioComment {
  id: string;
  group_id: string;
  text: string;
  status: AudioCommentStatus;
  revision: number;
  completion_note: string;
  completed_at: string | null;
  author_account_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Where an import lands: a group, or a project's 받은 파일 inbox. */
export type AudioImportTarget = { groupId: string } | { projectId: string };

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const db = () => getAudioDb();

function text(value: unknown, field: string, max: number, required = true): string {
  if (value === undefined || value === null) {
    if (required) throw new AudioServiceError(`${field}을(를) 입력해줘.`);
    return '';
  }
  if (typeof value !== 'string') throw new AudioServiceError(`${field} 형식이 잘못됐어.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new AudioServiceError(`${field}을(를) 입력해줘.`);
  if ([...trimmed].length > max) throw new AudioServiceError(`${field}은(는) ${max}자까지야.`);
  return trimmed;
}

function intInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function isUniqueViolation(error: unknown): boolean {
  return String((error as { code?: string })?.code ?? '').startsWith('SQLITE_CONSTRAINT');
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try { return JSON.parse(value); } catch { return null; }
}

/* ---------------------------------------------------------------- projects */

const PROJECT_SELECT = `
  SELECT p.*,
    (SELECT count(*) FROM audio_groups g WHERE g.project_id = p.id) AS group_count,
    (SELECT count(*) FROM audio_candidates c JOIN audio_groups g ON g.id = c.group_id
      WHERE g.project_id = p.id AND c.deleted_at IS NULL) AS candidate_count,
    (SELECT g.id FROM audio_groups g WHERE g.project_id = p.id AND g.is_inbox = 1) AS inbox_group_id
  FROM audio_projects p`;

export function listAudioProjects(): AudioProject[] {
  return db().prepare(`${PROJECT_SELECT} ORDER BY p.created_at, p.id`).all() as AudioProject[];
}

export function getAudioProject(id: string): AudioProject {
  const row = db().prepare(`${PROJECT_SELECT} WHERE p.id = ?`).get(String(id)) as AudioProject | undefined;
  if (!row) throw new AudioServiceError('프로젝트를 찾을 수 없어.', 404);
  return row;
}

/** Create a project together with its 받은 파일 inbox group. */
export function createAudioProject(input: { name?: unknown; description?: unknown }, accountId: number | null): AudioProject {
  const name = text(input.name, '프로젝트 이름', 120);
  const description = text(input.description, '설명', 4000, false);
  const id = newId();
  const at = now();
  try {
    db().transaction(() => {
      db().prepare(`INSERT INTO audio_projects (id, name, description, created_by_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, name, description, accountId, at, at);
      db().prepare(`INSERT INTO audio_groups (id, project_id, name, label, description, is_inbox, created_at, updated_at) VALUES (?, ?, ?, NULL, '', 1, ?, ?)`)
        .run(newId(), id, AUDIO_INBOX_GROUP_NAME, at, at);
    }).immediate();
  } catch (error) {
    if (isUniqueViolation(error)) throw new AudioServiceError('같은 이름의 프로젝트가 이미 있어.', 409);
    throw error;
  }
  return getAudioProject(id);
}

export function updateAudioProject(id: string, input: { name?: unknown; description?: unknown }): AudioProject {
  const current = getAudioProject(id);
  const name = input.name === undefined ? current.name : text(input.name, '프로젝트 이름', 120);
  const description = input.description === undefined ? current.description : text(input.description, '설명', 4000, false);
  try {
    db().prepare('UPDATE audio_projects SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(name, description, now(), current.id);
  } catch (error) {
    if (isUniqueViolation(error)) throw new AudioServiceError('같은 이름의 프로젝트가 이미 있어.', 409);
    throw error;
  }
  return getAudioProject(current.id);
}

/** Delete a project with its groups, candidates and comments; blobs nothing else uses go to the RecycleBin. */
export async function deleteAudioProject(id: string): Promise<{ deleted: true; released: number }> {
  const project = getAudioProject(id);
  const hashes = db().prepare(`
    SELECT DISTINCT c.file_hash FROM audio_candidates c JOIN audio_groups g ON g.id = c.group_id WHERE g.project_id = ?
  `).all(project.id) as Array<{ file_hash: string }>;
  const snapshot = snapshotCandidatesForRelease(hashes.map((row) => row.file_hash));
  await cancelOrdersOf((db().prepare('SELECT id FROM audio_groups WHERE project_id = ?').all(project.id) as Array<{ id: string }>).map((row) => row.id));
  db().prepare('DELETE FROM audio_projects WHERE id = ?').run(project.id);
  const released = await releaseUnreferencedAudioBlobs(hashes.map((row) => row.file_hash), snapshot);
  return { deleted: true, released: released.released };
}

/* ---------------------------------------------------------------- groups */

const GROUP_SELECT = `
  SELECT g.*,
    (SELECT count(*) FROM audio_candidates c WHERE c.group_id = g.id AND c.deleted_at IS NULL) AS candidate_count,
    (SELECT count(*) FROM audio_candidates c WHERE c.group_id = g.id AND c.deleted_at IS NULL AND c.review = 'selected') AS selected_count,
    (SELECT count(*) FROM audio_candidates c WHERE c.group_id = g.id AND c.deleted_at IS NULL AND c.review = 'pending') AS pending_review_count,
    (SELECT count(*) FROM audio_group_comments m WHERE m.group_id = g.id) AS comment_count,
    (SELECT count(*) FROM audio_group_comments m WHERE m.group_id = g.id AND m.status = 'pending') AS pending_comment_count,
    (SELECT count(*) FROM audio_group_comments m WHERE m.group_id = g.id AND m.status = 'completed') AS completed_comment_count
  FROM audio_groups g`;

type GroupRow = Omit<AudioGroup, 'is_inbox'> & { is_inbox: number };
const toGroup = (row: GroupRow): AudioGroup => ({ ...row, is_inbox: row.is_inbox === 1 });

export function listAudioGroups(projectId: string, options: { search?: unknown; filter?: unknown } = {}): AudioGroup[] {
  const project = getAudioProject(projectId);
  const filter = options.filter === undefined || options.filter === null || options.filter === '' ? null : String(options.filter);
  if (filter !== null && !['unselected', 'has_comments', 'pending_comments', 'completed_comments'].includes(filter)) {
    throw new AudioServiceError('그룹 필터는 unselected, has_comments, pending_comments, completed_comments 중 하나야.');
  }
  const search = typeof options.search === 'string' ? options.search.trim().toLowerCase() : '';
  const rows = (db().prepare(`${GROUP_SELECT} WHERE g.project_id = ? ORDER BY g.is_inbox DESC, g.created_at, g.id`).all(project.id) as GroupRow[]).map(toGroup);
  return rows.filter((group) => {
    if (search && !group.name.toLowerCase().includes(search) && !(group.label ?? '').toLowerCase().includes(search)) return false;
    switch (filter as AudioGroupFilter | null) {
      case 'unselected': return group.candidate_count > 0 && group.selected_count === 0;
      case 'has_comments': return group.comment_count > 0;
      case 'pending_comments': return group.pending_comment_count > 0;
      case 'completed_comments': return group.completed_comment_count > 0;
      default: return true;
    }
  });
}

export function getAudioGroup(id: string): AudioGroup {
  const row = db().prepare(`${GROUP_SELECT} WHERE g.id = ?`).get(String(id)) as GroupRow | undefined;
  if (!row) throw new AudioServiceError('그룹을 찾을 수 없어.', 404);
  return toGroup(row);
}

export function getAudioInboxGroup(projectId: string): AudioGroup {
  const row = db().prepare('SELECT id FROM audio_groups WHERE project_id = ? AND is_inbox = 1').get(String(projectId)) as { id: string } | undefined;
  if (!row) {
    getAudioProject(projectId);
    // A project always has an inbox; recreate it if an older row lost it.
    const at = now();
    const id = newId();
    db().prepare(`INSERT INTO audio_groups (id, project_id, name, label, description, is_inbox, created_at, updated_at) VALUES (?, ?, ?, NULL, '', 1, ?, ?)`)
      .run(id, String(projectId), AUDIO_INBOX_GROUP_NAME, at, at);
    return getAudioGroup(id);
  }
  return getAudioGroup(row.id);
}

export function createAudioGroup(projectId: string, input: { name?: unknown; label?: unknown; description?: unknown }): AudioGroup {
  const project = getAudioProject(projectId);
  const name = text(input.name, '그룹 이름', 120);
  const label = validateAudioLabel(text(input.label, '파일명 규칙', 120));
  const description = text(input.description, '설명', 4000, false);
  const id = newId();
  const at = now();
  try {
    db().prepare(`INSERT INTO audio_groups (id, project_id, name, label, description, is_inbox, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(id, project.id, name, label, description, at, at);
  } catch (error) {
    if (isUniqueViolation(error)) throw new AudioServiceError('이 프로젝트에 같은 파일명 규칙의 그룹이 이미 있어.', 409);
    throw error;
  }
  return getAudioGroup(id);
}

export function updateAudioGroup(id: string, input: { name?: unknown; label?: unknown; description?: unknown }): AudioGroup {
  const current = getAudioGroup(id);
  if (current.is_inbox && input.label !== undefined && input.label !== null) {
    throw new AudioServiceError('받은 파일 그룹에는 파일명 규칙을 붙일 수 없어.');
  }
  const name = input.name === undefined ? current.name : text(input.name, '그룹 이름', 120);
  const label = current.is_inbox ? null : input.label === undefined ? current.label : validateAudioLabel(text(input.label, '파일명 규칙', 120));
  const description = input.description === undefined ? current.description : text(input.description, '설명', 4000, false);
  try {
    db().prepare('UPDATE audio_groups SET name = ?, label = ?, description = ?, updated_at = ? WHERE id = ?').run(name, label, description, now(), current.id);
  } catch (error) {
    if (isUniqueViolation(error)) throw new AudioServiceError('이 프로젝트에 같은 파일명 규칙의 그룹이 이미 있어.', 409);
    throw error;
  }
  return getAudioGroup(current.id);
}

/** Queued or running generation of these groups' orders stops before the order rows cascade away. */
async function cancelOrdersOf(groupIds: string[]): Promise<void> {
  const { cancelAudioOrdersInGroups } = await import('./audioOrders');
  await cancelAudioOrdersInGroups(groupIds);
}

/** Delete a group with its candidates and comments (never the inbox); unused blobs go to the RecycleBin. */
export async function deleteAudioGroup(id: string): Promise<{ deleted: true; released: number }> {
  const group = getAudioGroup(id);
  if (group.is_inbox) throw new AudioServiceError('받은 파일 그룹은 지울 수 없어.');
  const hashes = (db().prepare('SELECT DISTINCT file_hash FROM audio_candidates WHERE group_id = ?').all(group.id) as Array<{ file_hash: string }>)
    .map((row) => row.file_hash);
  const snapshot = snapshotCandidatesForRelease(hashes);
  await cancelOrdersOf([group.id]);
  db().prepare('DELETE FROM audio_groups WHERE id = ?').run(group.id);
  const released = await releaseUnreferencedAudioBlobs(hashes, snapshot);
  return { deleted: true, released: released.released };
}

/* ---------------------------------------------------------------- candidates */

type CandidateRow = {
  id: string; group_id: string; project_id: string; file_hash: string; parent_id: string | null; origin: AudioCandidateOrigin;
  name: string; review: AudioReview; notes: string; edit_json: string | null; provenance_json: string | null;
  order_id: string | null; job_id: string | null; created_by_account_id: number | null; created_at: string;
  updated_at: string; deleted_at: string | null;
  f_ext: string; f_size: number; f_duration: number | null; f_sample_rate: number | null; f_channels: number | null; f_codec: string | null;
};

const CANDIDATE_SELECT = `
  SELECT c.*, g.project_id AS project_id,
    f.ext AS f_ext, f.size AS f_size, f.duration AS f_duration, f.sample_rate AS f_sample_rate, f.channels AS f_channels, f.codec AS f_codec
  FROM audio_candidates c
  JOIN audio_groups g ON g.id = c.group_id
  JOIN audio_files f ON f.hash = c.file_hash`;

function toCandidate(row: CandidateRow): AudioCandidate {
  return {
    id: row.id, group_id: row.group_id, project_id: row.project_id, file_hash: row.file_hash, parent_id: row.parent_id,
    origin: row.origin, name: row.name, review: row.review, notes: row.notes,
    edit: parseJson(row.edit_json), provenance: parseJson(row.provenance_json),
    order_id: row.order_id, job_id: row.job_id, created_by_account_id: row.created_by_account_id,
    created_at: row.created_at, updated_at: row.updated_at, deleted_at: row.deleted_at,
    file: {
      ext: row.f_ext, mime_type: AUDIO_MIME_BY_EXTENSION[row.f_ext] ?? 'application/octet-stream', size: row.f_size,
      duration: row.f_duration, sample_rate: row.f_sample_rate, channels: row.f_channels, codec: row.f_codec,
    },
  };
}

export function listAudioCandidates(groupId: string, options: { review?: unknown; deleted?: unknown; limit?: unknown; offset?: unknown } = {}): { items: AudioCandidate[]; total: number; limit: number; offset: number } {
  const group = getAudioGroup(groupId);
  const review = options.review === undefined || options.review === null || options.review === '' ? null : String(options.review);
  if (review !== null && !(AUDIO_REVIEW_STATES as readonly string[]).includes(review)) {
    throw new AudioServiceError('검수 상태는 pending, selected, rejected 중 하나야.');
  }
  const deleted = options.deleted === undefined || options.deleted === null || options.deleted === '' ? 'exclude' : String(options.deleted);
  if (!['exclude', 'only', 'include'].includes(deleted)) throw new AudioServiceError('deleted는 exclude, only, include 중 하나야.');
  const limit = intInRange(options.limit, 50, 1, 200);
  const offset = intInRange(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const where = ['c.group_id = ?'];
  const params: unknown[] = [group.id];
  if (review) { where.push('c.review = ?'); params.push(review); }
  if (deleted === 'exclude') where.push('c.deleted_at IS NULL');
  if (deleted === 'only') where.push('c.deleted_at IS NOT NULL');
  const clause = where.join(' AND ');
  const total = (db().prepare(`SELECT count(*) AS n FROM audio_candidates c WHERE ${clause}`).get(...params) as { n: number }).n;
  const items = (db().prepare(`${CANDIDATE_SELECT} WHERE ${clause} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as CandidateRow[]).map(toCandidate);
  return { items, total, limit, offset };
}

export function getAudioCandidate(id: string): AudioCandidate {
  const row = db().prepare(`${CANDIDATE_SELECT} WHERE c.id = ?`).get(String(id)) as CandidateRow | undefined;
  if (!row) throw new AudioServiceError('후보를 찾을 수 없어.', 404);
  return toCandidate(row);
}

function candidateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new AudioServiceError('후보를 하나 이상 골라줘.');
  if (value.length > 500) throw new AudioServiceError('한 번에 500개까지 처리할 수 있어.');
  const ids = [...new Set(value.map((item) => String(item)))];
  return ids;
}

function requireCandidates(ids: string[]): Array<{ id: string; group_id: string; project_id: string; deleted_at: string | null }> {
  const rows = db().prepare(`
    SELECT c.id, c.group_id, g.project_id, c.deleted_at FROM audio_candidates c JOIN audio_groups g ON g.id = c.group_id
    WHERE c.id IN (SELECT value FROM json_each(?))
  `).all(JSON.stringify(ids)) as Array<{ id: string; group_id: string; project_id: string; deleted_at: string | null }>;
  if (rows.length !== ids.length) throw new AudioServiceError('없는 후보가 섞여 있어.', 404);
  return rows;
}

/** Move candidates to another group of the same project. */
export function moveAudioCandidates(ids: unknown, targetGroupId: string): { moved: number; group_id: string } {
  const list = candidateIds(ids);
  const target = getAudioGroup(targetGroupId);
  const rows = requireCandidates(list);
  if (rows.some((row) => row.project_id !== target.project_id)) {
    throw new AudioServiceError('다른 프로젝트의 그룹으로는 옮길 수 없어.');
  }
  const at = now();
  const moved = db().transaction(() => rows.reduce((sum, row) => sum + db().prepare(
    'UPDATE audio_candidates SET group_id = ?, updated_at = ? WHERE id = ? AND group_id != ?',
  ).run(target.id, at, row.id, target.id).changes, 0)).immediate();
  return { moved, group_id: target.id };
}

/** Soft delete; the file stays until the retention purge or an orphan cleanup releases it. */
export function deleteAudioCandidates(ids: unknown): { deleted: number } {
  const list = candidateIds(ids);
  requireCandidates(list);
  const at = now();
  const info = db().prepare(`UPDATE audio_candidates SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))`)
    .run(at, at, JSON.stringify(list));
  return { deleted: info.changes };
}

export function restoreAudioCandidates(ids: unknown): { restored: number } {
  const list = candidateIds(ids);
  requireCandidates(list);
  const info = db().prepare(`UPDATE audio_candidates SET deleted_at = NULL, updated_at = ? WHERE deleted_at IS NOT NULL AND id IN (SELECT value FROM json_each(?))`)
    .run(now(), JSON.stringify(list));
  return { restored: info.changes };
}

/** Human-only: called from the `/api/audio` review route, never from an MCP tool. */
export function setAudioCandidateReview(id: string, input: { review?: unknown; notes?: unknown }): AudioCandidate {
  const candidate = getAudioCandidate(id);
  if (candidate.deleted_at) throw new AudioServiceError('지운 후보는 검수할 수 없어.', 409);
  const review = input.review === undefined ? candidate.review : String(input.review);
  if (!(AUDIO_REVIEW_STATES as readonly string[]).includes(review)) throw new AudioServiceError('검수 상태는 pending, selected, rejected 중 하나야.');
  const notes = input.notes === undefined ? candidate.notes : text(input.notes, '메모', 4000, false);
  db().prepare('UPDATE audio_candidates SET review = ?, notes = ?, updated_at = ? WHERE id = ?').run(review, notes, now(), candidate.id);
  return getAudioCandidate(candidate.id);
}

/* ---------------------------------------------------------------- imports */

function resolveImportGroup(target: AudioImportTarget): AudioGroup {
  if ('groupId' in target && target.groupId) return getAudioGroup(target.groupId);
  if ('projectId' in target && target.projectId) return getAudioInboxGroup(target.projectId);
  throw new AudioServiceError('넣을 그룹이나 프로젝트를 골라줘.');
}

function candidateNameFrom(fileName: string): string {
  const stem = path.basename(String(fileName || ''), path.extname(String(fileName || ''))).trim();
  return [...(stem || '오디오')].slice(0, 200).join('');
}

interface CandidateInsert {
  groupId: string;
  file: AudioFileRecord;
  origin: AudioCandidateOrigin;
  name: string;
  accountId: number | null;
  sourceKey?: string | null;
  parentId?: string | null;
  provenance?: unknown;
  orderId?: string | null;
  jobId?: number | null;
}

function insertCandidate(input: CandidateInsert): AudioCandidate {
  if (input.sourceKey) {
    const existing = db().prepare('SELECT id FROM audio_candidates WHERE source_key = ?').get(input.sourceKey) as { id: string } | undefined;
    if (existing) return getAudioCandidate(existing.id);
  }
  const id = newId();
  const at = now();
  db().prepare(`
    INSERT INTO audio_candidates (id, group_id, file_hash, parent_id, origin, name, review, notes, provenance_json, source_key,
      order_id, job_id, created_by_account_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', '', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.groupId, input.file.hash, input.parentId ?? null, input.origin, input.name,
    input.provenance === undefined ? null : JSON.stringify(input.provenance), input.sourceKey ?? null,
    input.orderId ?? null, input.jobId == null ? null : String(input.jobId), input.accountId, at, at);
  return getAudioCandidate(id);
}

/** A generation result of an audio order (already ingested). `sourceKey` makes a re-collected output a no-op. */
export function registerGeneratedAudioCandidate(input: Omit<CandidateInsert, 'origin' | 'parentId'>): AudioCandidate {
  return insertCandidate({ ...input, origin: 'generated' });
}

/** Register an uploaded (multer-staged) file as a new candidate. The staged file is consumed. */
export async function importAudioUpload(target: AudioImportTarget, stagedPath: string, originalName: string, accountId: number | null): Promise<AudioCandidate> {
  const group = resolveImportGroup(target);
  const { file } = await ingestAudioFile(stagedPath, originalName);
  return insertCandidate({ groupId: group.id, file, origin: 'uploaded', name: candidateNameFrom(originalName), accountId,
    provenance: { source: 'upload', original_name: originalName } });
}

/** Copy one file from the requester's private file store (never moves it). `owner` is a resolved file-store owner key. */
export async function importAudioFromFileStore(target: AudioImportTarget, owner: string, fileId: string, accountId: number | null): Promise<AudioCandidate> {
  const group = resolveImportGroup(target);
  const { entry, filePath } = FileStoreService.resolveFile(owner, fileId);
  const { file } = await ingestAudioCopy(filePath, entry.name);
  return insertCandidate({ groupId: group.id, file, origin: 'imported', name: candidateNameFrom(entry.name), accountId,
    provenance: { source: 'file-store', file_id: fileId, original_name: entry.name } });
}

/** Decode a `data:audio/...;base64,` URL (already checked by the MCP request validator) and import it. */
export async function importAudioDataUrl(target: AudioImportTarget, dataUrl: string, fileName: string | undefined, accountId: number | null): Promise<AudioCandidate> {
  const match = /^data:(audio\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(String(dataUrl ?? ''));
  if (!match) throw new AudioServiceError('data_url은 data:audio/...;base64, 형식이어야 해.');
  const mime = match[1].toLowerCase();
  const fallbackExt = Object.entries(AUDIO_MIME_BY_EXTENSION).find(([, value]) => value === mime)?.[0]
    ?? (mime === 'audio/x-wav' || mime === 'audio/wave' ? 'wav' : mime === 'audio/mp3' ? 'mp3' : mime === 'audio/x-flac' ? 'flac' : null);
  const name = fileName && normalizeAudioExtension(fileName) ? fileName : `audio.${fallbackExt ?? 'bin'}`;
  const group = resolveImportGroup(target);
  const { file } = await ingestAudioBuffer(Buffer.from(match[2].replace(/\s/g, ''), 'base64'), name);
  return insertCandidate({ groupId: group.id, file, origin: 'imported', name: candidateNameFrom(name), accountId,
    provenance: { source: 'data-url', original_name: fileName ?? null } });
}

/** Path data for streaming a candidate's file. */
export function audioCandidateFile(id: string): { candidate: AudioCandidate; file: AudioFileRecord } {
  const candidate = getAudioCandidate(id);
  const file = getAudioFile(candidate.file_hash);
  if (!file) throw new AudioServiceError('파일 기록이 없어.', 404);
  return { candidate, file };
}

/* ---------------------------------------------------------------- comments */

export function listAudioGroupComments(groupId: string, options: { status?: unknown; limit?: unknown; offset?: unknown } = {}): AudioComment[] {
  const group = getAudioGroup(groupId);
  const status = options.status === undefined || options.status === null || options.status === '' ? null : String(options.status);
  if (status !== null && !(AUDIO_COMMENT_STATES as readonly string[]).includes(status)) {
    throw new AudioServiceError('코멘트 상태는 pending 또는 completed를 사용해 주세요.');
  }
  return db().prepare(`
    SELECT * FROM audio_group_comments WHERE group_id = ? AND (? IS NULL OR status = ?)
    ORDER BY created_at, id LIMIT ? OFFSET ?
  `).all(group.id, status, status, intInRange(options.limit, 100, 1, 200), intInRange(options.offset, 0, 0, Number.MAX_SAFE_INTEGER)) as AudioComment[];
}

function getComment(groupId: string, commentId: string): AudioComment {
  const row = db().prepare('SELECT * FROM audio_group_comments WHERE id = ?').get(String(commentId)) as AudioComment | undefined;
  if (!row) throw new AudioServiceError('코멘트를 찾을 수 없어.', 404);
  if (row.group_id !== groupId) throw new AudioServiceError('이 그룹의 코멘트가 아니야.', 404);
  return row;
}

export function createAudioGroupComment(groupId: string, input: { text?: unknown }, accountId: number | null): AudioComment {
  const group = getAudioGroup(groupId);
  const body = text(input.text, '코멘트', 4000);
  const id = newId();
  const at = now();
  db().prepare(`INSERT INTO audio_group_comments (id, group_id, text, status, revision, completion_note, author_account_id, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', 1, '', ?, ?, ?)`).run(id, group.id, body, accountId, at, at);
  return getComment(group.id, id);
}

/** Editing the text reopens the comment and bumps its revision, as in the original app. */
export function updateAudioGroupComment(groupId: string, commentId: string, input: { text?: unknown }): AudioComment {
  const body = text(input.text, '코멘트', 4000);
  return db().transaction(() => {
    const current = getComment(groupId, commentId);
    if (current.text !== body) {
      db().prepare(`UPDATE audio_group_comments SET text = ?, status = 'pending', revision = revision + 1, updated_at = ? WHERE id = ?`)
        .run(body, now(), current.id);
    }
    return getComment(groupId, commentId);
  }).immediate();
}

export function deleteAudioGroupComment(groupId: string, commentId: string): { deleted: true } {
  const current = getComment(groupId, commentId);
  db().prepare('DELETE FROM audio_group_comments WHERE id = ?').run(current.id);
  return { deleted: true };
}

/** Optimistic lock: a comment changed since the caller read it (revision differs) is not completed blindly. */
export function setAudioGroupCommentStatus(groupId: string, commentId: string, input: { status?: unknown; expected_revision?: unknown; completion_note?: unknown }): AudioComment {
  const status = String(input.status ?? '');
  if (!(AUDIO_COMMENT_STATES as readonly string[]).includes(status)) throw new AudioServiceError('코멘트 상태는 pending 또는 completed를 사용해 주세요.');
  const expected = Number(input.expected_revision);
  if (!Number.isInteger(expected)) throw new AudioServiceError('expected_revision이 필요해.');
  const note = text(input.completion_note, '완료 메모', 2000, false);
  return db().transaction(() => {
    const current = getComment(groupId, commentId);
    if (current.status === status) return current;
    if (current.revision !== expected) {
      throw new AudioServiceError('코멘트가 변경됐습니다. 최신 내용과 처리 상태를 다시 확인해 주세요.', 409);
    }
    const at = now();
    db().prepare(`
      UPDATE audio_group_comments SET status = ?, revision = revision + 1, updated_at = ?,
        completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
        completion_note = CASE WHEN ? = 'completed' THEN ? ELSE completion_note END
      WHERE id = ?
    `).run(status, at, status, at, status, note, current.id);
    return getComment(groupId, commentId);
  }).immediate();
}

/* ---------------------------------------------------------------- release helpers */

/** Rows of every candidate pointing at these blobs, captured before a cascade delete removes them. */
function snapshotCandidatesForRelease(hashes: string[]): Map<string, unknown[]> {
  const snapshot = new Map<string, unknown[]>();
  if (hashes.length === 0) return snapshot;
  const rows = db().prepare(`
    SELECT c.*, g.project_id AS project_id FROM audio_candidates c JOIN audio_groups g ON g.id = c.group_id
    WHERE c.file_hash IN (SELECT value FROM json_each(?))
  `).all(JSON.stringify(hashes)) as Array<Record<string, unknown> & { file_hash: string }>;
  for (const row of rows) {
    const list = snapshot.get(row.file_hash) ?? [];
    list.push(row);
    snapshot.set(row.file_hash, list);
  }
  return snapshot;
}
