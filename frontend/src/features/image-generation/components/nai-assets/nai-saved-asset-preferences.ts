import { useMemo, useState } from 'react'

export type NaiSavedAssetSortOption = 'pinned' | 'recent' | 'latest' | 'oldest' | 'name'

/** Load an id list (recent picks or pins) from localStorage so pickers can prioritize repeat selections. */
function loadAssetIds(storageKey: string) {
  if (typeof window === 'undefined') {
    return [] as string[]
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey)
    if (!rawValue) {
      return [] as string[]
    }

    const parsedValue = JSON.parse(rawValue)
    return Array.isArray(parsedValue) ? parsedValue.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return [] as string[]
  }
}

function persistAssetIds(storageKey: string, ids: string[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(storageKey, JSON.stringify(ids))
  }

  return ids
}

/** Index saved asset order preferences once before comparator hot paths run. */
function buildAssetOrderIndex(ids: string[]) {
  return new Map(ids.map((id, index) => [id, index] as const))
}

function getAssetOrder(orderIndex: ReadonlyMap<string, number>, assetId: string) {
  return orderIndex.get(assetId) ?? Number.MAX_SAFE_INTEGER
}

function compareNewestFirst(left: { created_date: string }, right: { created_date: string }) {
  return new Date(right.created_date).getTime() - new Date(left.created_date).getTime()
}

/** Sort saved asset cards so users can switch between pinned, recent use, recency, and name ordering. */
export function sortNaiSavedAssets<T extends { id: string; label: string; created_date: string }>(
  items: T[],
  sort: NaiSavedAssetSortOption,
  recentIds: string[],
  pinnedIds: string[],
  locale: string,
) {
  const nextItems = [...items]

  if (sort === 'pinned') {
    const pinnedIdOrder = buildAssetOrderIndex(pinnedIds)
    const recentIdOrder = buildAssetOrderIndex(recentIds)

    return nextItems.sort((left, right) => {
      const pinnedDelta = getAssetOrder(pinnedIdOrder, left.id) - getAssetOrder(pinnedIdOrder, right.id)
      if (pinnedDelta !== 0) {
        return pinnedDelta
      }

      const recentDelta = getAssetOrder(recentIdOrder, left.id) - getAssetOrder(recentIdOrder, right.id)
      return recentDelta !== 0 ? recentDelta : compareNewestFirst(left, right)
    })
  }

  if (sort === 'recent') {
    const recentIdOrder = buildAssetOrderIndex(recentIds)

    return nextItems.sort((left, right) => {
      const recentDelta = getAssetOrder(recentIdOrder, left.id) - getAssetOrder(recentIdOrder, right.id)
      return recentDelta !== 0 ? recentDelta : compareNewestFirst(left, right)
    })
  }

  if (sort === 'name') {
    return nextItems.sort((left, right) => left.label.localeCompare(right.label, locale, { numeric: true, sensitivity: 'base' }))
  }

  return nextItems.sort((left, right) => (sort === 'oldest' ? -compareNewestFirst(left, right) : compareNewestFirst(left, right)))
}

/**
 * Keep the per-browser sort choice, recent picks, and pins for one saved-asset library.
 * `storagePrefix` is e.g. `conai.nai.vibes` → `conai.nai.vibes.recent` / `conai.nai.vibes.pinned`.
 */
export function useNaiSavedAssetPreferences(storagePrefix: string) {
  const recentKey = `${storagePrefix}.recent`
  const pinnedKey = `${storagePrefix}.pinned`
  const [sort, setSort] = useState<NaiSavedAssetSortOption>('recent')
  const [recentIds, setRecentIds] = useState<string[]>(() => loadAssetIds(recentKey))
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => loadAssetIds(pinnedKey))
  const pinnedIdSet = useMemo(() => new Set(pinnedIds), [pinnedIds])

  /** Persist one recently used asset id and keep the newest 20 picks near the top. */
  const markRecent = (assetId: string) => {
    setRecentIds((current) => persistAssetIds(recentKey, [assetId, ...current.filter((entry) => entry !== assetId)].slice(0, 20)))
  }

  /** Toggle one pinned asset id and persist the updated favorite list. */
  const togglePin = (assetId: string) => {
    setPinnedIds((current) => persistAssetIds(
      pinnedKey,
      current.includes(assetId) ? current.filter((entry) => entry !== assetId) : [assetId, ...current],
    ))
  }

  return { sort, setSort, recentIds, pinnedIds, pinnedIdSet, markRecent, togglePin }
}
