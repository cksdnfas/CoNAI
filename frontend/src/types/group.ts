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
  image_count: number
  auto_collected_count?: number
  manual_added_count?: number
}

export interface GroupWithHierarchy extends GroupRecord {
  child_count: number
  has_children: boolean
  depth?: number
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
  }
}

export interface GroupMutationInput {
  name: string
  description?: string | null
  color?: string | null
  parent_id?: number | null
  auto_collect_enabled?: boolean
  auto_collect_conditions?: unknown
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

export interface GroupFileCounts {
  thumbnail: number
  original: number
  video: number
}

export type GroupDownloadType = 'thumbnail' | 'original' | 'video'
