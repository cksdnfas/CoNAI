import type Database from 'better-sqlite3';
import { RuntimeJobRunner } from '../runtimeJobs/runtimeJobRunner';
import { RuntimeJobConflictError } from '../runtimeJobs/runtimeJobStore';
import type { RuntimeJobKind } from '../../types/runtimeJob';
import { DEFAULT_DATABASE_BACKUP_KEEP } from './databaseBackupService';

/**
 * Background database upkeep for the worker process:
 *
 * - `PRAGMA optimize` on images.db and user.db. Nothing ever ran ANALYZE, so the planner worked from missing or
 *   stale statistics (see autoTagScheduler). The first run waits until the boot-time scan storm has passed, then
 *   repeats every 6 hours. `analysis_limit` caps the rows ANALYZE reads per index so one run stays short even on a
 *   multi-GB database.
 * - Optional scheduled database backup and orphan cleanup, both off unless an interval is configured:
 *   `CONAI_DB_BACKUP_INTERVAL_HOURS` (keep `CONAI_DB_BACKUP_KEEP`, default 7) and
 *   `CONAI_ORPHAN_CLEANUP_INTERVAL_HOURS`. Backups of a large library are several GB each, so they never start
 *   filling the disk without the operator choosing a cadence.
 */

const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const DEFAULT_OPTIMIZE_FIRST_DELAY_MS = 10 * ONE_MINUTE_MS;
const DEFAULT_OPTIMIZE_INTERVAL_MS = 6 * ONE_HOUR_MS;
/** First scheduled backup / cleanup also waits past the boot storm. */
const SCHEDULED_JOB_FIRST_DELAY_MS = 15 * ONE_MINUTE_MS;
const OPTIMIZE_ANALYSIS_LIMIT = 1000;

function readNonNegativeNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function readDatabaseBackupKeep(): number {
  const keep = readNonNegativeNumber('CONAI_DB_BACKUP_KEEP');
  return keep !== null && keep >= 1 ? Math.floor(keep) : DEFAULT_DATABASE_BACKUP_KEEP;
}

/** Run `PRAGMA optimize` on one connection and return how long it took. */
export function optimizeSqliteConnection(db: Database.Database, label: string): number {
  const startedAt = Date.now();
  try {
    db.pragma(`analysis_limit = ${OPTIMIZE_ANALYSIS_LIMIT}`);
    // 0x10002: analyze tables whose statistics are missing or stale, considering every table — not only the ones
    // this connection happened to query since it opened.
    db.pragma('optimize = 0x10002');
  } catch (error) {
    console.warn(`⚠️  PRAGMA optimize failed for ${label}:`, error instanceof Error ? error.message : error);
  }
  return Date.now() - startedAt;
}

export class DatabaseMaintenanceScheduler {
  private static timers = new Map<string, ReturnType<typeof setTimeout>>();
  private static started = false;

  static start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    const optimizeFirstDelayMs = readNonNegativeNumber('CONAI_SQLITE_OPTIMIZE_FIRST_DELAY_MS') ?? DEFAULT_OPTIMIZE_FIRST_DELAY_MS;
    const optimizeIntervalMs = readNonNegativeNumber('CONAI_SQLITE_OPTIMIZE_INTERVAL_MS') ?? DEFAULT_OPTIMIZE_INTERVAL_MS;
    this.schedule('optimize', optimizeFirstDelayMs, optimizeIntervalMs, () => this.runOptimize());

    const backupHours = readNonNegativeNumber('CONAI_DB_BACKUP_INTERVAL_HOURS') ?? 0;
    if (backupHours > 0) {
      this.schedule('backup', SCHEDULED_JOB_FIRST_DELAY_MS, backupHours * ONE_HOUR_MS, () => this.startScheduledJob('database-backup', { keep: readDatabaseBackupKeep() }));
    }

    const cleanupHours = readNonNegativeNumber('CONAI_ORPHAN_CLEANUP_INTERVAL_HOURS') ?? 0;
    if (cleanupHours > 0) {
      this.schedule('orphan-cleanup', SCHEDULED_JOB_FIRST_DELAY_MS, cleanupHours * ONE_HOUR_MS, () => this.startScheduledJob('media-orphan-cleanup', { dryRun: false }));
    }

    console.log(
      `🛠️  Database maintenance scheduler ready (optimize every ${Math.round(optimizeIntervalMs / ONE_HOUR_MS)}h, ` +
        `backup ${backupHours > 0 ? `every ${backupHours}h` : 'manual'}, orphan cleanup ${cleanupHours > 0 ? `every ${cleanupHours}h` : 'manual'})`,
    );
  }

  static stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.started = false;
  }

  private static schedule(name: string, firstDelayMs: number, intervalMs: number, task: () => void | Promise<void>): void {
    const run = () => {
      Promise.resolve()
        .then(task)
        .catch((error) => console.warn('⚠️  Database maintenance task failed:', error instanceof Error ? error.message : error))
        .finally(() => {
          if (this.started && intervalMs > 0) {
            const next = setTimeout(run, intervalMs);
            next.unref?.();
            this.timers.set(name, next);
          }
        });
    };

    const first = setTimeout(run, firstDelayMs);
    first.unref?.();
    this.timers.set(name, first);
  }

  static async runOptimize(): Promise<void> {
    const { db } = await import('../../database/init');
    const imagesMs = optimizeSqliteConnection(db, 'images.db');

    let userMs: number | null = null;
    try {
      const { getUserSettingsDb } = await import('../../database/userSettingsDb');
      userMs = optimizeSqliteConnection(getUserSettingsDb(), 'user.db');
    } catch {
      // user.db not initialised in this process.
    }

    console.log(`🛠️  PRAGMA optimize: images.db ${imagesMs}ms${userMs !== null ? `, user.db ${userMs}ms` : ''}`);
  }

  private static startScheduledJob(kind: RuntimeJobKind, params: object): void {
    try {
      RuntimeJobRunner.start(kind, params, { requestedByAccountId: null });
    } catch (error) {
      if (!(error instanceof RuntimeJobConflictError)) {
        throw error;
      }
      // A manual run is in progress; the next interval tries again.
    }
  }
}
