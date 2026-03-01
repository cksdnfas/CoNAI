import type { ImageRecord } from '@/types/image'

export interface ImageListPaginationConfig {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  pageSize: number
  onPageSizeChange: (size: number) => void
}

export interface ImageListInfiniteScrollConfig {
  hasMore: boolean
  loadMore: () => void
}

export interface ImageListSelectionConfig {
  selectedIds: number[]
  onSelectionChange: (selectedIds: number[]) => void
  selectedStableKeys?: string[]
  onStableSelectionChange?: (selectedStableKeys: string[]) => void
}

interface ImageListAdapterPolicyBase {
  total?: number
  capabilities?: {
    emptyStateAction?: {
      label?: string
      onClick: () => void
    }
  }
}

export type ImageListAdapterPolicy =
  | (ImageListAdapterPolicyBase & {
      mode: 'infinite'
      infiniteScroll: ImageListInfiniteScrollConfig
      pagination?: undefined
    })
  | (ImageListAdapterPolicyBase & {
      mode: 'pagination'
      pagination: ImageListPaginationConfig
      infiniteScroll?: undefined
    })

export function createInfiniteImageListAdapter(policy: ImageListAdapterPolicyBase & { infiniteScroll: ImageListInfiniteScrollConfig }): ImageListAdapterPolicy {
  return {
    ...policy,
    mode: 'infinite',
  }
}

export function createPaginationImageListAdapter(policy: ImageListAdapterPolicyBase & { pagination: ImageListPaginationConfig }): ImageListAdapterPolicy {
  return {
    ...policy,
    mode: 'pagination',
  }
}

export interface ImageStableIdentity {
  numericId: number | null
  stableKey: string
}

export function getImageStableIdentity(image: ImageRecord, index: number): ImageStableIdentity {
  const numericId = typeof image.id === 'number' ? image.id : null
  if (numericId !== null) {
    return {
      numericId,
      stableKey: `id:${numericId}`,
    }
  }

  if (image.composite_hash) {
    return {
      numericId: null,
      stableKey: `hash:${image.composite_hash}`,
    }
  }

  if (image.original_file_path) {
    return {
      numericId: null,
      stableKey: `path:${image.original_file_path}`,
    }
  }

  if (image.file_id !== null) {
    return {
      numericId: null,
      stableKey: `file:${image.file_id}`,
    }
  }

  return {
    numericId: null,
    stableKey: `fallback:${image.first_seen_date}:${index}`,
  }
}
