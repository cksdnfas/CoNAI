import type { MiniMaxH3DirectorMediaType } from './minimax-h3-director-dasiwa-utils'

const MAX_AUDIO_WAVEFORM_DECODE_BYTES = 64 * 1024 * 1024

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

/** Decode a compact standalone-audio waveform for a visual crop reference. */
export async function extractAudioWaveformPeaks(file: File) {
  if (typeof AudioContext === 'undefined' || file.size > MAX_AUDIO_WAVEFORM_DECODE_BYTES) {
    return []
  }

  const audioContext = new AudioContext()
  try {
    const buffer = await audioContext.decodeAudioData(await file.arrayBuffer())
    const channel = buffer.getChannelData(0)
    const peakCount = 64
    const step = Math.max(1, Math.floor(channel.length / peakCount))
    return Array.from({ length: peakCount }, (_, index) => {
      let peak = 0
      const end = Math.min(channel.length, (index + 1) * step)
      for (let sample = index * step; sample < end; sample += 1) {
        peak = Math.max(peak, Math.abs(channel[sample] ?? 0))
      }
      return peak
    })
  } catch {
    return []
  } finally {
    void audioContext.close()
  }
}
