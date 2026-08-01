import { publishRuntimeEvent } from './runtimeEventBus'
import type {
  GraphExecutionEventPayload,
  GraphScheduleEventPayload,
  HistoryRecordEventPayload,
  QueueJobEventPayload,
  QueueJobEventStatus,
  RuntimeJobHintPayload,
} from '../../types/runtimeEvents'
import type { GenerationQueueJobRecord } from '../../types/generationQueue'

/**
 * 이벤트 payload 조립을 한 곳에 모아 둔다.
 * 발행 지점이 큐 서비스/모델/그래프 실행기에 흩어져 있어도 와이어 형태는 여기서만 바뀐다.
 */

type QueueJobEventName = 'queue.job.created' | 'queue.job.status' | 'queue.job.cancel-requested'

/** Build one queue job payload from a queue row (list record or full record). */
function buildQueueJobPayload(
  job: Pick<
    GenerationQueueJobRecord,
    | 'id'
    | 'service_type'
    | 'status'
    | 'workflow_id'
    | 'requested_by_account_id'
    | 'cancel_requested'
    | 'provider_job_id'
    | 'assigned_server_id'
    | 'started_at'
    | 'completed_at'
    | 'failure_code'
    | 'cancel_requested_at'
    | 'cancel_origin'
    | 'provider_submit_state'
    | 'provider_submit_started_at'
    | 'provider_cancel_state'
    | 'submit_attempt_count'
  >,
  previousStatus: QueueJobEventStatus | null,
): QueueJobEventPayload {
  return {
    job_id: job.id,
    service_type: job.service_type,
    status: job.status,
    previous_status: previousStatus,
    workflow_id: job.workflow_id ?? null,
    requested_by_account_id: job.requested_by_account_id ?? null,
    cancel_requested: (job.cancel_requested ?? 0) > 0,
    provider_job_id: job.provider_job_id ?? null,
    assigned_server_id: job.assigned_server_id ?? null,
    started_at: job.started_at ?? null,
    completed_at: job.completed_at ?? null,
    failure_code: job.failure_code ?? null,
    cancel_requested_at: job.cancel_requested_at ?? null,
    cancel_origin: job.cancel_origin ?? null,
    provider_submit_state: job.provider_submit_state ?? null,
    provider_submit_started_at: job.provider_submit_started_at ?? null,
    provider_cancel_state: job.provider_cancel_state ?? null,
    submit_attempt_count: job.submit_attempt_count ?? null,
  }
}

/**
 * Publish one generation queue job event.
 *
 * 요청 계정이 있는 잡은 `visibility='account'` 로 발행해 소유자 + admin 에게만 전달한다.
 * 계정이 없는 시스템 잡(그래프 실행 등)은 기존 큐 목록 가시성과 같게 `all` 로 발행한다.
 */
export function publishQueueJobEvent(
  name: QueueJobEventName,
  job: Parameters<typeof buildQueueJobPayload>[0] | null | undefined,
  options?: { previousStatus?: QueueJobEventStatus | null },
): void {
  if (!job) {
    return
  }

  const accountId = job.requested_by_account_id ?? null
  publishRuntimeEvent({
    name,
    topic: 'generation-queue',
    visibility: accountId === null ? 'all' : 'account',
    accountId,
    payload: buildQueueJobPayload(job, options?.previousStatus ?? null),
  })
}

/** Publish one generation history event. */
export function publishHistoryRecordEvent(
  name: 'history.record.created' | 'history.record.status',
  payload: HistoryRecordEventPayload,
): void {
  publishRuntimeEvent({
    name,
    topic: 'generation-history',
    visibility: payload.requested_by_account_id === null ? 'all' : 'account',
    accountId: payload.requested_by_account_id,
    payload,
  })
}

/** Publish one workflow schedule change. Schedules are shared runtime state, so visibility stays 'all'. */
export function publishGraphScheduleEvent(payload: GraphScheduleEventPayload): void {
  publishRuntimeEvent({
    name: 'graph.schedule.changed',
    topic: 'graph-schedule',
    visibility: 'all',
    payload,
  })
}

/** Publish one graph execution status change. */
export function publishGraphExecutionEvent(payload: GraphExecutionEventPayload): void {
  publishRuntimeEvent({
    name: 'graph.execution.status',
    topic: 'graph-execution',
    visibility: 'all',
    payload,
  })
}

/**
 * Publish one long-running job hint.
 *
 * 잡은 라이브러리 전역 상태(스캔/재매칭/삭제)를 바꾸므로 가시성은 `all` 이다.
 * 힌트를 놓쳐도 `GET /api/jobs/:jobId` 폴링이 정본을 다시 읽으므로 전달 보장은 필요 없다.
 */
export function publishRuntimeJobHintEvent(payload: RuntimeJobHintPayload): void {
  publishRuntimeEvent({
    name: 'job.status',
    topic: 'runtime-job',
    visibility: 'all',
    payload,
  })
}
