import type { ImageRecord } from '@/types/image'

export function buildPreviewMediaUrl(image: ImageRecord, backendOrigin: string): string {
  const originalPath = image.original_file_path || ''
  const isProcessing = image.is_processing || !image.composite_hash

  if (isProcessing) {
    return `${backendOrigin}/api/images/by-path/${encodeURIComponent(originalPath)}`
  }

  if (image.file_type === 'video' || image.file_type === 'animated') {
    return `${backendOrigin}/api/images/${image.composite_hash}/file`
  }

  return `${backendOrigin}/api/images/${image.composite_hash}/thumbnail`
}
