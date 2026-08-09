import type { AuthAccountType } from './authAccount'
import type { ServiceType } from './generationHistory'

export type GenerationQueueJobStatus = 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled'

/**
 * `status`와 직교하는 축: "업스트림에 작업을 만들었을 가능성".
 * DB CHECK 없이 앱 레벨 enum으로만 강제하므로 상수 배열/컨트랙트로 정합을 지킨다.
 */
export type GenerationQueueProviderSubmitState =
  | 'none'
  | 'in_flight'
  | 'accepted'
  | 'orphan_suspected'
  | 'orphan_unresolved'
  | 'cancel_sent'
  | 'cancel_confirmed'
  | 'cancel_unsupported'

/** 취소 요청의 출처. 스테일 스위퍼/기동 reconcile 이 만든 취소를 사용자 취소와 구분한다. */
export type GenerationQueueCancelOrigin = 'user' | 'graph' | 'system' | 'reconcile'

export type GenerationQueueProgressPhase = 'preparing' | 'executing' | 'sampling' | 'finalizing'

/** Latest trusted progress sample received directly from a standard ComfyUI server. */
export interface GenerationQueueLiveProgress {
  source: 'comfyui_ws'
  phase: GenerationQueueProgressPhase
  node_id: string | null
  node_label: string | null
  value: number | null
  max: number | null
  percent: number | null
  updated_at: string
}

export interface GenerationQueueJobRecord {
  id: number
  service_type: ServiceType
  status: GenerationQueueJobStatus
  priority: number
  requested_by_account_id?: number | null
  requested_by_username?: string | null
  requested_by_account_type?: AuthAccountType | null
  workflow_id?: number | null
  workflow_name?: string | null
  requested_group_id?: number | null
  requested_server_id?: number | null
  requested_server_tag?: string | null
  assigned_server_id?: number | null
  provider_job_id?: string | null
  request_payload: string
  request_summary?: string | null
  failure_code?: string | null
  failure_message?: string | null
  cancel_requested: number
  cancel_requested_at?: string | null
  cancel_origin?: GenerationQueueCancelOrigin | null
  provider_submit_state?: GenerationQueueProviderSubmitState
  provider_submit_started_at?: string | null
  provider_cancel_state?: string | null
  submit_attempt_count?: number
  /** 029/PAYLOAD-2: 디버그 스냅샷 요청 여부. NULL 은 "029 이전 행" 이라 payload 폴백 대상이다. */
  debug_enabled?: number | null
  /** 029/PAYLOAD-2: 구 `request_payload._debug` 미러. 페이로드 재기록 없이 갱신된다. */
  debug_meta?: string | null
  queued_at: string
  started_at?: string | null
  completed_at?: string | null
  created_date: string
  updated_date: string
  queue_position?: number | null
  queue_position_scope?: 'service' | 'server' | 'tag' | 'auto' | null
  queue_position_server_id?: number | null
  queue_position_server_tag?: string | null
  estimated_start_at?: string | null
  estimated_wait_seconds?: number | null
  estimated_total_seconds?: number | null
  estimated_duration_seconds?: number | null
  live_progress?: GenerationQueueLiveProgress | null
  is_mine?: boolean
}

export type GenerationQueueJobListRecord = Omit<GenerationQueueJobRecord, 'request_payload'>

export type GenerationQueueRoutingJobRecord = Pick<
  GenerationQueueJobRecord,
  | 'id'
  | 'service_type'
  | 'workflow_id'
  | 'requested_server_id'
  | 'requested_server_tag'
  | 'assigned_server_id'
  | 'cancel_requested'
>

export type GenerationQueueDispatchCandidateRecord = GenerationQueueRoutingJobRecord & Pick<
  GenerationQueueJobRecord,
  | 'status'
  | 'priority'
  | 'queued_at'
>

export type GenerationQueueDurationSample = Pick<
  GenerationQueueJobRecord,
  | 'id'
  | 'service_type'
  | 'workflow_id'
  | 'requested_server_id'
  | 'assigned_server_id'
  | 'started_at'
  | 'completed_at'
>

export interface GenerationQueueJobCreateData {
  service_type: ServiceType
  status?: GenerationQueueJobStatus
  priority?: number
  requested_by_account_id?: number | null
  requested_by_account_type?: AuthAccountType | null
  workflow_id?: number | null
  workflow_name?: string | null
  requested_group_id?: number | null
  requested_server_id?: number | null
  requested_server_tag?: string | null
  assigned_server_id?: number | null
  provider_job_id?: string | null
  request_payload: Record<string, unknown>
  request_summary?: string | null
  failure_code?: string | null
  failure_message?: string | null
  cancel_requested?: boolean
  cancel_requested_at?: string | null
  cancel_origin?: GenerationQueueCancelOrigin | null
  provider_submit_state?: GenerationQueueProviderSubmitState
  provider_submit_started_at?: string | null
  provider_cancel_state?: string | null
  submit_attempt_count?: number
  queued_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}

export interface GenerationQueueJobUpdateData {
  status?: GenerationQueueJobStatus
  priority?: number
  requested_by_account_id?: number | null
  requested_by_account_type?: AuthAccountType | null
  workflow_id?: number | null
  workflow_name?: string | null
  requested_group_id?: number | null
  requested_server_id?: number | null
  requested_server_tag?: string | null
  assigned_server_id?: number | null
  provider_job_id?: string | null
  request_payload?: Record<string, unknown>
  request_summary?: string | null
  failure_code?: string | null
  failure_message?: string | null
  cancel_requested?: boolean
  cancel_requested_at?: string | null
  cancel_origin?: GenerationQueueCancelOrigin | null
  provider_submit_state?: GenerationQueueProviderSubmitState
  provider_submit_started_at?: string | null
  provider_cancel_state?: string | null
  submit_attempt_count?: number
  queued_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}

/** 취소 폴링 hot path 전용 경량 스냅샷 (request_payload 를 읽지 않는다). */
export type GenerationQueueCancelState = {
  status: GenerationQueueJobStatus
  cancelRequested: boolean
  providerSubmitState: GenerationQueueProviderSubmitState
  providerJobId: string | null
}

/** orphan reconcile / 스테일 스위퍼가 다루는 최소 필드 집합. */
export type GenerationQueueReconcileCandidate = Pick<
  GenerationQueueJobRecord,
  | 'id'
  | 'service_type'
  | 'status'
  | 'workflow_id'
  | 'assigned_server_id'
  | 'provider_job_id'
  | 'provider_submit_state'
  | 'provider_submit_started_at'
  | 'cancel_requested'
>
