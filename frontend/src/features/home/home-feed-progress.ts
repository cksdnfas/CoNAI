import type { ImageListPayload } from '@/types/image'

type HomeFeedProgressPage = Pick<ImageListPayload, 'images' | 'total'>

export interface HomeFeedProgressSummary {
  loadedCount: number
  visibleCount: number
  totalCount: number
  hiddenCount: number
}

export function getHomeFeedProgressSummary(pages: readonly HomeFeedProgressPage[] | undefined, visibleCount: number): HomeFeedProgressSummary {
  const loadedCount = pages?.reduce((sum, page) => sum + page.images.length, 0) ?? 0
  const totalCount = pages?.[0]?.total ?? loadedCount
  const rawVisibleCount = Number.isFinite(visibleCount) ? visibleCount : 0
  const safeVisibleCount = Math.max(0, Math.trunc(rawVisibleCount))

  return {
    loadedCount,
    visibleCount: safeVisibleCount,
    totalCount: Math.max(totalCount, loadedCount),
    hiddenCount: Math.max(0, loadedCount - safeVisibleCount),
  }
}
