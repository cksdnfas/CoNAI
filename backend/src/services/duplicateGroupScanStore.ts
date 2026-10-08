import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import type { DuplicateGroupRef } from '../models/Image/ImageSimilarityModel';

/**
 * Results of `duplicate-group-scan` jobs. A whole-library scan can find tens of thousands of groups, far past the
 * 64KB job result limit, so the job keeps compact group references (file ids) in a file per job and the route pages
 * through them. Files older than a day are removed whenever a new scan is stored.
 */

const RETENTION_MS = 24 * 60 * 60 * 1000;
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function storeDirectory(): string {
  return path.join(runtimePaths.tempDir, 'duplicate-groups');
}

function storePath(jobId: string): string | null {
  return JOB_ID_PATTERN.test(jobId) ? path.join(storeDirectory(), `${jobId}.json`) : null;
}

function pruneOldScans(now = Date.now()): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(storeDirectory(), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(storeDirectory(), entry.name);
    try {
      if (now - fs.statSync(filePath).mtimeMs > RETENTION_MS) fs.unlinkSync(filePath);
    } catch {
      // Already gone or busy: the next scan tries again.
    }
  }
}

export const DuplicateGroupScanStore = {
  write(jobId: string, refs: DuplicateGroupRef[]): void {
    const target = storePath(jobId);
    if (!target) throw new Error(`Invalid job id: ${jobId}`);
    fs.mkdirSync(storeDirectory(), { recursive: true });
    pruneOldScans();
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(refs));
    fs.renameSync(temporary, target);
  },

  read(jobId: string): DuplicateGroupRef[] | null {
    const target = storePath(jobId);
    if (!target) return null;
    try {
      return JSON.parse(fs.readFileSync(target, 'utf8')) as DuplicateGroupRef[];
    } catch {
      return null;
    }
  },
};
