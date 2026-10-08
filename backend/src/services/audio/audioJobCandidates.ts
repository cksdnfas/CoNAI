import { getAudioDb, hasAudioDb } from '../../database/audioDb';
import { AUDIO_MIME_BY_EXTENSION } from './audioStore';

/**
 * Live audio candidates per generation queue job id, for chat attachments and outcome notes. Kept apart from the
 * order service so chat code reads it without loading the queue machinery. Empty when there is no audio workspace.
 */
export function audioCandidatesByQueueJob(jobIds: number[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (jobIds.length === 0 || !hasAudioDb()) return result;
  const db = getAudioDb();
  for (let start = 0; start < jobIds.length; start += 500) {
    const chunk = jobIds.slice(start, start + 500).map(String);
    const rows = db.prepare(`SELECT id, job_id FROM audio_candidates WHERE deleted_at IS NULL AND job_id IN (${chunk.map(() => '?').join(',')}) ORDER BY created_at, id`)
      .all(...chunk) as Array<{ id: string; job_id: string }>;
    for (const row of rows) result.set(Number(row.job_id), [...(result.get(Number(row.job_id)) ?? []), row.id]);
  }
  return result;
}

/** Queue jobs that belong to an audio order → the order's group. Their outcome is a sound, never an image. */
export function audioOrderGroupsByQueueJob(jobIds: number[]): Map<number, string> {
  const result = new Map<number, string>();
  if (jobIds.length === 0 || !hasAudioDb()) return result;
  const db = getAudioDb();
  for (let start = 0; start < jobIds.length; start += 500) {
    const chunk = jobIds.slice(start, start + 500);
    const rows = db.prepare(`SELECT j.job_id, o.group_id FROM audio_order_jobs j JOIN audio_orders o ON o.id = j.order_id WHERE j.job_id IN (${chunk.map(() => '?').join(',')})`)
      .all(...chunk) as Array<{ job_id: number; group_id: string }>;
    for (const row of rows) result.set(Number(row.job_id), row.group_id);
  }
  return result;
}

/** One sound of a generation run, as a history row shows it. */
export interface GenerationAudioResult {
  id: string;
  name: string;
  file_hash: string;
  mime_type: string;
  duration: number | null;
  group_id: string;
}

/** Live sounds per queue job with what a history row needs to play them. Empty when there is no audio workspace. */
export function audioResultsByQueueJob(jobIds: number[]): Map<number, GenerationAudioResult[]> {
  const result = new Map<number, GenerationAudioResult[]>();
  if (jobIds.length === 0 || !hasAudioDb()) return result;
  const db = getAudioDb();
  for (let start = 0; start < jobIds.length; start += 500) {
    const chunk = jobIds.slice(start, start + 500).map(String);
    const rows = db.prepare(`
      SELECT c.id, c.job_id, c.name, c.group_id, c.file_hash, f.ext, f.duration
      FROM audio_candidates c JOIN audio_files f ON f.hash = c.file_hash
      WHERE c.deleted_at IS NULL AND c.job_id IN (${chunk.map(() => '?').join(',')})
      ORDER BY c.created_at, c.id
    `).all(...chunk) as Array<{ id: string; job_id: string; name: string; group_id: string; file_hash: string; ext: string; duration: number | null }>;
    for (const row of rows) {
      const entry = { id: row.id, name: row.name, file_hash: row.file_hash, mime_type: AUDIO_MIME_BY_EXTENSION[row.ext] ?? 'application/octet-stream', duration: row.duration, group_id: row.group_id };
      result.set(Number(row.job_id), [...(result.get(Number(row.job_id)) ?? []), entry]);
    }
  }
  return result;
}
