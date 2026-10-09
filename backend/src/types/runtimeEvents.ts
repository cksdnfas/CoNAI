/**
 * 런타임 이벤트 스트림(SSE) 계약.
 *
 * 이 파일은 `frontend/src/lib/runtime-events-types.ts` 와 1:1 미러이며,
 * 두 파일의 `RuntimeEventTopic` / `RuntimeEventName` 유니온 집합은 항상 일치해야 한다.
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
  | 'chat.generation.finished'
  | 'chat.reaction.created'
  | 'chat.message.created'
  | 'chat.message.updated'
  | 'chat.page.command'
  | 'chat.task.updated'
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

/** Topic rights match the corresponding REST surface; null means an owner-filtered authenticated session. */
export const RUNTIME_EVENT_TOPIC_PERMISSIONS: Record<RuntimeEventTopic, string | null> = {
  'generation-queue': null,
  'runtime-job': null,
  'generation-history': 'images.view',
  'graph-schedule': 'workflows.view',
  'graph-execution': 'workflows.view',
}


/**
 * SSE 데이터 프레임 공통 봉투.
 * `id` 는 프로세스 로컬 시퀀스이며 SSE `id:` 필드와 일치한다.
 * 프로세스가 재시작하면 시퀀스도 초기화되므로 `hello.server_boot_id` 로 세대를 구분한다.
 */
export interface RuntimeEventEnvelope<TPayload = unknown> {
  id: number
  name: RuntimeEventName
  topic: RuntimeEventTopic
  at: string
  payload: TPayload
}

/** 'account' includes admins; 'owner' stays strictly within the owning account (including bootstrap null). */
export type RuntimeEventVisibility = 'all' | 'account' | 'owner'

/** 버스 내부 레코드. 라우팅 메타데이터는 와이어로 나가지 않는다. */
export interface RuntimeEventRecord<TPayload = unknown> extends RuntimeEventEnvelope<TPayload> {
  visibility: RuntimeEventVisibility
  accountId: number | null
}

export type QueueJobEventStatus = 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ChatReactionCreatedEventPayload {
  threadId: number
  messageId: number
  requestedByAccountId: number | null
}

/** A reply was saved to one of the owner's chats (any engine, any tab): unread counts may have changed. */
export interface ChatMessageCreatedEventPayload {
  threadId: number
  messageId: number
  requestedByAccountId: number | null
}

/** A stored reply changed after it was announced (the judge settled its status fields): its chat refetches. */
export type ChatMessageUpdatedEventPayload = ChatMessageCreatedEventPayload

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
  // Wave 2 #2 가 승격한 취소 프로토콜 컬럼. 목록 응답과 같은 필드를 실어야 브리지 패치가 어긋나지 않는다.
  cancel_requested_at: string | null
  cancel_origin: string | null
  provider_submit_state: string | null
  provider_submit_started_at: string | null
  provider_cancel_state: string | null
  submit_attempt_count: number | null
}

/** A terminal chat-linked job, delivered only to the requesting thread owner. */
export interface ChatGenerationFinishedEventPayload {
  jobId: number
  requestedByAccountId: number | null
  status: 'completed' | 'failed' | 'cancelled'
  chat: { threadId: number; threadTitle: string; replyId: string; characterName: string | null }
  /** Completed images across the linked reply, so successive jobs replace one notification. */
  imageCount: number
  thumbnailHistoryId: number | null
  failureCode: string | null
  /** Audio-order jobs: sound candidates this job made (absent for image jobs). */
  audioCandidateCount?: number
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
  /** `graph_executions.status` 원본. `draft` 를 포함하므로 좁히지 않는다. */
  status: string
  trigger_type: string
  schedule_id: number | null
}

/**
 * 장기 실행 잡의 **무효화 힌트**. 진행률 수치는 절대 싣지 않는다.
 *
 * 정본은 `runtime_jobs` 테이블이고 조회 경로는 `GET /api/jobs/:jobId` 폴링이다.
 * 이 이벤트는 "지금 다시 읽어라" 는 신호일 뿐이라, 유실되어도 폴링이 스스로 회복한다.
 */
export interface RuntimeJobHintPayload {
  job_id: string
  kind: string
  status: string
  updated_at: string
}

/** 제어 이벤트: 데이터 이벤트와 달리 연결별로만 발행되고 재생 버퍼에 남지 않는다. */
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

/** 제어 이벤트 이름. 데이터 이벤트 이름과 네임스페이스가 겹치지 않는다. */
export type RuntimeEventControlName = 'hello' | 'heartbeat' | 'reset' | 'session-expired'
