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
