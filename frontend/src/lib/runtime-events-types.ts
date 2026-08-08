/**
 * 런타임 이벤트 스트림(SSE) 타입 미러.
 *
 * `backend/src/types/runtimeEvents.ts` 와 유니온 리터럴 집합이 정확히 일치해야 하며,
 * 어긋나면 `npm run verify:runtime-event-stream-ui-contracts` 가 실패한다.
 */

export type RuntimeEventTopic =
  | 'generation-queue'
  | 'generation-history'
  | 'graph-schedule'
  | 'graph-execution'
  | 'runtime-job'

export type RuntimeEventName =
  | 'queue.job.created'
  | 'queue.job.status'
  | 'queue.job.cancel-requested'
  | 'queue.job.progress'
  | 'history.record.created'
  | 'history.record.status'
  | 'graph.schedule.changed'
  | 'graph.execution.status'
  | 'job.status'

export const RUNTIME_EVENT_TOPICS: readonly RuntimeEventTopic[] = [
  'generation-queue',
  'generation-history',
  'graph-schedule',
  'graph-execution',
  'runtime-job',
]

/** 모든 토픽이 요구하는 권한 키. 서버 가드(`RUNTIME_EVENT_TOPIC_PERMISSION_KEY`)와 같아야 한다. */
export const RUNTIME_EVENT_STREAM_PERMISSION_KEY = 'page.generation.view'

/** SSE 데이터 프레임 공통 봉투. `id` 는 서버 프로세스 로컬 시퀀스이자 재개 커서다. */
export interface RuntimeEventEnvelope<TPayload = unknown> {
  id: number
  name: RuntimeEventName
  topic: RuntimeEventTopic
  at: string
  payload: TPayload
}

export type QueueJobEventStatus = 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface QueueJobEventPayload {
  job_id: number
  service_type: 'comfyui' | 'novelai' | 'codex'
  status: QueueJobEventStatus
  previous_status: QueueJobEventStatus | null
  workflow_id: number | null
  requested_by_account_id: number | null
  cancel_requested: boolean
  provider_job_id: string | null
  assigned_server_id: number | null
  started_at: string | null
  completed_at: string | null
  failure_code: string | null
  cancel_requested_at: string | null
  cancel_origin: string | null
  provider_submit_state: string | null
  provider_submit_started_at: string | null
  provider_cancel_state: string | null
  submit_attempt_count: number | null
}

export interface QueueJobProgressEventPayload {
  job_id: number
  provider_job_id: string | null
  source: 'comfyui_ws'
  phase: 'preparing' | 'executing' | 'sampling' | 'finalizing'
  node_id: string | null
  node_label: string | null
  value: number | null
  max: number | null
  percent: number | null
  updated_at: string
}

export interface HistoryRecordEventPayload {
  history_id: number
  queue_job_id: number | null
  service_type: string
  workflow_id: number | null
  generation_status: 'pending' | 'processing' | 'completed' | 'failed'
  composite_hash: string | null
  requested_by_account_id: number | null
}

export interface GraphScheduleEventPayload {
  schedule_id: number
  graph_workflow_id: number
  status: string
  next_run_at: string | null
  last_execution_id: number | null
  stop_reason_code: string | null
}

export interface GraphExecutionEventPayload {
  execution_id: number
  graph_workflow_id: number
  status: string
  trigger_type: string
  schedule_id: number | null
}

/**
 * 장기 실행 잡의 **무효화 힌트**. 진행률 수치는 싣지 않는다.
 * 브리지는 이 이벤트를 받으면 해당 잡 쿼리를 무효화만 하고, 값은 `GET /api/jobs/:jobId` 가 준다.
 */
export interface RuntimeJobHintPayload {
  job_id: string
  kind: string
  status: string
  updated_at: string
}

/** 제어 이벤트: 데이터 이벤트와 달리 연결별로만 발행된다. */
export interface RuntimeEventHello {
  cursor: number
  server_boot_id: string
  runtime_role: 'all' | 'api' | 'worker'
  topics: RuntimeEventTopic[]
  heartbeat_interval_ms: number
}

export interface RuntimeEventHeartbeat {
  cursor: number
  at: string
}

export interface RuntimeEventReset {
  reason: 'cursor-expired' | 'server-restart'
}

export interface RuntimeEventSessionExpired {
  reason: 'unauthenticated' | 'permission-revoked'
}

export type RuntimeEventControlName = 'hello' | 'heartbeat' | 'reset' | 'session-expired'
