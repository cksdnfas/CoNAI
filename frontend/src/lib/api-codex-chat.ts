import { requestApiData, requestJson } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'
import type { CodexReasoningEffort } from '@conai/shared'

export type ChatScope = 'read' | 'generate' | 'organize'
export type ChatEngine = 'llm' | 'codex'

export const CHAT_SCOPES: ChatScope[] = ['read', 'generate', 'organize']
export const CHAT_PROFILES_QUERY_KEY = ['codex-chat-profiles'] as const
export const CHAT_ADMIN_PROFILES_QUERY_KEY = ['codex-chat-admin-profiles'] as const
export const CHAT_ADMIN_SETTINGS_QUERY_KEY = ['codex-chat-admin-settings'] as const
export const CHAT_STATUS_QUERY_KEY = ['codex-chat-status'] as const

export interface CodexChatStatus {
  /** The chat master switch. */
  enabled: boolean
  /** This session can use at least one engine. */
  canUse: boolean
  codex: { canUse: boolean }
  llm: { canUse: boolean }
  scopes: ChatScope[]
}

export type ChatTypeface = 'sans' | 'serif' | 'mono'

/** A designed card: the model writes ```key + JSON values, the chat fills `template` ({{field}} slots) styled by `css`. */
export interface ChatDisplayBlock {
  id: string
  key: string
  /** When the model should use it (sent in the system prompt). */
  instruction: string
  /** Example JSON values: the format shown to the model, and the editor preview's data. */
  example: string
  template: string
  css: string
  enabled: boolean
}

/** How a profile's chats look. Colours are `#rrggbb`, or empty for the theme's text colour. */
export interface ChatStyle {
  typeface: ChatTypeface
  /** Colour "dialogue", *narration* and 'thoughts' (the model is told to mark them). */
  roleplay: boolean
  colors: { dialogue: string; narration: string; thought: string }
  /** Background dimming 0–90 (%) and blur 0–20 (px). */
  backgroundDim: number
  backgroundBlur: number
  blocks: ChatDisplayBlock[]
}

/** What a chat user sees of a profile; `usable` says whether this session can start a chat with it. */
export interface ChatProfileSummary {
  id: number
  name: string
  avatar: string | null
  engine: ChatEngine
  isEnabled: boolean
  usable: boolean
  /** Context defaults a chat can override (LLM profiles). */
  contextTurns: number
  summaryEnabled: boolean
  style: ChatStyle
  /** Null: no background image. Otherwise part of the image URL, so it changes with the image. */
  backgroundVersion: string | null
}

/** The chat background image of a profile. */
export function chatProfileBackgroundUrl(profileId: number, version: string) {
  return buildApiUrl(`/api/codex-chat/profiles/${profileId}/background?v=${encodeURIComponent(version)}`)
}

/** A user-defined prompt block: `text` joins the system prompt under its title, `dialogue` is example conversation. */
export interface ChatPromptSection {
  id: string
  title: string
  content: string
  kind: 'text' | 'dialogue'
  enabled: boolean
}

/** A full chat profile (admin). */
export interface ChatProfile {
  id: number
  name: string
  avatar: string | null
  engine: ChatEngine
  providerName: string
  model: string
  reasoningEffort: CodexReasoningEffort | ''
  systemPrompt: string
  promptSections: ChatPromptSection[]
  greeting: string
  temperature: number | null
  maxTokens: number | null
  mcpEnabled: boolean
  mcpScopes: ChatScope[]
  /** Only these tools; null offers every tool the scopes allow. */
  toolAllowlist: string[] | null
  toolOutputLimit: number
  contextTurns: number
  contextTokens: number | null
  summaryEnabled: boolean
  summaryTriggerTurns: number
  summaryPrompt: string
  summaryProviderName: string | null
  summaryModel: string
  maxToolRounds: number
  style: ChatStyle
  backgroundVersion: string | null
  isEnabled: boolean
  sortOrder: number
  createdDate: string
  updatedDate: string
}

/** `background`: a new image (data URL), null to remove it, left out to keep the current one. */
export type ChatProfileInput = Partial<Omit<ChatProfile, 'id' | 'createdDate' | 'updatedDate' | 'backgroundVersion'>> & { background?: string | null }

export interface ChatProfileDefaults {
  contextTurns: number
  summaryTriggerTurns: number
  maxToolRounds: number
  toolOutputLimit: number
  summaryPrompt: string
  scopes: ChatScope[]
  style: ChatStyle
}

export interface CodexChatToolCall {
  id: string
  tool: string
  status: 'running' | 'completed' | 'failed'
  arguments: unknown
  summary: string | null
  historyIds: number[]
  compositeHashes: string[]
  jobIds?: number[]
  /** Set by the server: jobs still queued with no result yet. */
  pendingJobIds?: number[]
}

export interface CodexChatThread {
  id: number
  codex_thread_id: string | null
  title: string
  engine: ChatEngine
  profile_id: number | null
  /** Overrides of the profile (null follows it). */
  context_turns: number | null
  summary_enabled: 0 | 1 | null
  summary: string | null
  summary_until_message_id: number | null
  summary_updated_date: string | null
  created_date: string
  updated_date: string
}

export interface CodexChatMessage {
  id: number
  thread_id: number
  role: 'user' | 'assistant'
  content: string
  tool_calls: CodexChatToolCall[]
  status: 'completed' | 'failed' | 'interrupted'
  error: string | null
  created_date: string
}

/** Media kind of an image a transcript references (so videos can play inline). */
export interface CodexChatMediaInfo {
  mimeType: string | null
  width: number | null
  height: number | null
}

export interface CodexChatThreadDetail {
  thread: CodexChatThread
  messages: CodexChatMessage[]
  media: Record<string, CodexChatMediaInfo>
  /** Generation jobs this chat started that are still running (results attach as they land). */
  pendingJobs: number
  /** Partial reply of a turn still running on the server (after a reload). */
  running: { text: string; toolCalls: CodexChatToolCall[] } | null
}

/** One image a chat brought in: `generated` by its jobs, or `found` through searches and lookups. */
export interface CodexChatMediaItem {
  compositeHash: string
  messageId: number
  /** SQLite UTC timestamp of that message. */
  createdDate: string
  source: 'generated' | 'found'
  mimeType: string | null
  width: number | null
  height: number | null
}

export type CodexChatStreamEvent =
  | { type: 'user'; message: CodexChatMessage }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; call: CodexChatToolCall }
  | { type: 'done'; message: CodexChatMessage }
  | { type: 'error'; message: string }

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function getCodexChatStatus() {
  return requestApiData<CodexChatStatus>('/api/codex-chat/status', { cache: 'no-store' })
}

export function listChatProfiles() {
  return requestApiData<ChatProfileSummary[]>('/api/codex-chat/profiles', { cache: 'no-store' })
}

export function getChatAdminSettings() {
  return requestApiData<{ enabled: boolean }>('/api/codex-chat/admin/settings', { cache: 'no-store' })
}

export function updateChatAdminSettings(patch: { enabled: boolean }) {
  return requestApiData<{ enabled: boolean }>('/api/codex-chat/admin/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function getChatProfileDefaults() {
  return requestApiData<ChatProfileDefaults>('/api/codex-chat/admin/profile-defaults', { cache: 'no-store' })
}

export function listChatAdminProfiles() {
  return requestApiData<ChatProfile[]>('/api/codex-chat/admin/profiles', { cache: 'no-store' })
}

export function createChatProfile(input: ChatProfileInput) {
  return requestApiData<ChatProfile>('/api/codex-chat/admin/profiles', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function updateChatProfile(profileId: number, patch: ChatProfileInput) {
  return requestApiData<ChatProfile>(`/api/codex-chat/admin/profiles/${profileId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteChatProfile(profileId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/profiles/${profileId}`, { method: 'DELETE' })
}

export interface ChatToolInfo {
  name: string
  description: string
  scope: ChatScope | null
}

export interface ChatProfilePreview {
  engine: ChatEngine
  messages: Array<{ role: string; content: string | null }>
  tools: string[]
  tokens: { prompt: number; tools: number; total: number }
  contextTokens: number | null
}

export function listChatTools() {
  return requestApiData<ChatToolInfo[]>('/api/codex-chat/admin/tools', { cache: 'no-store' })
}

export function previewChatProfile(draft: ChatProfileInput & { id?: number }) {
  return requestApiData<ChatProfilePreview>('/api/codex-chat/admin/profiles/preview', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(draft) })
}

export function listChatConnectionModels(providerName: string) {
  return requestApiData<{ models: string[]; defaultModel: string | null }>(`/api/codex-chat/admin/models?providerName=${encodeURIComponent(providerName)}`, { cache: 'no-store' })
}

export function updateCodexChatThreadContext(threadId: number, patch: { contextTurns?: number | null; summaryEnabled?: boolean | null; summary?: string | null }) {
  return requestApiData<CodexChatThread>(`/api/codex-chat/threads/${threadId}/context`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function summarizeCodexChatThread(threadId: number) {
  return requestApiData<CodexChatThread>(`/api/codex-chat/threads/${threadId}/summarize`, { method: 'POST' })
}

export function listCodexChatThreads() {
  return requestApiData<CodexChatThread[]>('/api/codex-chat/threads', { cache: 'no-store' })
}

export function createCodexChatThread(profileId: number) {
  return requestApiData<CodexChatThread>('/api/codex-chat/threads', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ profileId }) })
}

export function getCodexChatThread(threadId: number) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}`, { cache: 'no-store' })
}

export function getCodexChatThreadMedia(threadId: number) {
  return requestApiData<CodexChatMediaItem[]>(`/api/codex-chat/threads/${threadId}/media`, { cache: 'no-store' })
}

export function deleteCodexChatThread(threadId: number) {
  return requestJson<{ success: boolean }>(`/api/codex-chat/threads/${threadId}`, { method: 'DELETE' })
}

export function interruptCodexChatThread(threadId: number) {
  return requestJson<{ success: boolean }>(`/api/codex-chat/threads/${threadId}/interrupt`, { method: 'POST' })
}

/**
 * Send a message and read the NDJSON turn stream. No timeout: a turn with generation jobs can run for minutes.
 * Aborting only stops reading; the server finishes and stores the reply.
 */
export async function streamCodexChatMessage(threadId: number, text: string, onEvent: (event: CodexChatStreamEvent) => void, signal?: AbortSignal) {
  const response = await fetch(buildApiUrl(`/api/codex-chat/threads/${threadId}/messages`), {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { ...JSON_HEADERS, Accept: 'application/x-ndjson' },
    body: JSON.stringify({ text }),
    signal,
  })

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || `Request failed: ${response.status}`)
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    buffer += value
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) {
        onEvent(JSON.parse(line) as CodexChatStreamEvent)
      }
      newlineIndex = buffer.indexOf('\n')
    }
  }
}
