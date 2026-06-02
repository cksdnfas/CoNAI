import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { runtimePaths } from '../config/runtimePaths';

export type GroupRematchJobKind = 'group-auto-collect' | 'all-auto-collect' | 'auto-folder-rebuild';
export type GroupRematchJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface GroupRematchJobProgress {
  total: number;
  completed: number;
  failed: number;
  percentage: number;
  current_label?: string | null;
}

export interface GroupRematchJobRecord {
  job_id: string;
  kind: GroupRematchJobKind;
  status: GroupRematchJobStatus;
  progress: GroupRematchJobProgress;
  group_id?: number | null;
  result?: unknown;
  error?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

const JOB_DIR = path.join(runtimePaths.tempDir, 'group-rematch-jobs');
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

function ensureJobDir(): void {
  if (!fs.existsSync(JOB_DIR)) {
    fs.mkdirSync(JOB_DIR, { recursive: true });
  }
}

function resolveJobPath(jobId: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) {
    throw new Error('Invalid group rematch job id');
  }
  return path.join(JOB_DIR, `${jobId}.json`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeProgress(progress: Partial<GroupRematchJobProgress> | undefined): GroupRematchJobProgress {
  const total = Math.max(0, Math.floor(progress?.total ?? 0));
  const completed = Math.max(0, Math.floor(progress?.completed ?? 0));
  const failed = Math.max(0, Math.floor(progress?.failed ?? 0));
  const denominator = total > 0 ? total : Math.max(1, completed + failed);
  const percentage = total > 0
    ? Math.min(100, Math.round(((completed + failed) / denominator) * 100))
    : 0;

  return {
    total,
    completed,
    failed,
    percentage,
    current_label: progress?.current_label ?? null,
  };
}

export class GroupRematchJobService {
  static createJob(kind: GroupRematchJobKind, input: { groupId?: number | null; total?: number } = {}): GroupRematchJobRecord {
    ensureJobDir();
    this.cleanupExpiredJobs();

    const timestamp = nowIso();
    const job: GroupRematchJobRecord = {
      job_id: randomUUID(),
      kind,
      status: 'queued',
      progress: normalizeProgress({ total: input.total ?? 0 }),
      group_id: input.groupId ?? null,
      error: null,
      created_at: timestamp,
      updated_at: timestamp,
      started_at: null,
      completed_at: null,
    };

    this.writeJob(job);
    return job;
  }

  static readJob(jobId: string): GroupRematchJobRecord | null {
    const jobPath = resolveJobPath(jobId);
    if (!fs.existsSync(jobPath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(jobPath, 'utf8')) as GroupRematchJobRecord;
    parsed.progress = normalizeProgress(parsed.progress);
    return parsed;
  }

  static writeJob(job: GroupRematchJobRecord): void {
    ensureJobDir();
    const nextJob = {
      ...job,
      progress: normalizeProgress(job.progress),
      updated_at: nowIso(),
    };
    fs.writeFileSync(resolveJobPath(nextJob.job_id), JSON.stringify(nextJob, null, 2));
  }

  static updateJob(jobId: string, updater: (job: GroupRematchJobRecord) => GroupRematchJobRecord): GroupRematchJobRecord {
    const current = this.readJob(jobId);
    if (!current) {
      throw new Error(`Group rematch job not found: ${jobId}`);
    }
    const next = updater(current);
    this.writeJob(next);
    return next;
  }

  static startJobProcess(kind: GroupRematchJobKind, input: { groupId?: number | null } = {}): GroupRematchJobRecord {
    const job = this.createJob(kind, { groupId: input.groupId ?? null });
    const runner = this.resolveRunnerCommand();
    const args = [...runner.args, '--job-id', job.job_id, '--kind', kind];

    if (input.groupId !== undefined && input.groupId !== null) {
      args.push('--group-id', String(input.groupId));
    }

    const outFd = fs.openSync(path.join(JOB_DIR, `${job.job_id}.out.log`), 'a');
    const errFd = fs.openSync(path.join(JOB_DIR, `${job.job_id}.err.log`), 'a');

    try {
      const child = spawn(runner.command, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CONAI_GROUP_REMATCH_JOB_ID: job.job_id,
          CONAI_RUNTIME_ROLE: 'group-rematch-job',
        },
        windowsHide: true,
        detached: false,
        stdio: ['ignore', outFd, errFd],
      });

      child.unref();
      fs.closeSync(outFd);
      fs.closeSync(errFd);
      child.on('error', (error) => {
        this.markFailed(job.job_id, error.message);
      });
      child.on('exit', (code) => {
        if (code === 0) {
          return;
        }
        const current = this.readJob(job.job_id);
        if (current && current.status !== 'completed' && current.status !== 'failed') {
          this.markFailed(job.job_id, `Group rematch job exited with code ${code ?? 'unknown'}`);
        }
      });
    } catch (error) {
      fs.closeSync(outFd);
      fs.closeSync(errFd);
      this.markFailed(job.job_id, error instanceof Error ? error.message : 'Failed to start group rematch job');
      throw error;
    }

    return job;
  }

  static markRunning(jobId: string, progress?: Partial<GroupRematchJobProgress>): void {
    this.updateJob(jobId, (job) => ({
      ...job,
      status: 'running',
      started_at: job.started_at ?? nowIso(),
      progress: normalizeProgress({ ...job.progress, ...progress }),
    }));
  }

  static markCompleted(jobId: string, result: unknown, progress?: Partial<GroupRematchJobProgress>): void {
    this.updateJob(jobId, (job) => ({
      ...job,
      status: 'completed',
      result,
      completed_at: nowIso(),
      progress: normalizeProgress({ ...job.progress, ...progress, completed: progress?.completed ?? job.progress.total }),
    }));
  }

  static markFailed(jobId: string, error: string, progress?: Partial<GroupRematchJobProgress>): void {
    this.updateJob(jobId, (job) => ({
      ...job,
      status: 'failed',
      error,
      completed_at: nowIso(),
      progress: normalizeProgress({ ...job.progress, ...progress }),
    }));
  }

  private static resolveRunnerCommand(): { command: string; args: string[] } {
    const compiledScript = path.resolve(__dirname, '../scripts/runGroupRematchJob.js');
    if (fs.existsSync(compiledScript)) {
      return { command: process.execPath, args: [compiledScript] };
    }

    const sourceScript = path.resolve(__dirname, '../scripts/runGroupRematchJob.ts');
    if (fs.existsSync(sourceScript)) {
      return { command: process.execPath, args: [path.resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs'), sourceScript] };
    }

    throw new Error('Group rematch job runner script not found');
  }

  private static cleanupExpiredJobs(): void {
    ensureJobDir();
    const cutoff = Date.now() - JOB_TTL_MS;

    for (const entry of fs.readdirSync(JOB_DIR)) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      const jobPath = path.join(JOB_DIR, entry);
      const stat = fs.statSync(jobPath);
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(jobPath, { force: true });
      }
    }
  }
}
