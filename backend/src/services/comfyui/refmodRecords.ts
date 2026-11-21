import fs from 'node:fs/promises';
import path from 'node:path';
import {
  hasMiniMaxH3RefModExportNode,
  MINIMAX_H3_REFMOD_EXPORT_CLASS_TYPE,
  type MiniMaxH3RefModRecord,
  type MiniMaxH3RefModRecordMember,
} from '@conai/shared';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { runtimePaths, resolveUploadsPath } from '../../config/runtimePaths';
import type { ComfyUIHistoryResponse, MarkedField } from '../../types/workflow';
import { getComfyMediaUploadInput, getMiniMaxDirectorActiveItems, ComfyInputValidationError } from '../prepareComfyPromptData';
import { substituteComfyPromptData } from './workflowSubstitution';
import { ImageFileModel } from '../../models/Image/ImageFileModel';
import { validateUploadedMediaFile } from '../../routes/images/uploadSecurity';
import { HistoryCommandService } from '../historyCommandService';
import { parseComfyApiGraph, refModDirectorField, refModExportDirectorNodeId } from './refmodWorkflowRoles';
import { FileStoreService } from '../fileStoreService';

/** retained_file: a copy under basePath/refmods; file_id: the entry's file-store copy (entry-linked runs); item_id: the Director item. */
export type StoredRefModMember = MiniMaxH3RefModRecordMember & { retained_file?: string; file_id?: string; item_id?: string };
type StoredMember = StoredRefModMember;
export type RefModRecordHandle = { id: number; export_node_id: string };
export type RefModRecordRow = Omit<MiniMaxH3RefModRecord, 'members'> & {
  members_json: string; queue_job_id: number | null; history_id: number | null;
  prompt_id: string | null; export_node_id: string;
  /** The entry this run built or was adopted into. */
  entry_id: number | null;
  /** The run's Director value without asset bytes, for adoption. */
  director_value: string | null;
};
type RecordRow = RefModRecordRow;
// The link key is written only by enqueueGenerationJobs (see queueRefModEntryLink); captureRefModRecords still re-checks
// it against the entry's files.
export { REFMOD_ENTRY_RUN_KEY, readRefModEntryRunLink, type RefModEntryRunLink } from '../generation-queue/queueRefModEntryLink';
import type { RefModEntryRunLink } from '../generation-queue/queueRefModEntryLink';

// Outside uploads/save/temp: neither library scanning nor temporary-input cleanup owns retained sources.
const recordsDir = path.join(runtimePaths.basePath, 'refmods');
const recordDir = (id: number) => path.join(recordsDir, String(id));
const FAILED_MESSAGE = 'RefMod creation failed or was cancelled. See server logs for details.';
const INTERRUPTED_MESSAGE = 'RefMod creation interrupted by backend restart.';
// A stored queue failure text (the requester's own failure_message, e.g. ComfyUI's node validation line) carries this
// marker; any other stored error reads as the generic message, as it always did.
const QUEUE_FAILURE_PREFIX = 'queue-failure: ';
const QUEUE_FAILURE_LIMIT = 500;

/**
 * A queue failure text fit for the instance-shared record: one line, absolute filesystem paths replaced, bounded. `text` is
 * the job's own failure_message; without it, the text an error carries for the queue (stampQueueFailureCode,
 * ComfyUINodeValidationError). Null when there is none.
 */
function queueFailureText(error: unknown, text?: string | null): string | null {
  const carried = error && typeof error === 'object' ? (error as { queueFailureMessage?: unknown }).queueFailureMessage : undefined;
  const raw = typeof text === 'string' && text.trim() ? text : typeof carried === 'string' ? carried : '';
  const clean = raw.replace(/\s+/g, ' ').replace(/(?:(?<![A-Za-z])[A-Za-z]:[\\/]|\\\\|(?<![\w.:/-])\/(?=[\w.-]+\/))[^\s'"`,;)\]]+/g, '<path>').trim();
  if (!clean) return null;
  return clean.length > QUEUE_FAILURE_LIMIT ? `${clean.slice(0, QUEUE_FAILURE_LIMIT - 1)}…` : clean;
}

/** What a stored error shows: the interruption note, a queue failure text, or the generic message. */
function publicRefModError(error: string): string {
  if (error === INTERRUPTED_MESSAGE) return INTERRUPTED_MESSAGE;
  if (error.startsWith(QUEUE_FAILURE_PREFIX) && error.length > QUEUE_FAILURE_PREFIX.length) return error.slice(QUEUE_FAILURE_PREFIX.length, QUEUE_FAILURE_PREFIX.length + QUEUE_FAILURE_LIMIT);
  return FAILED_MESSAGE;
}
const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tiff',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/x-msvideo': 'avi',
  'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/webm': 'weba',
};

/** A MIME type CoNAI serves for a RefMod source of this kind (image/video/audio), or null. */
export function safeMediaMime(mime: unknown, kind: string): string | null {
  if (typeof mime !== 'string') return null;
  const normalized = mime.toLowerCase();
  return normalized.startsWith(`${kind}/`) && Object.prototype.hasOwnProperty.call(MEDIA_EXTENSIONS, normalized) ? normalized : null;
}

/** File extension for a MIME accepted by safeMediaMime. */
export function refModMediaExtension(mime: string): string {
  return MEDIA_EXTENSIONS[mime] ?? 'bin';
}

/** The GET /api/refmods contract: storage-only columns and member fields never leave the server. */
export function publicRefModRecord(row: RecordRow): MiniMaxH3RefModRecord {
  const { members_json, queue_job_id, history_id, prompt_id, export_node_id, entry_id, director_value, ...record } = row;
  return {
    ...record,
    error: record.error === null ? null : publicRefModError(record.error),
    members: (JSON.parse(members_json) as StoredMember[]).map(({ retained_file, file_id, item_id, ...member }) => member),
  };
}
const publicRecord = publicRefModRecord;

/** Absolute path of a record's retained copy (legacy and manual runs). */
export function refModRecordRetainedPath(id: number, retainedFile: string): string {
  return path.join(recordDir(id), retainedFile);
}

/** A record member's file in an entry's file-store copy, only while the record is linked to that entry and the entry still holds the file. */
function entryMemberFile(entryId: number | null, fileId: string | undefined): string | null {
  if (entryId === null || !fileId) return null;
  if (!getUserSettingsDb().prepare('SELECT 1 FROM refmod_entry_files WHERE entry_id = ? AND file_id = ?').get(entryId, fileId)) return null;
  try { return FileStoreService.resolveFile('bootstrap', fileId).filePath; } catch { return null; }
}

export function listRefModRecords(serverId?: number): MiniMaxH3RefModRecord[] {
  const rows = getUserSettingsDb().prepare(`SELECT * FROM minimax_refmod_records
    ${serverId === undefined ? '' : 'WHERE server_id = ?'} ORDER BY id DESC`)
    .all(...(serverId === undefined ? [] : [serverId])) as RecordRow[];
  return rows.map(publicRecord);
}

export function savedRefModRecordsByName(serverId: number): Map<string, MiniMaxH3RefModRecord> {
  const rows = getUserSettingsDb().prepare(`SELECT * FROM minimax_refmod_records
    WHERE server_id = ? AND status = 'saved' ORDER BY id DESC`).all(serverId) as RecordRow[];
  const result = new Map<string, MiniMaxH3RefModRecord>();
  for (const row of rows) if (row.name && !result.has(row.name)) result.set(row.name, publicRecord(row));
  return result;
}

export function refModRecordsByHistory(historyIds: number[]): Map<number, MiniMaxH3RefModRecord[]> {
  const result = new Map<number, MiniMaxH3RefModRecord[]>();
  if (!historyIds.length) return result;
  const rows = getUserSettingsDb().prepare(`SELECT * FROM minimax_refmod_records
    WHERE history_id IN (SELECT value FROM json_each(?)) ORDER BY id`).all(JSON.stringify(historyIds)) as RecordRow[];
  for (const row of rows) {
    const records = result.get(row.history_id!) ?? [];
    records.push(publicRecord(row));
    result.set(row.history_id!, records);
  }
  return result;
}

export function linkRefModRecords(records: RefModRecordHandle[], links: { historyId?: number; promptId?: string; workflow?: Record<string, any> }): void {
  if (!records.length) return;
  const update = getUserSettingsDb().prepare(`UPDATE minimax_refmod_records
    SET history_id = COALESCE(?, history_id), prompt_id = COALESCE(?, prompt_id) WHERE id = ?`);
  for (const record of records) {
    update.run(links.historyId ?? null, links.promptId ?? null, record.id);
    const inputs = links.workflow?.[record.export_node_id]?.inputs;
    if (inputs) getUserSettingsDb().prepare(`UPDATE minimax_refmod_records SET
      name = COALESCE(?, name), concept_type = COALESCE(?, concept_type), description = COALESCE(?, description) WHERE id = ?`)
      .run(typeof inputs.name === 'string' ? inputs.name : null,
        typeof inputs.concept_type === 'string' ? inputs.concept_type : null,
        typeof inputs.description === 'string' ? inputs.description : null, record.id);
  }
}

/** `failureMessage`: the queue job's own failure_message for this run (queue path only); other paths keep the generic text. */
export async function failRefModRecords(records: RefModRecordHandle[], error: unknown, failureMessage?: string | null): Promise<void> {
  const queueText = queueFailureText(error, failureMessage);
  const message = error instanceof Error && error.message === INTERRUPTED_MESSAGE ? INTERRUPTED_MESSAGE : queueText ?? FAILED_MESSAGE;
  const stored = message === queueText ? `${QUEUE_FAILURE_PREFIX}${queueText}` : message;
  for (const record of records) {
    const result = getUserSettingsDb().prepare(`UPDATE minimax_refmod_records SET status = 'failed', error = ? WHERE id = ? AND status = 'pending'`).run(stored, record.id);
    if (result.changes) {
      console.error(`[RefMod ${record.id}] ${message}`, error);
      await fs.rm(recordDir(record.id), { recursive: true, force: true });
    }
  }
}

/** Run before accepting requests or starting queue workers; no previous process can finish these captures. */
export async function recoverInterruptedRefModRecords(): Promise<void> {
  const records = getUserSettingsDb().prepare("SELECT id, export_node_id FROM minimax_refmod_records WHERE status = 'pending'").all() as RefModRecordHandle[];
  await failRefModRecords(records, new Error(INTERRUPTED_MESSAGE));
}

export async function deleteRefModRecord(id: number): Promise<boolean> {
  const row = getUserSettingsDb().prepare('SELECT status FROM minimax_refmod_records WHERE id = ?').get(id) as { status: string } | undefined;
  if (!row) return false;
  // A pending capture may still be writing; deletion must not race it and leave orphaned sources.
  if (row.status === 'pending') throw new ComfyInputValidationError('A running RefMod record cannot be deleted; cancel the run first.');
  await fs.rm(recordDir(id), { recursive: true, force: true });
  getUserSettingsDb().prepare('DELETE FROM minimax_refmod_records WHERE id = ?').run(id);
  return true;
}

export function resolveRefModRecordMedia(id: number, index: number): { filePath: string; mimeType: string; kind: string; compositeHash: string | null } | null {
  const row = getUserSettingsDb().prepare("SELECT members_json, entry_id FROM minimax_refmod_records WHERE id = ? AND status != 'failed'").get(id) as { members_json: string; entry_id: number | null } | undefined;
  const member = row && (JSON.parse(row.members_json) as StoredMember[]).find((item) => item.index === index);
  if (!member) return null;
  const libraryFile = member.composite_hash ? ImageFileModel.findActiveByHash(member.composite_hash)[0] : null;
  const filePath = libraryFile ? resolveUploadsPath(libraryFile.original_file_path)
    : member.retained_file ? path.join(recordDir(id), member.retained_file)
      : entryMemberFile(row!.entry_id, member.file_id);
  const mimeType = safeMediaMime(libraryFile ? libraryFile.mime_type : member.mime_type, member.kind);
  return filePath && mimeType ? { filePath, mimeType, kind: member.kind, compositeHash: member.composite_hash } : null;
}

const numberOrNull = (value: unknown) => value != null && Number.isFinite(Number(value)) ? Number(value) : null;

/** The Director value a record keeps for adoption: asset bytes and server references dropped, file names and MIME kept. */
function recordDirectorValue(draft: unknown): string | null {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
  const value = draft as Record<string, any>;
  const meta = value.__conai_minimax_h3_director;
  const assets = meta && typeof meta === 'object' && meta.assets && typeof meta.assets === 'object' ? meta.assets as Record<string, any> : {};
  const kept = Object.fromEntries(Object.entries(assets).map(([key, asset]) => [key, {
    ...(typeof asset?.fileName === 'string' ? { fileName: asset.fileName } : {}),
    ...(typeof asset?.mimeType === 'string' ? { mimeType: asset.mimeType } : {}),
  }]));
  try { return JSON.stringify({ ...value, __conai_minimax_h3_director: { assets: kept } }); } catch { return null; }
}

/**
 * An entry link is honoured only when the entry exists and every member maps to one of its own files; anything else
 * (a stale or client-written link) runs as a plain creation run with retained copies.
 */
function verifiedEntryLink(link: RefModEntryRunLink | undefined, items: Array<Record<string, any>>): RefModEntryRunLink | null {
  if (!link || !Number.isSafeInteger(link.entryId) || !link.files || typeof link.files !== 'object') return null;
  const db = getUserSettingsDb();
  if (!db.prepare('SELECT 1 FROM refmod_entries WHERE id = ?').get(link.entryId)) return null;
  const owned = db.prepare('SELECT 1 FROM refmod_entry_files WHERE entry_id = ? AND file_id = ?');
  for (const item of items) {
    const fileId = link.files[String(item.id ?? '')];
    if (typeof fileId !== 'string' || !owned.get(link.entryId, fileId)) return null;
  }
  return link;
}

export async function captureRefModRecords(params: {
  workflowJson: string; markedFields: MarkedField[]; promptData: Record<string, any>;
  serverId: number | null; workflowId: number; queueJobId?: number;
  /** Set by an entry build: link the record to the entry and point members at its files instead of retaining copies. */
  entry?: RefModEntryRunLink;
}): Promise<RefModRecordHandle[]> {
  if (!hasMiniMaxH3RefModExportNode(params.workflowJson)) return [];
  if (!params.serverId) throw new ComfyInputValidationError('RefMod creation requires a registered ComfyUI server.');
  const workflow = substituteComfyPromptData(params.workflowJson, params.markedFields, params.promptData);
  const graph = parseComfyApiGraph(workflow) ?? {};
  const exportNodeIds = Object.keys(graph).filter((nodeId) => graph[nodeId]?.class_type === MINIMAX_H3_REFMOD_EXPORT_CLASS_TYPE);
  const records: RefModRecordHandle[] = [];
  try {
    for (const nodeId of exportNodeIds) {
      const inputs = graph[nodeId].inputs;
      const directorId = refModExportDirectorNodeId(graph, nodeId);
      const directorNode = directorId ? graph[directorId] : undefined;
      const field = refModDirectorField(params.markedFields, directorId);
      const draft = field ? params.promptData[field.id] ?? field.default_value : undefined;
      const assets = draft?.__conai_minimax_h3_director?.assets ?? {};
      const snapshot = typeof inputs.timeline_data === 'string' ? inputs.timeline_data : directorNode?.inputs?.timeline_data;
      const timeline = typeof snapshot === 'string' ? JSON.parse(snapshot) : {};
      const items = getMiniMaxDirectorActiveItems(directorNode ? directorNode.inputs?.mode : 'REF2VA', timeline);
      const link = exportNodeIds.length === 1 ? verifiedEntryLink(params.entry, items) : null;
      const id = Number(getUserSettingsDb().prepare(`INSERT INTO minimax_refmod_records
        (name, server_id, workflow_id, status, concept_type, description, queue_job_id, export_node_id, entry_id, director_value)
        VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`).run(
        typeof inputs.name === 'string' && inputs.name.trim() ? inputs.name : null,
        params.serverId, params.workflowId, typeof inputs.concept_type === 'string' ? inputs.concept_type : 'generic',
        typeof inputs.description === 'string' ? inputs.description : '', params.queueJobId ?? null, nodeId,
        link?.entryId ?? null, recordDirectorValue(draft),
      ).lastInsertRowid);
      records.push({ id, export_node_id: nodeId });
      const members: StoredMember[] = [];
      for (const [index, item] of items.entries()) {
        if (!['image', 'video', 'audio'].includes(item.type)) throw new ComfyInputValidationError(`Unsupported RefMod member kind: ${item.type}`);
        const itemId = String(item.id ?? '');
        const asset = assets[itemId];
        const source = getComfyMediaUploadInput(asset);
        if (!source) throw new ComfyInputValidationError(`RefMod member ${item.id} has no retainable source. Reattach its media before exporting.`);
        const compositeHash = !link && typeof asset?.composite_hash === 'string' ? asset.composite_hash : null;
        const libraryFile = compositeHash ? ImageFileModel.findActiveByHash(compositeHash)[0] : null;
        const mime = safeMediaMime(compositeHash ? libraryFile?.mime_type : source.mimeType, item.type);
        if (!mime) throw new ComfyInputValidationError('RefMod source media type is unsupported or does not match its kind.');
        const retainedFile = `${index}.${MEDIA_EXTENSIONS[mime]}`;
        if (link) {
          // The entry already holds a validated copy; the run's input is a copy of it. Nothing is retained here.
          if (!source.filePath) throw new ComfyInputValidationError(`RefMod member ${item.id} has no source file.`);
          await validateUploadedMediaFile({ path: source.filePath, mimetype: mime });
        } else if (compositeHash) {
          await validateUploadedMediaFile({ path: resolveUploadsPath(libraryFile!.original_file_path), mimetype: mime });
        } else {
          await fs.mkdir(recordDir(id), { recursive: true });
          const stagedPath = path.join(recordDir(id), `${index}.tmp`);
          if (source.filePath) await fs.copyFile(source.filePath, stagedPath);
          else if (source.buffer) await fs.writeFile(stagedPath, source.buffer, { flag: 'wx' });
          else throw new ComfyInputValidationError(`RefMod member ${item.id} has no source bytes.`);
          await validateUploadedMediaFile({ path: stagedPath, mimetype: mime });
          await fs.rename(stagedPath, path.join(recordDir(id), retainedFile));
        }
        members.push({
          index, kind: item.type, description: typeof item.prompt === 'string' ? item.prompt : '',
          file_name: asset?.fileName || item.file_name || source.fileName || retainedFile, mime_type: mime,
          media_url: `/api/refmods/${id}/media/${index}`, composite_hash: compositeHash,
          media_mode: ['video', 'audio', 'video_audio'].includes(item.media_mode) ? item.media_mode : null,
          trim_start: numberOrNull(item.trim_start), trim_end: numberOrNull(item.trim_end),
          source_width: numberOrNull(item.source_width), source_height: numberOrNull(item.source_height),
          source_duration: numberOrNull(item.source_duration ?? item.duration),
          ...(link ? { file_id: link.files[itemId] } : !compositeHash ? { retained_file: retainedFile } : {}),
          ...(itemId ? { item_id: itemId } : {}),
        });
      }
      getUserSettingsDb().prepare('UPDATE minimax_refmod_records SET members_json = ? WHERE id = ?').run(JSON.stringify(members), id);
    }
    return records;
  } catch (error) {
    await failRefModRecords(records, error);
    throw error;
  }
}

let adoptionQueue: Promise<void> = Promise.resolve();
/** Settles once every automatic adoption scheduled so far has finished (each failure is only logged). */
export function refModAdoptionsSettled(): Promise<void> {
  return adoptionQueue;
}

/** An entry build finished: note it on the entry and take the name ComfyUI reported when it differs and is free. */
function noteEntryBuilt(row: RecordRow) {
  const db = getUserSettingsDb();
  db.transaction(() => {
    const entry = db.prepare('SELECT id, name FROM refmod_entries WHERE id = ?').get(row.entry_id) as { id: number; name: string } | undefined;
    if (!entry) return;
    const rename = Boolean(row.name) && row.name !== entry.name
      && !db.prepare('SELECT 1 FROM refmod_entries WHERE name = ? AND id != ?').get(row.name, entry.id);
    if (rename) {
      db.prepare(`UPDATE refmod_entries SET name = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP,
        last_built_at = CURRENT_TIMESTAMP, last_record_id = ? WHERE id = ?`).run(row.name, row.id, entry.id);
    } else {
      db.prepare('UPDATE refmod_entries SET last_built_at = CURRENT_TIMESTAMP, last_record_id = ? WHERE id = ?').run(row.id, entry.id);
    }
  })();
}

/** After a saved export: entry builds update their entry; a plain run is adopted in the background. Never throws. */
function afterRefModRecordsSaved(rows: RecordRow[]) {
  for (const row of rows) {
    try {
      if (row.entry_id !== null) {
        noteEntryBuilt(row);
      } else if (row.name) {
        const recordId = row.id;
        adoptionQueue = adoptionQueue
          .then(async () => { await (await import('./refmodEntries')).adoptCompletedRefModRecord(recordId); })
          .catch((error) => { console.warn(`[RefMod ${recordId}] Automatic entry registration failed:`, error instanceof Error ? error.message : error); });
      }
    } catch (error) {
      console.warn(`[RefMod ${row.id}] Entry update after export failed:`, error instanceof Error ? error.message : error);
    }
  }
}

/** Only the export nodes in this submission may turn a no-image run into success. */
export function completeRefModRecords(records: RefModRecordHandle[], history: ComfyUIHistoryResponse | undefined, promptId: string): MiniMaxH3RefModRecord[] {
  if (!records.length) return [];
  const item = history?.[promptId];
  if (!item?.status.completed || item.status.status_str === 'error') throw new Error('ComfyUI did not complete the RefMod export.');
  const names = records.map((record) => {
    const result = item.outputs[record.export_node_id]?.dasiwa_refmod_export?.[0];
    if (!result || typeof result.name !== 'string' || !result.name.trim()) throw new Error(`ComfyUI returned no RefMod export result for node ${record.export_node_id}.`);
    return result.name;
  });
  const db = getUserSettingsDb();
  const saved = db.transaction(() => records.map((record, index) => {
    db.prepare("UPDATE minimax_refmod_records SET status = 'saved', name = ?, prompt_id = ?, error = NULL WHERE id = ?").run(names[index], promptId, record.id);
    return db.prepare('SELECT * FROM minimax_refmod_records WHERE id = ?').get(record.id) as RecordRow;
  }))();
  for (const historyId of new Set(saved.map((row) => row.history_id).filter((id): id is number => id !== null))) {
    HistoryCommandService.updateStatus(historyId, 'completed');
  }
  afterRefModRecordsSaved(saved);
  return saved.map(publicRecord);
}
