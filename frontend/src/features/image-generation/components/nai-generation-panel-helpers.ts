import { useEffect, useState } from 'react'
import { loadImageSaveSourceInfo } from '@/lib/image-save-output'
import type { NaiImageSize } from '../image-generation-shared'

/** Natural size of one image data URL (the enhance source); null while it loads, fails, or without a URL. */
export function useNaiImageSize(dataUrl: string | undefined): NaiImageSize | null {
  const [loaded, setLoaded] = useState<{ dataUrl: string; size: NaiImageSize | null } | null>(null)

  useEffect(() => {
    if (!dataUrl) {
      return
    }

    let cancelled = false
    loadImageSaveSourceInfo({ source: dataUrl }).then(
      ({ width, height }) => {
        if (!cancelled) setLoaded({ dataUrl, size: width > 0 && height > 0 ? { width, height } : null })
      },
      () => {
        if (!cancelled) setLoaded({ dataUrl, size: null })
      },
    )
    return () => {
      cancelled = true
    }
  }, [dataUrl])

  return dataUrl && loaded?.dataUrl === dataUrl ? loaded.size : null
}

/** Build a human-readable asset label from one optional file name. */
export function deriveNaiAssetLabel(fileName: string | undefined, fallback: string) {
  const trimmed = fileName?.trim()
  if (!trimmed) {
    return fallback
  }

  return trimmed.replace(/\.[^/.]+$/, '') || fallback
}

/** Build one edited image file name while preserving the source label when possible. */
export function buildNaiEditedImageFileName(fileName: string | undefined, fallback: string) {
  return `${deriveNaiAssetLabel(fileName, fallback)}-edited.png`
}

/** Convert a base64 PNG payload into a Blob download. */
export function decodeNaiBase64Png(data: string) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: 'image/png' })
}
