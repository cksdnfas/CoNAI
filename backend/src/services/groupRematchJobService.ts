import { RuntimeJobRunner } from './runtimeJobs/runtimeJobRunner';
import { RuntimeJobConflictError, RuntimeJobStore } from './runtimeJobs/runtimeJobStore';
import type { RuntimeJobRecord } from '../types/runtimeJob';

/**
 * 그룹 재매칭 잡 어댑터.
 *
 * 실행/상태 저장은 전부 `RuntimeJobRunner` + `runtime_jobs` 로 넘어갔고, 이 클래스에는
 * **레거시 응답 형태로 되돌리는 변환만** 남는다. `GET /api/groups/auto-collect-jobs/:jobId`
 * 와 프론트의 `GroupRematchJobRecord` 를 한 릴리스 동안 그대로 유지하기 위한 얇은 층이다.
 */

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

/**
 * 레거시 상태 매핑.
 * `cancelled` 는 예전 계약에 없던 상태이므로 `failed` 로 접는다 — 레거시 폴링 루프
 * (`waitForGroupRematchJob`)가 종료를 인지할 수 있어야 무한 대기가 생기지 않는다.
 */
function toLegacyStatus(status: RuntimeJobRecord['status']): GroupRematchJobStatus {
  if (status === 'completed') {
    return 'completed';
  }
  if (status === 'failed' || status === 'cancelled') {
    return 'failed';
  }
  return status;
}

function toLegacyProgress(job: RuntimeJobRecord): GroupRematchJobProgress {
  return {
    total: job.progress.total,
    completed: job.progress.succeeded,
    failed: job.progress.failed,
    percentage: job.progress.percentage,
    current_label: job.progress.currentLabel,
  };
}

/** Convert one runtime job record into the legacy group rematch payload. */
export function toGroupRematchJobRecord(job: RuntimeJobRecord, groupId?: number | null): GroupRematchJobRecord {
  return {
    job_id: job.jobId,
    kind: job.kind as GroupRematchJobKind,
    status: toLegacyStatus(job.status),
    progress: toLegacyProgress(job),
    group_id: groupId ?? null,
    result: job.result ?? undefined,
    error: job.failureMessage,
    created_at: job.queuedAt,
    updated_at: job.updatedAt,
    started_at: job.startedAt,
    completed_at: job.completedAt,
  };
}

export class GroupRematchJobService {
  /**
   * Start (or join) one group rematch job.
   *
   * 같은 대상의 잡이 이미 살아 있으면 **새 잡을 만들지 않고 그 잡을 돌려준다.**
   * 레거시 호출부는 응답의 job_id 를 완료까지 await 하므로, 409 를 던지는 대신 붙여 주는 쪽이
   * 기존 동작(눌린 만큼 다 실행됨)에 더 가깝고 사용자에게도 정확하다.
   */
  static startJobProcess(
    kind: GroupRematchJobKind,
    input: { groupId?: number | null; requestedByAccountId?: number | null } = {},
  ): GroupRematchJobRecord {
    const groupId = input.groupId ?? null;
    const params = kind === 'group-auto-collect' ? { groupId } : {};

    try {
      const job = RuntimeJobRunner.start(kind, params, {
        requestedByAccountId: input.requestedByAccountId ?? null,
      });
      return toGroupRematchJobRecord(job, groupId);
    } catch (error) {
      if (error instanceof RuntimeJobConflictError && error.liveJob) {
        return toGroupRematchJobRecord(error.liveJob, groupId);
      }
      throw error;
    }
  }

  /** Read one job in the legacy shape. `/auto-collect-jobs/:jobId` alias 가 쓴다. */
  static readJob(jobId: string): GroupRematchJobRecord | null {
    const job = RuntimeJobStore.get(jobId);
    if (!job) {
      return null;
    }

    return toGroupRematchJobRecord(job, resolveGroupIdFromParams(jobId));
  }
}

/** Recover the group id a job was started with, so the legacy record keeps its `group_id`. */
function resolveGroupIdFromParams(jobId: string): number | null {
  const raw = RuntimeJobStore.getParamsJson(jobId);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { groupId?: unknown };
    return typeof parsed.groupId === 'number' ? parsed.groupId : null;
  } catch {
    return null;
  }
}
