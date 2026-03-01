import { apiClient } from '@/lib/api/client'

export interface VerificationResult {
  totalChecked: number
  missingFound: number
  deletedRecords: number
  duration: number
  errors: Array<{
    fileId: number
    filePath: string
    error: string
  }>
}

export interface VerificationLog {
  id: number
  verification_date: string
  total_checked: number
  missing_found: number
  deleted_records: number
  duration_ms: number
  verification_type: string
  error_count: number
  error_details: string | null
}

export interface VerificationStats {
  totalFiles: number
  missingFiles: number
  lastVerificationDate: string | null
  lastVerificationResult: VerificationLog | null
}

export interface VerificationProgress {
  isRunning: boolean
  totalFiles: number
  checkedFiles: number
  missingFiles: number
  startTime: number
  progressPercentage: number
}

export interface FileVerificationSettings {
  enabled: boolean
  interval: number
}

const DEFAULT_ERROR_MESSAGE = 'File verification service request failed'

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

export const fileVerificationApi = {
  async getStats(): Promise<VerificationStats> {
    try {
      const response = await apiClient.get<{ success: boolean; data: VerificationStats }>('/api/file-verification/stats')
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async getProgress(): Promise<VerificationProgress> {
    try {
      const response = await apiClient.get<{ success: boolean; data: VerificationProgress }>('/api/file-verification/progress')
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async triggerVerification(): Promise<{ success: boolean; result: VerificationResult }> {
    try {
      const response = await apiClient.post<{ success: boolean; result: VerificationResult }>('/api/file-verification/verify')
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async getLogs(limit = 50): Promise<VerificationLog[]> {
    try {
      const response = await apiClient.get<{ success: boolean; data: VerificationLog[] }>('/api/file-verification/logs', {
        params: { limit },
      })
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async getSettings(): Promise<FileVerificationSettings> {
    try {
      const response = await apiClient.get<{ success: boolean; data: FileVerificationSettings }>('/api/file-verification/settings')
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async updateSettings(settings: Partial<FileVerificationSettings>): Promise<{ success: boolean; settings: FileVerificationSettings }> {
    try {
      const response = await apiClient.put<{ success: boolean; settings: FileVerificationSettings }>('/api/file-verification/settings', settings)
      return response.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },
}
