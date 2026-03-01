import { apiClient } from '@/lib/api/client'

export interface WatchedFolder {
  id: number
  folder_path: string
  name?: string
  folder_name?: string
  active: boolean
  is_active?: boolean
  is_default?: boolean
  auto_scan?: number | boolean
  scan_interval?: number
  recursive?: number | boolean
  exclude_extensions?: string | string[] | null
  exclude_patterns?: string | string[] | null
  watcher_enabled?: number | boolean
  watcher_status?: 'watching' | 'error' | 'stopped' | 'initializing' | null
  watcher_error?: string | null
  watcher_polling_interval?: number | null
  last_scan_date?: string | null
  last_scan_status?: 'success' | 'error' | 'in_progress' | null
  created_at?: string
  updated_at?: string
}

export interface WatchedFolderCreate {
  folder_path: string
  name?: string
  folder_name?: string
  active?: boolean
  auto_scan?: boolean
  scan_interval?: number
  recursive?: boolean
  exclude_extensions?: string[]
  exclude_patterns?: string[]
  watcher_enabled?: boolean
  watcher_polling_interval?: number | null
}

export interface WatchedFolderUpdate {
  folder_path?: string
  name?: string
  folder_name?: string
  active?: boolean
  auto_scan?: boolean
  scan_interval?: number
  recursive?: boolean
  exclude_extensions?: string[]
  exclude_patterns?: string[]
  watcher_enabled?: boolean
  watcher_polling_interval?: number | null
}

export interface FolderScanResult {
  totalScanned: number
  newImages: number
  existingImages: number
  updatedPaths: number
  missingImages: number
  errors: Array<{ file: string; error: string }>
  duration: number
  thumbnailsGenerated: number
  backgroundTasks: number
}

export interface ScanAllSummary {
  totalFolders: number
  totalScanned: number
  totalNew: number
  totalExisting: number
  totalErrors: number
  results: FolderScanResult[]
}

export interface FolderScanLog {
  id: number
  folder_id: number
  folder_name: string | null
  folder_path: string
  scan_type: 'manual' | 'auto'
  scan_status: 'success' | 'error' | 'in_progress'
  total_scanned: number
  new_images: number
  existing_images: number
  errors_count: number
  errors_details: string | null
  duration_ms: number
  scan_date: string
}

export interface PathValidationResult {
  valid: boolean
  exists: boolean
  readable: boolean
  message?: string
}

export interface WatcherStatusInfo {
  isRunning: boolean
  folderId: number
  lastEventAt?: string | null
}

export interface WatcherHealthCheck {
  healthy: boolean
  totalWatchers: number
  runningWatchers: number
  stoppedWatchers: number
}

const DEFAULT_ERROR_MESSAGE = 'Folder service request failed'

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

export const folderApi = {
  async getFolders(params?: { active_only?: boolean }): Promise<WatchedFolder[]> {
    try {
      const response = await apiClient.get<{ success: boolean; data: WatchedFolder[] }>('/api/folders', { params })
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async getFolder(id: number): Promise<WatchedFolder> {
    try {
      const response = await apiClient.get<{ success: boolean; data: WatchedFolder }>(`/api/folders/${id}`)
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async addFolder(folderData: WatchedFolderCreate): Promise<{ id: number; folder: WatchedFolder; message: string }> {
    try {
      const response = await apiClient.post<{ success: boolean; data: { id: number; folder: WatchedFolder; message: string } }>('/api/folders', folderData)
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async updateFolder(id: number, updates: WatchedFolderUpdate): Promise<{ folder: WatchedFolder; message: string }> {
    try {
      const response = await apiClient.patch<{ success: boolean; data: { folder: WatchedFolder; message: string } }>(`/api/folders/${id}`, updates)
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async deleteFolder(id: number, deleteFiles = false): Promise<{ message: string }> {
    try {
      const response = await apiClient.delete<{ success: boolean; data: { message: string } }>(`/api/folders/${id}`, {
        params: { delete_files: deleteFiles },
      })
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async scanFolder(id: number, fullRescan = false): Promise<FolderScanResult> {
    try {
      const response = await apiClient.post<{ success: boolean; data: FolderScanResult }>(`/api/folders/${id}/scan`, null, {
        params: { full: fullRescan },
      })
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async scanAllFolders(): Promise<ScanAllSummary> {
    try {
      const response = await apiClient.post<{ success: boolean; data: ScanAllSummary }>('/api/folders/scan-all', null)
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async getScanLogs(id: number, limit = 50): Promise<FolderScanLog[]> {
    try {
      const response = await apiClient.get<{ success: boolean; data: FolderScanLog[] }>(`/api/folders/${id}/scan-logs`, {
        params: { limit },
      })
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async getRecentScanLogs(limit = 100): Promise<FolderScanLog[]> {
    try {
      const response = await apiClient.get<{ success: boolean; data: FolderScanLog[] }>('/api/folders/scan-logs/recent', {
        params: { limit },
      })
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async validateFolderPath(folderPath: string): Promise<PathValidationResult> {
    try {
      const response = await apiClient.post<{ success: boolean; data: PathValidationResult }>('/api/folders/validate-path', {
        folder_path: folderPath,
      })
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async startWatcher(id: number): Promise<{ message: string; status: WatcherStatusInfo }> {
    try {
      const response = await apiClient.post<{ success: boolean; data: { message: string; status: WatcherStatusInfo } }>(`/api/folders/${id}/watcher/start`, null)
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async stopWatcher(id: number): Promise<{ message: string }> {
    try {
      const response = await apiClient.post<{ success: boolean; data: { message: string } }>(`/api/folders/${id}/watcher/stop`, null)
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async restartWatcher(id: number): Promise<{ message: string; status: WatcherStatusInfo }> {
    try {
      const response = await apiClient.post<{ success: boolean; data: { message: string; status: WatcherStatusInfo } }>(`/api/folders/${id}/watcher/restart`, null)
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async getWatcherStatus(id: number): Promise<WatcherStatusInfo> {
    try {
      const response = await apiClient.get<{ success: boolean; data: WatcherStatusInfo }>(`/api/folders/${id}/watcher/status`)
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  async getWatchersHealth(): Promise<WatcherHealthCheck> {
    try {
      const response = await apiClient.get<{ success: boolean; data: WatcherHealthCheck }>('/api/folders/watchers/health')
      return response.data.data
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },
}
