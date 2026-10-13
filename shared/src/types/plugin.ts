import type { ChatPageAction, ChatPageData } from './chatPageAction'

export type PluginCapability = 'files.read' | 'files.write' | 'files.media'
export type PluginPage = {
  id: string; title: string; entry: string; accepts: string[]
  actions: Array<ChatPageAction & { tier: 'view' | 'draft' }>
}
export type PluginManifest = {
  apiVersion: 1; id: string; name: string; version: string; description: string
  capabilities: PluginCapability[]; pages: PluginPage[]
}
export type InstalledPlugin = { manifest: PluginManifest; enabled: boolean; installedAt: string }
export type PluginInstance = {
  id: string; plugin: PluginManifest; page: PluginPage; expiresAt: number
  files: Array<{ id: string; name: string; mimeType: string | null; size: number }>
}
export type PluginWriteProposal = {
  id: string; instanceId: string; fileId: string; name: string
  before: string; text: string; revision: string; expiresAt: number
}
export type PluginSnapshot = { revision: string; dirty?: boolean; data: Record<string, ChatPageData> }
