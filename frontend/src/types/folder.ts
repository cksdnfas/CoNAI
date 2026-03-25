export interface WatchedFolder {
  id: number
  folder_path: string
  folder_name: string | null
  auto_scan: number
  scan_interval: number
  recursive: number
  exclude_extensions: string | null
  exclude_patterns: string | null
  watcher_enabled: number
  watcher_polling_interval: number | null
  is_active: number
  is_default: number
  last_scan_date: string | null
  last_scan_status: string | null
  last_scan_found: number
  last_scan_error: string | null
  created_date: string
  updated_date: string
}

export interface WatchedFolderInput {
  folder_path: string
  folder_name?: string
  auto_scan?: boolean
  scan_interval?: number
  recursive?: boolean
  exclude_extensions?: string[]
  exclude_patterns?: string[]
  watcher_enabled?: boolean
  watcher_polling_interval?: number | null
}

export interface WatchedFolderUpdateInput {
  folder_name?: string
  auto_scan?: boolean
  scan_interval?: number
  recursive?: boolean
  exclude_extensions?: string[]
  exclude_patterns?: string[]
  watcher_enabled?: boolean
  watcher_polling_interval?: number | null
  is_active?: boolean
}

export interface BackupSource {
  id: number
  source_path: string
  display_name: string | null
  target_folder_name: string
  recursive: number
  watcher_enabled: number
  watcher_polling_interval: number | null
  import_mode: 'copy_original' | 'convert_webp'
  webp_quality: number
  is_active: number
  watcher_status: string | null
  watcher_error: string | null
  watcher_last_event: string | null
  created_date: string
  updated_date: string
}

export interface BackupSourceInput {
  source_path: string
  display_name?: string
  target_folder_name: string
  recursive?: boolean
  watcher_enabled?: boolean
  watcher_polling_interval?: number | null
  import_mode?: 'copy_original' | 'convert_webp'
  webp_quality?: number
}

export interface BackupSourceUpdateInput {
  source_path?: string
  display_name?: string
  target_folder_name?: string
  recursive?: boolean
  watcher_enabled?: boolean
  watcher_polling_interval?: number | null
  import_mode?: 'copy_original' | 'convert_webp'
  webp_quality?: number
  is_active?: boolean
}

export interface FolderScanLog {
  id: number
  folder_id: number
  scan_date: string
  scan_type: string
  status: string
  total_scanned: number
  new_images: number
  existing_images: number
  error_count: number
  duration_ms: number | null
  error_message: string | null
  error_details: string[]
  folder_name?: string
  folder_path?: string
}

export interface FolderWatcherStatus {
  folderId: number
  running: boolean
  state: string
  folderName?: string
  folderPath?: string
  lastEvent?: string | null
  eventCount?: number
  error?: string | null
  retryAttempts?: number
  message?: string
}

export interface WatchersHealthSummary {
  totalWatchers: number
  watching: number
  error: number
  stopped: number
  initializing: number
  totalEvents24h: number
  watchers: FolderWatcherStatus[]
}

export interface ScanAllSummary {
  totalFolders: number
  totalScanned: number
  totalNew: number
  totalExisting: number
  totalErrors: number
}
