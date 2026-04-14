import type { AuthAccountType } from '../models/AuthAccount'
import type { ServiceType } from '../models/GenerationHistory'

export type GenerationQueueJobStatus = 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled'

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
  queued_at: string
  started_at?: string | null
  completed_at?: string | null
  created_date: string
  updated_date: string
  queue_position?: number | null
  queue_position_scope?: 'service' | 'server' | 'tag' | 'auto' | null
  queue_position_server_id?: number | null
  queue_position_server_tag?: string | null
  estimated_wait_seconds?: number | null
  estimated_total_seconds?: number | null
  estimated_duration_seconds?: number | null
  is_mine?: boolean
}

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
  queued_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}
