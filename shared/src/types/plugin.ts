import type { ChatPageAction, ChatPageData, ChatPageSchema } from './chatPageAction'
import type { ChatPageValue } from './chatPage'
import type { GenerationLayoutSurface } from '../constants/generationLayout'
import type { WorkspaceOperation } from './workspace'

/** Legacy manifest metadata; installed plugins use native account permissions instead of capability grants. */
export type PluginCapability = 'files.read' | 'files.write' | 'files.media' | 'workspace.read' | 'workspace.write' | 'workspace.media' | 'media.process' | 'server'
export type PluginPage = {
  id: string; title: string; entry: string; accepts: string[]
  actions: Array<ChatPageAction & { tier: 'view' | 'draft' }>
  serverActions?: string[]
  /** false: no header menu entry (a page that only lives as a layout block). */
  menu?: boolean
}
/** One of the plugin's pages shown inline as a block of the listed layout surfaces. */
export type PluginGenerationBlock = { id: string; page: string; surfaces: GenerationLayoutSurface[]; height?: number }
/** A button next to Generate on the listed surfaces; the server module's `generation.action` hook answers it. */
export type PluginGenerationAction = { id: string; label: string; surfaces: GenerationLayoutSurface[] }
/** What `generation.action` may return: a short note and input values for the screen's form. */
export type PluginGenerationActionResult = { message?: string; fill?: Record<string, ChatPageValue> }
export type PluginServerAction = {
  id: string; label: string; description: string; schema: ChatPageSchema; tool: string
  /** JSON constants or { "$input": "field.nested" }; absent: forward validated input. */
  arguments?: Record<string, ChatPageData>
}
export type PluginManifest = {
  apiVersion: 1; id: string; name: string; version: string; description: string
  capabilities: PluginCapability[]; pages: PluginPage[]
  appTools?: string[]; serverActions?: PluginServerAction[]
  /** Optional server module; independent of legacy capability declarations. */
  server?: { entry: string }
  /** Blocks and Generate-bar buttons on the generation layouts. */
  generation?: { blocks: PluginGenerationBlock[]; actions: PluginGenerationAction[] }
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
/** `updated`: replaced an installed version in place, keeping data. `reenable`: an unreadable prior installation was recovered disabled. */
export type PluginInstallResult = { plugin: InstalledPlugin; updated: boolean; reenable: boolean }
/** One stateless character turn. History and world state belong to the plugin, not a native chat thread. */
export type PluginLlmInput = {
  requestId: string; profileId: number; message: string; history?: string; userName?: string
  /** profile: native chat execution with the profile's tools and its own plugin/account room. text: stateless compatibility mode. */
  mode?: 'text' | 'profile'
  /** Opt-in isolated, read-only published-post research; direct API LLM profiles only. */
  research?: PluginResearchInput
  /** Text mode only. judge: the profile's prompt on its judge model, else the default judge row (cheap quick calls). */
  model?: 'chat' | 'judge'
  useLorebooks?: boolean
  /** Optional integer 1–4096, capped by the profile. Omitted: text uses 512; profile uses its native budget. */
  maxTokens?: number
  timeoutMs?: number
  /** JSON example/schema passed through the native workflow LLM JSON mode. */
  structuredOutput?: string | Record<string, unknown>
  /** Opt-in prose translation. `only` translates message JSON without a character/model turn. */
  translation?: { fields: string[]; only?: boolean; direction?: 'model' | 'display' }
}
export type PluginLlmProfile = {
  id: number; name: string; tagline: string; engine: string
  /** Visible look as image-prompt tags (the profile's appearance field); empty when unset. */
  appearance: string
  translation?: { enabled: boolean; modelLanguage: 'en' | 'ko' | 'ja' | 'zh'; displayLanguage: 'en' | 'ko' | 'ja' | 'zh' }
  assetVersion: string | null; avatarCrop: { x: number; y: number; scale: number } | null
  assets: { avatar: boolean; background: boolean; reference: boolean }
}
/** Bounded native profile image; convert data to a Blob URL in sandboxed pages. */
export type PluginProfileAsset = {
  profileId: number; kind: 'avatar' | 'background' | 'reference'; state: 'ready' | 'missing' | 'hidden'
  version: string; crop: { x: number; y: number; scale: number } | null
  mimeType?: 'image/webp'; data?: string; width?: number; height?: number
}
export type PluginLlmJob = {
  jobId: string; requestId: string; profileId: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; cancelRequested: boolean
  result: { text: string; truncated: boolean; model: string; engine: string; json?: unknown; profileRun?: PluginProfileRun; translation?: { status: 'completed' | 'failed' | 'disabled'; language: 'en' | 'ko' | 'ja' | 'zh'; sourceLanguage?: 'en' | 'ko' | 'ja' | 'zh'; json?: unknown } } | null
  error: string | null; expiresAt: number
}
export type PluginProfileRun = {
  threadId: number; messageIds: number[]
  research?: PluginResearchResult
  tools: Array<{ id: string; name: string; status: 'running' | 'completed' | 'failed'; summary: string; output: string;
    historyIds: number[]; compositeHashes: string[]; audioCandidateIds: string[]; pendingJobIds: number[];
    proposalId: number | null; failedJobs: Array<{ jobId: number; message: string }>; deferred?: { state: 'writing' | 'failed'; error: string | null } }>
  toolsTruncated: boolean
}
export type PluginResearchInput = {
  slotId: string; activityId: string; allowedPostIds: number[]
  maxModelCalls?: number; maxToolCalls?: number
}
export type PluginResearchResult = {
  slotId: string; activityId: string; modelCalls: number; toolCalls: number
  stopReason: 'completed' | 'model_limit' | 'tool_limit'
  evidence: Array<{ postId: number; revision: number; contentVersion: number | null; offset: number; end: number; excerpt: string }>
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
