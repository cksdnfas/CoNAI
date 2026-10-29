export type DirectoryListingParams = {
  limit: number
  search?: string
  cursor?: string | null
  snapshot?: string | null
  refresh?: boolean
}

export type DirectoryPage = { total: number; nextCursor: string | null; snapshot: string | null }

export function appendDirectoryListingParams(searchParams: URLSearchParams, params: DirectoryListingParams) {
  searchParams.set('limit', String(params.limit))
  if (params.search) searchParams.set('search', params.search)
  if (params.cursor) searchParams.set('cursor', params.cursor)
  if (params.snapshot) searchParams.set('snapshot', params.snapshot)
  if (params.refresh) searchParams.set('refresh', '1')
}
