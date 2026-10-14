import type { InstalledPlugin, PluginInstance, PluginWriteProposal } from '@conai/shared'
import { requestApiData } from './api-request'
import { buildApiUrl } from './api-url'

const hostHeaders = { 'X-CoNAI-Plugin-Host': '1' }
/** pagehide is also fired for real reloads, where React effect cleanup never runs. */
export function closePlugin(id: string) {
  return fetch(buildApiUrl(`/api/plugins/instances/${encodeURIComponent(id)}`), { method: 'DELETE', credentials: 'include', headers: hostHeaders, keepalive: true }).catch(() => undefined)
}
export function pluginRequest<T>(suffix: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
  const form = body instanceof FormData
  return requestApiData<T>(`/api/plugins${suffix}`, { method, signal, headers: { ...hostHeaders, ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) })
}
export const PLUGINS_QUERY_KEY = ['plugins'] as const
export const listPlugins = () => pluginRequest<InstalledPlugin[]>('')
export const openPlugin = (id: string, page: string, files: string[], workspace?: { id: string; write: boolean }) => pluginRequest<PluginInstance>(`/${encodeURIComponent(id)}/pages/${encodeURIComponent(page)}/instances`, 'POST', { files, ...(workspace ? { workspace } : {}) })
export const proposePluginWrite = (instance: string, value: unknown, signal?: AbortSignal) => pluginRequest<PluginWriteProposal>(`/instances/${instance}/proposals`, 'POST', value, signal)
