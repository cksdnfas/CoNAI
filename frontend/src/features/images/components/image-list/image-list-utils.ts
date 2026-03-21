import type { ImageRecord } from '@/types/image'

/** Return a stable image list identity for rendering and selection state. */
export function getImageListItemId(image: ImageRecord): string {
  return String(image.composite_hash ?? image.id)
}

/** Return the preferred preview URL for image list rendering. */
export function getImageListPreviewUrl(image: ImageRecord): string | null {
  return image.thumbnail_url || image.image_url || null
}

/** Return a human-readable image name for alt text and labels. */
export function getImageListDisplayName(image: ImageRecord): string {
  const raw = image.original_file_path || image.composite_hash || String(image.id)
  const normalized = raw.replace(/\\/g, '/')
  return normalized.split('/').at(-1) || raw
}
