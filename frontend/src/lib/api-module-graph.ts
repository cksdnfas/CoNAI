import { buildApiUrl } from '@/lib/api-client'
import type { WorkflowMarkedField } from '@/lib/api-image-generation'

export type ModuleEngineType = 'nai' | 'comfyui' | 'system' | 'custom_js'
export type ModuleAuthoringSource = 'nai_form_snapshot' | 'comfyui_workflow_wrap' | 'manual' | 'custom_node_fs'
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
  description?: string | null
  parent_id?: number | null
  created_date: string
  updated_date: string
}

export type GraphExecutionStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type GraphExecutionTriggerType = 'manual' | 'schedule'
export type GraphWorkflowScheduleType = 'once' | 'interval' | 'daily'
export type GraphWorkflowScheduleStatus = 'active' | 'paused' | 'error_stopped' | 'overlap_stopped' | 'completed'

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
  input_values?: string | null
  confirmed_graph_version?: number | null
  confirmed_input_signature?: string | null
  stop_reason_code?: string | null
  stop_reason_message?: string | null
  last_execution_id?: number | null
  next_run_at?: string | null
  last_enqueued_at?: string | null
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

export interface GraphWorkflowScheduleMaintenanceResult {
  pausedScheduleCount?: number
  deletedScheduleCount?: number
  cancelled: number
  runningCancellationRequested: number
}

interface CreateEnvelope {
  id: number
  message: string
}

export interface GraphWorkflowUpdateResult extends CreateEnvelope {
  schedule_maintenance?: GraphWorkflowScheduleMaintenanceResult | null
}

export interface GraphWorkflowDeleteResult {
  message: string
  schedule_maintenance?: GraphWorkflowScheduleMaintenanceResult | null
}

/** Execute a JSON API request and surface backend error messages. */
async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: init?.credentials ?? 'include',
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
  description?: string
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
  description?: string | null
  parent_id?: number | null
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

export type GraphWorkflowFolderDeleteMode = 'move_children' | 'delete_tree'

/** Delete one workflow explorer folder. */
export async function deleteGraphWorkflowFolder(folderId: number, mode: GraphWorkflowFolderDeleteMode = 'move_children') {
  const response = await requestJson<ApiEnvelope<{ message: string }>>(`/api/graph-workflows/folders/${folderId}?mode=${mode}`, {
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
  const response = await requestJson<ApiEnvelope<GraphWorkflowUpdateResult>>(`/api/graph-workflows/${workflowId}`, {
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
  const response = await requestJson<ApiEnvelope<GraphWorkflowDeleteResult>>(`/api/graph-workflows/${workflowId}`, {
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

/** List saved workflow autorun schedules. */
export async function getGraphWorkflowSchedules(params?: { workflowId?: number | null; folderId?: number | null }) {
  const searchParams = new URLSearchParams()
  if (typeof params?.workflowId === 'number') {
    searchParams.set('workflow_id', String(params.workflowId))
  }
  if (typeof params?.folderId === 'number') {
    searchParams.set('folder_id', String(params.folderId))
  }

  const response = await requestJson<ApiEnvelope<GraphWorkflowScheduleRecord[]>>(`/api/graph-workflows/schedules${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`)
  return response.data
}

/** Create one saved workflow autorun schedule. */
export async function createGraphWorkflowSchedule(payload: {
  graph_workflow_id: number
  name: string
  schedule_type: GraphWorkflowScheduleType
  status?: GraphWorkflowScheduleStatus
  timezone?: string | null
  run_at?: string | null
  interval_minutes?: number | null
  daily_time?: string | null
  max_run_count?: number | null
  input_values?: Record<string, unknown> | null
}) {
  const response = await requestJson<ApiEnvelope<CreateEnvelope>>('/api/graph-workflows/schedules', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return response.data
}

/** Update one saved workflow autorun schedule. */
export async function updateGraphWorkflowSchedule(scheduleId: number, payload: {
  name?: string
  schedule_type?: GraphWorkflowScheduleType
  status?: GraphWorkflowScheduleStatus
  timezone?: string | null
  run_at?: string | null
  interval_minutes?: number | null
  daily_time?: string | null
  max_run_count?: number | null
  input_values?: Record<string, unknown> | null
}) {
  const response = await requestJson<ApiEnvelope<CreateEnvelope>>(`/api/graph-workflows/schedules/${scheduleId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return response.data
}

/** Pause one workflow autorun schedule. */
export async function pauseGraphWorkflowSchedule(scheduleId: number) {
  const response = await requestJson<ApiEnvelope<{ message: string }>>(`/api/graph-workflows/schedules/${scheduleId}/pause`, {
    method: 'POST',
  })
  return response.data
}

/** Resume one workflow autorun schedule after review. */
export async function resumeGraphWorkflowSchedule(scheduleId: number) {
  const response = await requestJson<ApiEnvelope<{ message: string }>>(`/api/graph-workflows/schedules/${scheduleId}/resume`, {
    method: 'POST',
  })
  return response.data
}

/** Enqueue one immediate run from a saved schedule definition. */
export async function runGraphWorkflowScheduleNow(scheduleId: number) {
  const response = await requestJson<ApiEnvelope<{
    executionId: number
    status: GraphExecutionStatus
    message: string
  }>>(`/api/graph-workflows/schedules/${scheduleId}/run-now`, {
    method: 'POST',
  })
  return response.data
}

/** Delete one workflow autorun schedule. */
export async function deleteGraphWorkflowSchedule(scheduleId: number) {
  const response = await requestJson<ApiEnvelope<{ message: string }>>(`/api/graph-workflows/schedules/${scheduleId}`, {
    method: 'DELETE',
  })
  return response.data
}

/** Load folder-scoped browse content for generated workflow outputs and empty runs. */
export async function getGraphWorkflowBrowseContent(folderId?: number | null) {
  const searchParams = new URLSearchParams()
  if (typeof folderId === 'number') {
    searchParams.set('folder_id', String(folderId))
  }

  const response = await requestJson<ApiEnvelope<GraphWorkflowBrowseContentRecord>>(`/api/graph-workflows/browse-content${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`)
  return response.data
}

/** Copy selected generated workflow artifacts into one watched folder target. */
export async function copyGraphWorkflowArtifactsToFolder(payload: {
  folder_id: number
  source_paths: string[]
}) {
  const response = await requestJson<ApiEnvelope<GraphWorkflowArtifactCopyResult>>('/api/graph-workflows/artifacts/copy-to-folder', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return response.data
}

/** Delete output-less finished executions in bulk. */
export async function cleanupGraphWorkflowEmptyExecutions(payload: {
  execution_ids: number[]
}) {
  const response = await requestJson<ApiEnvelope<GraphWorkflowEmptyExecutionCleanupResult>>('/api/graph-workflows/executions/cleanup-empty', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return response.data
}

/** Delete raw workflow artifacts that should no longer appear in management lists. */
export async function deleteGraphWorkflowArtifacts(payload: {
  artifact_ids: number[]
}) {
  const response = await requestJson<ApiEnvelope<GraphWorkflowArtifactDeleteResult>>('/api/graph-workflows/artifacts/delete', {
    method: 'POST',
    body: JSON.stringify(payload),
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
