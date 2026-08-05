import type { ImageListPayload } from '@/types/image'

type HomeFeedProgressPage = Pick<ImageListPayload, 'images' | 'total' | 'totalKnown'>

export interface HomeFeedProgressSummary {
  loadedCount: number
  visibleCount: number
  totalCount: number
  hiddenCount: number
  /**
   * False while the feed only knows how many rows it has loaded so far — the first
   * page is fetched without a total and the exact count arrives in a later request.
   */
  isTotalKnown: boolean
}

export interface HomeFeedProgressOptions {
  /** Exact total from the deferred count request, once it has arrived. */
  deferredTotal?: number | null
}

/** Resolve the exact total for the feed, or null while only loaded rows are known. */
function resolveKnownTotal(
  firstPage: HomeFeedProgressPage | undefined,
  deferredTotal: number | null | undefined,
): number | null {
  if (firstPage?.totalKnown === false) {
    return typeof deferredTotal === 'number' && Number.isFinite(deferredTotal) ? deferredTotal : null
  }

  if (typeof firstPage?.total === 'number') {
    return firstPage.total
  }

  return typeof deferredTotal === 'number' && Number.isFinite(deferredTotal) ? deferredTotal : null
}

export function getHomeFeedProgressSummary(
  pages: readonly HomeFeedProgressPage[] | undefined,
  visibleCount: number,
  options?: HomeFeedProgressOptions,
): HomeFeedProgressSummary {
  const loadedCount = pages?.reduce((sum, page) => sum + page.images.length, 0) ?? 0
  const knownTotal = resolveKnownTotal(pages?.[0], options?.deferredTotal)
  const rawVisibleCount = Number.isFinite(visibleCount) ? visibleCount : 0
  const safeVisibleCount = Math.max(0, Math.trunc(rawVisibleCount))

  return {
    loadedCount,
    visibleCount: safeVisibleCount,
    totalCount: Math.max(knownTotal ?? loadedCount, loadedCount),
    hiddenCount: Math.max(0, loadedCount - safeVisibleCount),
    isTotalKnown: knownTotal !== null,
  }
}
