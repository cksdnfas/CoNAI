import fs from 'fs';
import { db } from './init';
import { runtimePaths } from '../config/runtimePaths';

const ONE_MIB = 1024 * 1024;
const DEFAULT_TRUNCATE_THRESHOLD_BYTES = 256 * ONE_MIB;
const DEFAULT_MIN_INTERVAL_MS = 30_000;

let lastImagesWalAttemptAt = 0;

export interface ImagesWalMaintenanceResult {
  checked: boolean;
  attempted: boolean;
  busy: boolean;
  beforeBytes: number;
  afterBytes: number;
  reason: string;
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getTruncateThresholdBytes(): number {
  const thresholdMb = parsePositiveInteger(process.env.SQLITE_WAL_TRUNCATE_THRESHOLD_MB);
  return thresholdMb ? thresholdMb * ONE_MIB : DEFAULT_TRUNCATE_THRESHOLD_BYTES;
}

function getMinIntervalMs(): number {
  return parsePositiveInteger(process.env.SQLITE_WAL_TRUNCATE_MIN_INTERVAL_MS) ?? DEFAULT_MIN_INTERVAL_MS;
}

function getImagesWalPath(): string {
  return `${runtimePaths.databaseFile}-wal`;
}

function getFileSizeBytes(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function maybeTruncateImagesWal(reason: string): ImagesWalMaintenanceResult {
  const walPath = getImagesWalPath();
  const beforeBytes = getFileSizeBytes(walPath);
  const thresholdBytes = getTruncateThresholdBytes();

  if (beforeBytes < thresholdBytes) {
    return {
      checked: true,
      attempted: false,
      busy: false,
      beforeBytes,
      afterBytes: beforeBytes,
      reason,
    };
  }

  const now = Date.now();
  const minIntervalMs = getMinIntervalMs();
  if (now - lastImagesWalAttemptAt < minIntervalMs) {
    return {
      checked: true,
      attempted: false,
      busy: false,
      beforeBytes,
      afterBytes: beforeBytes,
      reason,
    };
  }

  lastImagesWalAttemptAt = now;

  try {
    const result = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy?: number;
      log?: number;
      checkpointed?: number;
    }>;
    const busy = Number(result[0]?.busy ?? 0) !== 0;
    const afterBytes = getFileSizeBytes(walPath);

    console.log(
      `[SQLiteWAL] images.db checkpoint ${busy ? 'busy' : 'ok'} ` +
        `reason=${reason} before=${Math.round(beforeBytes / ONE_MIB)}MB after=${Math.round(afterBytes / ONE_MIB)}MB`
    );

    return {
      checked: true,
      attempted: true,
      busy,
      beforeBytes,
      afterBytes,
      reason,
    };
  } catch (error) {
    const afterBytes = getFileSizeBytes(walPath);
    console.warn(
      `[SQLiteWAL] images.db checkpoint failed reason=${reason}:`,
      error instanceof Error ? error.message : error
    );

    return {
      checked: true,
      attempted: true,
      busy: false,
      beforeBytes,
      afterBytes,
      reason,
    };
  }
}
