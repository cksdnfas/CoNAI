import { useState } from 'react'
import type { FileStoreSortDirection, FileStoreSortKey } from '@conai/shared'

/** What a file list is ordered by; the server sorts (folders always first), the list is paged. */
export type FileSort = { sort: FileStoreSortKey; direction: FileStoreSortDirection }
export const DEFAULT_FILE_SORT: FileSort = { sort: 'name', direction: 'asc' }
const FILES_SORT_KEY = 'conai.files.sort'
const WORKSPACE_SORT_KEY = 'conai.files.workspace.sort'

/** A header click: the same column flips its direction, another starts ascending (a date or size, newest / largest first). */
export function nextFileSort(current: FileSort, sort: FileStoreSortKey): FileSort {
  if (current.sort === sort) return { sort, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  return { sort, direction: sort === 'name' ? 'asc' : 'desc' }
}

/** The order remembered per browser: one for the file store, one for project workspaces (no modified time there). */
export function useFileSort(scope: 'files' | 'workspace' = 'files') {
  const key = scope === 'workspace' ? WORKSPACE_SORT_KEY : FILES_SORT_KEY
  const keys: readonly FileStoreSortKey[] = scope === 'workspace' ? ['name', 'size'] : ['name', 'modified', 'size']
  const [order, setOrder] = useState<FileSort>(() => {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null')
      if (typeof stored === 'object' && stored !== null) {
        const { sort, direction } = stored as Partial<FileSort>
        if (sort && keys.includes(sort) && (direction === 'asc' || direction === 'desc')) return { sort, direction }
      }
    } catch {
      // Unreadable or blocked storage: the default order.
    }
    return DEFAULT_FILE_SORT
  })
  const changeOrder = (next: FileSort) => {
    setOrder(next)
    try {
      window.localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
  }
  return [order, changeOrder, keys] as const
}

export type FileViewMode = 'grid' | 'list'
const FILES_VIEW_MODE_KEY = 'conai.files.view'
/** The RecycleBin is read through its details (original location, deleted by, date), so it opens as a list. */
const RECYCLE_BIN_VIEW_MODE_KEY = 'conai.files.recycle-bin.view'
/** Project workspaces hold text documents, read by name, so they open as a list too. */
const WORKSPACE_VIEW_MODE_KEY = 'conai.files.workspace.view'

function readViewMode(key: string, fallback: FileViewMode): FileViewMode {
  try {
    const stored = window.localStorage.getItem(key)
    return stored === 'list' || stored === 'grid' ? stored : fallback
  } catch {
    return fallback
  }
}

/** Icons / details choice, remembered per browser: one for the file store and server folders, one for the bin. */
export function useFileViewMode(scope: 'files' | 'recycle-bin' | 'workspace' = 'files') {
  const key = scope === 'recycle-bin' ? RECYCLE_BIN_VIEW_MODE_KEY : scope === 'workspace' ? WORKSPACE_VIEW_MODE_KEY : FILES_VIEW_MODE_KEY
  const fallback: FileViewMode = scope === 'files' ? 'grid' : 'list'
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
