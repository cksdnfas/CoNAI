import { useState } from 'react'

export type FileViewMode = 'grid' | 'list'
const FILES_VIEW_MODE_KEY = 'conai.files.view'
/** The RecycleBin is read through its details (original location, deleted by, date), so it opens as a list. */
const RECYCLE_BIN_VIEW_MODE_KEY = 'conai.files.recycle-bin.view'

function readViewMode(key: string, fallback: FileViewMode): FileViewMode {
  try {
    const stored = window.localStorage.getItem(key)
    return stored === 'list' || stored === 'grid' ? stored : fallback
  } catch {
    return fallback
  }
}

/** Icons / details choice, remembered per browser: one for the file store and server folders, one for the bin. */
export function useFileViewMode(scope: 'files' | 'recycle-bin' = 'files') {
  const key = scope === 'recycle-bin' ? RECYCLE_BIN_VIEW_MODE_KEY : FILES_VIEW_MODE_KEY
  const fallback: FileViewMode = scope === 'recycle-bin' ? 'list' : 'grid'
  const [viewMode, setViewMode] = useState<FileViewMode>(() => readViewMode(key, fallback))
  const changeViewMode = (mode: FileViewMode) => {
    setViewMode(mode)
    try {
      window.localStorage.setItem(key, mode)
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }
  return [viewMode, changeViewMode] as const
}
