import type { McpHttpSettings } from '@conai/shared'
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

export async function rotateMcpHttpApiKey() {
  const response = await fetchJson<ApiResponse<McpHttpSettings>>('/api/settings/mcp-http/rotate-key', {
    method: 'POST',
  })
  if (!response.success) {
    throw createApiFallbackError(response.error, 'settings.mcp.rotate')
  }
  return response.data
}
