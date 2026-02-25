import { apiClient } from '@/lib/api/client'

export interface CustomDropdownList {
  id: number
  name: string
  description?: string
  items: string[]
  is_auto_collected: boolean
  source_path?: string
  created_date: string
  updated_date: string
}

export interface CreateCustomDropdownListData {
  name: string
  description?: string
  items: string[]
}

export interface UpdateCustomDropdownListData {
  name?: string
  description?: string
  items?: string[]
}

export interface ComfyUIModelFolder {
  folderName: string
  displayName: string
  files: string[]
}

export interface ScanComfyUIModelsRequest {
  modelFolders: ComfyUIModelFolder[]
  sourcePath?: string
  mergeSubfolders?: boolean
  createBoth?: boolean
}

export interface ScanComfyUIModelsResponse {
  success: boolean
  data: {
    scannedFolders: number
    createdLists: number
    isRescan: boolean
    message: string
  }
}

export const customDropdownListApi = {
  getAllLists: async () => {
    const response = await apiClient.get('/api/custom-dropdown-lists')
    return response.data
  },

  getList: async (id: number) => {
    const response = await apiClient.get(`/api/custom-dropdown-lists/${id}`)
    return response.data
  },

  getListByName: async (name: string) => {
    const response = await apiClient.get(`/api/custom-dropdown-lists/by-name/${encodeURIComponent(name)}`)
    return response.data
  },

  createList: async (data: CreateCustomDropdownListData) => {
    const response = await apiClient.post('/api/custom-dropdown-lists', data)
    return response.data
  },

  updateList: async (id: number, data: UpdateCustomDropdownListData) => {
    const response = await apiClient.put(`/api/custom-dropdown-lists/${id}`, data)
    return response.data
  },

  deleteList: async (id: number) => {
    const response = await apiClient.delete(`/api/custom-dropdown-lists/${id}`)
    return response.data
  },

  scanComfyUIModels: async (request: ScanComfyUIModelsRequest): Promise<ScanComfyUIModelsResponse> => {
    const response = await apiClient.post('/api/custom-dropdown-lists/scan-comfyui-models', request)
    return response.data
  },
}
