export interface GenerationHistoryFeedProgressSummary {
  loadedCount: number
  visibleCount: number
  totalCount: number
  hiddenCount: number
}

function normalizeCount(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.trunc(value as number))
}

export function getGenerationHistoryFeedProgressSummary({
  loadedCount,
  visibleCount,
  totalCount,
}: {
  loadedCount: number
  visibleCount: number
  totalCount?: number
}): GenerationHistoryFeedProgressSummary {
  const safeLoadedCount = normalizeCount(loadedCount)
  const safeVisibleCount = normalizeCount(visibleCount)
  const safeTotalCount = totalCount === undefined ? safeLoadedCount : normalizeCount(totalCount)

  return {
    loadedCount: safeLoadedCount,
    visibleCount: safeVisibleCount,
    totalCount: Math.max(safeTotalCount, safeLoadedCount),
    hiddenCount: Math.max(0, safeLoadedCount - safeVisibleCount),
  }
}
