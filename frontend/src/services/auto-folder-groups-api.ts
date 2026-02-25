import type { AutoFolderGroupRebuildResult, AutoFolderGroupWithStats } from '@comfyui-image-manager/shared'
import type { ImageRecord } from '@/types/image'
import { API_BASE_URL, apiClient } from '@/lib/api/client'

interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

export interface AutoFolderGroupImagesData {
  items: ImageRecord[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export const autoFolderGroupsApi = {
  async getRootGroups(): Promise<ApiResult<AutoFolderGroupWithStats[]>> {
    const response = await apiClient.get('/api/auto-folder-groups/children/root')
    return response.data
  },

  async getChildGroups(parentId: number): Promise<ApiResult<AutoFolderGroupWithStats[]>> {
    const response = await apiClient.get(`/api/auto-folder-groups/children/${parentId}`)
    return response.data
  },

  async getGroup(id: number): Promise<ApiResult<AutoFolderGroupWithStats>> {
    const response = await apiClient.get(`/api/auto-folder-groups/${id}`)
    return response.data
  },

  async getGroupImages(id: number, page = 1, pageSize = 50): Promise<ApiResult<AutoFolderGroupImagesData>> {
    const response = await apiClient.get(`/api/auto-folder-groups/${id}/images`, {
      params: { page, pageSize },
    })
    return response.data
  },

  async getBreadcrumbPath(groupId: number): Promise<ApiResult<Array<{ id: number; name: string; folder_path: string }>>> {
    const response = await apiClient.get(`/api/auto-folder-groups/${groupId}/breadcrumb`)
    return response.data
  },

  getThumbnailUrl(groupId: number): string {
    return `${API_BASE_URL}/api/auto-folder-groups/${groupId}/thumbnail?t=${Date.now()}`
  },

  async getPreviewImages(id: number, count = 8, includeChildren = true): Promise<ApiResult<ImageRecord[]>> {
    const response = await apiClient.get(`/api/auto-folder-groups/${id}/preview-images?count=${count}&includeChildren=${includeChildren}`)
    return response.data
  },

  async rebuild(): Promise<ApiResult<AutoFolderGroupRebuildResult>> {
    const response = await apiClient.post('/api/auto-folder-groups/rebuild')
    return response.data
  },

  async getFileCounts(groupId: number, selectedHashes?: string[]): Promise<ApiResult<{ thumbnail: number; original: number; video: number }>> {
    const params: { hashes?: string } = {}
    if (selectedHashes && selectedHashes.length > 0) {
      params.hashes = selectedHashes.join(',')
    }
    const response = await apiClient.get(`/api/auto-folder-groups/${groupId}/file-counts`, {
      params,
    })
    return response.data
  },

  async downloadGroup(
    groupId: number,
    type: 'thumbnail' | 'original' | 'video' = 'original',
    selectedHashes?: string[],
    captionMode?: 'auto_tags' | 'merged',
  ): Promise<void> {
    const params: { type: 'thumbnail' | 'original' | 'video'; hashes?: string; captionMode?: 'auto_tags' | 'merged' } = { type }
    if (selectedHashes && selectedHashes.length > 0) {
      params.hashes = selectedHashes.join(',')
    }
    if (captionMode) {
      params.captionMode = captionMode
    }

    const response = await apiClient.get(`/api/auto-folder-groups/${groupId}/download`, {
      params,
      responseType: 'blob',
    })

    const blobUrl = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = blobUrl

    const contentDisposition = response.headers['content-disposition']
    let filename = `folder-group-${groupId}.zip`
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1].replace(/['"]/g, '')
      }
    }

    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(blobUrl)
  },
}
