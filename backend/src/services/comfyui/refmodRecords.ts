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

type StoredMember = MiniMaxH3RefModRecordMember & { retained_file?: string };
export type RefModRecordHandle = { id: number; export_node_id: string };
type RecordRow = Omit<MiniMaxH3RefModRecord, 'members'> & {
  members_json: string; queue_job_id: number | null; history_id: number | null;
  prompt_id: string | null; export_node_id: string;
};

// Outside uploads/save/temp: neither library scanning nor temporary-input cleanup owns retained sources.
const recordsDir = path.join(runtimePaths.basePath, 'refmods');
const recordDir = (id: number) => path.join(recordsDir, String(id));
const FAILED_MESSAGE = 'RefMod creation failed or was cancelled. See server logs for details.';
const INTERRUPTED_MESSAGE = 'RefMod creation interrupted by backend restart.';
const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tiff',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/x-msvideo': 'avi',
  'audio/wav': 'wav', 'audio/flac': 'flac', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/webm': 'weba',
};

function safeMediaMime(mime: unknown, kind: string): string | null {
  if (typeof mime !== 'string') return null;
  const normalized = mime.toLowerCase();
  return normalized.startsWith(`${kind}/`) && Object.prototype.hasOwnProperty.call(MEDIA_EXTENSIONS, normalized) ? normalized : null;
}

function publicRecord(row: RecordRow): MiniMaxH3RefModRecord {
  const { members_json, queue_job_id, history_id, prompt_id, export_node_id, ...record } = row;
  return {
    ...record,
    error: record.error === null ? null : record.error === INTERRUPTED_MESSAGE ? INTERRUPTED_MESSAGE : FAILED_MESSAGE,
    members: (JSON.parse(members_json) as StoredMember[]).map(({ retained_file, ...member }) => member),
  };
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

export async function failRefModRecords(records: RefModRecordHandle[], error: unknown): Promise<void> {
  const message = error instanceof Error && error.message === INTERRUPTED_MESSAGE ? INTERRUPTED_MESSAGE : FAILED_MESSAGE;
  for (const record of records) {
    const result = getUserSettingsDb().prepare(`UPDATE minimax_refmod_records SET status = 'failed', error = ? WHERE id = ? AND status = 'pending'`).run(message, record.id);
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
  const row = getUserSettingsDb().prepare("SELECT members_json FROM minimax_refmod_records WHERE id = ? AND status != 'failed'").get(id) as { members_json: string } | undefined;
  const member = row && (JSON.parse(row.members_json) as StoredMember[]).find((item) => item.index === index);
  if (!member) return null;
  const libraryFile = member.composite_hash ? ImageFileModel.findActiveByHash(member.composite_hash)[0] : null;
  const filePath = libraryFile ? resolveUploadsPath(libraryFile.original_file_path)
    : member.retained_file ? path.join(recordDir(id), member.retained_file) : null;
  const mimeType = safeMediaMime(libraryFile ? libraryFile.mime_type : member.mime_type, member.kind);
  return filePath && mimeType ? { filePath, mimeType, kind: member.kind, compositeHash: member.composite_hash } : null;
}

const numberOrNull = (value: unknown) => value != null && Number.isFinite(Number(value)) ? Number(value) : null;

export async function captureRefModRecords(params: {
  workflowJson: string; markedFields: MarkedField[]; promptData: Record<string, any>;
  serverId: number | null; workflowId: number; queueJobId?: number;
}): Promise<RefModRecordHandle[]> {
  if (!hasMiniMaxH3RefModExportNode(params.workflowJson)) return [];
  if (!params.serverId) throw new ComfyInputValidationError('RefMod creation requires a registered ComfyUI server.');
  const workflow = substituteComfyPromptData(params.workflowJson, params.markedFields, params.promptData);
  const directors = Object.entries(workflow).filter(([, node]: [string, any]) => node?.class_type === 'MiniMaxH3Director');
  const records: RefModRecordHandle[] = [];
  try {
    for (const [nodeId, node] of Object.entries(workflow) as Array<[string, any]>) {
      if (node?.class_type !== MINIMAX_H3_REFMOD_EXPORT_CLASS_TYPE) continue;
      const inputs = node.inputs;
      const linkedDirector = Array.isArray(inputs.timeline_data) ? directors.find(([id]) => id === String(inputs.timeline_data[0])) : undefined;
      const director = linkedDirector ?? (directors.length === 1 ? directors[0] : undefined);
      const field = director && params.markedFields.find((entry) => entry.node_editor === 'minimax_h3_director_dasiwa' && entry.jsonPath === `${director[0]}.inputs`);
      const draft = field ? params.promptData[field.id] ?? field.default_value : undefined;
      const assets = draft?.__conai_minimax_h3_director?.assets ?? {};
      const snapshot = typeof inputs.timeline_data === 'string' ? inputs.timeline_data : director && (director[1] as any).inputs?.timeline_data;
      const timeline = typeof snapshot === 'string' ? JSON.parse(snapshot) : {};
      const items = getMiniMaxDirectorActiveItems(director ? (director[1] as any).inputs?.mode : 'REF2VA', timeline);
      const id = Number(getUserSettingsDb().prepare(`INSERT INTO minimax_refmod_records
        (name, server_id, workflow_id, status, concept_type, description, queue_job_id, export_node_id)
        VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`).run(
        typeof inputs.name === 'string' && inputs.name.trim() ? inputs.name : null,
        params.serverId, params.workflowId, typeof inputs.concept_type === 'string' ? inputs.concept_type : 'generic',
        typeof inputs.description === 'string' ? inputs.description : '', params.queueJobId ?? null, nodeId,
      ).lastInsertRowid);
      records.push({ id, export_node_id: nodeId });
      const members: StoredMember[] = [];
      for (const [index, item] of items.entries()) {
        if (!['image', 'video', 'audio'].includes(item.type)) throw new ComfyInputValidationError(`Unsupported RefMod member kind: ${item.type}`);
        const asset = assets[String(item.id ?? '')];
        const source = getComfyMediaUploadInput(asset);
        if (!source) throw new ComfyInputValidationError(`RefMod member ${item.id} has no retainable source. Reattach its media before exporting.`);
        const compositeHash = typeof asset?.composite_hash === 'string' ? asset.composite_hash : null;
        const libraryFile = compositeHash ? ImageFileModel.findActiveByHash(compositeHash)[0] : null;
        const mime = safeMediaMime(compositeHash ? libraryFile?.mime_type : source.mimeType, item.type);
        if (!mime) throw new ComfyInputValidationError('RefMod source media type is unsupported or does not match its kind.');
        const retainedFile = `${index}.${MEDIA_EXTENSIONS[mime]}`;
        if (compositeHash) {
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
          ...(!compositeHash ? { retained_file: retainedFile } : {}),
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
  return saved.map(publicRecord);
}
