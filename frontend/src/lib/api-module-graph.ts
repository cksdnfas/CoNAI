import { buildApiUrl } from '@/lib/api-client'
import type { WorkflowMarkedField } from '@/lib/api-image-generation'

export type ModuleEngineType = 'nai' | 'comfyui' | 'system'
export type ModuleAuthoringSource = 'nai_form_snapshot' | 'comfyui_workflow_wrap' | 'manual'
export type ModulePortDirection = 'input' | 'output'
export type ModulePortDataType = 'image' | 'mask' | 'prompt' | 'text' | 'number' | 'boolean' | 'json' | 'any'

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
  template_defaults: Record<string, unknown>
  exposed_inputs: ModulePortDefinition[]
  output_ports: ModulePortDefinition[]
  internal_fixed_values?: Record<string, unknown> | null
  ui_schema?: ModuleUiFieldDefinition[] | null
  version: number
  is_active: boolean
  color?: string | null
  created_date: string
  updated_date: string
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
  graph: GraphWorkflowDocument
  folder_id?: number | null
  version: number
  is_active: boolean
  created_date: string
  updated_date: string
}

export interface GraphWorkflowFolderRecord {
  id: number
  name: string
  parent_id?: number | null
  created_date: string
  updated_date: string
}

export type GraphExecutionStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

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
}

interface ApiEnvelope<T> {
  success: boolean
  data: T
  error?: string
}

interface CreateEnvelope {
  id: number
  message: string
}

/** Execute a JSON API request and surface backend error messages. */
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const contentType = response.headers.get('content-type') ?? ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    if (typeof payload === 'string' && payload.trim().length > 0) {
      throw new Error(payload)
    }

    if (payload && typeof payload === 'object') {
      const errorMessage = 'error' in payload && typeof payload.error === 'string' ? payload.error : undefined
      if (errorMessage) {
        throw new Error(errorMessage)
      }
    }

    throw new Error(`Request failed: ${response.status}`)
  }

  return payload as T
}

/** List reusable module definitions for the graph editor. */
export async function getModuleDefinitions(activeOnly = true) {
  const searchParams = new URLSearchParams()
  if (activeOnly) {
    searchParams.set('active', 'true')
  }

  const response = await requestJson<ApiEnvelope<ModuleDefinitionRecord[]>>(`/api/module-definitions${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`)
  return response.data
}

/** Create a reusable NAI module from a captured generation-page snapshot. */
export async function createNaiModuleFromSnapshot(payload: CreateNaiModuleFromSnapshotPayload) {
  const response = await requestJson<ApiEnvelope<CreateEnvelope>>('/api/module-definitions/from-nai-snapshot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return response.data
}

/** Wrap an existing ComfyUI workflow as a reusable module definition. */
export async function createComfyModuleFromWorkflow(workflowId: number, payload: CreateComfyModuleFromWorkflowPayload) {
  const response = await requestJson<ApiEnvelope<CreateEnvelope>>(`/api/module-definitions/from-comfy-workflow/${workflowId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return response.data
}

/** List saved graph workflows for the future graph editor page. */
export async function getGraphWorkflows(activeOnly = true) {
  const searchParams = new URLSearchParams()
  if (activeOnly) {
    searchParams.set('active', 'true')
  }

  const response = await requestJson<ApiEnvelope<GraphWorkflowRecord[]>>(`/api/graph-workflows${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`)
  return response.data
}

/** List workflow explorer folders for the graph editor. */
export async function getGraphWorkflowFolders() {
  const response = await requestJson<ApiEnvelope<GraphWorkflowFolderRecord[]>>('/api/graph-workflows/folders')
  return response.data
}

/** Create one workflow explorer folder. */
export async function createGraphWorkflowFolder(payload: {
  name: string
  parent_id?: number | null
}) {
  const response = await requestJson<ApiEnvelope<CreateEnvelope>>('/api/graph-workflows/folders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return response.data
}

/** Rename one workflow explorer folder. */
export async function updateGraphWorkflowFolder(folderId: number, payload: {
  name?: string
}) {
  const response = await requestJson<ApiEnvelope<{ message: string }>>(`/api/graph-workflows/folders/${folderId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return response.data
}

/** Delete one workflow explorer folder. */
export async function deleteGraphWorkflowFolder(folderId: number) {
  const response = await requestJson<ApiEnvelope<{ message: string }>>(`/api/graph-workflows/folders/${folderId}`, {
    method: 'DELETE',
  })

  return response.data
}

/** Save a graph workflow document. */
export async function createGraphWorkflow(payload: {
  name: string
  description?: string
  graph: GraphWorkflowDocument
  folder_id?: number | null
  version?: number
  is_active?: boolean
}) {
  const response = await requestJson<ApiEnvelope<CreateEnvelope>>('/api/graph-workflows', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return response.data
}

/** Update a saved graph workflow document in place. */
export async function updateGraphWorkflow(workflowId: number, payload: {
  name?: string
  description?: string
  graph?: GraphWorkflowDocument
  folder_id?: number | null
  version?: number
  is_active?: boolean
}) {
  const response = await requestJson<ApiEnvelope<CreateEnvelope>>(`/api/graph-workflows/${workflowId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return response.data
}

/** Delete one saved graph workflow document. */
export async function deleteGraphWorkflow(workflowId: number) {
  const response = await requestJson<ApiEnvelope<{ message: string }>>(`/api/graph-workflows/${workflowId}`, {
    method: 'DELETE',
  })

  return response.data
}

/** Enqueue a saved graph workflow for background execution. */
export async function executeGraphWorkflow(workflowId: number, payload?: { input_values?: Record<string, unknown> }) {
  const response = await requestJson<ApiEnvelope<{
    executionId: number
    status: GraphExecutionStatus
  }>>(`/api/graph-workflows/${workflowId}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload ?? {}),
  })

  return response.data
}

/** Enqueue one selected graph node and its required upstream closure for execution. */
export async function executeGraphNode(workflowId: number, nodeId: string, payload?: { input_values?: Record<string, unknown>; force_rerun?: boolean }) {
  const response = await requestJson<ApiEnvelope<{
    executionId: number
    status: GraphExecutionStatus
  }>>(`/api/graph-workflows/${workflowId}/nodes/${encodeURIComponent(nodeId)}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload ?? {}),
  })

  return response.data
}

/** Request cancellation for a queued or running graph execution. */
export async function cancelGraphExecution(executionId: number) {
  const response = await requestJson<ApiEnvelope<{
    success: boolean
    status?: GraphExecutionStatus | 'not_found'
    message: string
  }>>(`/api/graph-workflows/executions/${executionId}/cancel`, {
    method: 'POST',
  })

  return response.data
}

/** List recent executions for a saved graph workflow. */
export async function getGraphWorkflowExecutions(workflowId: number) {
  const response = await requestJson<ApiEnvelope<GraphExecutionRecord[]>>(`/api/graph-workflows/${workflowId}/executions`)
  return response.data
}

/** Load a graph execution with its stored artifacts. */
export async function getGraphExecution(executionId: number) {
  const response = await requestJson<ApiEnvelope<{
    execution: GraphExecutionRecord
    artifacts: GraphExecutionArtifactRecord[]
    final_results: GraphExecutionFinalResultRecord[]
    logs: GraphExecutionLogRecord[]
  }>>(`/api/graph-workflows/executions/${executionId}`)
  return response.data
}

/** Convert Comfy workflow marked fields into candidate exposed field ids. */
export function getDefaultComfyExposedFieldIds(markedFields: WorkflowMarkedField[]) {
  return markedFields.map((field) => field.id)
}
