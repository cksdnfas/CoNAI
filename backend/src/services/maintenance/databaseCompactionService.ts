import type Database from 'better-sqlite3';
import { RuntimeJobStore } from '../runtimeJobs/runtimeJobStore';
import { SystemMaintenanceLockService } from '../systemMaintenanceLockService';

/**
 * `VACUUM` of images.db: rewrites the file without free pages (deletes, the 040/041 rebuilds and old histograms
 * leave a lot behind) and re-packs rows.
 *
 * Safe since migration 041: media_metadata has an explicit INTEGER PRIMARY KEY, so VACUUM keeps every media id and
 * the FTS5 prompt index and media_auto_tags keep pointing at the right rows. Before 041 VACUUM was allowed to
 * renumber those rowids.
 *
 * Cost: VACUUM is one synchronous statement. It blocks the whole Node process and every writer for its duration
 * (seconds per GB) and needs free disk space of about twice the database (the copy plus the WAL). It therefore runs
 * only on request, never while another runtime job or the exclusive maintenance lock is active, and holds that lock
 * itself so scans and taggers stand down.
 */

const LOCK_OWNER = 'database-compaction';

export class DatabaseCompactionRefusedError extends Error {}

export interface DatabaseCompactionResult {
  bytesBefore: number;
  bytesAfter: number;
  freePagesBefore: number;
  durationMs: number;
}

function fileBytes(db: Database.Database): { bytes: number; freePages: number } {
  const pageSize = Number(db.pragma('page_size', { simple: true }));
  const pageCount = Number(db.pragma('page_count', { simple: true }));
  return { bytes: pageSize * pageCount, freePages: Number(db.pragma('freelist_count', { simple: true })) };
}

/** Throws DatabaseCompactionRefusedError when anything else that touches the databases is running. */
export function assertDatabaseCompactionAllowed(ownJobId: string | null): void {
  if (SystemMaintenanceLockService.isExclusiveActive() && !SystemMaintenanceLockService.isOwnedBy(LOCK_OWNER)) {
    throw new DatabaseCompactionRefusedError(`다른 유지보수 작업이 실행 중이야: ${SystemMaintenanceLockService.getStatus().reason}`);
  }
  const others = RuntimeJobStore.list({ status: ['queued', 'running'], limit: 200 })
    .filter((job) => job.jobId !== ownJobId);
  if (others.length > 0) {
    throw new DatabaseCompactionRefusedError(`다른 작업이 끝난 뒤에 실행할 수 있어: ${[...new Set(others.map((job) => job.kind))].join(', ')}`);
  }
}

export function compactImagesDatabase(db: Database.Database, ownJobId: string | null): DatabaseCompactionResult {
  assertDatabaseCompactionAllowed(ownJobId);
  const lock = SystemMaintenanceLockService.acquireExclusive({
    owner: LOCK_OWNER,
    reason: 'database-compaction',
    message: '데이터베이스 정리(VACUUM) 중이야. 잠시 기다려 줘.',
  });

  try {
    const before = fileBytes(db);
    const started = Date.now();
    db.exec('VACUUM');
    // VACUUM in WAL mode writes the new image through the WAL; fold it back so the file and WAL shrink now.
    db.pragma('wal_checkpoint(TRUNCATE)');
    const durationMs = Date.now() - started;
    const after = fileBytes(db);
    console.log(`🗜️ images.db VACUUM: ${before.bytes} → ${after.bytes} bytes in ${durationMs}ms (free pages before: ${before.freePages})`);
    return { bytesBefore: before.bytes, bytesAfter: after.bytes, freePagesBefore: before.freePages, durationMs };
  } finally {
    lock.release();
  }
}
