import { useCallback, useMemo } from 'react'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ImageRecord } from '@/types/image'

interface CachedListPage {
  images?: ImageRecord[]
  hasMore?: boolean
  total?: number
  totalKnown?: boolean
  pagination?: { total?: number; hasMore?: boolean }
}

/** Gallery lists the detail page can step through: the ones an image page is usually opened from. */
const SEQUENCE_SOURCE_QUERY_KEYS = [['home-images'], ['group-images']] as const

export interface ImageDetailSequence {
  /** Zero-based position in the loaded list. */
  index: number
  /** Loaded items in the list. */
  loadedCount: number
  /** Real list total when the cached pages carry one. */
  total: number | null
  /** The source can load more than `loadedCount`. */
  hasMore: boolean
  previousHash: string | null
  nextHash: string | null
  goPrevious: () => void
  goNext: () => void
}

function readHashes(pages: CachedListPage[]) {
  const hashes: string[] = []
  for (const page of pages) {
    for (const image of page?.images ?? []) {
      if (typeof image.composite_hash === 'string' && image.composite_hash.length > 0) {
        hashes.push(image.composite_hash)
      }
    }
  }
  return hashes
}

function readTotal(pages: CachedListPage[]) {
  const first = pages[0]
  if (typeof first?.pagination?.total === 'number') {
    return first.pagination.total
  }
  if (typeof first?.total === 'number' && first.totalKnown !== false && first.total > 0) {
    return first.total
  }
  return null
}

/**
 * Previous / next for the standalone image page, read from the gallery list it was most likely opened from (the most
 * recently updated cached Home or Group list that contains the image). Returns null when no cached list has it.
 * Stepping replaces the history entry and keeps the source state, so Back still returns to the list.
 */
export function useImageDetailSequence(compositeHash: string): ImageDetailSequence | null {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  const found = useMemo(() => {
    const candidates = SEQUENCE_SOURCE_QUERY_KEYS.flatMap((queryKey) => queryClient.getQueryCache().findAll({ queryKey }))
      .filter((query) => {
        const data = query.state.data as InfiniteData<CachedListPage> | undefined
        return Array.isArray(data?.pages)
      })
      .sort((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)

    for (const query of candidates) {
      const pages = (query.state.data as InfiniteData<CachedListPage>).pages
      const hashes = readHashes(pages)
      const index = hashes.indexOf(compositeHash)
      if (index >= 0) {
        const lastPage = pages.at(-1)
        return {
          hashes,
          index,
          total: readTotal(pages),
          hasMore: Boolean(lastPage?.hasMore ?? lastPage?.pagination?.hasMore),
        }
      }
    }

    return null
  }, [compositeHash, queryClient])

  const previousHash = found && found.index > 0 ? found.hashes[found.index - 1] : null
  const nextHash = found && found.index < found.hashes.length - 1 ? found.hashes[found.index + 1] : null

  const goTo = useCallback((hash: string | null) => {
    if (hash) {
      navigate(`/images/${hash}`, { replace: true, state: location.state })
    }
  }, [location.state, navigate])

  const goPrevious = useCallback(() => goTo(previousHash), [goTo, previousHash])
  const goNext = useCallback(() => goTo(nextHash), [goTo, nextHash])

  if (!found || found.hashes.length < 2) {
    return null
  }

  return {
    index: found.index,
    loadedCount: found.hashes.length,
    total: found.total,
    hasMore: found.hasMore,
    previousHash,
    nextHash,
    goPrevious,
    goNext,
  }
}
