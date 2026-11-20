import type { InfiniteData, Query, QueryClient } from '@tanstack/react-query'
import type { ImageRecord } from '@/types/image'

/** Home feed pages carry `total`; group pages carry `pagination.total`. Both list `images`. */
interface ImageListCachePage {
  images?: ImageRecord[]
  total?: number
  pagination?: { total?: number }
}

/** Gallery lists whose cached pages should drop deleted images in place instead of refetching every page. */
const GALLERY_LIST_QUERY_KEYS = [['home-images'], ['group-images']] as const
const DEPENDENT_ROOTS = new Set([
  'home-images-total', 'groups-hierarchy-all', 'group-detail', 'group-file-counts', 'group-cover-images',
  'prompt-search', 'prompt-statistics', 'prompt-groups', 'prompt-group-statistics', 'prompt-top', 'chat-prompt-item',
])
const isFilterTotal = (query: Query) => query.queryKey[0] === 'group-images' && query.queryKey[3] === 'filter-total'
const isGallery = (query: Query) => GALLERY_LIST_QUERY_KEYS.some(([root]) => query.queryKey[0] === root)

async function refreshDependentQueries(client: QueryClient, restored: boolean) {
  const matches = (query: Query) => DEPENDENT_ROOTS.has(String(query.queryKey[0])) || isFilterTotal(query)
    || (restored && (isGallery(query) || query.queryKey[0] === 'image-detail'))
  // An initial fetch has no data yet: ordinary invalidation would reuse its pre-mutation response.
  await client.cancelQueries({ predicate: query => query.state.fetchStatus !== 'idle' && matches(query) })
  await client.invalidateQueries({ predicate: matches })
}

function withDecrementedTotal(page: ImageListCachePage, removedCount: number): ImageListCachePage {
  const next = { ...page }
  if (typeof next.total === 'number') {
    next.total = Math.max(0, next.total - removedCount)
  }
  if (next.pagination && typeof next.pagination.total === 'number') {
    next.pagination = { ...next.pagination, total: Math.max(0, next.pagination.total - removedCount) }
  }
  return next
}

/**
 * Remove deleted images from every cached Home/Group page so open lists (and the viewer
 * sequence they feed) update at once without reloading the whole infinite list, then refresh
 * the counts that depend on them.
 */
async function removeDeletedImagesFromListCaches(queryClient: QueryClient, deletedHashes: ReadonlySet<string>) {
  if (!deletedHashes.size) return

  const inFlight = queryClient.getQueryCache().findAll({ predicate: query =>
    query.state.fetchStatus !== 'idle' && isGallery(query) && !isFilterTotal(query),
  })
  const initial = new Set(inFlight.filter(query => query.state.data === undefined))
  // A page fetched before the delete can otherwise put it back. Restart empty active lists, not every loaded page.
  if (inFlight.length) {
    const pending = new Set(inFlight)
    await queryClient.cancelQueries({ predicate: query => pending.has(query) })
  }

  for (const queryKey of GALLERY_LIST_QUERY_KEYS) {
    queryClient.setQueriesData<InfiniteData<ImageListCachePage>>({ queryKey }, (data) => {
      if (!data?.pages) {
        return data
      }

      let removedCount = 0
      const pages = data.pages.map((page) => {
        if (!Array.isArray(page?.images)) {
          return page
        }

        const images = page.images.filter((image) => !(typeof image.composite_hash === 'string' && deletedHashes.has(image.composite_hash)))
        if (images.length === page.images.length) {
          return page
        }

        removedCount += page.images.length - images.length
        return { ...page, images }
      })

      if (removedCount === 0) {
        return data
      }

      // The first page holds the list total.
      pages[0] = withDecrementedTotal(pages[0], removedCount)
      return { ...data, pages }
    })
  }

  await Promise.all([
    ...(initial.size ? [queryClient.refetchQueries({ type: 'active', predicate: query => initial.has(query) })] : []),
    refreshDependentQueries(queryClient, false),
    // A failed detail refetch keeps its old data. Reset all scopes for the removed hashes, not the rest of the library.
    queryClient.resetQueries({ predicate: query =>
      query.queryKey[0] === 'image-detail' && typeof query.queryKey[1] === 'string' && deletedHashes.has(query.queryKey[1]),
    }),
  ])
}

/** Keep failed items selected and visible. An older server with a partial result cannot identify them reliably. */
export async function removeBulkDeletedImagesFromListCaches(queryClient: QueryClient, hashes: readonly string[], result: {
  failed: number; failedHashes?: readonly string[]; recycleBinEntries: readonly string[]
}) {
  const failed = new Set(result.failedHashes)
  const unknown = result.failed > 0 && !result.failedHashes
  const deleted = new Set(unknown ? [] : hashes.filter(hash => !failed.has(hash)))
  await Promise.all([
    unknown ? refreshRestoredImageListCaches(queryClient) : removeDeletedImagesFromListCaches(queryClient, deleted),
    ...(result.recycleBinEntries.length ? [queryClient.invalidateQueries({ queryKey: ['system-folders', 'list', 'recycle-bin'] })] : []),
  ])
  return deleted
}

/** Restoration changes ordering and can reintroduce filtered items; refresh active lists and their dependent counts. */
export async function refreshRestoredImageListCaches(queryClient: QueryClient) {
  await refreshDependentQueries(queryClient, true)
}
