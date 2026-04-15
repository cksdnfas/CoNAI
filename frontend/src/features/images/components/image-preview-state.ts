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

/** Resolve one user-facing placeholder label from a shared preview state. */
export function getImagePreviewStateLabel(status: ImagePreviewStatus, emptyLabel = '미리보기 없음') {
  if (status === 'processing') return '진행 중'
  if (status === 'failed') return '실패'
  if (status === 'unavailable') return '표시 불가'
  if (status === 'empty') return emptyLabel
  return emptyLabel
}
