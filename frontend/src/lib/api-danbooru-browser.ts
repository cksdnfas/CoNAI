import { fetchJson } from '@/lib/api-client'
import type { ApiResponse } from '@/types/image'
import type {
  DanbooruBrowserArtistRecord,
  DanbooruBrowserCharacterRecord,
  DanbooruBrowserListPayload,
  DanbooruBrowserRelatedTagCategory,
  DanbooruBrowserSummary,
  DanbooruBrowserTagRecord,
} from '@/types/danbooru-browser'

function appendPagingParams(searchParams: URLSearchParams, params?: { query?: string; page?: number; limit?: number }) {
  if (params?.query !== undefined) searchParams.set('q', params.query)
  if (params?.page !== undefined) searchParams.set('page', String(params.page))
  if (params?.limit !== undefined) searchParams.set('limit', String(params.limit))
}

export async function getDanbooruBrowserSummary() {
  const response = await fetchJson<ApiResponse<DanbooruBrowserSummary>>('/api/danbooru-browser/summary')
  if (!response.success) {
    throw new Error(response.error || 'Failed to load Danbooru database summary.')
  }
  return response.data
}

export async function getDanbooruBrowserTags(params?: { query?: string; categoryCode?: number; taxonomyNodeId?: number; page?: number; limit?: number }) {
  const searchParams = new URLSearchParams()
  appendPagingParams(searchParams, params)
  if (params?.categoryCode !== undefined) searchParams.set('category', String(params.categoryCode))
  if (params?.taxonomyNodeId !== undefined) searchParams.set('taxonomyNodeId', String(params.taxonomyNodeId))

  const response = await fetchJson<ApiResponse<DanbooruBrowserListPayload<DanbooruBrowserTagRecord>>>(`/api/danbooru-browser/tags?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || 'Failed to load Danbooru tags.')
  }
  return response.data
}

export async function getDanbooruBrowserArtists(params?: { query?: string; page?: number; limit?: number }) {
  const searchParams = new URLSearchParams()
  appendPagingParams(searchParams, params)

  const response = await fetchJson<ApiResponse<DanbooruBrowserListPayload<DanbooruBrowserArtistRecord>>>(`/api/danbooru-browser/artists?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || 'Failed to load Danbooru artists.')
  }
  return response.data
}

export async function getDanbooruBrowserCharacters(params?: { query?: string; copyrightTagId?: number; page?: number; limit?: number; relatedTagCategories?: DanbooruBrowserRelatedTagCategory[]; relatedTagScoreMin?: number; relatedTagScoreMax?: number; relatedTagLimit?: number }) {
  const searchParams = new URLSearchParams()
  appendPagingParams(searchParams, params)
  if (params?.copyrightTagId !== undefined) searchParams.set('copyrightTagId', String(params.copyrightTagId))
  if (params?.relatedTagCategories !== undefined) searchParams.set('relatedTagCategories', params.relatedTagCategories.join(','))
  if (params?.relatedTagScoreMin !== undefined) searchParams.set('relatedTagScoreMin', String(params.relatedTagScoreMin))
  if (params?.relatedTagScoreMax !== undefined) searchParams.set('relatedTagScoreMax', String(params.relatedTagScoreMax))
  if (params?.relatedTagLimit !== undefined) searchParams.set('relatedTagLimit', String(params.relatedTagLimit))

  const response = await fetchJson<ApiResponse<DanbooruBrowserListPayload<DanbooruBrowserCharacterRecord>>>(`/api/danbooru-browser/characters?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || 'Failed to load Danbooru characters.')
  }
  return response.data
}
