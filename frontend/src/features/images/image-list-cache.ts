import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { ImageRecord } from '@/types/image'

/** Home feed pages carry `total`; group pages carry `pagination.total`. Both list `images`. */
interface ImageListCachePage {
  images?: ImageRecord[]
  total?: number
  pagination?: { total?: number }
}

/** Gallery lists whose cached pages should drop deleted images in place instead of refetching every page. */
const GALLERY_LIST_QUERY_KEYS = [['home-images'], ['group-images']] as const

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
export async function removeDeletedImagesFromListCaches(queryClient: QueryClient, compositeHashes: readonly string[]) {
  const deletedHashes = new Set(compositeHashes)
  if (deletedHashes.size === 0) {
    return
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
    queryClient.invalidateQueries({ queryKey: ['home-images-total'] }),
    queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all'] }),
    queryClient.invalidateQueries({ queryKey: ['group-detail'] }),
    queryClient.invalidateQueries({ queryKey: ['group-file-counts'] }),
    queryClient.invalidateQueries({ queryKey: ['group-images'], predicate: (query) => query.queryKey[3] === 'filter-total' }),
    // Cover mosaics may show a deleted image.
    queryClient.invalidateQueries({ queryKey: ['group-cover-images'] }),
  ])
}

/** Bulk-delete failures use the API's `Image <hash>: <error>` format; keep those items in the lists. */
export function removeBulkDeletedImagesFromListCaches(queryClient: QueryClient, compositeHashes: readonly string[], errors: readonly string[]) {
  const failedHashes = new Set(errors.map((error) => error.slice('Image '.length, error.indexOf(': '))))
  return removeDeletedImagesFromListCaches(queryClient, compositeHashes.filter((hash) => !failedHashes.has(hash)))
}

/** Restoration changes ordering and can reintroduce filtered items; refresh active lists and their dependent counts. */
export async function refreshRestoredImageListCaches(queryClient: QueryClient) {
  await Promise.all([
    ...GALLERY_LIST_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    ...['home-images-total', 'groups-hierarchy-all', 'group-detail', 'group-file-counts', 'group-cover-images', 'image-detail', 'system-folders', 'prompt-search', 'prompt-statistics', 'prompt-group-statistics', 'prompt-top'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  ])
}
