import { fetchJson } from './api-client'

export type ExternalApiProviderType = 'general' | 'llm_openai_compatible' | 'llm_ollama'

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

export interface ExternalApiSecurityStatus {
  api_key_encryption_configured: boolean
  auth_configured: boolean
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

type ExternalApiSecurityStatusResponse = {
  success: boolean
  data: ExternalApiSecurityStatus
}

export async function getExternalApiProviders() {
  const response = await fetchJson<ExternalApiProvidersResponse>('/api/external-api/providers')
  return Array.isArray(response.data) ? response.data : []
}

export async function getExternalApiLlmOptions() {
  const response = await fetchJson<ExternalApiLlmOptionsResponse>('/api/external-api/llm-options')
  return Array.isArray(response.data) ? response.data : []
}

export async function getExternalApiSecurityStatus() {
  const response = await fetchJson<ExternalApiSecurityStatusResponse>('/api/external-api/security-status')
  return response.data
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

export async function deleteExternalApiProvider(providerName: string) {
  return await fetchJson<{ success: boolean; message?: string }>(`/api/external-api/providers/${encodeURIComponent(providerName)}`, {
    method: 'DELETE',
  })
}

export async function toggleExternalApiProvider(providerName: string, isEnabled: boolean) {
  const response = await fetchJson<ExternalApiProviderResponse>(`/api/external-api/providers/${encodeURIComponent(providerName)}/toggle`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_enabled: isEnabled }),
  })
  return response.data
}

export async function testExternalApiProvider(providerName: string) {
  return await fetchJson<ExternalApiConnectionTestResponse>(`/api/external-api/providers/${encodeURIComponent(providerName)}/test`, {
    method: 'POST',
  })
}
