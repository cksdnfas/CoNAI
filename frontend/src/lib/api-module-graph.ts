import { requestJson } from '@/lib/api-request'

import type {
  ApiEnvelope,
  CreateCodexModuleFromSnapshotPayload,
  CreateComfyModuleFromWorkflowPayload,
  CreateEnvelope,
  CreateNaiModuleFromSnapshotPayload,
  GraphExecutionArtifactRecord,
  GraphExecutionFinalResultRecord,
  GraphExecutionLogLevel,
  GraphExecutionLogRecord,
  GraphExecutionNodeIoDirection,
  GraphExecutionNodeIoRecord,
  GraphExecutionRecord,
  GraphExecutionStatus,
  GraphExecutionTriggerType,
  GraphWorkflowArtifactCopyResult,
  GraphWorkflowArtifactDeleteResult,
  GraphWorkflowBrowseContentRecord,
  GraphWorkflowDeleteResult,
  GraphWorkflowDocument,
  GraphWorkflowEdge,
  GraphWorkflowEmptyExecutionCleanupResult,
  GraphWorkflowExposedInput,
  GraphWorkflowExportPayload,
  GraphWorkflowFolderRecord,
  GraphWorkflowImportResult,
  GraphWorkflowMetadata,
  GraphWorkflowNode,
  GraphWorkflowRecord,
  GraphWorkflowScheduleEnqueueResult,
  GraphWorkflowScheduleFailurePolicy,
  GraphWorkflowScheduleMaintenanceResult,
  GraphWorkflowScheduleRecord,
  GraphWorkflowScheduleStatus,
  GraphWorkflowScheduleType,
  GraphWorkflowUpdateResult,
  GraphWorkflowVersionSummaryRecord,
  ModuleAuthoringSource,
  ModuleDefinitionRecord,
  ModuleEngineType,
  ModulePortDataType,
  ModulePortDefinition,
  ModulePortDirection,
  ModuleSelectOption,
  ModuleUiFieldDefinition
} from './api-module-graph-types'

export type {
  CreateCodexModuleFromSnapshotPayload,
  CreateComfyModuleFromWorkflowPayload,
  CreateNaiModuleFromSnapshotPayload,
  GraphExecutionArtifactRecord,
  GraphExecutionFinalResultRecord,
  GraphExecutionLogLevel,
  GraphExecutionLogRecord,
  GraphExecutionNodeIoDirection,
  GraphExecutionNodeIoRecord,
  GraphExecutionRecord,
  GraphExecutionStatus,
  GraphExecutionTriggerType,
  GraphWorkflowArtifactCopyResult,
  GraphWorkflowArtifactDeleteResult,
  GraphWorkflowBrowseContentRecord,
  GraphWorkflowDeleteResult,
  GraphWorkflowDocument,
  GraphWorkflowEdge,
  GraphWorkflowEmptyExecutionCleanupResult,
  GraphWorkflowExposedInput,
  GraphWorkflowExportPayload,
  GraphWorkflowFolderRecord,
  GraphWorkflowImportResult,
  GraphWorkflowMetadata,
  GraphWorkflowNode,
  GraphWorkflowRecord,
  GraphWorkflowScheduleFailurePolicy,
  GraphWorkflowScheduleMaintenanceResult,
  GraphWorkflowScheduleRecord,
  GraphWorkflowScheduleStatus,
  GraphWorkflowScheduleType,
  GraphWorkflowUpdateResult,
  GraphWorkflowVersionSummaryRecord,
  ModuleAuthoringSource,
  ModuleDefinitionRecord,
  ModuleEngineType,
  ModulePortDataType,
  ModulePortDefinition,
  ModulePortDirection,
  ModuleSelectOption,
  ModuleUiFieldDefinition
} from './api-module-graph-types'

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

/** Create a reusable Codex module from the current generation-tab snapshot. */
export async function createCodexModuleFromSnapshot(payload: CreateCodexModuleFromSnapshotPayload) {
  const response = await requestJson<ApiEnvelope<CreateEnvelope>>('/api/module-definitions/from-codex-snapshot', {
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

/** Export one saved graph workflow with the module definitions it references. */
export async function exportGraphWorkflow(workflowId: number) {
  const response = await requestJson<ApiEnvelope<GraphWorkflowExportPayload>>(`/api/graph-workflows/${workflowId}/export`)
  return response.data
}

/** Import one graph workflow export payload. Missing modules become placeholder modules. */
export async function importGraphWorkflow(payload: {
  payload: GraphWorkflowExportPayload
  name?: string
  folder_id?: number | null
}) {
  const response = await requestJson<ApiEnvelope<GraphWorkflowImportResult>>('/api/graph-workflows/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  return response.data
}

/** List compact saved-version snapshots for one graph workflow. */
export async function getGraphWorkflowVersionSummaries(workflowId: number, limit = 12) {
  const searchParams = new URLSearchParams({ limit: String(limit) })
  const response = await requestJson<ApiEnvelope<GraphWorkflowVersionSummaryRecord[]>>(`/api/graph-workflows/${workflowId}/versions?${searchParams.toString()}`)
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
  run_enqueue_count?: number | null
  failure_policy?: GraphWorkflowScheduleFailurePolicy | null
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
  run_enqueue_count?: number | null
  failure_policy?: GraphWorkflowScheduleFailurePolicy | null
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

/** Enqueue one or more immediate runs from a saved schedule definition. */
export async function runGraphWorkflowScheduleNow(scheduleId: number, enqueueCount = 1) {
  const response = await requestJson<ApiEnvelope<{
    executionId: number | null
    status: GraphExecutionStatus
    message: string
    enqueue?: GraphWorkflowScheduleEnqueueResult
  }>>(`/api/graph-workflows/schedules/${scheduleId}/run-now`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ enqueue_count: enqueueCount }),
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
export async function getGraphWorkflowBrowseContent(folderId?: number | null, options?: { includeOutputs?: boolean }) {
  const searchParams = new URLSearchParams()
  if (typeof folderId === 'number') {
    searchParams.set('folder_id', String(folderId))
  }
  if (options?.includeOutputs === false) {
    searchParams.set('include_outputs', 'false')
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
    headers: {
      'Content-Type': 'application/json',
    },
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
    headers: {
      'Content-Type': 'application/json',
    },
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
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return response.data
}

/** Delete all generated outputs or technical artifacts in one workflow browse scope. */
export async function deleteGraphWorkflowArtifactsInScope(payload: {
  folder_id: number | null
  kind: 'outputs' | 'artifacts'
  artifact_type?: string | null
  search?: string | null
}) {
  const response = await requestJson<ApiEnvelope<GraphWorkflowArtifactDeleteResult>>('/api/graph-workflows/artifacts/delete-scope', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return response.data
}

/** List recent executions for a saved graph workflow. */
export async function getGraphWorkflowExecutions(workflowId: number) {
  const response = await requestJson<ApiEnvelope<GraphExecutionRecord[]>>(`/api/graph-workflows/${workflowId}/executions`)
  return response.data
}

export interface GraphExecutionStatusRecord {
  id: number
  status: GraphExecutionRecord['status']
  updated_date: string
  completed_at?: string | null
  error_message?: string | null
  failed_node_id?: string | null
  queue_position?: number | null
  cancel_requested?: boolean
}

/** Load one graph execution's lightweight status only. */
export async function getGraphExecutionStatus(executionId: number) {
  const response = await requestJson<ApiEnvelope<GraphExecutionStatusRecord>>(`/api/graph-workflows/executions/${executionId}/status`)
  return response.data
}

/** Load a graph execution with its stored artifacts. */
export async function getGraphExecution(executionId: number) {
  const response = await requestJson<ApiEnvelope<{
    execution: GraphExecutionRecord
    artifacts: GraphExecutionArtifactRecord[]
    final_results: GraphExecutionFinalResultRecord[]
    logs: GraphExecutionLogRecord[]
    node_io: GraphExecutionNodeIoRecord[]
  }>>(`/api/graph-workflows/executions/${executionId}`)
  return response.data
}
