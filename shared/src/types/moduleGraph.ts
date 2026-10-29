/**
 * 모듈 그래프 와이어 계약 중 백엔드와 프론트엔드가 똑같이 쓰는 모양.
 * 저장 형식이 갈리는 레코드(ModuleDefinitionRecord, GraphWorkflowRecord, GraphExecutionRecord)는 각 쪽에 남는다.
 */

export interface WorkflowNodeNumericBound {
  min?: number
  max?: number
}

export type WorkflowNodeNumericBounds = Record<string, WorkflowNodeNumericBound>

export type ModuleEngineType = 'nai' | 'codex' | 'comfyui' | 'system' | 'custom_js'

export type ModuleAuthoringSource = 'nai_form_snapshot' | 'codex_form_snapshot' | 'comfyui_workflow_wrap' | 'manual' | 'custom_node_fs'

export type ModulePortDirection = 'input' | 'output'

export type ModulePortDataType = 'image' | 'video' | 'audio' | 'mask' | 'prompt' | 'text' | 'number' | 'boolean' | 'json' | 'any'

export type ModuleSelectOption = string | { value: string; label: string }

export type GraphExecutionStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type GraphExecutionTriggerType = 'manual' | 'schedule'

export type GraphWorkflowScheduleType = 'once' | 'interval' | 'daily'

export type GraphWorkflowScheduleStatus = 'active' | 'paused' | 'error_stopped' | 'overlap_stopped' | 'completed'

export type GraphWorkflowScheduleFailurePolicy = 'stop' | 'continue'

/** Stored schedule fields and optional response decorations shared by the API and UI. */
export interface GraphWorkflowScheduleRecord {
  id: number
  revision: number
  graph_workflow_id: number
  workflow_version?: number | null
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
  run_as_account_id?: number | null
  run_as_account_name?: string | null
  completed_run_count?: number
  queued_run_count?: number
  running_run_count?: number
  failed_run_count?: number
  reserved_run_count?: number
  remaining_run_count?: number | null
  created_date: string
  updated_date: string
}

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
  node_binding?: {
    node_editor: 'minimax_h3_director_dasiwa'
    field_key: string
    input_key: string
    active_modes?: string[]
  }
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
  node_editor?: 'power_lora_loader_rgthree' | 'minimax_h3_director_dasiwa'
  node_visible_fields?: string[]
  node_hidden_controls?: string[]
  node_numeric_bounds?: WorkflowNodeNumericBounds
  node_items?: Array<{
    key: string
    label: string
    lora?: string
  }>
  /** Pick the value from a live list (model rows, chat profiles, presets…) served by GET /api/graph-workflows/node-options/:source. */
  options_source?: string
  /** A new node starts on this entry of `options_source`: `first` (lists put the newest first) or the list's `default`. */
  initial_option?: 'first' | 'default'
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

/**
 * List projection for saved graph workflows.
 *
 * WF-1: 목록 응답은 그래프 문서를 절대 담지 않는다. 전체 그래프는 `GET /api/graph-workflows/:id`
 * 한 곳에서만 내려간다. 노드/엣지/최종결과 개수는 SQL(`json_array_length`, `json_each`)로 계산해
 * 요청 경로에서 JSON.parse 가 돌지 않게 한다.
 */
export interface GraphWorkflowSummaryRecord {
  id: number
  name: string
  description?: string | null
  folder_id?: number | null
  version: number
  is_active: boolean
  created_date: string
  updated_date: string
  node_count: number
  edge_count: number
  final_result_node_count: number
}

/** Name-only projection used by reservation/header surfaces that just label a workflow id. */
export interface GraphWorkflowNameRecord {
  id: number
  name: string
}

export interface GraphWorkflowFolderRecord {
  id: number
  name: string
  description?: string | null
  parent_id?: number | null
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
