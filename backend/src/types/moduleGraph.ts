/**
 * Generic module-graph types for modular image generation workflows.
 */

export type ModuleEngineType = 'nai' | 'comfyui' | 'system'
export type ModuleAuthoringSource = 'nai_form_snapshot' | 'comfyui_workflow_wrap' | 'manual'
export type ModulePortDirection = 'input' | 'output'
export type ModulePortDataType = 'image' | 'mask' | 'prompt' | 'text' | 'number' | 'boolean' | 'json' | 'any'
export type GraphExecutionStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

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
  options?: string[]
  min?: number
  max?: number
  placeholder?: string
  ui_hint?: string
}

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
}

export interface GraphWorkflowNode {
  id: string
  module_id: number
  label?: string
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
  graph_json: string
  version: number
  is_active: boolean
  created_date: string
  updated_date: string
}

export interface GraphWorkflowCreateData {
  name: string
  description?: string
  graph: GraphWorkflowDocument
  version?: number
  is_active?: boolean
}

export interface GraphWorkflowUpdateData {
  name?: string
  description?: string
  graph?: GraphWorkflowDocument
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

export interface GraphExecutionRecord {
  id: number
  graph_workflow_id: number
  graph_version: number
  status: GraphExecutionStatus
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

export interface ModuleGraphResponse {
  success: boolean
  data?: any
  error?: string
}
