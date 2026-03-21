export interface ImageAiMetadata {
  model_name?: string | null
}

export interface ImageRecord {
  id: number | string
  composite_hash?: string | null
  original_file_path?: string | null
  thumbnail_url?: string | null
  image_url?: string | null
  width?: number | null
  height?: number | null
  mime_type?: string | null
  file_size?: number | null
  first_seen_date?: string | null
  is_processing?: boolean
  ai_metadata?: ImageAiMetadata | null
}

export interface ImageListPayload {
  images: ImageRecord[]
  total: number
  page: number
  limit: number
  totalPages: number
  hasMore: boolean
}

export interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}
