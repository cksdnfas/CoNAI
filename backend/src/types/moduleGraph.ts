/**
 * Generic module-graph types for modular image generation workflows.
 */

import type { GraphExecutionStatus, GraphExecutionTriggerType, GraphWorkflowDocument, GraphWorkflowScheduleFailurePolicy, GraphWorkflowScheduleStatus, GraphWorkflowScheduleType, ModuleAuthoringSource, ModuleEngineType, ModulePortDefinition, ModuleUiFieldDefinition } from '@conai/shared'

export type {
  GraphExecutionArtifactRecord,
  GraphExecutionFinalResultRecord,
  GraphExecutionLogLevel,
  GraphExecutionLogRecord,
  GraphExecutionNodeIoDirection,
  GraphExecutionNodeIoRecord,
  GraphExecutionStatus,
  GraphExecutionTriggerType,
  GraphWorkflowDocument,
  GraphWorkflowEdge,
  GraphWorkflowExposedInput,
  GraphWorkflowFolderRecord,
  GraphWorkflowMetadata,
  GraphWorkflowNameRecord,
  GraphWorkflowNode,
  GraphWorkflowScheduleFailurePolicy,
  GraphWorkflowScheduleRecord,
  GraphWorkflowScheduleStatus,
  GraphWorkflowScheduleType,
  GraphWorkflowSummaryRecord,
  GraphWorkflowVersionSummaryRecord,
  ModuleAuthoringSource,
  ModuleEngineType,
  ModulePortDataType,
  ModulePortDefinition,
  ModulePortDirection,
  ModuleSelectOption,
  ModuleUiFieldDefinition,
} from '@conai/shared'

export interface ModuleDefinitionRecord {
  id: number
  name: string
  description?: string | null
  engine_type: ModuleEngineType
  authoring_source: ModuleAuthoringSource
  category?: string | null
  source_workflow_id?: number | null
  template_defaults: string
  exposed_inputs: string
  output_ports: string
  internal_fixed_values?: string | null
  ui_schema?: string | null
  version: number
  is_active: boolean
  color?: string | null
  external_key?: string | null
  source_path?: string | null
  source_hash?: string | null
  created_date: string
  updated_date: string
}

export interface ModuleDefinitionCreateData {
  name: string
  description?: string
  engine_type: ModuleEngineType
  authoring_source: ModuleAuthoringSource
  category?: string
  source_workflow_id?: number | null
  template_defaults: Record<string, unknown>
  exposed_inputs: ModulePortDefinition[]
  output_ports: ModulePortDefinition[]
  internal_fixed_values?: Record<string, unknown>
  ui_schema?: ModuleUiFieldDefinition[]
  version?: number
  is_active?: boolean
  color?: string
  external_key?: string
  source_path?: string
  source_hash?: string
}

export interface ModuleDefinitionUpdateData {
  name?: string
  description?: string
  category?: string
  template_defaults?: Record<string, unknown>
  exposed_inputs?: ModulePortDefinition[]
  output_ports?: ModulePortDefinition[]
  internal_fixed_values?: Record<string, unknown>
  ui_schema?: ModuleUiFieldDefinition[]
  version?: number
  is_active?: boolean
  color?: string
  external_key?: string | null
  source_path?: string | null
  source_hash?: string | null
}

export interface GraphWorkflowRecord {
  id: number
  revision: number
  name: string
  description?: string | null
  graph_json: string
  folder_id?: number | null
  version: number
  is_active: boolean
  created_date: string
  updated_date: string
}

export interface GraphWorkflowCreateData {
  name: string
  description?: string
  graph: GraphWorkflowDocument
  folder_id?: number | null
  version?: number
  is_active?: boolean
}

export interface GraphWorkflowUpdateData {
  name?: string
  description?: string
  graph?: GraphWorkflowDocument
  folder_id?: number | null
  version?: number
  is_active?: boolean
}

export interface GraphWorkflowVersionRecord {
  id: number
  workflow_id: number
  version: number
  graph_json: string
  changelog?: string | null
  created_date: string
}

export interface GraphWorkflowRuntimeHealthRecord {
  workflow_id: number
  queue: {
    queued_count: number
    running_count: number
    manual_queued_count: number
    manual_running_count: number
    schedule_queued_count: number
    schedule_running_count: number
    in_process_running_count: number
    oldest_queued_at?: string | null
    retry_timer_pending: boolean
    queue_recheck_interval_ms: number
    schedule_concurrency_limit: number
    cancellation_requested_count: number
  }
  retry_policy: {
    schedule_count: number
    active_schedule_count: number
    stop_on_failure_count: number
    continue_on_failure_count: number
    paused_for_review_count: number
    stopped_after_error_count: number
    overlap_stopped_count: number
  }
  retention: {
    output_retention_limit: number
    pending_prune: boolean
    pending_prune_count: number
  }
  recovery: {
    last_startup_recovery_at?: string | null
    startup_queued_backlog: number
    startup_failed_running: number
    running_not_in_process_count: number
  }
  telemetry: {
    completed_count: number
    failed_count: number
    cancelled_count: number
    latest_completed_at?: string | null
    latest_failed_at?: string | null
    latest_error_message?: string | null
  }
}

export interface GraphExecutionRecord {
  id: number
  graph_workflow_id: number
  graph_version: number
  status: GraphExecutionStatus
  trigger_type?: GraphExecutionTriggerType
  schedule_id?: number | null
  execution_plan?: string | null
  started_at?: string | null
  completed_at?: string | null
  failed_node_id?: string | null
  error_message?: string | null
  /** The account that started a manual run (null: a scheduled run, or no accounts configured). */
  requested_by_account_id?: number | null
  queue_position?: number | null
  cancel_requested?: boolean
  created_date: string
  updated_date: string
}

export interface GraphWorkflowScheduleCreateData {
  graph_workflow_id: number
  name: string
  schedule_type: GraphWorkflowScheduleType
  status?: GraphWorkflowScheduleStatus
  timezone?: string | null
  run_at?: string | null
  interval_minutes?: number | null
  daily_time?: string | null
  max_run_count?: number | null
  run_enqueue_count?: number | null
  failure_policy?: GraphWorkflowScheduleFailurePolicy | null
  input_values?: Record<string, unknown> | null
  confirmed_graph_version?: number | null
  confirmed_input_signature?: string | null
  stop_reason_code?: string | null
  stop_reason_message?: string | null
  last_execution_id?: number | null
  next_run_at?: string | null
  last_enqueued_at?: string | null
  /** The account the schedule runs as (who last saved it); null on schedules saved before accounts were recorded. */
  run_as_account_id?: number | null
}

export interface GraphWorkflowScheduleUpdateData {
  name?: string
  schedule_type?: GraphWorkflowScheduleType
  status?: GraphWorkflowScheduleStatus
  timezone?: string | null
  run_at?: string | null
  interval_minutes?: number | null
  daily_time?: string | null
  max_run_count?: number | null
  run_enqueue_count?: number | null
  failure_policy?: GraphWorkflowScheduleFailurePolicy | null
  input_values?: Record<string, unknown> | null
  confirmed_graph_version?: number | null
  confirmed_input_signature?: string | null
  stop_reason_code?: string | null
  stop_reason_message?: string | null
  last_execution_id?: number | null
  next_run_at?: string | null
  last_enqueued_at?: string | null
  /** The account the schedule runs as (who last saved it); null on schedules saved before accounts were recorded. */
  run_as_account_id?: number | null
}

export interface ModuleGraphResponse {
  success: boolean
  data?: any
  error?: string
}
