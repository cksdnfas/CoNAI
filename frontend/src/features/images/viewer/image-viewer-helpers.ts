import type { ImageRecord } from '@/types/image'
import type { NaiCharacterPrompt } from '@/components/prompt-display'

interface RawNaiParametersShape {
  v4_prompt?: {
    caption?: {
      char_captions?: unknown
    }
  }
}

export function getImageTitle(image: ImageRecord, index: number): string {
  if (image.prompt) {
    return image.prompt.slice(0, 80)
  }
  if (image.model_name) {
    return image.model_name
  }
  if (image.composite_hash) {
    return image.composite_hash
  }
  return `Image ${index + 1}`
}

export function isVideoLike(image: ImageRecord): boolean {
  return image.file_type === 'video'
}

export function hasMetadataValue(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) {
    return false
  }
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized.length > 0 && normalized.toLowerCase() !== 'n/a'
  }
  return true
}

export function formatFileSize(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const digits = unitIndex === 0 ? 0 : 2
  return `${size.toFixed(digits)} ${units[unitIndex]}`
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'N/A'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString()
}

export function extractCharacterPrompts(rawNaiParameters: unknown): NaiCharacterPrompt[] | undefined {
  const rawNaiParams = rawNaiParameters as RawNaiParametersShape | null | undefined
  const rawCaptions = rawNaiParams?.v4_prompt?.caption?.char_captions
  if (!Array.isArray(rawCaptions)) {
    return undefined
  }

  const normalized = rawCaptions
    .map((entry): NaiCharacterPrompt | null => {
      if (!entry || typeof entry !== 'object') {
        return null
      }

      const candidate = entry as { char_caption?: unknown; centers?: unknown }
      if (typeof candidate.char_caption !== 'string' || candidate.char_caption.trim().length === 0) {
        return null
      }

      const centers = Array.isArray(candidate.centers)
        ? candidate.centers.flatMap((point) => {
          if (!point || typeof point !== 'object') {
            return []
          }

          const typedPoint = point as { x?: unknown; y?: unknown }
          if (typeof typedPoint.x === 'number' && typeof typedPoint.y === 'number') {
            return [{ x: typedPoint.x, y: typedPoint.y }]
          }
          return []
        })
        : []

      return {
        char_caption: candidate.char_caption,
        centers,
      }
    })
    .filter((entry): entry is NaiCharacterPrompt => entry !== null)

  return normalized.length > 0 ? normalized : undefined
}
