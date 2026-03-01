import { apiClient } from '@/lib/api/client'

export interface BackgroundQueueStatus {
  queue: {
    queueLength: number
    processing: boolean
    tasksByType: {
      metadata_extraction: number
      prompt_collection: number
      civitai_model_lookup: number
    }
  }
  autoTag: {
    isRunning: boolean
    pollingIntervalSeconds: number
    batchSize: number
    untaggedCount: number
  }
}

export interface HashStats {
  totalImages: number
  imagesWithoutHash: number
  imagesWithHash: number
  completionPercentage: number
}

export interface RebuildHashesResult {
  message: string
  processed: number
  failed: number
  total: number
  remaining: number
}

const DEFAULT_ERROR_MESSAGE = 'Background queue service request failed'

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string; message?: string } } }).response
    const apiMessage = response?.data?.error ?? response?.data?.message
    if (typeof apiMessage === 'string' && apiMessage.length > 0) {
      return apiMessage
    }
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return DEFAULT_ERROR_MESSAGE
}

export const backgroundQueueApi = {
  async getQueueStatus(): Promise<BackgroundQueueStatus> {
    try {
      const response = await apiClient.get<{ success: boolean; data: BackgroundQueueStatus }>('/api/background-queue/status')
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async clearQueue(): Promise<{ message: string }> {
    try {
      const response = await apiClient.post<{ success: boolean; data: { message: string } }>('/api/background-queue/clear', null)
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async triggerAutoTag(): Promise<{ message: string }> {
    try {
      const response = await apiClient.post<{ success: boolean; data: { message: string } }>('/api/background-queue/trigger-auto-tag', null)
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async getHashStats(): Promise<HashStats> {
    try {
      const response = await apiClient.get<{ success: boolean; data: HashStats }>('/api/images/similarity/stats')
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async rebuildHashes(): Promise<RebuildHashesResult> {
    try {
      const response = await apiClient.post<{ success: boolean; data: RebuildHashesResult }>('/api/images/similarity/rebuild-hashes', null)
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },
}
