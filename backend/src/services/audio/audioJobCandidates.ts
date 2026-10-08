import { getAudioDb, hasAudioDb } from '../../database/audioDb';

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
