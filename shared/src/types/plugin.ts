import type { ChatPageAction, ChatPageData, ChatPageSchema } from './chatPageAction'
import type { WorkspaceOperation } from './workspace'

/** `server`: the package brings a server module (trusted code with the app's full reach, see plugins/README.md). */
export type PluginCapability = 'files.read' | 'files.write' | 'files.media' | 'workspace.read' | 'workspace.write' | 'workspace.media' | 'media.process' | 'server'
export type PluginPage = {
  id: string; title: string; entry: string; accepts: string[]
  actions: Array<ChatPageAction & { tier: 'view' | 'draft' }>
  serverActions?: string[]
}
export type PluginServerAction = {
  id: string; label: string; description: string; schema: ChatPageSchema; tool: string
  /** JSON constants or { "$input": "field.nested" }; absent: forward validated input. */
  arguments?: Record<string, ChatPageData>
}
export type PluginManifest = {
  apiVersion: 1; id: string; name: string; version: string; description: string
  capabilities: PluginCapability[]; pages: PluginPage[]
  appTools?: string[]; serverActions?: PluginServerAction[]
  /** The server module (`capabilities` must list `server`). */
  server?: { entry: string }
}
export type PluginAppRequest = {
  id: string; pluginId: string; version: string; label: string; tool: string; arguments: Record<string, unknown>
  /** Trusted packages (a server module) also reach configure/backup/restore tools. */
  scope: 'organize' | 'generate' | 'configure' | 'backup' | 'restore'
  project?: { id: string; name: string }
  status: 'pending' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'; jobId: string | null
  result?: unknown; error?: string; expiresAt: number
}
/** A server module's live state; `tools` are the names it registered (`p_<plugin>_<tool>`), `hooks` the hooks it listens to. */
export type PluginServerStatus = {
  state: 'off' | 'starting' | 'ready' | 'error'; error: string | null
  tools: Array<{ name: string; description: string }>; hooks: string[]
}
export type InstalledPlugin = { manifest: PluginManifest; enabled: boolean; installedAt: string; server?: PluginServerStatus }
/** `updated`: replaced an installed version in place (its data kept). `reenable`: it asks for more than before, so it was turned off. */
export type PluginInstallResult = { plugin: InstalledPlugin; updated: boolean; reenable: boolean }
/** One stateless character turn. History and world state belong to the plugin, not a native chat thread. */
export type PluginLlmInput = {
  requestId: string; profileId: number; message: string; history?: string; userName?: string
  useLorebooks?: boolean; maxTokens?: number; timeoutMs?: number
}
export type PluginLlmProfile = { id: number; name: string; tagline: string; engine: string }
export type PluginLlmJob = {
  jobId: string; requestId: string; profileId: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; cancelRequested: boolean
  result: { text: string; truncated: boolean; model: string; engine: string } | null
  error: string | null; expiresAt: number
}
export type PluginInstance = {
  id: string; plugin: PluginManifest; page: PluginPage; expiresAt: number
  files: Array<{ id: string; name: string; mimeType: string | null; size: number }>
  workspace?: { id: string; name: string; write: boolean }
}
export type PluginWriteProposal = {
  id: string; instanceId: string; fileId: string; name: string
  before: string; text: string; revision: string; expiresAt: number
}
export type PluginSnapshot = { revision: string; dirty?: boolean; data: Record<string, ChatPageData> }
export type PluginWorkspaceProposal = {
  source: 'workspace'; id: string; instanceId: string; projectId: string; target: string; name: string
  before: string; text: string; revision: string | null; expiresAt: number
  operations?: WorkspaceOperation[]
}
export type PluginMediaOperation =
  | { kind: 'crop'; left: number; top: number; width: number; height: number; outputWidth: number; outputHeight: number; quality: number }
  | { kind: 'extract_audio'; quality: number }
export type PluginMediaProposal = Omit<PluginWorkspaceProposal, 'source' | 'operations'> & {
  source: 'media'; sourceTarget: string; sourceRevision: string; fingerprint: string; operation: PluginMediaOperation
}
