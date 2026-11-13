import type { MiniMaxH3DirectorMediaType } from './minimax-h3-director-dasiwa-utils'

/** Read browser media metadata without retaining an object URL. */
export async function probeMediaDuration(file: File, type: MiniMaxH3DirectorMediaType) {
  if (type === 'image') {
    return null
  }

  const media = document.createElement(type === 'video' ? 'video' : 'audio')
  const objectUrl = URL.createObjectURL(file)
  media.preload = 'metadata'
  media.src = objectUrl

  try {
    return await new Promise<number | null>((resolve) => {
      media.onloadedmetadata = () => resolve(Number.isFinite(media.duration) ? media.duration : null)
      media.onerror = () => resolve(null)
    })
  } finally {
    media.removeAttribute('src')
    media.load()
    URL.revokeObjectURL(objectUrl)
  }
}

/** Read image/video intrinsic dimensions for Auto aspect without retaining an object URL. */
export async function probeMediaDimensions(file: File, type: MiniMaxH3DirectorMediaType) {
  if (type !== 'image' && type !== 'video') return null
  const media = document.createElement(type === 'video' ? 'video' : 'img')
  const objectUrl = URL.createObjectURL(file)
  media.src = objectUrl
  if (media instanceof HTMLVideoElement) media.preload = 'metadata'

  try {
    return await new Promise<{ source_width: number; source_height: number } | null>((resolve) => {
      const complete = () => {
        const sourceWidth = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth
        const sourceHeight = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight
        resolve(sourceWidth > 0 && sourceHeight > 0 ? { source_width: sourceWidth, source_height: sourceHeight } : null)
      }
      if (media instanceof HTMLVideoElement) media.onloadedmetadata = complete
      else media.onload = complete
      media.onerror = () => resolve(null)
    })
  } finally {
    if (media instanceof HTMLVideoElement) {
      media.removeAttribute('src')
      media.load()
    } else {
      media.removeAttribute('src')
    }
    URL.revokeObjectURL(objectUrl)
  }
}
