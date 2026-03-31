import { fetchJson } from '@/lib/api-client'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export type WildcardTool = 'comfyui' | 'nai'

export interface WildcardItemRecord {
  id: number
  wildcard_id: number
  tool: WildcardTool
  content: string
  weight: number
  order_index: number
  created_date: string
}

export interface WildcardRecord {
  id: number
  name: string
  description?: string | null
  parent_id: number | null
  include_children: number
  only_children: number
  type: 'wildcard' | 'chain'
  chain_option: 'replace' | 'append'
  created_date: string
  updated_date: string
  items?: WildcardItemRecord[]
  children?: WildcardRecord[]
  is_auto_collected?: number
  source_path?: string | null
  lora_weight?: number | null
}

export interface WildcardMutationInput {
  name: string
  description?: string
  parent_id?: number | null
  include_children?: number
  only_children?: number
  type?: 'wildcard' | 'chain'
  chain_option?: 'replace' | 'append'
  items: {
    comfyui: Array<{ content: string; weight: number }>
    nai: Array<{ content: string; weight: number }>
  }
}

export interface WildcardParseResponse {
  original: string
  results: string[]
  usedWildcards: string[]
}

export interface WildcardStatistics {
  totalWildcards: number
  itemsByTool: {
    comfyui: number
    nai: number
  }
  totalItems: number
  averageItemsPerWildcard: number
}

export interface WildcardScanLogEntry {
  id: number
  name: string
  itemCount: number
  folderName: string
  level: number
  parentPath: string | null
}

export interface WildcardScanLog {
  timestamp: string
  loraWeight: number
  duplicateHandling: 'number' | 'parent'
  totalWildcards: number
  totalItems: number
  wildcards: WildcardScanLogEntry[]
}

export interface LoraFileData {
  folderName: string
  loraName: string
  promptLines: string[]
}

export interface LoraScanRequest {
  loraFiles: LoraFileData[]
  loraWeight: number
  duplicateHandling: 'number' | 'parent'
  matchingMode?: 'filename' | 'common'
  commonTextFilename?: string
  matchingPriority?: 'filename' | 'common'
}

export interface LoraScanResponse {
  created: number
  log: WildcardScanLog
}

/** Load wildcard records from the backend with optional hierarchical expansion. */
export async function getWildcards(params?: { hierarchical?: boolean; rootsOnly?: boolean; withItems?: boolean }) {
  const searchParams = new URLSearchParams()

  if (params?.hierarchical !== undefined) {
    searchParams.set('hierarchical', String(params.hierarchical))
  }

  if (params?.rootsOnly !== undefined) {
    searchParams.set('rootsOnly', String(params.rootsOnly))
  }

  if (params?.withItems !== undefined) {
    searchParams.set('withItems', String(params.withItems))
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : ''
  const response = await fetchJson<ApiResponse<WildcardRecord[]>>(`/api/wildcards${suffix}`)
  if (!response.success || !response.data) {
    throw new Error(response.error || '와일드카드 목록을 불러오지 못했어.')
  }

  return response.data
}

/** Create a new wildcard-like record in the shared wildcard store. */
export async function createWildcard(input: WildcardMutationInput) {
  const response = await fetchJson<ApiResponse<WildcardRecord>>('/api/wildcards', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success || !response.data) {
    throw new Error(response.error || '항목을 만들지 못했어.')
  }

  return response.data
}

/** Update an existing wildcard-like record in the shared wildcard store. */
export async function updateWildcard(wildcardId: number, input: WildcardMutationInput) {
  const response = await fetchJson<ApiResponse<WildcardRecord>>(`/api/wildcards/${wildcardId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success || !response.data) {
    throw new Error(response.error || '항목을 저장하지 못했어.')
  }

  return response.data
}

/** Remove a wildcard-like record, optionally cascading through its children. */
export async function deleteWildcard(wildcardId: number, options?: { cascade?: boolean }) {
  const searchParams = new URLSearchParams()
  if (options?.cascade) {
    searchParams.set('cascade', 'true')
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : ''
  const response = await fetchJson<ApiResponse<{ message?: string }>>(`/api/wildcards/${wildcardId}${suffix}`, {
    method: 'DELETE',
  })

  if (!response.success) {
    throw new Error(response.error || '항목을 삭제하지 못했어.')
  }

  return response
}

/** Load aggregate wildcard statistics for the browser tab header. */
export async function getWildcardStatistics() {
  const response = await fetchJson<ApiResponse<WildcardStatistics>>('/api/wildcards/stats/summary')
  if (!response.success || !response.data) {
    throw new Error(response.error || '와일드카드 통계를 불러오지 못했어.')
  }

  return response.data
}

/** Load the latest auto-generated LoRA scan summary when available. */
export async function getWildcardLastScanLog() {
  const response = await fetchJson<ApiResponse<WildcardScanLog | null>>('/api/wildcards/last-scan-log')
  if (!response.success) {
    throw new Error(response.error || '최근 LoRA 스캔 로그를 불러오지 못했어.')
  }

  return response.data ?? null
}

/** Scan a LoRA folder dump and rebuild the auto-collected wildcard tree. */
export async function scanWildcardLoraFolder(input: LoraScanRequest) {
  const response = await fetchJson<ApiResponse<LoraScanResponse>>('/api/wildcards/scan-lora-folder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success || !response.data) {
    throw new Error(response.error || 'LoRA 자동 수집에 실패했어.')
  }

  return response.data
}

/** Ask the backend wildcard parser to preview one or more resolved prompt results. */
export async function parseWildcards(input: { text: string; tool: WildcardTool; count?: number }) {
  const response = await fetchJson<ApiResponse<WildcardParseResponse>>('/api/wildcards/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: input.text,
      tool: input.tool,
      count: input.count ?? 5,
    }),
  })

  if (!response.success || !response.data) {
    throw new Error(response.error || '와일드카드 프리뷰 생성에 실패했어.')
  }

  return response.data
}
