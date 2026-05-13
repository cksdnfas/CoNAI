import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { fetchJson } from '@/lib/api-client'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export type WildcardTool = 'general' | 'comfyui' | 'nai'

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
    general: Array<{ content: string; weight: number }>
    comfyui: Array<{ content: string; weight: number }>
    nai: Array<{ content: string; weight: number }>
  }
}

export interface WildcardParseResponse {
  original: string
  results: string[]
  usedWildcards: string[]
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
    throw createApiFallbackError(response.error, 'wildcards.list.load')
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
    throw createApiFallbackError(response.error, 'wildcards.create')
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
    throw createApiFallbackError(response.error, 'wildcards.update')
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
    throw createApiFallbackError(response.error, 'wildcards.delete')
  }

  return response
}

/** Load the latest auto-generated LoRA scan summary when available. */
export async function getWildcardLastScanLog() {
  const response = await fetchJson<ApiResponse<WildcardScanLog | null>>('/api/wildcards/last-scan-log')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'wildcards.lastScanLog.load')
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
    throw createApiFallbackError(response.error, 'wildcards.loraScan.run')
  }

  return response.data
}

/** Ask the backend wildcard parser to preview one or more resolved prompt results. */
export async function parseWildcards(input: { text: string; tool: WildcardTool | 'codex'; count?: number }) {
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
    throw createApiFallbackError(response.error, 'wildcards.preview.parse')
  }

  return response.data
}
