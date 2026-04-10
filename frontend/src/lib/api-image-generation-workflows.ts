import { requestJson } from './api-image-generation-request'
import type {
  ComfyUIModelFolderScanInput,
  ComfyUIGenerationPayload,
  ComfyUIGenerationResponse,
  ComfyUIServer,
  ComfyUIServerConnectionStatus,
  CreateComfyUIServerPayload,
  CreateGenerationWorkflowPayload,
  CustomDropdownList,
  GenerationWorkflow,
  GenerationWorkflowDetail,
  UpdateComfyUIServerPayload,
} from './api-image-generation-types'

interface WorkflowListResponse {
  success: boolean
  data: GenerationWorkflow[]
}

interface WorkflowDetailResponse {
  success: boolean
  data: GenerationWorkflowDetail
}

interface ComfyUIServerListResponse {
  success: boolean
  data: ComfyUIServer[]
}

interface CustomDropdownListResponse {
  success: boolean
  data: CustomDropdownList[]
}

interface CreateComfyUIServerResponse {
  success: boolean
  data: {
    id: number
    message: string
  }
}

interface MutationResponse {
  success: boolean
  data: {
    id?: number
    message: string
  }
}

interface CreateWorkflowResponse {
  success: boolean
  data: {
    id: number
    message: string
  }
}

interface TestComfyUIServerResponse {
  success: boolean
  data: ComfyUIServerConnectionStatus
}

/** Normalize mixed backend server status payloads into one client shape. */
function normalizeComfyUIServerStatus(payload: Record<string, unknown>): ComfyUIServerConnectionStatus {
  return {
    server_id: Number(payload.server_id ?? payload.serverId ?? 0),
    server_name: String(payload.server_name ?? payload.serverName ?? ''),
    endpoint: String(payload.endpoint ?? ''),
    is_connected: payload.is_connected === true || payload.isConnected === true,
    response_time: typeof payload.response_time === 'number'
      ? payload.response_time
      : typeof payload.responseTime === 'number'
        ? payload.responseTime
        : undefined,
    error_message: typeof payload.error_message === 'string'
      ? payload.error_message
      : typeof payload.error === 'string'
        ? payload.error
        : undefined,
  }
}

/** Load the workflows available for ComfyUI generation. */
export async function getGenerationWorkflows(activeOnly = true) {
  const searchParams = new URLSearchParams()
  if (activeOnly) {
    searchParams.set('active', 'true')
  }

  const response = await requestJson<WorkflowListResponse>(`/api/workflows${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`)
  return response.data
}

/** Load the full detail for a single saved workflow. */
export async function getGenerationWorkflow(workflowId: number) {
  const response = await requestJson<WorkflowDetailResponse>(`/api/workflows/${workflowId}`)
  return response.data
}

/** Load the registered ComfyUI servers. */
export async function getGenerationComfyUIServers(activeOnly = true) {
  const searchParams = new URLSearchParams()
  if (activeOnly) {
    searchParams.set('active', 'true')
  }

  const response = await requestJson<ComfyUIServerListResponse>(`/api/comfyui-servers${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`)
  return response.data
}

/** Create a ComfyUI server entry for generation routing. */
export async function createGenerationComfyUIServer(payload: CreateComfyUIServerPayload) {
  return requestJson<CreateComfyUIServerResponse>('/api/comfyui-servers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Update a saved ComfyUI server entry. */
export async function updateGenerationComfyUIServer(serverId: number, payload: UpdateComfyUIServerPayload) {
  return requestJson<MutationResponse>(`/api/comfyui-servers/${serverId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Delete a saved ComfyUI server entry. */
export async function deleteGenerationComfyUIServer(serverId: number) {
  return requestJson<MutationResponse>(`/api/comfyui-servers/${serverId}`, {
    method: 'DELETE',
  })
}

/** Create a saved ComfyUI workflow definition. */
export async function createGenerationWorkflow(payload: CreateGenerationWorkflowPayload) {
  return requestJson<CreateWorkflowResponse>('/api/workflows', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Update a saved ComfyUI workflow definition. */
export async function updateGenerationWorkflow(workflowId: number, payload: CreateGenerationWorkflowPayload) {
  return requestJson<MutationResponse>(`/api/workflows/${workflowId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Delete a saved ComfyUI workflow definition. */
export async function deleteGenerationWorkflow(workflowId: number) {
  return requestJson<MutationResponse>(`/api/workflows/${workflowId}`, {
    method: 'DELETE',
  })
}

/** Link one or more ComfyUI servers to a saved workflow. */
export async function linkGenerationWorkflowServers(workflowId: number, serverIds: number[]) {
  return requestJson<{ success: boolean; data: { message: string; linked_count: number } }>(`/api/workflows/${workflowId}/servers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ server_ids: serverIds }),
  })
}

/** Remove a linked server from a saved workflow. */
export async function unlinkGenerationWorkflowServer(workflowId: number, serverId: number) {
  return requestJson<MutationResponse>(`/api/workflows/${workflowId}/servers/${serverId}`, {
    method: 'DELETE',
  })
}

/** Test whether a ComfyUI server endpoint is reachable. */
export async function testGenerationComfyUIServer(serverId: number) {
  const response = await requestJson<TestComfyUIServerResponse>(`/api/comfyui-servers/${serverId}/test-connection`)
  return normalizeComfyUIServerStatus(response.data as unknown as Record<string, unknown>)
}

/** Load the linked servers for a specific ComfyUI workflow. */
export async function getGenerationWorkflowServers(workflowId: number) {
  const response = await requestJson<ComfyUIServerListResponse>(`/api/workflows/${workflowId}/servers`)
  return response.data
}

/** Load saved custom dropdown lists used by ComfyUI workflows. */
export async function getGenerationCustomDropdownLists() {
  const response = await requestJson<CustomDropdownListResponse>('/api/custom-dropdown-lists')
  return response.data
}

/** Create one manual custom dropdown list. */
export async function createGenerationCustomDropdownList(payload: {
  name: string
  description?: string
  items: string[]
}) {
  return requestJson<{ success: boolean; data: { id: number; message: string } }>('/api/custom-dropdown-lists', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Update one manual custom dropdown list. */
export async function updateGenerationCustomDropdownList(listId: number, payload: {
  name?: string
  description?: string
  items?: string[]
}) {
  return requestJson<{ success: boolean; data: { message: string } }>(`/api/custom-dropdown-lists/${listId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Delete one custom dropdown list. */
export async function deleteGenerationCustomDropdownList(listId: number) {
  return requestJson<{ success: boolean; data: { message: string } }>(`/api/custom-dropdown-lists/${listId}`, {
    method: 'DELETE',
  })
}

/** Scan a selected ComfyUI models folder dump and store auto-collected dropdown lists. */
export async function scanGenerationComfyUIModelDropdownLists(payload: {
  modelFolders: ComfyUIModelFolderScanInput[]
  sourcePath?: string
  mergeSubfolders?: boolean
  createBoth?: boolean
}) {
  return requestJson<{ success: boolean; data: { scannedFolders: number; createdLists: number; deletedLists?: number; message: string } }>('/api/custom-dropdown-lists/scan-comfyui-models', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Start a ComfyUI workflow generation request. */
export async function generateComfyUIImage(workflowId: number, payload: ComfyUIGenerationPayload) {
  return requestJson<ComfyUIGenerationResponse>(`/api/workflows/${workflowId}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}
