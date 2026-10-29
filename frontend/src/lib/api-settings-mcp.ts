import type { McpHttpSettings } from '@conai/shared'
import { requestApiData } from '@/lib/api-request'

export async function getMcpHttpSettings() {
  return requestApiData<McpHttpSettings>('/api/settings/mcp-http', 'settings.mcp.load')
}

export async function updateMcpHttpEnabled(enabled: boolean) {
  return requestApiData<McpHttpSettings>('/api/settings/mcp-http', 'settings.mcp.update', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}

export async function createMcpHttpApiKey(input: { name: string; groupKey: string }) {
  return requestApiData<McpHttpSettings>('/api/settings/mcp-http/keys', 'settings.mcp.update', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export async function updateMcpHttpApiKey(input: { keyId: string; name: string; groupKey: string }) {
  return requestApiData<McpHttpSettings>(`/api/settings/mcp-http/keys/${input.keyId}`, 'settings.mcp.update', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.name, groupKey: input.groupKey }),
  })
}

export async function rotateMcpHttpApiKey(keyId: string) {
  return requestApiData<McpHttpSettings>(`/api/settings/mcp-http/keys/${keyId}/rotate`, 'settings.mcp.rotate', {
    method: 'POST',
  })
}

export async function revokeMcpHttpApiKey(keyId: string) {
  return requestApiData<McpHttpSettings>(`/api/settings/mcp-http/keys/${keyId}`, 'settings.mcp.update', { method: 'DELETE' })
}
