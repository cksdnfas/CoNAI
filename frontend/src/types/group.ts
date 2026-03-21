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
