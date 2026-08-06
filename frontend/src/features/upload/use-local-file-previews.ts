import { useEffect, useState } from 'react'

export type LocalFilePreview = {
  file: File
  key: string
  url: string | null
}

type LocalFilePreviewState = {
  files: File[]
  limit: number
  previews: LocalFilePreview[]
}

/** Identify image and video files that browsers can preview from object URLs. */
function canPreviewLocalFile(file: File) {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
}

/** Build one stable-enough render key while preserving duplicate files by index. */
function buildLocalFilePreviewKey(file: File, index: number) {
  return `${file.name}:${file.size}:${file.lastModified}:${index}`
}

/** Create and revoke local object URLs for the current selected-file snapshot. */
export function useLocalFilePreviews(files: File[], limit = files.length) {
  const [state, setState] = useState<LocalFilePreviewState>({ files: [], limit: 0, previews: [] })

  useEffect(() => {
    const previews = files.slice(0, limit).map((file, index) => ({
      file,
      key: buildLocalFilePreviewKey(file, index),
      url: canPreviewLocalFile(file) ? URL.createObjectURL(file) : null,
    }))

    setState({ files, limit, previews })

    return () => {
      for (const preview of previews) {
        if (preview.url) {
          URL.revokeObjectURL(preview.url)
        }
      }
    }
  }, [files, limit])

  if (state.files === files && state.limit === limit) {
    return state.previews
  }

  return files.slice(0, limit).map((file, index) => {
    const currentPreview = state.previews.find((preview) => preview.file === file)
    return currentPreview ?? {
      file,
      key: buildLocalFilePreviewKey(file, index),
      url: null,
    }
  })
}
