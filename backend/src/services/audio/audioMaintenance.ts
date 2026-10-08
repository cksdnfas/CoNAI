import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getAudioDb, hasAudioDb } from '../../database/audioDb';
import { deleteFile, moveFileWithoutReplacing } from '../../utils/recycleBin';
import { settingsService } from '../settingsService';
import {
  AUDIO_STORE_DIR,
  audioBlobPath,
  getAudioFile,
  isAudioStorePath,
  parseAudioBlobName,
  probeAudioFile,
  sha256File,
  type AudioFileRecord,
} from './audioStore';

/**
 * Lifecycle of audio blobs: release (RecycleBin), retention purge of soft-deleted candidates, re-attach on RecycleBin
 * restore, orphan sweep, verification.
 *
 * A blob is released only when no candidate row, live or soft-deleted, points at it. Before the move, the rows that
 * used it are saved in `audio_purged_files`; restoring the file from the RecycleBin (or finding it back in the store)
 * re-creates them, so a restore really brings the sound back.
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 500;
const MAX_REPORTED_ISSUES = 1000;
/** Files newer than this are left alone by the orphan sweep: an ingest may not have written its row yet. */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
export const AUDIO_RECOVERED_PROJECT_NAME = '복구된 오디오';

const db = () => getAudioDb();
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface AudioMaintenanceHooks {
  yield?: () => Promise<void>;
  throwIfCancelled?: () => void;
  warn?: (message: string) => void;
}

function useRecycleBin(): boolean {
  try {
    return settingsService.loadSettings().general.deleteProtection.enabled !== false;
  } catch {
    return true;
  }
}

function referenceCount(hash: string): number {
  return (db().prepare('SELECT count(*) AS n FROM audio_candidates WHERE file_hash = ?').get(hash) as { n: number }).n;
}

/* ------------------------------------------------------------------------------------------------ release */

export interface AudioReleaseResult {
  released: number;
  recycled: number;
  /** Rows released whose blob was already gone from disk. */
  missing: number;
  failed: number;
}

/**
 * Release every blob among `hashes` that no candidate references any more: save the rows that used it (from
 * `snapshot`, captured before a cascade delete), drop its `audio_files` row and move the file to the RecycleBin
 * (or delete it when delete protection is off).
 */
export async function releaseUnreferencedAudioBlobs(hashes: Iterable<string>, snapshot: Map<string, unknown[]> = new Map()): Promise<AudioReleaseResult> {
  const result: AudioReleaseResult = { released: 0, recycled: 0, missing: 0, failed: 0 };
  const recycle = useRecycleBin();
  for (const hash of new Set(hashes)) {
    const file = db().transaction((): AudioFileRecord | null => {
      if (referenceCount(hash) > 0) return null;
      const row = getAudioFile(hash);
      if (!row) return null;
      const previous = db().prepare('SELECT candidates_json FROM audio_purged_files WHERE hash = ?').get(hash) as { candidates_json: string } | undefined;
      const candidates = [...(previous ? safeArray(previous.candidates_json) : []), ...(snapshot.get(hash) ?? [])];
      db().prepare(`INSERT INTO audio_purged_files (hash, file_json, candidates_json, purged_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(hash) DO UPDATE SET file_json = excluded.file_json, candidates_json = excluded.candidates_json, purged_at = excluded.purged_at`)
        .run(hash, JSON.stringify(row), JSON.stringify(dedupeById(candidates)), new Date().toISOString());
      db().prepare('DELETE FROM audio_files WHERE hash = ?').run(hash);
      return row;
    }).immediate();
    if (!file) continue;
    result.released += 1;

    const blob = audioBlobPath(file.hash, file.ext);
    if (!fs.existsSync(blob)) {
      result.missing += 1;
      continue;
    }
    try {
      const binPath = await deleteFile(blob, recycle, 'audio');
      if (binPath) {
        result.recycled += 1;
        // The same bytes were ingested again while the file was moving: put them back for the new row.
        if (getAudioFile(file.hash) && !fs.existsSync(blob)) {
          await moveFileWithoutReplacing(binPath, blob).catch(() => undefined);
        }
      } else {
        db().prepare('DELETE FROM audio_purged_files WHERE hash = ?').run(file.hash);
      }
    } catch {
      result.failed += 1;
      // Keep the blob registered so it can be released again later.
      db().prepare(`INSERT OR IGNORE INTO audio_files (hash, ext, size, duration, sample_rate, channels, codec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(file.hash, file.ext, file.size, file.duration, file.sample_rate, file.channels, file.codec, file.created_at);
    }
  }
  return result;
}

function safeArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dedupeById(rows: unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  for (const row of rows) {
    const id = (row as { id?: unknown })?.id;
    if (typeof id === 'string') byId.set(id, row);
  }
  return [...byId.values()];
}

/* ------------------------------------------------------------------------------------------------ retention */

export interface AudioPurgeResult extends AudioReleaseResult {
  purgedCandidates: number;
}

/**
 * Hard-delete candidates soft-deleted more than `retentionDays` ago, then release the blobs left unused.
 * `retentionDays <= 0` (retention off) purges nothing.
 */
export async function purgeAudioTombstones(options: { retentionDays: number; now?: Date }, hooks: AudioMaintenanceHooks = {}): Promise<AudioPurgeResult> {
  const result: AudioPurgeResult = { purgedCandidates: 0, released: 0, recycled: 0, missing: 0, failed: 0 };
  if (!Number.isInteger(options.retentionDays) || options.retentionDays <= 0 || !hasAudioDb()) return result;
  const cutoff = new Date((options.now ?? new Date()).getTime() - options.retentionDays * ONE_DAY_MS).toISOString();
  for (;;) {
    hooks.throwIfCancelled?.();
    const rows = db().prepare(`
      SELECT c.*, g.project_id AS project_id FROM audio_candidates c JOIN audio_groups g ON g.id = c.group_id
      WHERE c.deleted_at IS NOT NULL AND c.deleted_at < ? ORDER BY c.deleted_at, c.id LIMIT ${PAGE_SIZE}
    `).all(cutoff) as Array<Record<string, unknown> & { id: string; file_hash: string }>;
    if (rows.length === 0) break;
    const snapshot = new Map<string, unknown[]>();
    for (const row of rows) snapshot.set(row.file_hash, [...(snapshot.get(row.file_hash) ?? []), row]);
    const deleteRow = db().prepare('DELETE FROM audio_candidates WHERE id = ?');
    result.purgedCandidates += db().transaction(() => rows.reduce((sum, row) => sum + deleteRow.run(row.id).changes, 0)).immediate();
    const released = await releaseUnreferencedAudioBlobs(snapshot.keys(), snapshot);
    result.released += released.released;
    result.recycled += released.recycled;
    result.missing += released.missing;
    result.failed += released.failed;
    await (hooks.yield ?? yieldToEventLoop)();
  }
  return result;
}

/* ------------------------------------------------------------------------------------------------ re-attach */

/** The 받은 파일 group of the project called `name`, creating the project and/or its inbox when missing. */
export function ensureNamedAudioProjectInbox(name: string): string {
  const existing = db().prepare(`SELECT g.id FROM audio_groups g JOIN audio_projects p ON p.id = g.project_id WHERE p.name = ? AND g.is_inbox = 1`)
    .get(name) as { id: string } | undefined;
  if (existing) return existing.id;
  const at = new Date().toISOString();
  const projectRow = db().prepare('SELECT id FROM audio_projects WHERE name = ?').get(name) as { id: string } | undefined;
  const projectId = projectRow?.id ?? crypto.randomUUID();
  if (!projectRow) {
    db().prepare(`INSERT INTO audio_projects (id, name, description, created_by_account_id, created_at, updated_at) VALUES (?, ?, '', NULL, ?, ?)`)
      .run(projectId, name, at, at);
  }
  const groupId = crypto.randomUUID();
  db().prepare(`INSERT INTO audio_groups (id, project_id, name, label, description, is_inbox, created_at, updated_at) VALUES (?, ?, '받은 파일', NULL, '', 1, ?, ?)`)
    .run(groupId, projectId, at, at);
  return groupId;
}

/** Group a recovered candidate goes back to: its own group, else its project's inbox, else 복구된 오디오. */
function recoveryGroup(row: { group_id?: unknown; project_id?: unknown }): string {
  if (typeof row.group_id === 'string' && db().prepare('SELECT 1 FROM audio_groups WHERE id = ?').get(row.group_id)) return row.group_id;
  if (typeof row.project_id === 'string') {
    const inbox = db().prepare('SELECT id FROM audio_groups WHERE project_id = ? AND is_inbox = 1').get(row.project_id) as { id: string } | undefined;
    if (inbox) return inbox.id;
  }
  return ensureNamedAudioProjectInbox(AUDIO_RECOVERED_PROJECT_NAME);
}

export interface AudioReattachResult {
  hash: string | null;
  /** Candidates re-created from the purge record (or one new candidate when there was none). */
  candidates: number;
  /** The file was not an audio blob (wrong name/content); left where it is. */
  skipped: boolean;
}

/**
 * A file came back into the audio store (RecycleBin restore, or found by the orphan sweep): verify its content,
 * move it to its canonical name, register it and re-create the candidates saved when it was released.
 */
export async function reattachAudioFile(filePath: string): Promise<AudioReattachResult> {
  const resolved = path.resolve(filePath);
  if (!isAudioStorePath(resolved) || !fs.existsSync(resolved)) return { hash: null, candidates: 0, skipped: true };
  const ext = path.extname(resolved).replace(/^\./, '').toLowerCase();
  const nameExt = (parseAudioBlobName(path.basename(resolved))?.ext) ?? ext;
  let hash: string;
  let probe: Awaited<ReturnType<typeof probeAudioFile>>;
  try {
    probe = await probeAudioFile(resolved);
    hash = await sha256File(resolved);
  } catch {
    return { hash: null, candidates: 0, skipped: true };
  }
  let canonical: string;
  try {
    canonical = audioBlobPath(hash, nameExt);
  } catch {
    return { hash: null, candidates: 0, skipped: true };
  }
  if (path.resolve(canonical) !== resolved) {
    await fs.promises.mkdir(path.dirname(canonical), { recursive: true });
    if (fs.existsSync(canonical)) await fs.promises.rm(resolved, { force: true });
    else await moveFileWithoutReplacing(resolved, canonical);
  }
  const size = (await fs.promises.stat(canonical)).size;

  return db().transaction((): AudioReattachResult => {
    const purged = db().prepare('SELECT * FROM audio_purged_files WHERE hash = ?').get(hash) as { file_json: string; candidates_json: string } | undefined;
    const previousFile = purged ? (JSON.parse(purged.file_json) as Partial<AudioFileRecord>) : null;
    db().prepare(`INSERT INTO audio_files (hash, ext, size, duration, sample_rate, channels, codec, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hash) DO NOTHING`)
      .run(hash, nameExt, size, probe.duration, probe.sampleRate, probe.channels, probe.codec, previousFile?.created_at ?? new Date().toISOString());

    let created = 0;
    const at = new Date().toISOString();
    const rows = purged ? safeArray(purged.candidates_json) as Array<Record<string, unknown>> : [];
    const insert = db().prepare(`
      INSERT OR IGNORE INTO audio_candidates (id, group_id, file_hash, parent_id, origin, name, review, notes, edit_json, provenance_json,
        order_id, job_id, source_key, created_by_account_id, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `);
    for (const row of rows) {
      const id = typeof row.id === 'string' ? row.id : crypto.randomUUID();
      const parent = typeof row.parent_id === 'string' && db().prepare('SELECT 1 FROM audio_candidates WHERE id = ?').get(row.parent_id) ? row.parent_id : null;
      const sourceKey = typeof row.source_key === 'string' && !db().prepare('SELECT 1 FROM audio_candidates WHERE source_key = ?').get(row.source_key) ? row.source_key : null;
      created += insert.run(id, recoveryGroup(row), hash, parent, row.origin ?? 'imported', row.name ?? hash.slice(0, 12),
        row.review ?? 'pending', row.notes ?? '', row.edit_json ?? null, row.provenance_json ?? null, row.order_id ?? null,
        row.job_id ?? null, sourceKey, row.created_by_account_id ?? null, row.created_at ?? at, at).changes;
    }
    if (rows.length === 0 && referenceCount(hash) === 0) {
      created += insert.run(crypto.randomUUID(), ensureNamedAudioProjectInbox(AUDIO_RECOVERED_PROJECT_NAME), hash, null, 'imported', `복구 ${hash.slice(0, 12)}`, 'pending', '', null,
        JSON.stringify({ source: 'recovered' }), null, null, null, null, at, at).changes;
    }
    db().prepare('DELETE FROM audio_purged_files WHERE hash = ?').run(hash);
    return { hash, candidates: created, skipped: false };
  }).immediate();
}

/* ------------------------------------------------------------------------------------------------ orphan sweep */

export interface AudioOrphanResult {
  scannedFiles: number;
  /** Files in the store with no row and no purge record (or not a blob name). */
  orphanFiles: number;
  orphanBytes: number;
  /** Files with a purge record that were registered again instead of being recycled. */
  recoveredFiles: number;
  /** `audio_files` rows no candidate references. */
  unreferencedBlobs: number;
  releasedBlobs: number;
}

async function walkFiles(dir: string, visit: (filePath: string) => Promise<void>, hooks: AudioMaintenanceHooks): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  let count = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, visit, hooks);
    else if (entry.isFile()) await visit(full);
    if (++count % PAGE_SIZE === 0) {
      hooks.throwIfCancelled?.();
      await (hooks.yield ?? yieldToEventLoop)();
    }
  }
}

/** (a) files in the store without a row, (b) rows no candidate references. A dry run only counts. */
export async function sweepAudioOrphans(options: { dryRun: boolean; graceMs?: number; now?: number }, hooks: AudioMaintenanceHooks = {}): Promise<AudioOrphanResult> {
  const result: AudioOrphanResult = { scannedFiles: 0, orphanFiles: 0, orphanBytes: 0, recoveredFiles: 0, unreferencedBlobs: 0, releasedBlobs: 0 };
  // No audio.db yet means no audio workspace: nothing is registered, so nothing in the store can be judged.
  if (!hasAudioDb()) return result;
  const cutoff = (options.now ?? Date.now()) - (options.graceMs ?? ORPHAN_GRACE_MS);
  const recycle = useRecycleBin();
  await walkFiles(AUDIO_STORE_DIR, async (filePath) => {
    result.scannedFiles += 1;
    let stat: fs.Stats;
    try { stat = await fs.promises.lstat(filePath); } catch { return; }
    if (!stat.isFile() || stat.mtimeMs > cutoff) return;
    const blob = parseAudioBlobName(path.basename(filePath));
    if (blob && getAudioFile(blob.hash)) return;
    const purged = blob ? db().prepare('SELECT 1 FROM audio_purged_files WHERE hash = ?').get(blob.hash) : undefined;
    if (purged) {
      result.recoveredFiles += 1;
      if (!options.dryRun) {
        try { await reattachAudioFile(filePath); } catch (error) { hooks.warn?.(`audio re-attach failed: ${(error as Error).message}`); }
      }
      return;
    }
    result.orphanFiles += 1;
    result.orphanBytes += stat.size;
    if (!options.dryRun) {
      try { await deleteFile(filePath, recycle, 'audio'); } catch (error) { hooks.warn?.(`audio orphan move failed: ${(error as Error).message}`); }
    }
  }, hooks);

  // Same grace as the files: an ingest registers the blob a moment before its candidate row exists.
  const unreferenced = (db().prepare(`
    SELECT f.hash FROM audio_files f
    WHERE f.created_at < ? AND NOT EXISTS (SELECT 1 FROM audio_candidates c WHERE c.file_hash = f.hash)
  `).all(new Date(cutoff).toISOString()) as Array<{ hash: string }>).map((row) => row.hash);
  result.unreferencedBlobs = unreferenced.length;
  if (!options.dryRun && unreferenced.length > 0) {
    result.releasedBlobs = (await releaseUnreferencedAudioBlobs(unreferenced)).released;
  }
  return result;
}

/* ------------------------------------------------------------------------------------------------ verification */

export interface AudioVerificationResult {
  checked: number;
  missing: number;
  sizeMismatch: number;
  issues: Array<{ hash: string; ext: string; reason: 'missing' | 'size-mismatch' }>;
}

/** Report `audio_files` rows whose blob is gone or has another size. Rows are never changed here. */
export async function verifyAudioFiles(hooks: AudioMaintenanceHooks = {}): Promise<AudioVerificationResult> {
  const result: AudioVerificationResult = { checked: 0, missing: 0, sizeMismatch: 0, issues: [] };
  if (!hasAudioDb()) return result;
  let after = '';
  for (;;) {
    hooks.throwIfCancelled?.();
    const rows = db().prepare(`SELECT hash, ext, size FROM audio_files WHERE hash > ? ORDER BY hash LIMIT ${PAGE_SIZE}`).all(after) as Array<{ hash: string; ext: string; size: number }>;
    if (rows.length === 0) break;
    after = rows[rows.length - 1].hash;
    for (const row of rows) {
      result.checked += 1;
      let size: number | null = null;
      try { size = (await fs.promises.stat(audioBlobPath(row.hash, row.ext))).size; } catch { size = null; }
      const reason = size === null ? 'missing' : size !== row.size ? 'size-mismatch' : null;
      if (!reason) continue;
      if (reason === 'missing') result.missing += 1;
      else result.sizeMismatch += 1;
      if (result.issues.length < MAX_REPORTED_ISSUES) result.issues.push({ hash: row.hash, ext: row.ext, reason });
    }
    await (hooks.yield ?? yieldToEventLoop)();
  }
  return result;
}
