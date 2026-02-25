export interface HealthResponse {
  status: string
  timestamp: string
  uptime: number
}

export interface GeneralSettings {
  language?: string
  enableGallery?: boolean
  autoCleanupCanvasOnShutdown?: boolean
  showRatingBadges?: boolean
}

export interface AppSettings {
  general?: GeneralSettings
  [key: string]: unknown
}

export interface SettingsResponse {
  success: boolean
  data: AppSettings
}

export interface ImageItem {
  id?: number
  composite_hash: string
  width?: number
  height?: number
  file_size?: number
  mime_type?: string
  original_file_path?: string
  first_seen_date?: string
  ai_tool?: string
  model_name?: string
}

export interface ImagesPayload {
  images: ImageItem[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface ImagesResponse {
  success: boolean
  data: ImagesPayload
}
