import { buildApiUrl, fetchJson } from './api-client'

/** `decision_typesafe`: a TypeSafe decision model (Jev) for chat judge presets. */
export type ExternalApiProviderType = 'general' | 'llm_openai_compatible' | 'llm_ollama' | 'decision_typesafe'

export interface ExternalApiProviderRecord {
  id: number
  provider_name: string
  display_name: string
  provider_type: ExternalApiProviderType
  api_key_masked: string
  api_secret_masked?: string | null
  base_url?: string | null
  additional_config?: Record<string, unknown> | null
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export interface ExternalApiProviderUpsertInput {
  provider_name?: string
  display_name: string
  provider_type: ExternalApiProviderType
  api_key?: string
  api_secret?: string
  base_url?: string
  additional_config?: Record<string, unknown> | null
  is_enabled?: boolean
}

export interface ExternalApiLlmOptionRecord {
  provider_name: string
  display_name: string
  provider_type: Extract<ExternalApiProviderType, 'llm_openai_compatible' | 'llm_ollama'>
  default_model?: string | null
  default_temperature?: number | null
  default_max_tokens?: number | null
}

type ExternalApiProvidersResponse = {
  success: boolean
  data: ExternalApiProviderRecord[]
  message?: string
}

type ExternalApiProviderResponse = {
  success: boolean
  data: ExternalApiProviderRecord
  message?: string
}

type ExternalApiConnectionTestResponse = {
  success: boolean
  message: string
}

type ExternalApiLlmOptionsResponse = {
  success: boolean
  data: ExternalApiLlmOptionRecord[]
}

export async function getExternalApiProviders() {
  const response = await fetchJson<ExternalApiProvidersResponse>('/api/external-api/providers')
  return Array.isArray(response.data) ? response.data : []
}

/** An API LLM chat profile a workflow LLM node can run on. */
export interface LlmProfileOptionRecord {
  id: number
  name: string
  avatar: string | null
  provider_name: string
  model: string | null
  is_enabled: boolean
}

export async function getLlmProfileOptions() {
  const response = await fetchJson<{ success: boolean; data?: LlmProfileOptionRecord[] }>('/api/external-api/llm-profile-options')
  return Array.isArray(response.data) ? response.data : []
}

export async function getExternalApiLlmOptions() {
  const response = await fetchJson<ExternalApiLlmOptionsResponse>('/api/external-api/llm-options')
  return Array.isArray(response.data) ? response.data : []
}

export async function createExternalApiProvider(input: ExternalApiProviderUpsertInput) {
  const response = await fetchJson<ExternalApiProviderResponse>('/api/external-api/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return response.data
}

export async function updateExternalApiProvider(providerName: string, input: Omit<ExternalApiProviderUpsertInput, 'provider_name'>) {
  const response = await fetchJson<ExternalApiProviderResponse>(`/api/external-api/providers/${encodeURIComponent(providerName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return response.data
}

/** Deletes a connection; a 409 (still used by models or profiles) throws with the user names appended to the message. */
export async function deleteExternalApiProvider(providerName: string) {
  const response = await fetch(buildApiUrl(`/api/external-api/providers/${encodeURIComponent(providerName)}`), {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  const payload = (await response.json().catch(() => null)) as {
    success?: boolean
    message?: string
    error?: string
    data?: { slots?: unknown; profiles?: unknown }
  } | null
  if (!response.ok) {
    const names = [payload?.data?.slots, payload?.data?.profiles]
      .flatMap((list) => (Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string') : []))
    const base = payload?.error || `Request failed: ${response.status}`
    throw new Error(names.length > 0 ? `${base.replace(/[.。]$/, '')}: ${names.join(', ')}` : base)
  }
  return { success: payload?.success ?? true, message: payload?.message }
}

/** Model ids the LLM server at these (possibly unsaved) connection values lists. */
export async function listExternalApiLlmModels(input: { provider_type: ExternalApiProviderType; base_url: string; api_key?: string; provider_name?: string }) {
  const response = await fetchJson<{ success: boolean; data: { models: string[] } }>('/api/external-api/llm-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return response.data.models
}

export async function testExternalApiProvider(providerName: string) {
  return await fetchJson<ExternalApiConnectionTestResponse>(`/api/external-api/providers/${encodeURIComponent(providerName)}/test`, {
    method: 'POST',
  })
}
