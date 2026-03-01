import type { ImageRecord } from '@/types/image'
import type { ImageItem } from '@/lib/api/types'
import { buildPreviewMediaUrl } from '@/features/images/components/image-preview-url'

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

export interface ImageRenderItem {
  image: ImageRecord
  stableIdentity: ImageStableIdentity
  previewUrl: string
  compositeHashLabel: string
  resolutionLabel: string
  fileSizeLabel: string
  modelLabel: string
  searchSource: string
}

function formatNullableText(value: string | null | undefined): string {
  if (!value) {
    return '-'
  }
  return value
}

function formatTableResolution(width: number | null | undefined, height: number | null | undefined): string {
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
    return '- × -'
  }
  return `${width} × ${height}`
}

function formatTableFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) {
    return '-'
  }
  const kb = bytes / 1024
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`
  }
  return `${(kb / 1024).toFixed(1)} MB`
}

export function toImageRecordFromApiItem(item: ImageItem): ImageRecord {
  return {
    id: item.id,
    composite_hash: item.composite_hash || null,
    first_seen_date: item.first_seen_date ?? 'unknown',
    is_processing: !item.composite_hash,
    file_id: item.id ?? null,
    original_file_path: item.original_file_path ?? null,
    file_size: item.file_size ?? null,
    mime_type: item.mime_type ?? '',
    file_status: 'active',
    file_type: 'image',
    width: item.width ?? 0,
    height: item.height ?? 0,
    thumbnail_path: '',
    ai_tool: item.ai_tool ?? null,
    model_name: item.model_name ?? null,
    lora_models: null,
    steps: null,
    cfg_scale: null,
    sampler: null,
    seed: null,
    scheduler: null,
    prompt: null,
    negative_prompt: null,
    character_prompt_text: null,
    denoise_strength: null,
    generation_time: null,
    batch_size: null,
    batch_index: null,
    auto_tags: null,
    rating_score: null,
    perceptual_hash: null,
    dhash: null,
    ahash: null,
    color_histogram: null,
    duration: null,
    fps: null,
    video_codec: null,
    audio_codec: null,
    bitrate: null,
    thumbnail_url: null,
    image_url: null,
  }
}

export function createImageRenderItem(image: ImageRecord, index: number, backendOrigin: string): ImageRenderItem {
  const compositeHashLabel = formatNullableText(image.composite_hash)
  const modelLabel = formatNullableText(image.model_name)
  const pathLabel = formatNullableText(image.original_file_path)

  return {
    image,
    stableIdentity: getImageStableIdentity(image, index),
    previewUrl: buildPreviewMediaUrl(image, backendOrigin),
    compositeHashLabel,
    resolutionLabel: formatTableResolution(image.width, image.height),
    fileSizeLabel: formatTableFileSize(image.file_size),
    modelLabel,
    searchSource: [compositeHashLabel, modelLabel, pathLabel].join(' ').toLowerCase(),
  }
}

export function createImageRenderItemFromApiItem(item: ImageItem, index: number, backendOrigin: string): ImageRenderItem {
  return createImageRenderItem(toImageRecordFromApiItem(item), index, backendOrigin)
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
