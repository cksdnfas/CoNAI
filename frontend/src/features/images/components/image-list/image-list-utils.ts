import type { ImageRecord } from '@/types/image'

export type ImageListMediaKind = 'image' | 'gif' | 'video'

/** Return a stable image list identity for rendering and selection state. */
export function getImageListItemId(image: ImageRecord): string {
  return String(image.composite_hash ?? image.id)
}

/** Return a human-readable image name for alt text and labels. */
export function getImageListDisplayName(image: ImageRecord): string {
  const raw = image.original_file_path || image.composite_hash || String(image.id)
  const normalized = raw.replace(/\\/g, '/')
  return normalized.split('/').at(-1) || raw
}

/** Classify the image-list media type from backend metadata. */
export function getImageListMediaKind(image: ImageRecord): ImageListMediaKind {
  const mimeType = image.mime_type?.toLowerCase() || ''

  if (mimeType.startsWith('video/')) {
    return 'video'
  }

  if (mimeType === 'image/gif') {
    return 'gif'
  }

  return 'image'
}

/** Return the preferred preview URL for image list rendering. */
export function getImageListPreviewUrl(image: ImageRecord): string | null {
  const mediaKind = getImageListMediaKind(image)

  if (mediaKind === 'video') {
    return image.thumbnail_url || image.image_url || null
  }

  if (mediaKind === 'gif') {
    return image.image_url || image.thumbnail_url || null
  }

  return image.thumbnail_url || image.image_url || null
}
