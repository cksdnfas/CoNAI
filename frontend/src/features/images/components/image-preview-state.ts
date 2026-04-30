import type { ImageRecord, ImagePreviewStatus } from '@/types/image'

interface ResolveImagePreviewStateOptions {
  image: Pick<ImageRecord, 'is_processing' | 'file_status' | 'preview_status'> | null | undefined
  hasPreviewUrl: boolean
  hasPreviewError?: boolean
}

/** Resolve one shared preview state so fallback labels stay consistent across list surfaces. */
export function resolveImagePreviewState({
  image,
  hasPreviewUrl,
  hasPreviewError = false,
}: ResolveImagePreviewStateOptions): ImagePreviewStatus {
  if (image?.preview_status) {
    return image.preview_status
  }

  if (image?.is_processing) {
    return 'processing'
  }

  if (image?.file_status === 'missing' || image?.file_status === 'deleted') {
    return 'unavailable'
  }

  if (hasPreviewError) {
    return 'unavailable'
  }

  if (!hasPreviewUrl) {
    return 'empty'
  }

  return 'ready'
}

interface ImagePreviewStateLabels {
  empty: string
  processing: string
  failed: string
  unavailable: string
}

/** Resolve one user-facing placeholder label from a shared preview state. */
export function getImagePreviewStateLabel(
  status: ImagePreviewStatus,
  emptyLabel = '미리보기 없음',
  labels?: Partial<ImagePreviewStateLabels>,
) {
  if (status === 'processing') return labels?.processing ?? '진행 중'
  if (status === 'failed') return labels?.failed ?? '실패'
  if (status === 'unavailable') return labels?.unavailable ?? '표시 불가'
  if (status === 'empty') return labels?.empty ?? emptyLabel
  return labels?.empty ?? emptyLabel
}
