import type { AuthAccountType } from './authAccount';

/** Services that can create generation-history rows. */
export type ServiceType = 'comfyui' | 'novelai' | 'codex';

/** Persisted generation-history lifecycle states. */
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface GenerationHistoryRecord {
  id?: number;

  service_type: ServiceType;
  generation_status: GenerationStatus;
  created_at?: string;
  completed_at?: string;

  workflow_id?: number;
  workflow_name?: string;
  nai_model?: string;
  composite_hash?: string;
  queue_job_id?: number;
  requested_by_account_id?: number;
  requested_by_account_type?: AuthAccountType;
  server_id?: number;
  error_message?: string;

  // Transitional compatibility fields kept while legacy rows still exist.
  width?: number;
  height?: number;
  original_path?: string;
  file_size?: number;
  assigned_group_id?: number;
  metadata?: string;
  comfyui_workflow?: string;

  // Legacy compatibility fields. New result-list code should not depend on them.
  comfyui_prompt_id?: string;
  nai_sampler?: string;
  nai_seed?: number;
  nai_steps?: number;
  nai_scale?: number;
  nai_parameters?: string;
  positive_prompt?: string;
  negative_prompt?: string;
}

export interface GenerationHistoryListRecord extends GenerationHistoryRecord {
  actual_composite_hash?: string | null;
  actual_width?: number | null;
  actual_height?: number | null;
  actual_mime_type?: string | null;
  result_file_status?: 'active' | 'missing' | 'deleted' | null;
  rating_score?: number | null;
  requested_server_id?: number | null;
  requested_server_name?: string | null;
  requested_server_tag?: string | null;
  assigned_server_id?: number | null;
  assigned_server_name?: string | null;
  queue_status?: 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled' | null;
  queue_cancel_requested?: number | null;
  provider_job_id?: string | null;
}

export interface GenerationHistoryDetailRecord extends GenerationHistoryRecord {
  actual_composite_hash?: string | null;
  actual_width?: number | null;
  actual_height?: number | null;
  actual_mime_type?: string | null;
  result_file_status?: 'active' | 'missing' | 'deleted' | null;
  rating_score?: number | null;
  requested_server_id?: number | null;
  requested_server_name?: string | null;
  requested_server_tag?: string | null;
  assigned_server_id?: number | null;
  assigned_server_name?: string | null;
  queue_status?: 'queued' | 'dispatching' | 'running' | 'completed' | 'failed' | 'cancelled' | null;
  queue_cancel_requested?: number | null;
  provider_job_id?: string | null;
}

export interface GenerationHistoryFilterOptions {
  ids?: number[];
  service_type?: ServiceType;
  generation_status?: GenerationStatus;
  workflow_id?: number;
  queue_job_id?: number;
  requested_by_account_id?: number;
  requested_by_account_type?: AuthAccountType;
  server_id?: number;
  limit?: number;
  offset?: number;
  order_by?: 'created_at' | 'completed_at';
  order_direction?: 'ASC' | 'DESC';
}

export interface GenerationHistoryStatistics {
  total: number;
  comfyui: number;
  novelai: number;
  codex: number;
  completed: number;
  failed: number;
  pending: number;
  processing: number;
}

export interface GenerationWorkflowStatistics {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  processing: number;
}
