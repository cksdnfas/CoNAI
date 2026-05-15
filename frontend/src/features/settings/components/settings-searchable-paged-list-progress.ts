export interface SettingsPagedListProgressInput {
  page: number
  pageSize: number
  visibleCount: number
  totalCount: number
}

export interface SettingsPagedListProgress {
  start: number
  end: number
  visibleCount: number
  totalCount: number
}

function normalizePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function normalizeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function resolveSettingsPagedListProgress({ page, pageSize, visibleCount, totalCount }: SettingsPagedListProgressInput): SettingsPagedListProgress {
  const safeVisibleCount = normalizeNonNegativeInteger(visibleCount)
  const safeTotalCount = normalizeNonNegativeInteger(totalCount)
  const safePage = normalizePositiveInteger(page, 1)
  const safePageSize = normalizePositiveInteger(pageSize, Math.max(safeVisibleCount, 1))

  if (safeVisibleCount === 0 || safeTotalCount === 0) {
    return {
      start: 0,
      end: 0,
      visibleCount: safeVisibleCount,
      totalCount: safeTotalCount,
    }
  }

  const totalPages = Math.max(Math.ceil(safeTotalCount / safePageSize), 1)
  const clampedPage = Math.min(safePage, totalPages)
  const start = (clampedPage - 1) * safePageSize + 1
  const end = Math.min(start + safeVisibleCount - 1, safeTotalCount)

  return {
    start,
    end,
    visibleCount: safeVisibleCount,
    totalCount: safeTotalCount,
  }
}
