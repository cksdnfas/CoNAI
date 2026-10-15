import { useEffect, useRef, useState } from 'react'

export type LocalFilePreview = {
  file: File
  key: string
  url: string | null
}

/** Identify image and video files that browsers can preview from object URLs. */
function canPreviewLocalFile(file: File) {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
}

/** Keep visible files' URLs and row identities across queue edits; release files that leave the preview window. */
export function useLocalFilePreviews(files: File[], limit = files.length) {
  const owned = useRef(new Map<File, LocalFilePreview>())
  const nextKey = useRef(0)
  const [previews, setPreviews] = useState(new Map<File, LocalFilePreview>())

  useEffect(() => {
    return () => {
      for (const preview of owned.current.values()) {
        if (preview.url) URL.revokeObjectURL(preview.url)
      }
      owned.current.clear()
    }
  }, [])

  useEffect(() => {
    const next = new Map<File, LocalFilePreview>()
    for (const file of files.slice(0, limit)) {
      if (next.has(file)) continue
      next.set(file, owned.current.get(file) ?? {
        file,
        key: `local-preview-${nextKey.current++}`,
        url: canPreviewLocalFile(file) ? URL.createObjectURL(file) : null,
      })
    }
    for (const [file, preview] of owned.current) {
      if (!next.has(file) && preview.url) URL.revokeObjectURL(preview.url)
    }
    owned.current = next
    setPreviews(next)
  }, [files, limit])

  const occurrences = new Map<File, number>()
  return files.slice(0, limit).map((file, index) => {
    const occurrence = occurrences.get(file) ?? 0
    occurrences.set(file, occurrence + 1)
    const preview = previews.get(file)
    return {
      file,
      key: preview ? `${preview.key}:${occurrence}` : `pending-preview-${index}`,
      url: preview?.url ?? null,
    }
  })
}
