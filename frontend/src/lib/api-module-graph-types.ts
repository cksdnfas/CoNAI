export type ModuleEngineType = 'nai' | 'codex' | 'comfyui' | 'system' | 'custom_js'
export type ModuleAuthoringSource = 'nai_form_snapshot' | 'codex_form_snapshot' | 'comfyui_workflow_wrap' | 'manual' | 'custom_node_fs'
export type ModulePortDirection = 'input' | 'output'
export type ModulePortDataType = 'image' | 'mask' | 'prompt' | 'text' | 'number' | 'boolean' | 'json' | 'any'
export type ModuleSelectOption = string | { value: string; label: string }

export interface ModulePortDefinition {
  key: string
  label: string
  direction: ModulePortDirection
  data_type: ModulePortDataType
  description?: string
  required?: boolean
  multiple?: boolean
  default_value?: unknown
  ui_hint?: string
  source_path?: string
}

export interface ModuleUiFieldDefinition {
  key: string
  label: string
  data_type: ModulePortDataType | 'select'
  description?: string
  default_value?: unknown
  options?: ModuleSelectOption[]
  dropdown_list_name?: string
  min?: number
  max?: number
  placeholder?: string
  ui_hint?: string
  node_editor?: 'power_lora_loader_rgthree'
  node_items?: Array<{
    key: string
    label: string
    lora?: string
  }>
}

export interface ModuleDefinitionRecord {
  id: number
  name: string
  description?: string | null
  engine_type: ModuleEngineType
  authoring_source: ModuleAuthoringSource
  category?: string | null
  source_workflow_id?: number | null
  template_defaults: Record<string, unknown>
  exposed_inputs: ModulePortDefinition[]
  output_ports: ModulePortDefinition[]
  internal_fixed_values?: Record<string, unknown> | null
  ui_schema?: ModuleUiFieldDefinition[] | null
  version: number
  is_active: boolean
  color?: string | null
  external_key?: string | null
  source_path?: string | null
  source_hash?: string | null
  created_date: string
  updated_date: string
}

export interface GraphWorkflowNode {
  id: string
  module_id: number
  label?: string
  disabled?: boolean
  position: {
    x: number
    y: number
  }
  input_values?: Record<string, unknown>
}

export interface GraphWorkflowEdge {
  id: string
  source_node_id: string
  source_port_key: string
  target_node_id: string
  target_port_key: string
}

export interface GraphWorkflowExposedInput {
  id: string
  node_id: string
  port_key: string
  label: string
  data_type: ModulePortDataType
  ui_data_type?: ModulePortDataType | 'select'
  description?: string
  required?: boolean
  placeholder?: string
  default_value?: unknown
  options?: string[]
  module_id?: number
  module_name?: string
}

export interface GraphWorkflowMetadata {
  exposed_inputs?: GraphWorkflowExposedInput[]
  debug_mode?: boolean
}

export interface GraphWorkflowDocument {
  nodes: GraphWorkflowNode[]
  edges: GraphWorkflowEdge[]
  viewport?: {
    x: number
    y: number
    zoom: number
  }
  metadata?: GraphWorkflowMetadata
}

export interface GraphWorkflowRecord {
  id: number
  name: string
  description?: string | null
  graph: GraphWorkflowDocument
  folder_id?: number | null
  version: number
  is_active: boolean
  created_date: string
  updated_date: string
}

export interface GraphWorkflowVersionSummaryRecord {
  id: number
  workflow_id: number
  version: number
  changelog?: string | null
  created_date: string
  node_count: number
  edge_count: number
  exposed_input_count: number
  debug_mode: boolean
  previous_version?: number | null
  node_delta: number
  edge_delta: number
  exposed_input_delta: number
}

export interface GraphWorkflowFolderRecord {
  id: number
  name: string
  description?: string | null
  parent_id?: number | null
  created_date: string
  updated_date: string
}

export type GraphExecutionStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type GraphExecutionTriggerType = 'manual' | 'schedule'
export type GraphWorkflowScheduleType = 'once' | 'interval' | 'daily'
export type GraphWorkflowScheduleStatus = 'active' | 'paused' | 'error_stopped' | 'overlap_stopped' | 'completed'
export type GraphWorkflowScheduleFailurePolicy = 'stop' | 'continue'

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
  queue_position?: number | null
  cancel_requested?: boolean
  created_date: string
  updated_date: string
}

export interface GraphWorkflowScheduleRecord {
  id: number
  graph_workflow_id: number
  name: string
  schedule_type: GraphWorkflowScheduleType
  status: GraphWorkflowScheduleStatus
  timezone?: string | null
  run_at?: string | null
  interval_minutes?: number | null
  daily_time?: string | null
  max_run_count?: number | null
  run_enqueue_count?: number | null
  failure_policy?: GraphWorkflowScheduleFailurePolicy | null
  input_values?: string | null
  confirmed_graph_version?: number | null
  confirmed_input_signature?: string | null
  stop_reason_code?: string | null
  stop_reason_message?: string | null
  last_execution_id?: number | null
  next_run_at?: string | null
  last_enqueued_at?: string | null
  completed_run_count?: number
  queued_run_count?: number
  running_run_count?: number
  failed_run_count?: number
  reserved_run_count?: number
  remaining_run_count?: number | null
  created_date: string
  updated_date: string
}

export type GraphExecutionLogLevel = 'info' | 'warn' | 'error'

export interface GraphExecutionLogRecord {
  id: number
  execution_id: number
  node_id?: string | null
  level: GraphExecutionLogLevel
  event_type: string
  message: string
  details?: string | null
  created_date: string
}

export interface GraphExecutionArtifactRecord {
  id: number
  execution_id: number
  node_id: string
  port_key: string
  artifact_type: ModulePortDataType | 'file'
  storage_path?: string | null
  metadata?: string | null
  created_date: string
}

export interface GraphExecutionFinalResultRecord {
  id: number
  execution_id: number
  final_node_id: string
  source_artifact_id: number
  source_execution_id?: number | null
  source_node_id: string
  source_port_key: string
  artifact_type: ModulePortDataType | 'file'
  source_storage_path?: string | null
  source_metadata?: string | null
  created_date: string
}

export type GraphExecutionNodeIoDirection = 'input' | 'output'

export interface GraphExecutionNodeIoRecord {
  id: number
  execution_id: number
  node_id: string
  direction: GraphExecutionNodeIoDirection
  port_key: string
  source_node_id?: string | null
  source_port_key?: string | null
  output_index: number
  artifact_type?: ModulePortDataType | 'file' | null
  ref_kind?: string | null
  ref_value?: string | null
  summary?: string | null
  created_date: string
}

export interface GraphWorkflowBrowseContentRecord {
  scope: {
    folder_id: number | null
    folder_ids: number[] | null
    workflow_count: number
    execution_count: number
    schedule_count: number
    artifact_count: number
    final_result_count: number
    empty_execution_count: number
  }
  workflows: GraphWorkflowRecord[]
  schedules: GraphWorkflowScheduleRecord[]
  executions: GraphExecutionRecord[]
  artifacts: GraphExecutionArtifactRecord[]
  final_results: GraphExecutionFinalResultRecord[]
  empty_executions: GraphExecutionRecord[]
}

export interface GraphWorkflowArtifactCopyResult {
  folder_id: number
  folder_name: string
  folder_path: string
  copied_count: number
  skipped_count: number
  copied: Array<{ source_path: string; target_path: string }>
  skipped: Array<{ source_path: string; reason: string }>
}

export interface GraphWorkflowEmptyExecutionCleanupResult {
  requested_count: number
  deleted_count: number
  missing: number[]
  deleted_execution_ids: number[]
  skipped: Array<{ execution_id: number; reason: string }>
}

export interface GraphWorkflowArtifactDeleteResult {
  requested_count: number
  deleted_count: number
  missing: number[]
  deleted_artifact_ids: number[]
  deleted_file_count: number
  skipped_files: Array<{ artifact_id: number; path: string; reason: string }>
  execution_cleanup?: GraphWorkflowEmptyExecutionCleanupResult
}

export interface CreateNaiModuleFromSnapshotPayload {
  name: string
  description?: string
  category?: string
  color?: string
  snapshot: Record<string, unknown>
  exposed_fields?: Array<string | Partial<ModulePortDefinition> & { key: string }>
  output_ports?: ModulePortDefinition[]
  ui_schema?: ModuleUiFieldDefinition[]
  is_active?: boolean
  target_module_id?: number | null
}

export interface CreateCodexModuleFromSnapshotPayload {
  name: string
  description?: string
  category?: string
  color?: string
  snapshot: Record<string, unknown>
  exposed_fields?: Array<string | Partial<ModulePortDefinition> & { key: string }>
  output_ports?: ModulePortDefinition[]
  ui_schema?: ModuleUiFieldDefinition[]
  is_active?: boolean
  target_module_id?: number | null
}

export interface CreateComfyModuleFromWorkflowPayload {
  name?: string
  description?: string
  category?: string
  color?: string
  exposed_field_ids?: string[]
  output_ports?: ModulePortDefinition[]
  ui_schema?: ModuleUiFieldDefinition[]
  is_active?: boolean
  target_module_id?: number | null
}

export interface ApiEnvelope<T> {
  success: boolean
  data: T
  error?: string
}

export interface GraphWorkflowScheduleMaintenanceResult {
  pausedScheduleCount?: number
  deletedScheduleCount?: number
  cancelled: number
  runningCancellationRequested: number
}

export interface GraphWorkflowScheduleEnqueueResult {
  requested_count: number
  enqueued_count: number
  execution_ids: number[]
}

export interface CreateEnvelope {
  id: number
  message: string
  enqueue?: GraphWorkflowScheduleEnqueueResult
}

export interface GraphWorkflowUpdateResult extends CreateEnvelope {
  schedule_maintenance?: GraphWorkflowScheduleMaintenanceResult | null
}

export interface GraphWorkflowDeleteResult {
  message: string
  schedule_maintenance?: GraphWorkflowScheduleMaintenanceResult | null
}
