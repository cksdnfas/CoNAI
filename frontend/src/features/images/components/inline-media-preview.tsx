import { useEffect, useState } from 'react'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { ImagePreviewPlaceholder } from '@/features/images/components/image-preview-placeholder'
import { getImagePreviewStateLabel, resolveImagePreviewState } from '@/features/images/components/image-preview-state'
import { cn } from '@/lib/utils'
import type { ImagePreviewStatus, ImageRecord } from '@/types/image'

interface InlineMediaPreviewProps {
  src?: string | null
  mimeType?: string | null
  fileName?: string | null
  alt: string
  frameClassName?: string
  mediaClassName?: string
  emptyLabel?: string
  loading?: 'lazy' | 'eager'
  fitToMedia?: boolean
  isProcessing?: boolean
  fileStatus?: ImageRecord['file_status']
  previewStatus?: ImagePreviewStatus
}

/** Infer one mime type from a data URL or file-like URL when explicit metadata is absent. */
function inferMimeTypeFromSource(src?: string | null) {
  if (!src) {
    return null
  }

  if (src.startsWith('data:')) {
    const match = /^data:([^;,]+)[;,]/i.exec(src)
    return match?.[1] ?? null
  }

  const normalized = src.split('?')[0]?.toLowerCase() ?? ''

  if (normalized.endsWith('.gif')) {
    return 'image/gif'
  }

  if (normalized.endsWith('.mp4')) {
    return 'video/mp4'
  }

  if (normalized.endsWith('.webm')) {
    return 'video/webm'
  }

  if (normalized.endsWith('.mov')) {
    return 'video/quicktime'
  }

  return null
}

/** Build one temporary ImageRecord so shared media rendering can be reused. */
export function buildPreviewImageRecord({ src, mimeType, fileName, alt, isProcessing, fileStatus, previewStatus }: Pick<InlineMediaPreviewProps, 'src' | 'mimeType' | 'fileName' | 'alt' | 'isProcessing' | 'fileStatus' | 'previewStatus'>): ImageRecord | null {
  if (!src) {
    return null
  }

  return {
    id: fileName || alt || src,
    original_file_path: fileName || alt,
    image_url: src,
    thumbnail_url: src,
    mime_type: mimeType || inferMimeTypeFromSource(src),
    is_processing: isProcessing,
    file_status: fileStatus,
    preview_status: previewStatus,
  }
}

/** Render one reusable bordered media preview for workflow forms, results, and picker summaries. */
export function InlineMediaPreview({
  src,
  mimeType,
  fileName,
  alt,
  frameClassName,
  mediaClassName,
  emptyLabel = '미리보기 없음',
  loading = 'lazy',
  fitToMedia = false,
  isProcessing,
  fileStatus,
  previewStatus,
}: InlineMediaPreviewProps) {
  const previewImage = buildPreviewImageRecord({ src, mimeType, fileName, alt, isProcessing, fileStatus, previewStatus })
  const [hasPreviewError, setHasPreviewError] = useState(false)

  useEffect(() => {
    setHasPreviewError(false)
  }, [src, mimeType, fileName, isProcessing, fileStatus, previewStatus])

  const resolvedPreviewState = resolveImagePreviewState({
    image: previewImage,
    hasPreviewUrl: Boolean(src),
    hasPreviewError,
  })

  return (
    <div
      className={cn(
        fitToMedia ? 'inline-flex max-w-full items-center justify-center overflow-hidden rounded-sm border border-border bg-surface-lowest p-2' : 'flex items-center justify-center overflow-hidden rounded-sm border border-border bg-surface-lowest p-2',
        frameClassName,
      )}
    >
      {previewImage && resolvedPreviewState === 'ready' ? (
        <ImagePreviewMedia
          image={previewImage}
          alt={alt}
          loading={loading}
          className={cn(fitToMedia ? 'max-h-40 max-w-full w-auto object-contain' : 'max-h-40 w-full object-contain', mediaClassName)}
          onError={() => setHasPreviewError(true)}
        />
      ) : (
        <ImagePreviewPlaceholder
          label={getImagePreviewStateLabel(resolvedPreviewState, emptyLabel)}
          compact
          className="min-h-24 text-xs"
          iconClassName="h-5 w-5"
          labelClassName="text-xs"
        />
      )}
    </div>
  )
}
