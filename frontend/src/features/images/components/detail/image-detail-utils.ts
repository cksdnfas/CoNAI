import type { ImageRecord } from '@/types/image'
import type { SimilaritySettings } from '@/types/settings'

export function formatBytes(value?: number | null) {
  if (!value) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function getDownloadName(path?: string | null, compositeHash?: string | null) {
  if (path) {
    const normalized = path.replace(/\\/g, '/')
    const name = normalized.split('/').at(-1)
    if (name) return name
  }

  return compositeHash ? `${compositeHash}.png` : 'image'
}

/** Build the in-app render URL for the main detail media view. */
export function getImageDetailRenderUrl(image?: ImageRecord | null) {
  if (!image) {
    return null
  }

  if (image.composite_hash) {
    return `/api/images/${image.composite_hash}/file`
  }

  return image.image_url || image.thumbnail_url || null
}

/** Build the original-file download URL for the detail header actions. */
export function getImageDetailDownloadUrl(image?: ImageRecord | null) {
  if (!image) {
    return null
  }

  if (image.composite_hash) {
    return `/api/images/${image.composite_hash}/download/original`
  }

  return image.image_url || image.thumbnail_url || null
}

export function getValidImageRecords(images: ImageRecord[]) {
  return images.filter((image) => typeof image.composite_hash === 'string' && image.composite_hash.length > 0)
}

export interface SimilaritySettingsDraft {
  detailSimilarThreshold: number
  detailSimilarLimit: number
  detailSimilarIncludeColorSimilarity: boolean
  detailSimilarSortBy: SimilaritySettings['detailSimilarSortBy']
  detailSimilarSortOrder: SimilaritySettings['detailSimilarSortOrder']
}

export interface PromptSimilaritySettingsDraft {
  resultLimit: number
  combinedThreshold: number
  weights: {
    positive: number
    negative: number
    auto: number
  }
  fieldThresholds: {
    positive: number
    negative: number
    auto: number
  }
}

function getSortedTagEntries(scores?: Record<string, number> | null) {
  return Object.entries(scores ?? {}).sort(([, left], [, right]) => right - left)
}

/** Build extracted auto prompt content for the detail metadata card. */
export function getImageAutoPromptContent(image: ImageRecord) {
  const tagger = image.auto_tags?.tagger
  const ratingEntries = getSortedTagEntries(tagger?.rating ?? image.auto_tags?.rating)
  const characterEntries = getSortedTagEntries(tagger?.character ?? image.auto_tags?.character)
  const generalEntries = getSortedTagEntries(tagger?.general ?? image.auto_tags?.general)

  if (ratingEntries.length === 0 && characterEntries.length === 0 && generalEntries.length === 0) {
    return null
  }

  return {
    ratingEntries,
    characterEntries,
    generalTags: generalEntries.map(([tag]) => tag),
    generalEntries,
  }
}

/** Build extracted artist prompt tag data for the detail metadata card. */
export function getImageArtistPromptSection(image: ImageRecord) {
  const kaloscopeArtists = image.auto_tags?.kaloscope?.artists ?? image.auto_tags?.kaloscope?.artist
  const entries = getSortedTagEntries(kaloscopeArtists)

  if (entries.length === 0) {
    return null
  }

  return {
    label: 'artist',
    tags: entries.map(([tag]) => tag),
    entries,
  }
}
