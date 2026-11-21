import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  hasMiniMaxH3RefModExportNode,
  REFMOD_ENTRY_LIMITS,
  type MiniMaxH3RefModKind,
  type RefModAdoptResult,
  type RefModEntryBulkResult,
  type RefModEntryDetail,
  type RefModEntryFileRef,
  type RefModEntryMember,
  type RefModEntryPage,
  type RefModEntryRun,
  type RefModEntrySummary,
  type RefModPresence,
  type RefModUnregisteredRecord,
  type RefModWorkflowCandidate,
  type RefModWorkflowIssue,
  refModNameProblem,
  type RefModNameProblem,
} from '@conai/shared';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { resolveUploadsPath } from '../../config/runtimePaths';
import { ComfyUIServerModel, WorkflowServerModel } from '../../models/ComfyUIServer';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { MediaMetadataFileQueries } from '../../models/Image/MediaMetadataFileQueries';
import { MediaPostprocessVisibilityService } from '../mediaPostprocessVisibilityService';
import { WorkflowModel } from '../../models/Workflow';
import type { McpRequester } from '../../mcp/context';
import { isRequesterAdmin } from '../../middleware/featureAccess';
import type { MarkedField, WorkflowRecord } from '../../types/workflow';
import { enqueueGenerationJobs, QueueRoleLimitError } from '../generation-queue/queueEnqueue';
import { ComfyInputValidationError, getComfyMediaUploadInput, getMiniMaxDirectorActiveItems, validateComfyPromptData } from '../prepareComfyPromptData';
import { visibleWorkflowFields } from '../workflowHiddenFieldPolicy';
import {
  discardUnclaimedWorkflowInputAssetCopies,
  isWorkflowInputAssetRef,
  markWorkflowInputAssetForDeletion,
  storeWorkflowInputAssetCopy,
  WorkflowInputAssetError,
  type WorkflowInputAssetRef,
} from '../workflowInputAssetStore';
import { normalizeWorkflowNumericPromptValues } from '../workflowNumericFieldPolicy';
import { fetchMiniMaxH3RefModLibrary, MiniMaxH3RefModLibraryError } from './refmodLibrary';
import { createMiniMaxMediaItem, hasMeaningfulValue, isMissingRequiredWorkflowInput, type MiniMaxMediaInput } from './comfyWorkflowInputs';
import {
  deleteRefModRecord,
  publicRefModRecord,
  REFMOD_ENTRY_RUN_KEY,
  refModRecordRetainedPath,
  type RefModRecordRow,
  type StoredRefModMember,
} from './refmodRecords';
import {
  ensureRefModEntryFolder,
  isRefModEntryFileRef,
  RefModEntryError,
  refModEntryFileRef,
  releaseRefModFiles,
  releaseRefModFolder,
  resolveRefModEntryFile,
  storeRefModSource,
} from './refmodEntryFiles';
import { resolveRefModWorkflowRoles, type RefModWorkflowRoleResult } from './refmodWorkflowRoles';

export { RefModEntryError } from './refmodEntryFiles';

const DIRECTOR_META_KEY = '__conai_minimax_h3_director';
// Positive statuses so the (status, service_type, …) queue index is used.
const ACTIVE_JOB_SQL = `status IN ('queued', 'dispatching', 'running') AND service_type = 'comfyui' AND json_valid(request_payload)`;
const ENTRY_ID_SQL = `json_extract(request_payload, '$.${REFMOD_ENTRY_RUN_KEY}.entryId')`;

export type RefModEntryRow = {
  id: number; name: string; concept_type: string; description: string; keywords: string; workflow_id: number | null;
  director_value: string | null; extra_values: string; members: string; folder_id: string | null; favorite: number;
  revision: number; created_at: string; updated_at: string; last_built_at: string | null; last_record_id: number | null;
};

/** Who acts: the file-store writer key and whether library images may be read. */
export type RefModEntryActor = { owner: string; canViewImages: boolean };

const db = () => getUserSettingsDb();
const isRecord = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const iso = (value: string | null) => value === null ? null : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

// ---------------------------------------------------------------- input

export function refModEntryId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new RefModEntryError('잘못된 RefMod ID야.');
  return id;
}

const NAME_PROBLEMS: Record<RefModNameProblem, string> = {
  empty: 'RefMod 이름을 입력해줘.',
  characters: 'RefMod 이름에는 / \\ : < > " | ? * % 와 제어 문자를 쓸 수 없어. 파일 이름 하나만 써줘.',
  'leading-dot': 'RefMod 이름은 점(.)으로 시작할 수 없어.',
  trailing: 'RefMod 이름은 점(.)이나 공백으로 끝날 수 없어.',
  'edge-space': 'RefMod 이름 앞뒤에 공백을 둘 수 없어.',
  reserved: 'CON·NUL·COM1 같은 Windows 예약 이름은 RefMod 이름으로 쓸 수 없어.',
  'too-long': 'RefMod 이름은 200바이트(UTF-8, 한글은 66자 정도)까지야.',
};

/** The bundle file name under models/refmods (no extension): one plain file name DaSiWa accepts (refModNameProblem). */
export function normalizeRefModEntryName(value: unknown): string {
  if (typeof value !== 'string') throw new RefModEntryError(NAME_PROBLEMS.empty);
  const name = value.normalize('NFC').trim();
  if (name.length > REFMOD_ENTRY_LIMITS.name) throw new RefModEntryError(`RefMod 이름은 ${REFMOD_ENTRY_LIMITS.name}자까지야.`);
  const problem = refModNameProblem(name);
  if (problem) throw new RefModEntryError(NAME_PROBLEMS[problem], 400, { code: 'invalid_name', problem });
  return name;
}

/**
 * A name registration takes as the server or an old record reports it, a sub-folder path the person arranged on disk
 * included: only what could never be a stored name is refused. Such an entry shows the blocking name-not-plain issue.
 */
function normalizeRegisteredRefModName(value: unknown): string {
  if (typeof value !== 'string') throw new RefModEntryError(NAME_PROBLEMS.empty);
  const name = value.normalize('NFC').trim();
  if (!name) throw new RefModEntryError(NAME_PROBLEMS.empty);
  if (name.length > REFMOD_ENTRY_LIMITS.name) throw new RefModEntryError(`RefMod 이름은 ${REFMOD_ENTRY_LIMITS.name}자까지야.`);
  if (/[\\<>:"|?*\u0000-\u001f\u007f]/.test(name) || name.split('/').some((segment) => !segment.trim() || segment === '.' || segment === '..' || segment !== segment.trim())) {
    throw new RefModEntryError(NAME_PROBLEMS.characters);
  }
  return name;
}

const conceptSchema = z.string().trim().min(1).max(40);
const descriptionSchema = z.string().max(REFMOD_ENTRY_LIMITS.description);
const keywordsSchema = z.array(z.string().trim().min(1).max(REFMOD_ENTRY_LIMITS.keyword)).max(REFMOD_ENTRY_LIMITS.keywords)
  .transform((items) => [...new Map(items.map((item) => [item.toLowerCase(), item])).values()]);
const workflowIdSchema = z.number().int().positive().nullable();

const createSchema = z.object({
  name: z.unknown(),
  workflowId: workflowIdSchema.optional(),
  /** Copy another entry (its sources are copied, never shared). */
  duplicateOf: z.number().int().positive().optional(),
}).strict();

const patchSchema = z.object({
  revision: z.number().int().positive(),
  name: z.unknown().optional(),
  conceptType: conceptSchema.optional(),
  description: descriptionSchema.optional(),
  keywords: keywordsSchema.optional(),
  favorite: z.boolean().optional(),
  workflowId: workflowIdSchema.optional(),
  values: z.record(z.string(), z.unknown()).optional(),
}).strict();

function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new RefModEntryError(result.error.issues.map((entry) => `${entry.path.join('.') || 'body'}: ${entry.message}`).join('; '));
  return result.data;
}

// ---------------------------------------------------------------- workflows and roles

export type RefModWorkflowInfo = { workflow: WorkflowRecord; fields: MarkedField[]; roles: RefModWorkflowRoleResult };
type WorkflowInfo = RefModWorkflowInfo;

function parseMarkedFields(workflow: WorkflowRecord): MarkedField[] {
  try {
    const parsed = workflow.marked_fields ? JSON.parse(workflow.marked_fields) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function workflowInfo(workflow: WorkflowRecord): WorkflowInfo {
  const fields = parseMarkedFields(workflow);
  return { workflow, fields, roles: resolveRefModWorkflowRoles(workflow.workflow_json, fields) };
}

function makeWorkflowCache() {
  const cache = new Map<number, WorkflowInfo | null>();
  return (id: number | null): WorkflowInfo | null => {
    if (id === null) return null;
    if (!cache.has(id)) {
      const workflow = WorkflowModel.findById(id);
      cache.set(id, workflow && workflow.is_active ? workflowInfo(workflow) : null);
    }
    return cache.get(id)!;
  };
}

/** Active workflows with an export node, oldest first, each with its roles and issues. */
export function listRefModWorkflowCandidates(): RefModWorkflowCandidate[] {
  return WorkflowModel.findAll(true)
    .filter((workflow) => hasMiniMaxH3RefModExportNode(workflow.workflow_json))
    .sort((left, right) => left.id - right.id)
    .map((workflow) => {
      const { roles } = workflowInfo(workflow);
      return { id: workflow.id, name: workflow.name, roles: roles.roles, issues: roles.issues, buildable: roles.buildable };
    });
}

/** The target instance's default creation workflow: the first candidate without blocking issues. */
export function defaultRefModWorkflowId(): number | null {
  return listRefModWorkflowCandidates().find((candidate) => candidate.buildable)?.id ?? null;
}

function requireLinkableWorkflow(id: number): WorkflowInfo {
  const workflow = WorkflowModel.findById(id);
  if (!workflow || !workflow.is_active) throw new RefModEntryError('워크플로를 찾을 수 없어.', 404);
  const info = workflowInfo(workflow);
  if (!info.roles.linkable) {
    throw new RefModEntryError('RefMod 내보내기 노드가 하나인 워크플로만 연결할 수 있어.', 400, { code: 'workflow_not_linkable', issues: info.roles.issues });
  }
  return info;
}

const NO_WORKFLOW_ISSUES: RefModWorkflowIssue[] = [{ code: 'no-export-node', severity: 'blocking' }];

// ---------------------------------------------------------------- rows

function requireRow(id: number): RefModEntryRow {
  const row = db().prepare('SELECT * FROM refmod_entries WHERE id = ?').get(id) as RefModEntryRow | undefined;
  if (!row) throw new RefModEntryError('RefMod를 찾을 수 없어.', 404);
  return row;
}

function nameTaken(name: string, exceptId = 0): boolean {
  return Boolean(db().prepare('SELECT 1 FROM refmod_entries WHERE name = ? AND id != ?').get(name, exceptId));
}

function nameConflict(name: string) {
  return new RefModEntryError(`같은 이름의 RefMod가 있어: ${name}`, 409, { code: 'name_conflict' });
}

function isUniqueViolation(error: unknown) {
  return error instanceof Error && /UNIQUE constraint failed: refmod_entries\.name/.test(error.message);
}

/** Entries with a pending run: a pending record, or a queued or running build job that carries the entry. */
function pendingEntryIds(ids: number[]): Set<number> {
  if (!ids.length) return new Set();
  const list = JSON.stringify(ids);
  const rows = db().prepare(`
    SELECT entry_id AS id FROM minimax_refmod_records WHERE status = 'pending' AND entry_id IN (SELECT value FROM json_each(?))
    UNION
    SELECT CAST(${ENTRY_ID_SQL} AS INTEGER) AS id FROM generation_queue_jobs
    WHERE ${ACTIVE_JOB_SQL} AND ${ENTRY_ID_SQL} IN (SELECT value FROM json_each(?))`).all(list, list) as Array<{ id: number }>;
  return new Set(rows.map((row) => row.id));
}

function latestRecords(ids: number[]): Map<number, RefModRecordRow> {
  const result = new Map<number, RefModRecordRow>();
  if (!ids.length) return result;
  const rows = db().prepare(`SELECT r.* FROM minimax_refmod_records r
    JOIN (SELECT entry_id, MAX(id) AS id FROM minimax_refmod_records WHERE entry_id IN (SELECT value FROM json_each(?)) GROUP BY entry_id) latest
      ON latest.id = r.id`).all(JSON.stringify(ids)) as RefModRecordRow[];
  for (const row of rows) result.set(row.entry_id!, row);
  return result;
}

function runOf(row: RefModRecordRow): RefModEntryRun {
  const record = publicRefModRecord(row);
  return { id: record.id, status: record.status, error: record.error, serverId: record.server_id, name: record.name, createdAt: iso(record.created_at)! };
}

function summarize(rows: RefModEntryRow[]): RefModEntrySummary[] {
  const workflows = makeWorkflowCache();
  const ids = rows.map((row) => row.id);
  const pending = pendingEntryIds(ids);
  const latest = latestRecords(ids);
  return rows.map((row) => {
    const info = workflows(row.workflow_id);
    const readiness = entryReadiness(row, info);
    const last = latest.get(row.id);
    const run = last ? runOf(last) : null;
    return {
      id: row.id,
      name: row.name,
      conceptType: row.concept_type,
      description: row.description,
      keywords: parseJson<string[]>(row.keywords, []),
      members: parseJson<RefModEntryMember[]>(row.members, []),
      workflowId: info ? row.workflow_id : null,
      workflowName: info?.workflow.name ?? null,
      issues: readiness.issues,
      buildable: readiness.buildable,
      pending: pending.has(row.id),
      lastBuiltAt: iso(row.last_built_at),
      lastRecord: run ? { id: run.id, status: run.status, error: run.error, serverId: run.serverId, createdAt: run.createdAt } : null,
      favorite: row.favorite === 1,
      revision: row.revision,
      updatedAt: iso(row.updated_at)!,
    };
  });
}

// ---------------------------------------------------------------- list / detail

const SORTS: Record<string, string> = {
  name: 'name COLLATE NOCASE ASC, id ASC',
  updated: 'updated_at DESC, id DESC',
  created: 'created_at DESC, id DESC',
  built: 'last_built_at IS NULL, last_built_at DESC, id DESC',
};

const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

export function listRefModEntries(input: { query?: unknown; concept?: unknown; favorite?: boolean; sort?: unknown; limit?: unknown; offset?: unknown } = {}): RefModEntryPage {
  const sort = typeof input.sort === 'string' && SORTS[input.sort] ? SORTS[input.sort] : SORTS.updated;
  const limit = input.limit === undefined ? 50 : Number(input.limit);
  const offset = input.offset === undefined ? 0 : Number(input.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) throw new RefModEntryError('잘못된 목록 범위야.');
  const where: string[] = [];
  const params: unknown[] = [];
  const terms = typeof input.query === 'string' ? input.query.trim().split(/\s+/).filter(Boolean).slice(0, 12) : [];
  for (const term of terms) {
    const pattern = likePattern(term);
    where.push(`(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM json_each(refmod_entries.keywords) k WHERE k.value LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM json_each(refmod_entries.members) m WHERE json_extract(m.value, '$.description') LIKE ? ESCAPE '\\'))`);
    params.push(pattern, pattern, pattern, pattern);
  }
  if (typeof input.concept === 'string' && input.concept) { where.push('concept_type = ?'); params.push(input.concept); }
  if (input.favorite) where.push('favorite = 1');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db().prepare(`SELECT * FROM refmod_entries ${clause} ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...params, limit, offset) as RefModEntryRow[];
  const { total } = db().prepare(`SELECT COUNT(*) AS total FROM refmod_entries ${clause}`).get(...params) as { total: number };
  return { items: summarize(rows), total, hasMore: offset + rows.length < total };
}

/** promptData for the linked workflow: role fields from the entry's columns, the rest from its stored values or the field default. */
export function composeRefModEntryValues(row: RefModEntryRow, info: WorkflowInfo): Record<string, unknown> {
  const { roles } = info.roles;
  const extras = parseJson<Record<string, unknown>>(row.extra_values, {});
  const values: Record<string, unknown> = {};
  for (const field of visibleWorkflowFields(info.fields)) {
    if (field.id === roles.name) values[field.id] = row.name;
    else if (field.id === roles.description) values[field.id] = row.description;
    else if (field.id === roles.concept) values[field.id] = row.concept_type;
    else if (field.id === roles.director) values[field.id] = row.director_value !== null ? parseJson(row.director_value, field.default_value) : field.default_value;
    else values[field.id] = Object.prototype.hasOwnProperty.call(extras, field.id) ? extras[field.id] : field.default_value;
  }
  return values;
}

/**
 * The entry's issues and whether it can be built: the workflow's role issues, plus required visible inputs the entry
 * leaves empty (the run path's own rule, on the composed values). The Director is not part of it: missing sources are the
 * build's own check.
 */
function entryReadiness(row: RefModEntryRow, info: WorkflowInfo | null): { issues: RefModWorkflowIssue[]; buildable: boolean } {
  // A registered name DaSiWa would refuse (a sub-folder path, say): shown, but never built under that name.
  const name: RefModWorkflowIssue[] = refModNameProblem(row.name) ? [{ code: 'name-not-plain', severity: 'blocking' }] : [];
  if (!info) return { issues: [...NO_WORKFLOW_ISSUES, ...name], buildable: false };
  if (!info.roles.linkable) return { issues: [...info.roles.issues, ...name], buildable: false };
  const values = composeRefModEntryValues(row, info);
  const empty = visibleWorkflowFields(info.fields)
    .filter((field) => field.id !== info.roles.roles.director && isMissingRequiredWorkflowInput(field, values[field.id]));
  const inputs: RefModWorkflowIssue[] = empty.length
    ? [{ code: 'required-input-empty', severity: 'blocking', fields: empty.map((field) => ({ id: field.id, label: field.label || field.id })) }] : [];
  return { issues: [...info.roles.issues, ...name, ...inputs], buildable: info.roles.buildable && !name.length && !inputs.length };
}

/**
 * When an entry gets a creation workflow, it starts with the inputs the last one used: each visible input that is not a
 * role, an image or a node editor, has no stored value and no meaningful workflow default takes the stored value of the
 * most recently updated other entry on that workflow (a select's value only while it is one of its options). The values
 * are stored now, never filled in at read time. Revision and update time stay as they are.
 */
function storeCarriedInputs(id: number): void {
  const row = requireRow(id);
  const info = makeWorkflowCache()(row.workflow_id);
  if (!info || !info.roles.linkable) return;
  const roleIds = new Set(Object.values(info.roles.roles).filter((value): value is string => typeof value === 'string'));
  const extras = parseJson<Record<string, unknown>>(row.extra_values, {});
  const wanted = visibleWorkflowFields(info.fields).filter((field) => !roleIds.has(field.id) && field.type !== 'image' && field.type !== 'audio' && field.type !== 'video' && field.type !== 'node'
    && !Object.prototype.hasOwnProperty.call(extras, field.id) && !hasMeaningfulValue(field.default_value));
  if (!wanted.length) return;
  const others = (db().prepare('SELECT extra_values FROM refmod_entries WHERE workflow_id = ? AND id != ? ORDER BY updated_at DESC, id DESC LIMIT 200')
    .all(row.workflow_id, id) as Array<{ extra_values: string }>).map((other) => parseJson<Record<string, unknown>>(other.extra_values, {}));
  const carried: Record<string, unknown> = {};
  for (const field of wanted) {
    const options = field.type === 'select' && Array.isArray(field.options) && field.options.length ? field.options.map(String) : null;
    const source = others.find((other) => hasMeaningfulValue(other[field.id]) && (!options || options.includes(String(other[field.id]))));
    if (source) carried[field.id] = source[field.id];
  }
  if (Object.keys(carried).length) db().prepare('UPDATE refmod_entries SET extra_values = ? WHERE id = ?').run(JSON.stringify({ ...extras, ...carried }), id);
}

export function getRefModEntry(id: number): RefModEntryDetail {
  const row = requireRow(id);
  const [summary] = summarize([row]);
  const info = summary.workflowId !== null ? makeWorkflowCache()(row.workflow_id) : null;
  const records = (db().prepare('SELECT * FROM minimax_refmod_records WHERE entry_id = ? ORDER BY id DESC LIMIT 10').all(id) as RefModRecordRow[]).map(runOf);
  return {
    ...summary,
    form: info && info.roles.linkable ? {
      workflow: { id: info.workflow.id, name: info.workflow.name },
      fields: visibleWorkflowFields(info.fields) as unknown as Array<Record<string, unknown>>,
      values: composeRefModEntryValues(row, info),
      roles: info.roles.roles,
    } : null,
    records,
    createdAt: iso(row.created_at)!,
  };
}

// ---------------------------------------------------------------- Director sources

/** The active library file of a hash, only while the library itself would serve it (the record media route's visibility rule). */
function visibleLibraryFile(compositeHash: string) {
  const guard = MediaMetadataFileQueries.findVisibilityGuardByHash(compositeHash);
  if (!guard || !MediaPostprocessVisibilityService.isReadyRecord(guard)) return null;
  return ImageFileModel.findActiveByHash(compositeHash)[0] ?? null;
}

type ParsedDirector = { value: Record<string, any>; items: Array<Record<string, any>>; assets: Record<string, any> };

function timelineOf(value: Record<string, any>): Record<string, any> {
  const raw = value.timeline_data;
  if (isRecord(raw)) return raw;
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return {};
  if (typeof raw !== 'string') throw new RefModEntryError('Director timeline_data는 객체여야 해.');
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new RefModEntryError('Director timeline_data가 올바른 JSON이 아니야.');
  }
}

function parseDirector(value: Record<string, any>): ParsedDirector {
  const timeline = timelineOf(value);
  const items = Array.isArray(timeline.items) ? (timeline.items as unknown[]).filter(isRecord) : [];
  const meta = isRecord(value[DIRECTOR_META_KEY]) ? value[DIRECTOR_META_KEY] : {};
  return { value, items, assets: isRecord(meta.assets) ? meta.assets : {} };
}

function activeItems(director: ParsedDirector) {
  return getMiniMaxDirectorActiveItems(director.value.mode ?? 'REF2VA', timelineOf(director.value)) as Array<Record<string, any>>;
}

const KINDS = new Set(['image', 'video', 'audio']);
const numberOrNull = (value: unknown) => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

function deriveMembers(director: ParsedDirector, assets: Record<string, unknown>): RefModEntryMember[] {
  return activeItems(director).filter((item) => KINDS.has(item.type)).map((item, index) => {
    const asset = assets[String(item.id ?? '')];
    const ref = isRefModEntryFileRef(asset) ? asset : null;
    return {
      index, kind: item.type as MiniMaxH3RefModKind, description: typeof item.prompt === 'string' ? item.prompt : '',
      fileId: ref?.id ?? null, fileName: ref?.fileName ?? (typeof item.file_name === 'string' ? item.file_name : null), mimeType: ref?.mimeType ?? null,
      mediaMode: ['video', 'audio', 'video_audio'].includes(item.media_mode) ? item.media_mode : null,
      trimStart: numberOrNull(item.trim_start), trimEnd: numberOrNull(item.trim_end),
      sourceWidth: numberOrNull(item.source_width), sourceHeight: numberOrNull(item.source_height),
      sourceDuration: numberOrNull(item.source_duration ?? item.duration),
    };
  });
}

type NormalizedDirector = {
  value: Record<string, any> | null;
  members: RefModEntryMember[];
  fileIds: Set<string>;
  /** Files this normalisation stored (deleted again if the save does not commit). */
  created: string[];
  /** Workflow input assets the entry took over (marked for deletion after commit). */
  consumed: string[];
};

/**
 * Every item's asset becomes an entry-file ref: one of this entry's own files stays (anything else is refused);
 * a workflow input asset, a library image or a data URL is copied into the entry's folder. Assets of no item are dropped.
 */
async function normalizeDirectorSources(entry: { id: number; name: string; folder_id: string | null }, raw: unknown, actor: RefModEntryActor, folder: { id: string | null }): Promise<NormalizedDirector> {
  if (!isRecord(raw)) throw new RefModEntryError('Director 값은 객체여야 해.');
  const director = parseDirector(raw);
  const result: NormalizedDirector = { value: raw, members: [], fileIds: new Set(), created: [], consumed: [] };
  const nextAssets: Record<string, unknown> = {};
  try {
    for (const item of director.items) {
      const key = String(item.id ?? '');
      const asset = key ? director.assets[key] : undefined;
      if (asset === undefined || asset === null) continue;
      if (isRefModEntryFileRef(asset)) {
        const owned = Number(asset.entryId) === entry.id ? resolveRefModEntryFile(entry.id, asset.id) : null;
        if (!owned) throw new RefModEntryError(`다른 RefMod의 파일이나 알 수 없는 파일은 쓸 수 없어: ${asset.id}`, 400, { code: 'foreign_file' });
        nextAssets[key] = {
          __ref: asset.__ref, entryId: entry.id, id: asset.id, mimeType: owned.mimeType, bytes: owned.entry.size,
          fileName: typeof asset.fileName === 'string' && asset.fileName ? asset.fileName : owned.entry.name,
        } satisfies RefModEntryFileRef;
        result.fileIds.add(asset.id);
        continue;
      }
      if (!KINDS.has(item.type)) throw new RefModEntryError(`지원하지 않는 RefMod 소스 종류야: ${String(item.type)}`);
      if (!isRecord(asset) || !(isWorkflowInputAssetRef(asset) || typeof asset.composite_hash === 'string' || typeof asset.dataUrl === 'string')) {
        throw new RefModEntryError(`RefMod 소스 ${key}는 업로드한 파일, 라이브러리 이미지 해시나 data URL이어야 해.`);
      }
      const payload = asset as Record<string, any>;
      let source: ReturnType<typeof getComfyMediaUploadInput>;
      let mimeType: unknown;
      if (typeof payload.composite_hash === 'string' && payload.composite_hash) {
        if (!actor.canViewImages) throw new RefModEntryError('라이브러리 이미지를 쓰려면 images.view 권한이 필요해.', 403);
        const libraryFile = visibleLibraryFile(payload.composite_hash);
        if (!libraryFile) throw new RefModEntryError('라이브러리에서 이미지를 찾을 수 없어.', 404);
        source = { filePath: resolveUploadsPath(libraryFile.original_file_path), fileName: path.basename(libraryFile.original_file_path) };
        // The library's MIME, never the one the payload claims.
        mimeType = libraryFile.mime_type;
      } else {
        try { source = getComfyMediaUploadInput(asset); }
        catch (error) { throw new RefModEntryError(error instanceof Error ? error.message : 'RefMod 소스를 읽지 못했어.'); }
        mimeType = source?.mimeType;
      }
      if (!source || (!source.filePath && !source.buffer)) throw new RefModEntryError(`RefMod 소스 ${key}에 파일이 없어. 다시 첨부해줘.`);
      folder.id ??= ensureRefModEntryFolder(actor.owner, entry.name, entry.folder_id);
      const stored = await storeRefModSource(actor.owner, folder.id, source, {
        kind: item.type, mimeType, fileName: typeof payload.fileName === 'string' && payload.fileName ? payload.fileName : typeof item.file_name === 'string' ? item.file_name : source.fileName ?? null,
      });
      result.created.push(stored.fileId);
      result.fileIds.add(stored.fileId);
      if (isWorkflowInputAssetRef(asset)) result.consumed.push(asset.id);
      nextAssets[key] = refModEntryFileRef(entry.id, stored);
    }
  } catch (error) {
    releaseRefModFiles(actor.owner, result.created);
    throw error;
  }
  const meta = isRecord(raw[DIRECTOR_META_KEY]) ? raw[DIRECTOR_META_KEY] : {};
  result.value = { ...raw, [DIRECTOR_META_KEY]: { ...meta, assets: nextAssets } };
  result.members = deriveMembers(director, nextAssets);
  return result;
}

/** Replace an entry's file set inside the caller's transaction; returns the files it no longer uses. */
function replaceEntryFiles(entryId: number, fileIds: Set<string>): string[] {
  const current = (db().prepare('SELECT file_id FROM refmod_entry_files WHERE entry_id = ?').all(entryId) as Array<{ file_id: string }>).map((row) => row.file_id);
  const removed = current.filter((id) => !fileIds.has(id));
  const remove = db().prepare('DELETE FROM refmod_entry_files WHERE entry_id = ? AND file_id = ?');
  for (const id of removed) remove.run(entryId, id);
  const insert = db().prepare('INSERT OR IGNORE INTO refmod_entry_files (entry_id, file_id) VALUES (?, ?)');
  for (const id of fileIds) insert.run(entryId, id);
  return removed;
}

function afterSourcesCommitted(actor: Pick<RefModEntryActor, 'owner'>, consumed: string[], removed: string[]) {
  for (const assetId of consumed) {
    try { markWorkflowInputAssetForDeletion(assetId); } catch (error) { console.warn('[RefMod] Could not mark a consumed input asset:', error); }
  }
  releaseRefModFiles(actor.owner, removed);
}

// ---------------------------------------------------------------- create / patch / delete

/** Form values split into the entry's columns (roles) and its other values (by field id). Hidden fields are ignored. */
function decomposeValues(values: Record<string, unknown>, info: WorkflowInfo | null) {
  if (!info) throw new RefModEntryError('워크플로를 연결한 다음 필드 값을 저장해줘.');
  const { roles } = info.roles;
  const visible = new Set(visibleWorkflowFields(info.fields).map((field) => field.id));
  const known = new Set(info.fields.map((field) => field.id));
  const result: { name?: unknown; description?: unknown; conceptType?: unknown; director?: unknown; extras: Record<string, unknown> } = { extras: {} };
  for (const [id, value] of Object.entries(values)) {
    if (!visible.has(id)) {
      if (known.has(id)) continue;
      throw new RefModEntryError(`이 워크플로에 없는 필드야: ${id}`);
    }
    if (id === roles.name) result.name = value;
    else if (id === roles.description) result.description = value;
    else if (id === roles.concept) result.conceptType = value;
    else if (id === roles.director) result.director = value;
    else result.extras[id] = value;
  }
  return result;
}

export async function createRefModEntry(input: unknown, actor: RefModEntryActor): Promise<RefModEntryDetail> {
  const value = parseInput(createSchema, input);
  const name = normalizeRefModEntryName(value.name);
  if (nameTaken(name)) throw nameConflict(name);
  const source = value.duplicateOf !== undefined ? requireRow(value.duplicateOf) : null;
  const workflowId = value.workflowId !== undefined
    ? (value.workflowId === null ? null : requireLinkableWorkflow(value.workflowId).workflow.id)
    : source ? source.workflow_id : defaultRefModWorkflowId();
  let id: number;
  try {
    id = Number(db().prepare(`INSERT INTO refmod_entries (name, workflow_id, concept_type, description, keywords, extra_values, members)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(name, workflowId, source?.concept_type ?? 'generic', source?.description ?? '', source?.keywords ?? '[]',
      source?.extra_values ?? '{}', source && source.director_value === null ? source.members : '[]').lastInsertRowid);
  } catch (error) {
    if (isUniqueViolation(error)) throw nameConflict(name);
    throw error;
  }
  if (source?.director_value) {
    try {
      await copyDirectorFrom(source, requireRow(id), actor);
    } catch (error) {
      deleteEntryRows(id);
      throw error;
    }
  }
  storeCarriedInputs(id);
  return getRefModEntry(id);
}

/** Give a new entry copies of another entry's sources (an entry never shares a file with another). */
async function copyDirectorFrom(source: RefModEntryRow, target: RefModEntryRow, actor: RefModEntryActor) {
  const director = parseJson<Record<string, any> | null>(source.director_value, null);
  if (!isRecord(director)) return;
  const parsed = parseDirector(director);
  const folder: { id: string | null } = { id: null };
  const assets: Record<string, unknown> = {};
  const created: string[] = [];
  try {
    for (const item of parsed.items) {
      const key = String(item.id ?? '');
      const asset = parsed.assets[key];
      if (!isRefModEntryFileRef(asset)) continue;
      const file = resolveRefModEntryFile(source.id, asset.id);
      if (!file) continue;
      folder.id ??= ensureRefModEntryFolder(actor.owner, target.name, target.folder_id);
      const stored = await storeRefModSource(actor.owner, folder.id, { filePath: file.filePath }, { kind: file.kind, mimeType: file.mimeType, fileName: asset.fileName });
      created.push(stored.fileId);
      assets[key] = refModEntryFileRef(target.id, stored);
    }
    const meta = isRecord(director[DIRECTOR_META_KEY]) ? director[DIRECTOR_META_KEY] : {};
    const value = { ...director, [DIRECTOR_META_KEY]: { ...meta, assets } };
    db().transaction(() => {
      replaceEntryFiles(target.id, new Set(created));
      db().prepare('UPDATE refmod_entries SET director_value = ?, members = ?, folder_id = COALESCE(?, folder_id) WHERE id = ?')
        .run(JSON.stringify(value), JSON.stringify(deriveMembers(parsed, assets)), folder.id, target.id);
    }).immediate();
  } catch (error) {
    db().prepare('DELETE FROM refmod_entry_files WHERE entry_id = ?').run(target.id);
    releaseRefModFiles(actor.owner, created);
    throw error;
  }
}

function revisionConflict(current: number) {
  return new RefModEntryError('다른 곳에서 먼저 바뀌었어. 다시 불러와줘.', 409, { code: 'revision_conflict', revision: current });
}

export async function patchRefModEntry(id: number, input: unknown, actor: RefModEntryActor): Promise<RefModEntryDetail> {
  const patch = parseInput(patchSchema, input);
  const row = requireRow(id);
  if (patch.revision !== row.revision) throw revisionConflict(row.revision);
  const workflowId = patch.workflowId !== undefined ? patch.workflowId : row.workflow_id;
  const info = workflowId === null ? null
    : patch.workflowId !== undefined ? requireLinkableWorkflow(workflowId) : makeWorkflowCache()(workflowId);
  const decomposed = patch.values ? decomposeValues(patch.values, info) : { extras: {} as Record<string, unknown> } as ReturnType<typeof decomposeValues>;
  const requestedName = patch.name !== undefined ? patch.name : decomposed.name;
  // The stored name passes as it is (a registered sub-folder name stays editable otherwise); a new one must be plain.
  const name = requestedName === undefined || (typeof requestedName === 'string' && requestedName.normalize('NFC').trim() === row.name)
    ? row.name : normalizeRefModEntryName(requestedName);
  const conceptType = patch.conceptType ?? (decomposed.conceptType !== undefined ? parseInput(conceptSchema, decomposed.conceptType) : row.concept_type);
  const description = patch.description ?? (decomposed.description !== undefined ? parseInput(descriptionSchema, decomposed.description ?? '') : row.description);
  if (name !== row.name && nameTaken(name, id)) throw nameConflict(name);
  const extras = patch.values ? { ...parseJson<Record<string, unknown>>(row.extra_values, {}), ...decomposed.extras } : null;
  const folder: { id: string | null } = { id: null };
  const normalized: NormalizedDirector | null = decomposed.director === undefined ? null
    : decomposed.director === null ? { value: null, members: [], fileIds: new Set<string>(), created: [], consumed: [] }
      : await normalizeDirectorSources(row, decomposed.director, actor, folder);
  let removed: string[] = [];
  try {
    db().transaction(() => {
      const current = requireRow(id);
      if (current.revision !== row.revision) throw revisionConflict(current.revision);
      if (name !== current.name && nameTaken(name, id)) throw nameConflict(name);
      if (normalized) removed = replaceEntryFiles(id, normalized.fileIds);
      db().prepare(`UPDATE refmod_entries SET name = ?, concept_type = ?, description = ?, keywords = COALESCE(?, keywords), favorite = COALESCE(?, favorite),
        workflow_id = ?, extra_values = COALESCE(?, extra_values), director_value = CASE WHEN ? THEN ? ELSE director_value END,
        members = COALESCE(?, members), folder_id = COALESCE(?, folder_id), revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
        name, conceptType, description, patch.keywords ? JSON.stringify(patch.keywords) : null,
        patch.favorite === undefined ? null : patch.favorite ? 1 : 0, workflowId, extras ? JSON.stringify(extras) : null,
        normalized ? 1 : 0, normalized?.value ? JSON.stringify(normalized.value) : null,
        normalized ? JSON.stringify(normalized.members) : null, folder.id, id);
    }).immediate();
  } catch (error) {
    if (normalized) releaseRefModFiles(actor.owner, normalized.created);
    if (isUniqueViolation(error)) throw nameConflict(name);
    throw error;
  }
  afterSourcesCommitted(actor, normalized?.consumed ?? [], removed);
  if (workflowId !== null && workflowId !== row.workflow_id) storeCarriedInputs(id);
  return getRefModEntry(id);
}

function deleteEntryRows(id: number, options: { requireIdle?: boolean } = {}): { fileIds: string[]; folderId: string | null } {
  return db().transaction(() => {
    // Under the write lock: a build queued while the linked records were being deleted keeps the entry.
    if (options.requireIdle && pendingEntryIds([id]).has(id)) throw deletePendingError();
    const row = db().prepare('SELECT folder_id FROM refmod_entries WHERE id = ?').get(id) as { folder_id: string | null } | undefined;
    const fileIds = (db().prepare('SELECT file_id FROM refmod_entry_files WHERE entry_id = ?').all(id) as Array<{ file_id: string }>).map((entry) => entry.file_id);
    db().prepare('UPDATE minimax_refmod_records SET entry_id = NULL WHERE entry_id = ?').run(id);
    db().prepare('DELETE FROM refmod_entry_files WHERE entry_id = ?').run(id);
    db().prepare('DELETE FROM refmod_entries WHERE id = ?').run(id);
    return { fileIds, folderId: row?.folder_id ?? null };
  }).immediate();
}

/**
 * The entry, its reference rows, its own file-store copies and every run record linked to it (through the record
 * deletion, so each retained folder goes too; none can be pending, the pending check refuses first). The ComfyUI
 * bundle is untouched.
 */
const deletePendingError = () => new RefModEntryError('만드는 중인 RefMod는 지울 수 없어. 끝나거나 취소한 다음 지워줘.', 409, { code: 'pending' });

export async function deleteRefModEntry(id: number, actor: Pick<RefModEntryActor, 'owner'>, revision?: number): Promise<void> {
  const row = requireRow(id);
  if (revision !== undefined && revision !== row.revision) throw revisionConflict(row.revision);
  if (pendingEntryIds([id]).has(id)) throw deletePendingError();
  const recordIds = (db().prepare('SELECT id FROM minimax_refmod_records WHERE entry_id = ?').all(id) as Array<{ id: number }>).map((record) => record.id);
  for (const recordId of recordIds) {
    try {
      await deleteRefModRecord(recordId);
    } catch (error) {
      // A record that turned pending meanwhile (a build queued after the check above).
      if (error instanceof ComfyInputValidationError) throw deletePendingError();
      throw error;
    }
  }
  const { fileIds, folderId } = deleteEntryRows(id, { requireIdle: true });
  releaseRefModFiles(actor.owner, fileIds);
  releaseRefModFolder(actor.owner, folderId);
}

const bulkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
  action: z.enum(['favorite', 'delete']),
  favorite: z.boolean().optional(),
}).strict();

export async function bulkRefModEntries(input: unknown, actor: Pick<RefModEntryActor, 'owner'>): Promise<RefModEntryBulkResult> {
  const value = parseInput(bulkSchema, input);
  const ids = [...new Set(value.ids)];
  if (value.action === 'favorite') {
    if (value.favorite === undefined) throw new RefModEntryError('favorite 값을 보내줘.');
    const update = db().prepare('UPDATE refmod_entries SET favorite = ? WHERE id = ?');
    const updated = db().transaction(() => ids.reduce((count, id) => count + update.run(value.favorite ? 1 : 0, id).changes, 0))();
    return { updated, deleted: 0 };
  }
  const pending = pendingEntryIds(ids);
  let deleted = 0;
  for (const id of ids) {
    if (pending.has(id) || !db().prepare('SELECT 1 FROM refmod_entries WHERE id = ?').get(id)) continue;
    try {
      await deleteRefModEntry(id, actor);
    } catch (error) {
      // Became pending after the snapshot above: skipped like the ones that already were.
      if (error instanceof RefModEntryError && error.extra.code === 'pending') continue;
      throw error;
    }
    deleted += 1;
  }
  return { updated: 0, deleted };
}

// ---------------------------------------------------------------- build

/**
 * Queue one build on the default ComfyUI server. Entry files become workflow-input-asset copies (already marked for
 * delayed deletion) before validation and enqueueing, so the entry-file reference never enters the run pipeline; the
 * job carries the entry id and the item → file map, which record capture verifies.
 */
/** The refusal a person reads (the build key's toast after a save, MCP): the inputs to fill and a name to change. */
function blockedMessage(issues: RefModWorkflowIssue[]): string {
  const reasons: string[] = [];
  if (issues.some((issue) => issue.code === 'name-not-plain')) reasons.push('이름이 파일 이름 하나가 아니야. 이름을 바꿔줘.');
  const empty = issues.find((issue) => issue.code === 'required-input-empty')?.fields ?? [];
  if (empty.length) reasons.push(`${empty.map((field) => `‘${field.label}’`).join(', ')} 입력을 채워줘.`);
  return reasons.length ? `이 RefMod는 아직 만들 수 없어: ${reasons.join(' ')}` : '이 RefMod는 아직 만들 수 없어.';
}

export async function buildRefModEntry(id: number, requester: McpRequester): Promise<{ jobId: number; serverId: number }> {
  const row = requireRow(id);
  const info = makeWorkflowCache()(row.workflow_id);
  const readiness = entryReadiness(row, info);
  if (!info || !readiness.buildable) {
    throw new RefModEntryError(blockedMessage(readiness.issues), 409, { code: 'blocked', issues: readiness.issues });
  }
  const server = ComfyUIServerModel.findDefaultActive();
  if (!server) throw new RefModEntryError('대표 ComfyUI 서버를 정해줘.', 409, { code: 'no_default_server' });
  // A pinned job only runs on a workflow-eligible server; one it can never reach would wait forever.
  if (WorkflowServerModel.findServersByWorkflow(info.workflow.id, false).length > 0
    && !WorkflowServerModel.findServersByWorkflow(info.workflow.id, true).some((linked) => Number(linked.server_id ?? linked.id) === server.id)) {
    throw new RefModEntryError(`대표 ComfyUI 서버(${server.name})가 이 워크플로에 연결돼 있지 않아.`, 409, { code: 'server_not_linked' });
  }
  const pendingError = () => new RefModEntryError('이미 만드는 중이야.', 409, { code: 'pending' });
  if (pendingEntryIds([id]).has(id)) throw pendingError();
  // DaSiWa never overwrites a bundle: a name already on the default server always fails there. A server that cannot be
  // asked does not block; the run's own failure comes back on its record.
  const presence = await getRefModPresence();
  if (presence.status === 'ok') {
    const lower = row.name.toLowerCase();
    if (presence.entries.some((entry) => entry.name === row.name) || presence.entries.some((entry) => entry.name.toLowerCase() === lower)) {
      throw new RefModEntryError('대표 서버에 같은 이름의 RefMod가 이미 있어. ComfyUI는 덮어쓰지 않아 — 이름을 바꾸거나 서버에서 그 파일을 지운 다음 만들어줘.', 409, { code: 'exists_on_server' });
    }
  }

  const values = composeRefModEntryValues(row, info);
  const directorFieldId = info.roles.roles.director!;
  const director = isRecord(values[directorFieldId]) ? values[directorFieldId] as Record<string, any> : null;
  const parsed = director ? parseDirector(director) : null;
  const items = parsed ? activeItems(parsed) : [];
  if (!director || !parsed || !items.length) throw new RefModEntryError('RefMod 소스를 하나 이상 넣어줘.', 400, { code: 'no_sources' });
  const copies: WorkflowInputAssetRef[] = [];
  const files: Record<string, string> = {};
  try {
    const assets: Record<string, unknown> = {};
    for (const [index, item] of items.entries()) {
      const key = String(item.id ?? '');
      const asset = parsed.assets[key];
      const file = isRefModEntryFileRef(asset) && Number(asset.entryId) === id ? resolveRefModEntryFile(id, asset.id) : null;
      if (!file || !KINDS.has(item.type)) {
        const label = typeof item.prompt === 'string' && item.prompt.trim() ? item.prompt.trim().slice(0, 40) : String(index + 1);
        throw new RefModEntryError(`소스 파일이 없는 항목이 있어: ${label}`, 400, { code: 'missing_source' });
      }
      const copy = await storeWorkflowInputAssetCopy(file.filePath, { fileName: asset.fileName || file.entry.name, mimeType: file.mimeType });
      copies.push(copy);
      assets[key] = copy;
      files[key] = asset.id;
    }
    const meta = isRecord(director[DIRECTOR_META_KEY]) ? director[DIRECTOR_META_KEY] : {};
    values[directorFieldId] = { ...director, [DIRECTOR_META_KEY]: { ...meta, assets } };
    const promptData = normalizeWorkflowNumericPromptValues(info.fields, values);
    try {
      if (validateComfyPromptData(info.fields, promptData)) throw new RefModEntryError('라이브러리 이미지를 직접 쓰는 값이 있어. 저장한 다음 다시 만들어줘.');
    } catch (error) {
      if (error instanceof ComfyInputValidationError) throw new RefModEntryError(error.message);
      throw error;
    }
    const created = enqueueGenerationJobs({
      service_type: 'comfyui',
      workflow_id: info.workflow.id,
      workflow_name: info.workflow.name,
      requested_server_id: server.id,
      requested_by_account_id: requester.accountId,
      requested_by_account_type: requester.accountType ?? null,
      request_payload: { prompt_data: promptData },
      request_summary: `RefMod: ${row.name}`,
    }, {
      // The only first-hand source of the link: enqueueGenerationJobs writes the key and refuses it in a payload.
      refmodEntryLink: { entryId: id, files },
      roleLimitWorkflow: isRequesterAdmin(requester) ? null : info.workflow,
      // Under the same write lock as the new row, so two builds cannot both pass the pending check.
      withinTransaction: (result) => {
        const other = db().prepare(`SELECT 1 FROM generation_queue_jobs WHERE ${ACTIVE_JOB_SQL}
          AND id NOT IN (SELECT value FROM json_each(?)) AND ${ENTRY_ID_SQL} = ? LIMIT 1`).get(JSON.stringify(result.jobIds), id);
        if (other || db().prepare("SELECT 1 FROM minimax_refmod_records WHERE entry_id = ? AND status = 'pending'").get(id)) throw pendingError();
      },
    });
    return { jobId: created.jobIds[0], serverId: server.id };
  } catch (error) {
    try { discardUnclaimedWorkflowInputAssetCopies(copies); } catch (cleanupError) { console.warn('[RefMod] Build input cleanup is left to pruning:', cleanupError); }
    if (error instanceof QueueRoleLimitError) throw new RefModEntryError(error.message, 429, { code: 'queue_limit' });
    if (error instanceof WorkflowInputAssetError) throw new RefModEntryError(error.message);
    throw error;
  }
}

// ---------------------------------------------------------------- unregistered, presence, adoption

const UNREGISTERED_SQL = `SELECT r.* FROM minimax_refmod_records r
  WHERE r.status = 'saved' AND r.entry_id IS NULL AND r.name IS NOT NULL
    AND r.id = (SELECT MAX(r2.id) FROM minimax_refmod_records r2 WHERE r2.status = 'saved' AND r2.entry_id IS NULL AND r2.name = r.name)
    AND NOT EXISTS (SELECT 1 FROM refmod_entries e WHERE e.name = r.name COLLATE NOCASE)`;

export function listUnregisteredRefModRecords(): RefModUnregisteredRecord[] {
  return (db().prepare(`${UNREGISTERED_SQL} ORDER BY r.id DESC LIMIT 500`).all() as RefModRecordRow[]).map((row) => {
    const record = publicRefModRecord(row);
    return { recordId: record.id, name: record.name!, conceptType: record.concept_type, description: record.description, members: record.members, createdAt: iso(record.created_at)! };
  });
}

/** The default active server's library, read live (never cached in the DB). */
export async function getRefModPresence(): Promise<RefModPresence> {
  const server = ComfyUIServerModel.findDefaultActive();
  if (!server) return { status: 'no-server', message: '대표 ComfyUI 서버를 정해줘.' };
  try {
    return { status: 'ok', serverId: server.id, serverName: server.name, entries: await fetchMiniMaxH3RefModLibrary(server) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: error instanceof MiniMaxH3RefModLibraryError && error.statusCode === 404 ? 'unavailable' : 'error', message };
  }
}

/** Every entry name (for matching the server library and unregistered records). */
export function listRefModEntryNames(): string[] {
  return (db().prepare('SELECT name FROM refmod_entries ORDER BY name COLLATE NOCASE').all() as Array<{ name: string }>).map((row) => row.name);
}

function findEntryByName(name: string): { id: number } | undefined {
  return db().prepare('SELECT id FROM refmod_entries WHERE name = ?').get(name) as { id: number } | undefined;
}

function linkRecord(recordId: number, entryId: number) {
  return db().prepare('UPDATE minimax_refmod_records SET entry_id = ? WHERE id = ? AND entry_id IS NULL').run(entryId, recordId).changes > 0;
}

/** A record member's own source: its retained copy, its library image, or the file of the entry it was built from. */
function recordMemberSource(row: RefModRecordRow, member: StoredRefModMember): string | null {
  if (member.retained_file) return refModRecordRetainedPath(row.id, member.retained_file);
  if (member.composite_hash) {
    const libraryFile = visibleLibraryFile(member.composite_hash);
    return libraryFile ? resolveUploadsPath(libraryFile.original_file_path) : null;
  }
  return row.entry_id !== null && member.file_id ? resolveRefModEntryFile(row.entry_id, member.file_id)?.filePath ?? null : null;
}

/** A Director value for a record made before records kept theirs: one REF2VA item per member. */
function synthesizeDirector(members: StoredRefModMember[], info: WorkflowInfo | null): Record<string, any> {
  const field = info?.roles.roles.director ? info.fields.find((entry) => entry.id === info.roles.roles.director) : undefined;
  const base: Record<string, any> = isRecord(field?.default_value) ? field!.default_value as Record<string, any> : { mode: 'REF2VA' };
  // The same constructor the friendly ComfyUI input normaliser uses, so the item shape is what the editor reads
  // (id, type and a string value; an item without them is dropped by the editor and its file removed on the next save).
  const items = members.map((member, index) => {
    const item = createMiniMaxMediaItem({
      id: `m${member.index}`,
      type: member.kind as MiniMaxMediaInput['type'],
      order: member.index,
      prompt: member.description ?? undefined,
      file_name: member.file_name ?? undefined,
      trim_start: member.trim_start ?? undefined,
      trim_end: member.trim_end ?? undefined,
      source_width: member.source_width ?? undefined,
      source_height: member.source_height ?? undefined,
      source_duration: member.source_duration ?? undefined,
    }, index);
    if (member.media_mode) item.media_mode = member.media_mode;
    return item;
  });
  const timeline = parseJson<Record<string, any>>(typeof base.timeline_data === 'string' && base.timeline_data.trim() ? base.timeline_data : '{}', {});
  return { ...base, mode: 'REF2VA', timeline_data: JSON.stringify({ ...timeline, items }) };
}

/**
 * A new entry from a saved record: its sources are COPIED into the file store (the record and its folder stay) and the
 * record is linked. When an entry already has that name the record is only linked to it.
 */
async function adoptRecord(row: RefModRecordRow, actor: RefModEntryActor): Promise<{ id: number; created: boolean } | null> {
  const name = row.name ? row.name.trim() : '';
  if (!name) return null;
  const existing = findEntryByName(name);
  if (existing) { linkRecord(row.id, existing.id); return { id: existing.id, created: false }; }
  let validName: string;
  try { validName = normalizeRegisteredRefModName(name); } catch { return null; }
  const workflows = makeWorkflowCache();
  const recordWorkflow = workflows(row.workflow_id);
  const workflowId = recordWorkflow?.roles.linkable ? recordWorkflow.workflow.id : defaultRefModWorkflowId();
  const info = workflows(workflowId);
  let id: number;
  try {
    id = Number(db().prepare(`INSERT INTO refmod_entries (name, workflow_id, concept_type, description, last_built_at, last_record_id)
      VALUES (?, ?, ?, ?, ?, ?)`).run(validName, workflowId, row.concept_type || 'generic', row.description ?? '', row.created_at, row.id).lastInsertRowid);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = findEntryByName(validName);
    if (winner) linkRecord(row.id, winner.id);
    return winner ? { id: winner.id, created: false } : null;
  }
  const created: string[] = [];
  try {
    const members = parseJson<StoredRefModMember[]>(row.members_json, []);
    const stored = parseJson<Record<string, any> | null>(row.director_value, null);
    const usable = isRecord(stored) && members.every((member) => member.item_id);
    const director = usable ? stored! : synthesizeDirector(members, info);
    const meta = isRecord(director[DIRECTOR_META_KEY]) ? director[DIRECTOR_META_KEY] : {};
    const assets: Record<string, unknown> = {};
    const folder: { id: string | null } = { id: null };
    for (const member of members) {
      const key = usable ? member.item_id! : `m${member.index}`;
      const filePath = recordMemberSource(row, member);
      if (!filePath || !fs.existsSync(filePath)) continue;
      folder.id ??= ensureRefModEntryFolder(actor.owner, validName, null);
      const file = await storeRefModSource(actor.owner, folder.id, { filePath }, { kind: member.kind, mimeType: member.mime_type, fileName: member.file_name });
      created.push(file.fileId);
      assets[key] = refModEntryFileRef(id, file);
    }
    const value = { ...director, [DIRECTOR_META_KEY]: { ...meta, assets } };
    db().transaction(() => {
      replaceEntryFiles(id, new Set(created));
      db().prepare('UPDATE refmod_entries SET director_value = ?, members = ?, folder_id = ? WHERE id = ?')
        .run(JSON.stringify(value), JSON.stringify(deriveMembers(parseDirector(value), assets)), folder.id, id);
      linkRecord(row.id, id);
    }).immediate();
    storeCarriedInputs(id);
    return { id, created: true };
  } catch (error) {
    deleteEntryRows(id);
    releaseRefModFiles(actor.owner, created);
    throw error;
  }
}

/** A plain (entry-less) run saved its bundle: register it as an entry, or link it when an entry has that name. */
export async function adoptCompletedRefModRecord(recordId: number): Promise<void> {
  const row = db().prepare("SELECT * FROM minimax_refmod_records WHERE id = ? AND status = 'saved' AND entry_id IS NULL").get(recordId) as RefModRecordRow | undefined;
  if (row) await adoptRecord(row, { owner: 'bootstrap', canViewImages: true });
}

const adoptSchema = z.object({
  recordIds: z.array(z.number().int().positive()).max(500).optional(),
  names: z.array(z.string().min(1).max(REFMOD_ENTRY_LIMITS.name)).max(500).optional(),
}).strict();

/** Entries from unregistered records (sources copied) and from server-only library names (metadata only, no sources). */
export async function adoptRefMods(input: unknown, actor: RefModEntryActor): Promise<RefModAdoptResult> {
  const value = parseInput(adoptSchema, input);
  const result: RefModAdoptResult = { created: [], linked: 0, skipped: [] };
  for (const recordId of new Set(value.recordIds ?? [])) {
    const row = db().prepare("SELECT * FROM minimax_refmod_records WHERE id = ? AND status = 'saved'").get(recordId) as RefModRecordRow | undefined;
    if (!row || !row.name) { result.skipped.push({ name: String(recordId), reason: 'not-saved' }); continue; }
    if (row.entry_id !== null) { result.skipped.push({ name: row.name, reason: 'registered' }); continue; }
    try {
      const adopted = await adoptRecord(row, actor);
      if (!adopted) result.skipped.push({ name: row.name, reason: 'invalid-name' });
      else if (adopted.created) result.created.push({ id: adopted.id, name: row.name });
      else result.linked += 1;
    } catch (error) {
      result.skipped.push({ name: row.name, reason: error instanceof Error ? error.message : 'failed' });
    }
  }
  const names = [...new Set(value.names ?? [])];
  if (names.length) {
    const presence = await getRefModPresence();
    if (presence.status !== 'ok') throw new RefModEntryError(presence.message, 409, { code: presence.status });
    const library = new Map(presence.entries.map((entry) => [entry.name, entry]));
    const workflowId = defaultRefModWorkflowId();
    for (const name of names) {
      const entry = library.get(name);
      if (!entry) { result.skipped.push({ name, reason: 'not-on-server' }); continue; }
      if (findEntryByName(name)) { result.skipped.push({ name, reason: 'exists' }); continue; }
      let validName: string;
      try { validName = normalizeRegisteredRefModName(name); } catch { result.skipped.push({ name, reason: 'invalid-name' }); continue; }
      const members: RefModEntryMember[] = entry.members.map((member, index) => ({
        index, kind: member.kind, description: member.description, fileId: null, fileName: null, mimeType: null,
        mediaMode: null, trimStart: null, trimEnd: null, sourceWidth: null, sourceHeight: null, sourceDuration: null,
      }));
      try {
        const id = Number(db().prepare('INSERT INTO refmod_entries (name, workflow_id, concept_type, description, members) VALUES (?, ?, ?, ?, ?)')
          .run(validName, workflowId, entry.concept || 'generic', entry.description ?? '', JSON.stringify(members)).lastInsertRowid);
        storeCarriedInputs(id);
        result.created.push({ id, name: validName });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        result.skipped.push({ name, reason: 'exists' });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------- shared with the bundle

export function refModEntryRowsForExport(ids?: number[]): RefModEntryRow[] {
  if (ids) return db().prepare('SELECT * FROM refmod_entries WHERE id IN (SELECT value FROM json_each(?)) ORDER BY name COLLATE NOCASE, id').all(JSON.stringify(ids)) as RefModEntryRow[];
  return db().prepare('SELECT * FROM refmod_entries ORDER BY name COLLATE NOCASE, id').all() as RefModEntryRow[];
}

export const refModEntryInternals = {
  requireRow, makeWorkflowCache, parseDirector, deriveMembers, replaceEntryFiles, deleteEntryRows,
  findEntryByName, isUniqueViolation, parseJson, isRecord, afterSourcesCommitted, storeCarriedInputs, DIRECTOR_META_KEY, KINDS,
};
