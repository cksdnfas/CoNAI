export interface ImageAiPromptMetadata {
  prompt?: string | null
  negative_prompt?: string | null
  character_prompt_text?: string | null
}

export interface ImageAiMetadata {
  model_name?: string | null
  prompts?: ImageAiPromptMetadata | null
}

export interface ImageAutoTaggerPayload {
  model?: string | null
  caption?: string | null
  taglist?: string | null
  rating?: Record<string, number> | null
  general?: Record<string, number> | null
  character?: Record<string, number> | null
}

export interface ImageAutoKaloscopePayload {
  model?: string | null
  topk?: number | null
  taglist?: string | null
  artists?: Record<string, number> | null
  artist?: Record<string, number> | null
}

export interface ImageAutoTags {
  version?: number | null
  tagger?: ImageAutoTaggerPayload | null
  kaloscope?: ImageAutoKaloscopePayload | null
  rating?: Record<string, number> | null
  general?: Record<string, number> | null
  character?: Record<string, number> | null
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
  file_type?: string | null
  file_size?: number | null
  first_seen_date?: string | null
  is_processing?: boolean
  ai_metadata?: ImageAiMetadata | null
  auto_tags?: ImageAutoTags | null
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
