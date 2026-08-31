import type { McpHttpScope, McpHttpSettings } from '@conai/shared'
import type { ApiResponse } from '@/types/image'
import { fetchJson } from '@/lib/api-client'
import { createApiFallbackError } from '@/i18n/api-error-fallbacks'

export async function getMcpHttpSettings() {
  const response = await fetchJson<ApiResponse<McpHttpSettings>>('/api/settings/mcp-http')
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.mcp.load')
  }
  return response.data
}

export async function updateMcpHttpEnabled(enabled: boolean) {
  const response = await fetchJson<ApiResponse<McpHttpSettings>>('/api/settings/mcp-http', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.mcp.update')
  }
  return response.data
}

export async function createMcpHttpApiKey(input: { name: string; scopes: McpHttpScope[] }) {
  const response = await fetchJson<ApiResponse<McpHttpSettings>>('/api/settings/mcp-http/keys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!response.success) throw createApiFallbackError(response.error, 'settings.mcp.update')
  return response.data
}

export async function updateMcpHttpApiKey(input: { keyId: string; name: string; scopes: McpHttpScope[] }) {
  const response = await fetchJson<ApiResponse<McpHttpSettings>>(`/api/settings/mcp-http/keys/${input.keyId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.name, scopes: input.scopes }),
  })
  if (!response.success) throw createApiFallbackError(response.error, 'settings.mcp.update')
  return response.data
}

export async function rotateMcpHttpApiKey(keyId: string) {
  const response = await fetchJson<ApiResponse<McpHttpSettings>>(`/api/settings/mcp-http/keys/${keyId}/rotate`, {
    method: 'POST',
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.mcp.rotate')
  }
  return response.data
}

export async function revokeMcpHttpApiKey(keyId: string) {
  const response = await fetchJson<ApiResponse<McpHttpSettings>>(`/api/settings/mcp-http/keys/${keyId}`, { method: 'DELETE' })
  if (!response.success) throw createApiFallbackError(response.error, 'settings.mcp.update')
  return response.data
}
