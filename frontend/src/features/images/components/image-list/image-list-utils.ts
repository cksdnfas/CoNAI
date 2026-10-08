import type { ImageRecord } from '@/types/image'

export type ImageListMediaKind = 'image' | 'gif' | 'video' | 'audio'

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
  // Sounds without a picture; a run with both stays an image tile that also plays its sounds.
  if (image.audio?.length && !image.composite_hash) {
    return 'audio'
  }

  const mimeType = image.mime_type?.toLowerCase() || ''

  if (mimeType.startsWith('video/')) {
    return 'video'
  }

  if (mimeType === 'image/gif') {
    return 'gif'
  }

  return 'image'
}

/** Return the preferred display URL for web rendering. Videos keep scoped history routes before falling back to the canonical gallery stream. */
export function getImageListPreviewUrl(image: ImageRecord): string | null {
  const mediaKind = getImageListMediaKind(image)

  if (mediaKind === 'video') {
    if (image.image_url?.startsWith('/api/generation-history/')) {
      return image.image_url
    }

    if (image.composite_hash) {
      return `/api/images/${image.composite_hash}/file`
    }

    return image.image_url || image.thumbnail_url || null
  }

  return image.thumbnail_url || image.image_url || null
}
