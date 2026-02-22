import { apiClient } from '@/lib/api/client'

export interface Workflow {
  id: number
  name: string
  description?: string
  workflow_json: string
  marked_fields?: MarkedField[]
  api_endpoint: string
  is_active: boolean
  color: string
  created_date: string
  updated_date: string
}

export interface MarkedField {
  id: string
  label: string
  description?: string
  jsonPath: string
  type: 'text' | 'number' | 'select' | 'textarea' | 'image'
  default_value?: unknown
  placeholder?: string
  dropdown_list_name?: string
  options?: string[]
  required?: boolean
  min?: number
  max?: number
  step?: number
}

export interface GenerationHistory {
  id: number
  workflow_id: number
  prompt_data: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  comfyui_prompt_id?: string
  generated_image_id?: string
  generated_image?: unknown
  error_message?: string
  execution_time?: number
  created_date: string
}

export const workflowApi = {
  getAllWorkflows: async (activeOnly = false) => {
    const response = await apiClient.get('/api/workflows', {
      params: { active: activeOnly },
    })
    return response.data
  },

  getWorkflow: async (id: number) => {
    const response = await apiClient.get(`/api/workflows/${id}`)
    return response.data
  },

  createWorkflow: async (data: {
    name: string
    description?: string
    workflow_json: string
    marked_fields?: MarkedField[]
    is_active?: boolean
  }) => {
    const response = await apiClient.post('/api/workflows', data)
    return response.data
  },

  updateWorkflow: async (id: number, data: Partial<Workflow>) => {
    const response = await apiClient.put(`/api/workflows/${id}`, data)
    return response.data
  },

  deleteWorkflow: async (id: number) => {
    const response = await apiClient.delete(`/api/workflows/${id}`)
    return response.data
  },

  generateImage: async (id: number, promptData: Record<string, unknown>) => {
    const response = await apiClient.post(`/api/workflows/${id}/generate`, {
      prompt_data: promptData,
    })
    return response.data
  },

  generateImageOnServer: async (id: number, serverId: number, promptData: Record<string, unknown>, groupId?: number) => {
    const response = await apiClient.post(`/api/workflows/${id}/generate`, {
      prompt_data: promptData,
      server_id: serverId,
      groupId,
    })
    return response.data
  },

  generateImageParallel: async (id: number, promptData: Record<string, unknown>) => {
    const response = await apiClient.post(`/api/workflows/${id}/generate-parallel`, {
      prompt_data: promptData,
    })
    return response.data
  },

  getHistory: async (id: number, page = 1, limit = 20) => {
    const response = await apiClient.get(`/api/workflows/${id}/history`, {
      params: { page, limit },
    })
    return response.data
  },

  getGenerationStatus: async (historyId: number) => {
    const response = await apiClient.get(`/api/workflows/history/${historyId}`)
    return response.data
  },

  getWorkflowServers: async (id: number) => {
    const response = await apiClient.get(`/api/workflows/${id}/servers`)
    return response.data
  },

  linkServers: async (id: number, serverIds: number[]) => {
    const response = await apiClient.post(`/api/workflows/${id}/servers`, {
      server_ids: serverIds,
    })
    return response.data
  },

  unlinkServer: async (id: number, serverId: number) => {
    const response = await apiClient.delete(`/api/workflows/${id}/servers/${serverId}`)
    return response.data
  },

  getCanvasImages: async () => {
    const response = await apiClient.get('/api/workflows/canvas-images')
    return response.data
  },
}
