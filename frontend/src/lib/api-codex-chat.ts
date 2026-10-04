import { requestApiData, requestJson } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'
import type { CodexReasoningEffort, StoredFileEntry } from '@conai/shared'

export type ChatScope = 'read' | 'generate' | 'organize'
export type ChatEngine = 'llm' | 'codex'

export const CHAT_SCOPES: ChatScope[] = ['read', 'generate', 'organize']
export const CHAT_PROFILES_QUERY_KEY = ['codex-chat-profiles'] as const
export const CHAT_ADMIN_PROFILES_QUERY_KEY = ['codex-chat-admin-profiles'] as const
export const CHAT_ADMIN_SETTINGS_QUERY_KEY = ['codex-chat-admin-settings'] as const
export const CHAT_LOREBOOKS_QUERY_KEY = ['codex-chat-lorebooks'] as const
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

/** Another character the profile voices; the model switches to them with a `[Name]` line. */
export interface ChatCastMember {
  id: string
  name: string
  avatar: string | null
  /** Name colour `#rrggbb`, or empty. */
  color: string
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
  cast: ChatCastMember[]
  /** Linked emoticon groups, in priority order (first wins on a shared keyword). */
  emoticonGroupIds: number[]
}

/** One emoticon a profile's chats can show: the model writes &*keyword*&. */
export interface ChatEmoticon {
  compositeHash: string
  keywords: string[]
  mimeType: string | null
}

export const chatProfileEmoticonsQueryKey = (profileId: number) => ['codex-chat-profile-emoticons', profileId] as const

export function listChatProfileEmoticons(profileId: number) {
  return requestApiData<ChatEmoticon[]>(`/api/codex-chat/profiles/${profileId}/emoticons`)
}

export function chatEmoticonUrl(profileId: number, compositeHash: string) {
  return buildApiUrl(`/api/codex-chat/profiles/${profileId}/emoticons/${compositeHash}`)
}

/** What a chat user sees of a profile; `usable` says whether this session can start a chat with it. */
export interface ChatProfileSummary {
  tagline: string
  model: string
  canReadFileText: boolean
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
export interface ChatLoreEntry {
  id: string
  keys: string[]
  content: string
  enabled: boolean
  constant: boolean
  order: number
  caseSensitive: boolean
}

/** A shared lorebook; profiles link it by id, so editing or re-importing it reaches every linked profile. */
export interface ChatLorebook {
  id: number
  name: string
  entries: ChatLoreEntry[]
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

export interface ChatProfile {
  /** Linked shared lorebooks, in priority order. */
  lorebookIds: number[]
  loreScanDepth: number
  loreTokenBudget: number
  tagline: string
  id: number
  name: string
  avatar: string | null
  engine: ChatEngine
  providerName: string
  model: string
  /** Codex: CLI effort. API LLM: none / low / medium / high, sent as reasoning_effort. Empty: not sent. */
  reasoningEffort: CodexReasoningEffort | ''
  /** API LLM: reasoning_budget_tokens; null is not sent. */
  reasoningBudgetTokens: number | null
  /** API LLM: extra request fields as JSON object text. */
  extraParams: string
  systemPrompt: string
  promptSections: ChatPromptSection[]
  greeting: string
  alternateGreetings: string[]
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
  /** LLM: the model can look at images (view_images). */
  visionEnabled: boolean
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
  loreScanDepth: number
  loreTokenBudget: number
  contextTurns: number
  summaryTriggerTurns: number
  maxToolRounds: number
  toolOutputLimit: number
  /** Codex profiles: compaction limit when `contextTokens` is empty, and the lowest one allowed. */
  codexCompactTokens: { default: number; min: number }
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
  /** Codex chats: input tokens of the last model request (null right after a compaction) and the model's window. */
  codex_context_tokens: number | null
  codex_context_window: number | null
  /** Codex chats: tokens the Codex thread has used in total. */
  codex_input_tokens: number | null
  codex_cached_input_tokens: number | null
  codex_output_tokens: number | null
  /** `group`: several profiles answer by @mention; `profile_id` is the representative. */
  kind: 'direct' | 'group'
  group_chain_limit: number | null
  group_window_limit: number | null
  /** Group rooms in chat lists: member profiles in room order. */
  member_profile_ids?: number[]
  created_date: string
  updated_date: string
}

export interface CodexChatMessage {
  alternatives: Array<{ content: string; tool_calls: CodexChatToolCall[]; created_at: string; status: 'completed' | 'failed' | 'interrupted'; error: string | null }>
  active_alternative: number
  attachments?: StoredFileEntry[]
  id: number
  thread_id: number
  role: 'user' | 'assistant'
  content: string
  /** Group rooms: the profile that wrote this reply. */
  speaker_profile_id: number | null
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
  /** Partial reply of a turn still running on the server (after a reload); group rooms add who answers and who is next. */
  running: { text: string; toolCalls: CodexChatToolCall[]; replacingMessageId?: number; speakerProfileId?: number | null; queue?: number[] } | null
  /** Codex chats: Codex folds its memory once a request's input reaches this many tokens. */
  codexCompactTokens?: number
  group?: ChatGroupInfo
}

/** A group room: members in order, the representative (answers unaddressed messages) and its limits. */
export interface ChatGroupInfo {
  memberIds: number[]
  representativeId: number | null
  /** Bot-to-bot wakes per user message. */
  chainLimit: number
  /** Messages handed to a woken member. */
  windowLimit: number
  limits: { chain: { default: number; min: number; max: number }; window: { default: number; min: number; max: number } }
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
  | { type: 'rewind'; mode: 'regenerate' | 'edit'; message: CodexChatMessage }
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; call: CodexChatToolCall }
  | { type: 'done'; message: CodexChatMessage }
  | { type: 'error'; message: string }
  /** Group rooms: this member answers now, `queue` after it. */
  | { type: 'speaker'; profileId: number; queue: number[] }
  | { type: 'queue'; queue: number[] }
  | { type: 'notice'; message: string }

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

export function importChatProfileCard(file: File) {
  const body = new FormData()
  body.append('file', file)
  return requestApiData<ChatProfileInput>('/api/codex-chat/admin/profiles/import-card', { method: 'POST', body })
}

export function listChatLorebooks() {
  return requestApiData<ChatLorebook[]>('/api/codex-chat/admin/lorebooks')
}

export function createChatLorebook(input: { name: string; entries?: ChatLoreEntry[] }) {
  return requestApiData<ChatLorebook>('/api/codex-chat/admin/lorebooks', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** A new lorebook from a file, or (with `lorebookId`) that book's entries replaced from a newer file. */
export function importChatLorebook(file: File, lorebookId?: number) {
  const body = new FormData()
  body.append('file', file)
  const path = lorebookId ? `/api/codex-chat/admin/lorebooks/${lorebookId}/import` : '/api/codex-chat/admin/lorebooks/import'
  return requestApiData<ChatLorebook>(path, { method: 'POST', body })
}

export function updateChatLorebook(lorebookId: number, patch: { name?: string; entries?: ChatLoreEntry[] }) {
  return requestApiData<ChatLorebook>(`/api/codex-chat/admin/lorebooks/${lorebookId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteChatLorebook(lorebookId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/lorebooks/${lorebookId}`, { method: 'DELETE' })
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

export function clearCodexChatThread(threadId: number) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/clear`, { method: 'POST' })
}

export type ChatSearchResult = { messageId: number; threadId: number; title: string; profileId: number | null; role: 'user' | 'assistant'; createdDate: string; excerpt: string }

export function searchChatMessages(query: string) {
  return requestApiData<ChatSearchResult[]>(`/api/codex-chat/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
}

export async function exportChat(threadId: number, format: 'md' | 'json') {
  const response = await fetch(buildApiUrl(`/api/codex-chat/threads/${threadId}/export?format=${format}`), { credentials: 'include', cache: 'no-store' })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `Request failed: ${response.status}`)
  return response.blob()
}

export function selectChatAlternative(threadId: number, messageId: number, index: number) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/messages/${messageId}/alternative`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ index }) })
}

export function listCodexChatThreads() {
  return requestApiData<CodexChatThread[]>('/api/codex-chat/threads', { cache: 'no-store' })
}

export function createCodexChatThread(profileId: number) {
  return requestApiData<CodexChatThread>('/api/codex-chat/threads', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ profileId }) })
}

export function createGroupChat(input: { profileIds: number[]; representativeId: number; title?: string }) {
  return requestApiData<CodexChatThread>('/api/codex-chat/threads/group', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** `null` limits restore the defaults. */
export function updateGroupChat(threadId: number, patch: { representativeId?: number; title?: string; chainLimit?: number | null; windowLimit?: number | null }) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/group`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function addGroupChatMembers(threadId: number, profileIds: number[]) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/members`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ profileIds }) })
}

export function removeGroupChatMember(threadId: number, profileId: number) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/members/${profileId}`, { method: 'DELETE' })
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
export async function streamCodexChatMessage(threadId: number, text: string, onEvent: (event: CodexChatStreamEvent) => void, signal?: AbortSignal, fileIds: string[] = []) {
  return streamChatOperation(`/api/codex-chat/threads/${threadId}/messages`, 'POST', { text, fileIds }, onEvent, signal)
}

export function streamChatRewrite(threadId: number, messageId: number, content: string | undefined, onEvent: (event: CodexChatStreamEvent) => void, signal?: AbortSignal) {
  return streamChatOperation(`/api/codex-chat/threads/${threadId}/messages/${messageId}${content === undefined ? '/regenerate' : ''}`, content === undefined ? 'POST' : 'PATCH', content === undefined ? {} : { content }, onEvent, signal)
}

async function streamChatOperation(path: string, method: 'POST' | 'PATCH', body: unknown, onEvent: (event: CodexChatStreamEvent) => void, signal?: AbortSignal) {
  const response = await fetch(buildApiUrl(path), {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: { ...JSON_HEADERS, Accept: 'application/x-ndjson' },
    body: JSON.stringify(body),
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
