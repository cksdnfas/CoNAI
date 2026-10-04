import type { ImageRecord } from '@/types/image'

export interface GroupRecord {
  id: number
  name: string
  description?: string | null
  color?: string | null
  parent_id?: number | null
  created_date?: string
  updated_date?: string
  auto_collect_enabled?: boolean
  auto_collect_conditions?: string | null
  auto_collect_last_run?: string | null
  /** Chat emoticon group (0/1 from the API). */
  emoticon_enabled?: boolean | number
  image_count: number
  auto_collected_count?: number
  manual_added_count?: number
}

export interface GroupWithHierarchy extends GroupRecord {
  child_count: number
  has_children: boolean
  depth?: number
  /** Visible images directly in the group, filtered like the in-group list. Custom groups only. */
  visible_image_count?: number
  /** Visible images in the group and its descendants, each counted once. Custom groups only. */
  total_visible_image_count?: number
}

export interface GroupBreadcrumbItem {
  id: number
  name: string
  color?: string | null
}

export interface GroupImagesPayload {
  images: ImageRecord[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasMore?: boolean
    totalKnown?: boolean
    nextCursorOrderIndex?: number | null
    nextCursorAddedDate?: string | null
    nextCursorDate?: string | null
    nextCursorHash?: string | null
  }
}

export interface GroupMutationInput {
  name: string
  description?: string | null
  color?: string | null
  parent_id?: number | null
  auto_collect_enabled?: boolean
  auto_collect_conditions?: unknown
  emoticon_enabled?: boolean
}

/** One image of an emoticon group with the keywords that call it up (`&*keyword*&` in chat). */
export interface EmoticonEntry {
  compositeHash: string
  /** Keywords in effect: the stored ones, or the file name when none were set. */
  keywords: string[]
  /** False while the keyword is the file name. */
  explicit: boolean
  fileName: string | null
  mimeType: string | null
  width: number | null
  height: number | null
}

export interface EmoticonKeywordResult {
  updated: number
  conflicts: Array<{ compositeHash: string; keyword: string; usedBy: string[] }>
  missing: string[]
}

export interface GroupMutationResult {
  id: number
  message: string
}

export interface GroupMutationMessage {
  message: string
}

export interface GroupBulkAddResult {
  message: string
  added_count: number
  converted_count: number
  skipped_count: number
  errors?: string[]
}

export interface GroupBulkRemoveResult {
  message: string
  removed_count: number
  skipped_count: number
  errors?: string[]
}

export interface GroupAutoCollectResult {
  group_id: number
  group_name: string
  images_added: number
  images_removed: number
  execution_time: number
}

export interface GroupAutoCollectAllResult {
  results: GroupAutoCollectResult[]
  total_groups: number
  total_images_added: number
  total_images_removed: number
}

export type GroupRematchJobKind = 'group-auto-collect' | 'all-auto-collect' | 'auto-folder-rebuild'

export type GroupRematchJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface GroupRematchJobProgress {
  total: number
  completed: number
  failed: number
  percentage: number
  current_label?: string | null
}

export interface GroupRematchJobRecord<T = unknown> {
  job_id: string
  kind: GroupRematchJobKind
  status: GroupRematchJobStatus
  progress: GroupRematchJobProgress
  group_id?: number | null
  result?: T
  error?: string | null
  created_at: string
  updated_at: string
  started_at?: string | null
  completed_at?: string | null
}

export interface GroupFileCounts {
  thumbnail: number
  original: number
  video: number
}

export type GroupDownloadType = 'thumbnail' | 'original' | 'video'
