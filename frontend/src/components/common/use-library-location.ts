import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export const positiveLibraryId = (value: string | null) => value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null

/** Both character libraries keep navigation, name search and editor return locations in the same URL contract. */
export function useLibraryLocation(pageSize: number, view?: 'profiles') {
  const [params, setParams] = useSearchParams()
  const folderId = positiveLibraryId(params.get('folder'))
  const query = params.get('q')?.trim() ?? ''
  const page = positiveLibraryId(params.get('page')) ?? 0
  const editing = params.has('setting') || params.has('new') || params.has('profile')
  const [searchText, setSearchText] = useState(query)
  const [syncedQuery, setSyncedQuery] = useState(query)
  if (syncedQuery !== query) { setSyncedQuery(query); setSearchText(query) }
  const update = (changes: Record<string, string | null>, replace = false) => setParams((current) => {
    const next = new URLSearchParams(current)
    if (view) next.set('view', view)
    for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value) }
    return next
  }, { replace })
  const pageParam = (offset: number) => offset > 0 ? String(Math.floor(offset / pageSize)) : null
  const openFolder = (id: number | null, offset = 0) => update({ folder: id === null ? null : String(id), q: null, page: pageParam(offset), setting: null, new: null, profile: null })
  const search = (text: string, offset = 0, replace = false) => update({ q: text.trim() || null, page: pageParam(offset), setting: null, new: null, profile: null }, replace)
  useEffect(() => {
    if (editing || searchText.trim() === query) return
    const timer = window.setTimeout(() => search(searchText, 0, true), 300)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- URL navigation synchronizes the input; editors cancel pending search
  }, [searchText, editing])
  return { params, folderId, query, page, searchText, setSearchText, update, openFolder, search, creationFolderId: query ? null : folderId }
}
