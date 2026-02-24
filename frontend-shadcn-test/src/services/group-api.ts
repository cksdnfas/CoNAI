import type {
  AutoCollectResult,
  BreadcrumbItem,
  GroupCreateData,
  GroupMoveRequest,
  GroupRecord,
  GroupResponse,
  GroupUpdateData,
  GroupWithHierarchy,
  HierarchyValidation,
} from '@comfyui-image-manager/shared'
import type { ImageRecord } from '@/types/image'
import { API_BASE_URL, apiClient } from '@/lib/api/client'

export const groupApi = {
  async getGroup(id: number): Promise<{ success: boolean; data?: GroupRecord; error?: string }> {
    const response = await apiClient.get(`/api/groups/${id}`)
    return response.data
  },

  async createGroup(groupData: GroupCreateData): Promise<GroupResponse> {
    const response = await apiClient.post('/api/groups', groupData)
    return response.data
  },

  async updateGroup(id: number, groupData: GroupUpdateData): Promise<GroupResponse> {
    const response = await apiClient.put(`/api/groups/${id}`, groupData)
    return response.data
  },

  async deleteGroup(id: number, cascade = false): Promise<GroupResponse> {
    const response = await apiClient.delete(`/api/groups/${id}?cascade=${cascade}`)
    return response.data
  },

  async getGroupImages(
    id: number,
    page = 1,
    limit = 20,
    collectionType?: 'manual' | 'auto',
  ): Promise<GroupResponse> {
    let url = `/api/groups/${id}/images?page=${page}&limit=${limit}`
    if (collectionType) {
      url += `&collection_type=${collectionType}`
    }
    const response = await apiClient.get(url)
    return response.data
  },

  async addImagesToGroup(groupId: number, compositeHashes: string[]): Promise<GroupResponse> {
    const response = await apiClient.post(`/api/groups/${groupId}/images/bulk`, {
      composite_hashes: compositeHashes,
    })
    return response.data
  },

  async removeImagesFromGroup(
    groupId: number,
    compositeHashes: string[],
  ): Promise<{ success: boolean; removed: number; errors: string[] }> {
    let removedCount = 0
    const errors: string[] = []

    for (const compositeHash of compositeHashes) {
      try {
        const response = await apiClient.delete(`/api/groups/${groupId}/images/${compositeHash}`)
        if (response.data.success) {
          removedCount += 1
        } else {
          errors.push(`Image ${compositeHash}: ${response.data.error || 'Failed to remove'}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to remove'
        errors.push(`Image ${compositeHash}: ${message}`)
      }
    }

    return {
      success: errors.length === 0,
      removed: removedCount,
      errors,
    }
  },

  async runAutoCollection(id: number): Promise<{ success: boolean; data?: AutoCollectResult; error?: string }> {
    const response = await apiClient.post(`/api/groups/${id}/auto-collect`)
    return response.data
  },

  getThumbnailUrl(id: number): string {
    return `${API_BASE_URL}/api/groups/${id}/thumbnail`
  },

  async getRandomImageFromGroup(id: number): Promise<{ success: boolean; data?: ImageRecord; error?: string }> {
    const response = await apiClient.get(`/api/groups/${id}/random-image?_t=${Date.now()}`)
    return response.data
  },

  async getPreviewImages(
    id: number,
    count = 8,
    includeChildren = true,
  ): Promise<{ success: boolean; data?: ImageRecord[]; error?: string }> {
    const response = await apiClient.get(`/api/groups/${id}/preview-images?count=${count}&includeChildren=${includeChildren}`)
    return response.data
  },

  async getFileCountsByType(id: number): Promise<{ success: boolean; data?: { thumbnail: number; original: number; video: number }; error?: string }> {
    const response = await apiClient.get(`/api/groups/${id}/file-counts`)
    return response.data
  },

  async downloadGroupBlob(
    id: number,
    type: 'thumbnail' | 'original' | 'video',
    compositeHashes?: string[],
    captionMode?: 'auto_tags' | 'merged',
  ): Promise<void> {
    let url = `/api/groups/${id}/download?type=${type}`
    if (compositeHashes && compositeHashes.length > 0) {
      url += `&hashes=${encodeURIComponent(JSON.stringify(compositeHashes))}`
    }
    if (captionMode) {
      url += `&captionMode=${captionMode}`
    }

    const response = await apiClient.get(url, {
      responseType: 'blob',
    })

    const blobUrl = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = blobUrl

    const contentDisposition = response.headers['content-disposition']
    let filename = `group-${id}-${type}.zip`
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename\*=UTF-8''(.+)|filename="?(.+?)"?(?:;|$)/)
      if (filenameMatch) {
        filename = decodeURIComponent(filenameMatch[1] || filenameMatch[2])
      }
    }

    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(blobUrl)
  },

  async getBreadcrumbPath(groupId: number): Promise<{ success: boolean; data?: BreadcrumbItem[]; error?: string }> {
    const response = await apiClient.get(`/api/groups/${groupId}/breadcrumb`)
    return response.data
  },

  async getRootGroups(): Promise<{ success: boolean; data?: GroupWithHierarchy[]; error?: string }> {
    const response = await apiClient.get('/api/groups/hierarchy/roots')
    return response.data
  },

  async getChildGroups(parentId: number): Promise<{ success: boolean; data?: GroupWithHierarchy[]; error?: string }> {
    const response = await apiClient.get(`/api/groups/${parentId}/children`)
    return response.data
  },

  async moveGroup(groupId: number, newParentId: number | null): Promise<GroupResponse> {
    const requestData: GroupMoveRequest = { parent_id: newParentId }
    const response = await apiClient.post(`/api/groups/${groupId}/move`, requestData)
    return response.data
  },

  async validateHierarchy(
    groupId: number,
    newParentId: number | null,
  ): Promise<{ success: boolean; data?: HierarchyValidation; error?: string }> {
    const response = await apiClient.post(`/api/groups/${groupId}/validate-hierarchy`, {
      parent_id: newParentId,
    })
    return response.data
  },

  async getAllGroupsWithHierarchy(): Promise<{ success: boolean; data?: GroupWithHierarchy[]; error?: string }> {
    const response = await apiClient.get('/api/groups/hierarchy/all')
    return response.data
  },
}
