import { createApiFallbackError } from '@/i18n/api-error-fallbacks'
import { fetchJson } from '@/lib/api-client'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface PromptPresetItemRecord {
  id: number
  preset_id: number
  description: string
  value: string
  order_index: number
  created_date: string
}

export interface PromptPresetRecord {
  id: number
  name: string
  description?: string | null
  parent_id: number | null
  created_date: string
  updated_date: string
  items?: PromptPresetItemRecord[]
  children?: PromptPresetRecord[]
}

export interface PromptPresetMutationInput {
  name: string
  description?: string | null
  parent_id?: number | null
  items: Array<{
    description: string
    value: string
  }>
}

/** Load prompt preset records with optional hierarchical expansion. */
export async function getPromptPresets(params?: { hierarchical?: boolean; rootsOnly?: boolean; withItems?: boolean }) {
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
  const response = await fetchJson<ApiResponse<PromptPresetRecord[]>>(`/api/prompt-presets${suffix}`)
  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'promptPresets.list.load')
  }

  return response.data
}

export async function createPromptPreset(input: PromptPresetMutationInput) {
  const response = await fetchJson<ApiResponse<PromptPresetRecord>>('/api/prompt-presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'promptPresets.create')
  }

  return response.data
}

export async function updatePromptPreset(presetId: number, input: PromptPresetMutationInput) {
  const response = await fetchJson<ApiResponse<PromptPresetRecord>>(`/api/prompt-presets/${presetId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  if (!response.success || !response.data) {
    throw createApiFallbackError(response.error, 'promptPresets.update')
  }

  return response.data
}

export async function deletePromptPreset(presetId: number, options?: { cascade?: boolean }) {
  const searchParams = new URLSearchParams()
  if (options?.cascade) {
    searchParams.set('cascade', 'true')
  }

  const suffix = searchParams.size > 0 ? `?${searchParams.toString()}` : ''
  const response = await fetchJson<ApiResponse<{ message?: string }>>(`/api/prompt-presets/${presetId}${suffix}`, {
    method: 'DELETE',
  })

  if (!response.success) {
    throw createApiFallbackError(response.error, 'promptPresets.delete')
  }

  return response
}

function normalizePresetValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  return /[,，]\s*$/.test(trimmed) ? trimmed : `${trimmed},`
}

/** Convert one preset into the comment/value text inserted into prompt textareas. */
export function buildPromptPresetInsertionText(preset: PromptPresetRecord) {
  return (preset.items ?? [])
    .map((item) => {
      const description = item.description.trim()
      const value = normalizePresetValue(item.value)
      if (!description || !value) {
        return ''
      }

      return `//${description}//\n${value}`
    })
    .filter(Boolean)
    .join('\n\n')
}
