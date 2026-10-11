import { requestApiData, requestJson } from '@/lib/api-request'

export type ExternalMcpScope = 'read' | 'organize' | 'configure'
export type ExternalMcpTransport = 'http' | 'stdio'

export type ExternalMcpServer = {
  id: string
  name: string
  enabled: boolean
  transport: ExternalMcpTransport
  url: string | null
  command: string | null
  args: string[]
  scope: ExternalMcpScope
  timeoutSeconds: number
  disabledTools: string[]
  /** Secrets come back by name only. */
  headerNames: string[]
  envNames: string[]
  status: {
    state: 'off' | 'connecting' | 'ready' | 'error'
    error: string | null
    tools: Array<{ name: string; remoteName: string; description: string; enabled: boolean }>
    refreshedAt: string | null
  }
}

/** A secret without `value` keeps the stored one; one left out is removed. */
export type ExternalMcpSecret = { name: string; value?: string }

export type ExternalMcpServerInput = Omit<ExternalMcpServer, 'headerNames' | 'envNames' | 'status'> & { headers: ExternalMcpSecret[]; env: ExternalMcpSecret[] }

export const EXTERNAL_MCP_QUERY_KEY = ['external-mcp-servers'] as const
const BASE = '/api/codex-chat/admin/external-mcp'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function listExternalMcpServers() {
  return requestApiData<ExternalMcpServer[]>(BASE, { cache: 'no-store' })
}

export function createExternalMcpServer(input: ExternalMcpServerInput) {
  return requestApiData<ExternalMcpServer>(BASE, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function updateExternalMcpServer(id: string, input: ExternalMcpServerInput) {
  return requestApiData<ExternalMcpServer>(`${BASE}/${encodeURIComponent(id)}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function patchExternalMcpServer(id: string, patch: { enabled?: boolean; tool?: { remoteName: string; enabled: boolean } }) {
  return requestApiData<ExternalMcpServer>(`${BASE}/${encodeURIComponent(id)}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function refreshExternalMcpServer(id: string) {
  return requestApiData<ExternalMcpServer>(`${BASE}/${encodeURIComponent(id)}/refresh`, { method: 'POST' })
}

export function deleteExternalMcpServer(id: string) {
  return requestJson<{ success: boolean }>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
