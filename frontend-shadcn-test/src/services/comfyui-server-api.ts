import { apiClient } from '@/lib/api/client'

export interface ComfyUIServer {
  id: number
  name: string
  endpoint: string
  description?: string
  is_active: boolean
  created_date: string
  updated_date: string
}

export interface ServerStatus {
  server_id: number
  server_name: string
  endpoint: string
  isConnected: boolean
  response_time?: number
  error?: string
}

export const comfyuiServerApi = {
  getAllServers: async (activeOnly = false) => {
    const response = await apiClient.get('/api/comfyui-servers', {
      params: { active: activeOnly },
    })
    return response.data
  },

  getServer: async (id: number) => {
    const response = await apiClient.get(`/api/comfyui-servers/${id}`)
    return response.data
  },

  createServer: async (data: {
    name: string
    endpoint: string
    description?: string
    is_active?: boolean
  }) => {
    const response = await apiClient.post('/api/comfyui-servers', data)
    return response.data
  },

  updateServer: async (id: number, data: Partial<ComfyUIServer>) => {
    const response = await apiClient.put(`/api/comfyui-servers/${id}`, data)
    return response.data
  },

  deleteServer: async (id: number) => {
    const response = await apiClient.delete(`/api/comfyui-servers/${id}`)
    return response.data
  },

  testConnection: async (id: number) => {
    const response = await apiClient.get(`/api/comfyui-servers/${id}/test-connection`)
    return response.data
  },

  testAllConnections: async () => {
    const response = await apiClient.get('/api/comfyui-servers/test-all-connections')
    return response.data
  },

  getServerWorkflows: async (id: number) => {
    const response = await apiClient.get(`/api/comfyui-servers/${id}/workflows`)
    return response.data
  },
}
