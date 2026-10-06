import { requestApiData, requestJson } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'
import type { ChatStreamEvent, CodexReasoningEffort, StoredFileEntry, ChatMessageRouting } from '@conai/shared'

export type ChatScope = 'read' | 'generate' | 'organize' | 'configure'
export type ChatEngine = 'llm' | 'codex'

export const CHAT_SCOPES: ChatScope[] = ['read', 'generate', 'organize', 'configure']
export const CHAT_PROFILES_QUERY_KEY = ['codex-chat-profiles'] as const
export const CHAT_ADMIN_PROFILES_QUERY_KEY = ['codex-chat-admin-profiles'] as const
export const CHAT_ADMIN_SETTINGS_QUERY_KEY = ['codex-chat-admin-settings'] as const
export const CHAT_LOREBOOKS_QUERY_KEY = ['codex-chat-lorebooks'] as const
export const CHAT_BLOCKS_QUERY_KEY = ['codex-chat-blocks'] as const
export const CHAT_TOOL_PRESETS_QUERY_KEY = ['codex-chat-tool-presets'] as const
export const CHAT_GENERATION_PRESETS_QUERY_KEY = ['codex-chat-generation-presets'] as const
export const MODEL_SLOTS_QUERY_KEY = ['codex-chat-model-slots'] as const
export const MODEL_USAGE_QUERY_KEY = ['codex-chat-model-usage'] as const
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

/** A rule the server holds a block field to when the model writes it (hand edits are free). */
export interface ChatBlockField {
  name: string
  min: number | null
  max: number | null
  /** Largest change per reply (numbers). */
  step: number | null
  /** Allowed values; empty: any. */
  values: string[]
  readonly: boolean
}

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
  /** How the values move; the model reads it with the current values. */
  rules: string
  /** One-line template of the folded status strip (`{{place}} · HP {{hp}}`); empty picks the first scalar fields. */
  summary: string
  /** Rules the server enforces on the model's updates, by field. */
  fields: ChatBlockField[]
  enabled: boolean
}

/** One field a reply or a hand edit changed; `from` / `to` are absent when the field was added / removed. */
export interface ChatBlockChange {
  field: string
  from?: unknown
  to?: unknown
}

/** The display block state of a chat: current values per block and what each message changed. */
export interface ChatBlocksState {
  state: Record<string, Record<string, unknown>>
  changes: Record<number, Record<string, ChatBlockChange[]>>
  edits: Record<string, Record<string, ChatBlockChange[]>>
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
  /** The line the chat UI shows for the model: `slot · model`, `connection · model` or `Codex · model`. */
  modelLabel: string
  canReadFileText: boolean
  /** The composer offers reply suggestions (a connection is set up to answer them). */
  suggestEnabled: boolean
  id: number
  name: string
  avatar: string | null
  engine: ChatEngine
  isEnabled: boolean
  usable: boolean
  /** Context defaults a chat can override (LLM profiles). */
  contextTurns: number
  summaryEnabled: boolean
  /** LLM profiles: reply token cap (null: the server's default) and reasoning budget, both counted in the cap. */
  maxTokens: number | null
  reasoningBudgetTokens: number | null
  /** Where keyword lore and the author's note go (turns before the end), and the default note a chat falls back to. */
  loreDepth: number
  authorNote: string
  style: ChatStyle
  /** Null: no background image. Otherwise part of the image URL, so it changes with the image. */
  backgroundVersion: string | null
}

/** An image copied in from a character card (`chat-asset:<name>` in profile and message text). */
export function chatAssetUrl(name: string) {
  return buildApiUrl(`/api/codex-chat/assets/${encodeURIComponent(name)}`)
}

/** Copy the web images these texts show into CoNAI; returns the texts pointing at the copies. */
export function localizeChatImages(texts: string[]) {
  return requestApiData<{ texts: string[]; saved: number; failed: Array<{ url: string; reason: string }>; messages: number }>('/api/codex-chat/admin/chat-assets/localize', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ texts }) })
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
  /** `post`: goes after the latest message (a card's post-history instructions). */
  kind: 'text' | 'dialogue' | 'post'
  enabled: boolean
}

/** A full chat profile (admin). */
/** How secondary keywords narrow a primary match: any also present, not all, none, or all. */
export type LoreSecondaryLogic = 'andAny' | 'notAll' | 'notAny' | 'andAll'

export interface ChatLoreEntry {
  id: string
  /** What the book's index calls the entry; empty: the first keyword (see loreEntryTitle). */
  title?: string
  /** `/pattern/flags` is a regular expression. */
  keys: string[]
  secondaryKeys?: string[]
  secondaryLogic?: LoreSecondaryLogic
  content: string
  enabled: boolean
  constant: boolean
  order: number
  caseSensitive: boolean
  /** A text file in the book's folder (`자료/x.md`); account and chat books only. `fileId` follows it when moved. */
  file?: string | null
  fileId?: string | null
}

/** The entry's title as the index shows it: its own, else the first keyword, else the start of its text. */
export function loreEntryTitle(entry: Pick<ChatLoreEntry, 'title' | 'keys' | 'content'>) {
  return entry.title?.trim() || entry.keys[0] || entry.content.slice(0, 20)
}

/** `global`: the admin's shared books. `account`: a folder under the account's 로어북/. `chat`: one chat's own book. */
export type ChatLorebookKind = 'global' | 'account' | 'chat'

/** A shared lorebook; profiles link it by id, so editing or re-importing it reaches every linked profile. */
export interface ChatLorebook {
  id: number
  name: string
  kind?: ChatLorebookKind
  entries: ChatLoreEntry[]
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

/** An account or chat book (a file-store folder); global ones come with no entries, only their count. */
export interface OwnedChatLorebook extends ChatLorebook {
  kind: ChatLorebookKind
  threadId: number | null
  folderId: string | null
  entryCount?: number
}

/** A book the chat's requests attach besides its own: linked to this chat, or brought by the profile (a room: members). */
export interface ThreadLoreBook {
  id: number
  name: string
  kind: ChatLorebookKind
  via: 'thread' | 'profile'
  folderId: string | null
  entries: ChatLoreEntry[]
  profiles: Array<{ id: number; name: string }>
}

export interface ThreadLorebooks {
  chatBook: OwnedChatLorebook | null
  linkedIds: number[]
  books: ThreadLoreBook[]
}

export type LoreMergeChoice = 'source' | 'target' | 'both' | 'merged'
export type LoreMergeDecision = { entryId: string; choice: LoreMergeChoice; content?: string }
export interface LoreMergeItem {
  entry: ChatLoreEntry
  status: 'new' | 'duplicate'
  duplicateOf?: ChatLoreEntry
  /** The starting text of "합친 결과". */
  suggested?: string
}
export interface LoreMergePreview {
  source: OwnedChatLorebook
  target: OwnedChatLorebook
  items: LoreMergeItem[]
  files: Array<{ file: string; clash: boolean }>
  /** What "맡기기" tells the model unless rewritten. */
  defaultInstruction: string
}
export type LoreMergeResult = { status: 'merged'; book: OwnedChatLorebook; added: number; updated: number; skipped: number; files: number; sourceDeleted: boolean; sourceError?: string }
export type LoreMergeDraft = { entryId: string; content: string } | { entryId: string; error: string }

/** A 409 answer that carries the merge preview: some duplicates still need a decision. */
export class LoreDecisionsNeededError extends Error {
  readonly preview: LoreMergePreview
  readonly missing: string[]
  constructor(message: string, preview: LoreMergePreview, missing: string[]) {
    super(message)
    this.preview = preview
    this.missing = missing
  }
}

/** A shared display block (status card); profiles link it by id, so editing it reaches every linked profile. */
export interface ChatSharedBlock {
  id: number
  name: string
  block: ChatDisplayBlock
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

/** The file a block exports as; import also takes a bare block or an array of either. */
export const CHAT_BLOCK_FILE_MARK = 'conai_display_block'

/** A tool preset (MCP scopes + tool allowlist); profiles link one by id, so editing it reaches every linked profile. */
export interface ChatToolPreset {
  id: number
  name: string
  scopes: ChatScope[]
  /** Only these tools; null offers every tool the scopes allow. */
  toolAllowlist: string[] | null
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

export type ChatToolPresetInput = { name: string; scopes: ChatScope[]; toolAllowlist: string[] | null }

/** The file a tool preset exports as; import also takes a bare preset or an array of either. */
export const CHAT_TOOL_PRESET_FILE_MARK = 'conai_tool_preset'

export type ChatNaiPresetSize = { label: string; width: number; height: number }

/** The fixed NovelAI setup of a generation preset; the model fills only the scene prompt (and a size when several are allowed). */
export interface ChatNaiPresetConfig {
  model: string
  sampler: string
  noiseSchedule: string
  steps: number
  scale: number
  varietyPlus: boolean
  transparentBackground: boolean
  promptPrefix: string
  promptSuffix: string
  negativePrompt: string
  sizes: ChatNaiPresetSize[]
  characters: Array<{ prompt: string; uc: string; center_x: number; center_y: number }>
  useCoords: boolean
  vibes: Array<{ encoded: string; strength: number; information_extracted: number }>
  characterRefs: Array<{ image: string; type: string; strength: number; fidelity: number }>
}

/** One ComfyUI workflow with fixed inputs; the model fills the exposed marked fields. */
export interface ChatComfyPresetConfig {
  workflowId: number
  serverId: number | null
  serverTag: string | null
  fixedInputs: Record<string, unknown>
  exposedFieldIds: string[]
}

export type ChatGenerationPresetKind = 'nai' | 'comfyui'

/** A generation preset; each one a profile links becomes a generate_image tool, and free-form generation is withheld. */
export interface ChatGenerationPreset {
  id: number
  name: string
  /** What the model is told the preset is for. */
  instruction: string
  kind: ChatGenerationPresetKind
  nai: ChatNaiPresetConfig | null
  comfyui: ChatComfyPresetConfig | null
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

export type ChatGenerationPresetInput = { name: string; instruction: string; kind: ChatGenerationPresetKind; nai: ChatNaiPresetConfig | null; comfyui: ChatComfyPresetConfig | null }

/** The file a generation preset exports as; import also takes a bare preset or an array of either. */
export const CHAT_GENERATION_PRESET_FILE_MARK = 'conai_generation_preset'

export interface ChatProfile {
  /** Linked shared lorebooks, in priority order. */
  lorebookIds: number[]
  /** Linked shared display blocks, in display order; the server fills `style.blocks` from them. */
  blockIds: number[]
  loreScanDepth: number
  loreTokenBudget: number
  /** API LLM: keyword lore is merged in this many turns before the end (0: the latest message). */
  loreDepth: number
  /** Default author's note for the profile's chats (a chat can set its own). */
  authorNote: string
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
  /** The shared tool preset whose scopes and tools apply; null keeps the profile's own scopes and allowlist. */
  toolPresetId: number | null
  /** Read-only: the linked preset's name. */
  toolPresetName?: string | null
  /** With a preset: the preset's scopes (read-only). Without: the profile's own. */
  mcpScopes: ChatScope[]
  /** Only these tools; null offers every tool the scopes allow. With a preset: the preset's list (read-only). */
  toolAllowlist: string[] | null
  /** Generation presets the profile draws with; any linked withholds free-form generation and workflow lookups. */
  generationPresetIds: number[]
  toolOutputLimit: number
  contextTurns: number
  contextTokens: number | null
  summaryEnabled: boolean
  summaryTriggerTurns: number
  summaryPrompt: string
  summaryProviderName: string | null
  summaryModel: string
  /** Translation model: messages go to the chat model in English, replies are shown in Korean. Null: none. */
  translationProviderName: string | null
  translationModel: string
  /** Reply suggestions on the composer's sparkle button; null provider uses the chat's own connection (LLM only). */
  suggestEnabled: boolean
  suggestProviderName: string | null
  suggestModel: string
  /** Model slots per role; a slot wins over the role's direct connection + model above. Null: the direct pair applies. */
  modelSlotId: number | null
  summarySlotId: number | null
  translationSlotId: number | null
  suggestSlotId: number | null
  maxToolRounds: number
  /** LLM: the model can look at images (view_images). */
  visionEnabled: boolean
  /** The model may propose chat lorebook entries (save_lore). */
  allowLoreProposals: boolean
  style: ChatStyle
  backgroundVersion: string | null
  isEnabled: boolean
  sortOrder: number
  createdDate: string
  updatedDate: string
}

/** `background`: a new image (data URL), null to remove it, left out to keep the current one. */
/** What a card import kept as it was, kept in another form, and left out. */
export interface ChatCardImportReport {
  kept: string[]
  converted: string[]
  dropped: string[]
}

export type ChatProfileInput = Partial<Omit<ChatProfile, 'id' | 'createdDate' | 'updatedDate' | 'backgroundVersion'>> & { background?: string | null }

export interface ChatProfileDefaults {
  loreScanDepth: number
  loreTokenBudget: number
  loreDepth: number
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

export type { ChatToolCall as CodexChatToolCall } from '@conai/shared'
import type { ChatToolCall as CodexChatToolCall } from '@conai/shared'

export interface CodexChatThread {
  id: number
  codex_thread_id: string | null
  title: string
  engine: ChatEngine
  profile_id: number | null
  /** Overrides of the profile (null follows it). */
  context_turns: number | null
  summary_enabled: 0 | 1 | null
  max_tokens: number | null
  summary: string | null
  summary_until_message_id: number | null
  summary_updated_date: string | null
  /** Moves whenever the history or its summary is rewritten. */
  context_revision: number
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
  /** This chat's author's note (null: the profile's default) and its depth in turns before the end (null: the profile's lore depth). */
  author_note?: string | null
  author_note_depth?: number | null
  /** Group rooms in chat lists: member profiles in room order. */
  member_profile_ids?: number[]
  /** JSON ids of the chat flags switched on in this chat (read with readThreadFlagIds). */
  flag_ids?: string | null
  /** The account's user profile (persona) in this chat; null is the plain user. */
  user_profile_id?: number | null
  /** LLM chats: why the last background summary failed; null once one succeeds. */
  summary_error?: string | null
  /** The chat list: shown first / kept in the archive instead of the list. */
  pinned?: 0 | 1
  archived?: 0 | 1
  /** Branches: the chat and message copied from, and why (null on older branches and other chats). */
  branched_from_thread_id?: number | null
  branched_at_message_id?: number | null
  branch_purpose?: ChatBranchPurpose | null
  /** Chat lists: the latest message as one plain line (text empty when it was only files or images). */
  preview?: { text: string; role: 'user' | 'assistant'; media: boolean; files: boolean } | null
  /** Chat lists: a reply is on its way (in any tab, or one started before a reload). */
  running?: boolean
  created_date: string
  updated_date: string
}

/** `preserve`: the chat as it was before an edit rewrote it; `continue`: branched to go on from that point. */
export type ChatBranchPurpose = 'preserve' | 'continue'

/**
 * One stretch of an LLM chat's summary: level 0 summarizes messages from..until; level 1 is the plot the older
 * stretches were folded into (those stay, and come back when the conversation touches them).
 */
export interface ChatSummarySegment {
  id: number
  level: 0 | 1
  from_message_id: number
  until_message_id: number
  content: string
  updated_date: string
}

export interface CodexChatMessage {
  routing?: ChatMessageRouting | null
  alternatives: Array<{ content: string; display_content?: string | null; tool_calls: CodexChatToolCall[]; created_at: string; status: 'completed' | 'failed' | 'interrupted'; error: string | null; finish_reason?: string | null }>
  active_alternative: number
  attachments?: StoredFileEntry[]
  mediaAttachments?: ChatMediaAttachment[]
  id: number
  thread_id: number
  role: 'user' | 'assistant'
  /** What the model saw (English in chats with a translation model). */
  content: string
  /** Chats with a translation model: what the reader sees (their own words, or the reply in Korean); shown first. */
  display_content?: string | null
  /** Group rooms: the profile that wrote this reply. */
  speaker_profile_id: number | null
  tool_calls: CodexChatToolCall[]
  status: 'completed' | 'failed' | 'interrupted'
  error: string | null
  /** LLM replies: the provider's finish_reason; 'length' means the token cap cut the reply short. */
  finish_reason?: string | null
  /** LLM replies: JSON of what the request carried (read with parseContextMeta). */
  context_meta?: string | null
  /** User messages: the chat flags that were on when it was sent. */
  flags?: ChatFlagSnapshot[]
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
  /** Direct chats with display blocks: their state (null otherwise). */
  blocks?: ChatBlocksState | null
  /** Group rooms: each member's own block state, by profile id (null when no member has blocks). */
  memberBlocks?: Record<number, ChatBlocksState> | null
  /** Partial reply of a turn still running on the server (after a reload); group rooms add who answers and who is next. */
  running: {
    routing?: ChatMessageRouting
    text: string
    toolCalls: CodexChatToolCall[]
    replacingMessageId?: number
    speakerProfileId?: number | null
    /** Group rooms: every member answering now (several when their connection takes requests at once). */
    replies?: ChatGroupRunningReply[]
    queue?: number[]
  } | null
  /** Codex chats: Codex folds its memory once a request's input reaches this many tokens. */
  codexCompactTokens?: number
  /** A `tail` fetch: the id of the first message sent, and how many the thread has in all. */
  messagesFrom?: number
  messageCount?: number
  /** Direct LLM chats: the summary by stretch, the plot first. */
  summarySegments?: ChatSummarySegment[]
  group?: ChatGroupInfo
}

export interface ChatGroupRunningReply {
  routing?: ChatMessageRouting
  profileId: number
  text: string
  toolCalls: CodexChatToolCall[]
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
  /** Reply token cap of the room (null: each profile's own) and each member's override of it, by profile id. */
  maxTokens: number | null
  memberMaxTokens: Record<string, number | null>
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

export type CodexChatStreamEvent = ChatStreamEvent<CodexChatMessage>

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

/** A chat exported as CoNAI JSON, back in as a new chat; `notes` say what did not come along. */
export function importCodexChatThread(file: File) {
  const body = new FormData()
  body.append('file', file)
  return requestApiData<{ thread: CodexChatThread; notes: string[] }>('/api/codex-chat/threads/import', { method: 'POST', body })
}

/** CoNAI chat JSON files from the requester's file store (chat backups) as new chats, each reported on its own. */
export function importChatFromFiles(fileIds: string[]) {
  return requestApiData<{ results: Array<{ fileId: string; name: string; threadId?: number; notes?: string[]; error?: string }> }>('/api/codex-chat/threads/import-files', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ fileIds }) })
}

export function importChatProfileCard(file: File) {
  const body = new FormData()
  body.append('file', file)
  return requestApiData<ChatProfileInput & { importReport?: ChatCardImportReport }>('/api/codex-chat/admin/profiles/import-card', { method: 'POST', body })
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

export function listChatBlocks() {
  return requestApiData<ChatSharedBlock[]>('/api/codex-chat/admin/blocks')
}

export function createChatBlock(input: { name: string; block: ChatDisplayBlock }) {
  return requestApiData<ChatSharedBlock>('/api/codex-chat/admin/blocks', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** The parsed contents of a block JSON file; every block in it becomes a shared block. */
export function importChatBlocks(contents: unknown) {
  return requestApiData<ChatSharedBlock[]>('/api/codex-chat/admin/blocks/import', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(contents) })
}

export function updateChatBlock(blockId: number, patch: { name?: string; block?: ChatDisplayBlock }) {
  return requestApiData<ChatSharedBlock>(`/api/codex-chat/admin/blocks/${blockId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteChatBlock(blockId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/blocks/${blockId}`, { method: 'DELETE' })
}

export function listChatToolPresets() {
  return requestApiData<ChatToolPreset[]>('/api/codex-chat/admin/tool-presets')
}

export function createChatToolPreset(input: ChatToolPresetInput) {
  return requestApiData<ChatToolPreset>('/api/codex-chat/admin/tool-presets', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** The parsed contents of a preset JSON file; every preset in it becomes a tool preset. */
export function importChatToolPresets(contents: unknown) {
  return requestApiData<ChatToolPreset[]>('/api/codex-chat/admin/tool-presets/import', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(contents) })
}

export function updateChatToolPreset(presetId: number, patch: Partial<ChatToolPresetInput>) {
  return requestApiData<ChatToolPreset>(`/api/codex-chat/admin/tool-presets/${presetId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteChatToolPreset(presetId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/tool-presets/${presetId}`, { method: 'DELETE' })
}

export type ModelRole = 'chat' | 'summary' | 'translation' | 'suggest'

/** A named connection + model; profiles and workflow nodes reference it per role, so editing it reaches all of them. */
export interface ModelSlot {
  id: number
  name: string
  providerName: string
  model: string
  isDefault: boolean
  sortOrder: number
  profiles: Array<{ id: number; name: string; roles: ModelRole[] }>
  createdDate: string
  updatedDate: string
}

/** `adoptProfiles`: bind profiles whose direct connection + model equals this slot's (and have no slot for that role). */
export type ModelSlotInput = { name: string; providerName: string; model: string; isDefault?: boolean; adoptProfiles?: boolean }

export type ModelSlotSaveResult = { slot: ModelSlot; adopted: Record<ModelRole, number> }

export interface ModelUsage {
  connections: Array<{
    providerName: string
    slots: Array<{ id: number; name: string }>
    directProfiles: Array<{ id: number; name: string; roles: ModelRole[] }>
    workflowNodes: number
  }>
  slots: Array<{ id: number; name: string; profiles: Array<{ id: number; name: string; roles: ModelRole[] }>; workflowNodes: number }>
}

export function listModelSlots() {
  return requestApiData<ModelSlot[]>('/api/codex-chat/admin/model-slots')
}

export function createModelSlot(input: ModelSlotInput) {
  return requestApiData<ModelSlotSaveResult>('/api/codex-chat/admin/model-slots', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function updateModelSlot(slotId: number, patch: Partial<ModelSlotInput>) {
  return requestApiData<ModelSlotSaveResult>(`/api/codex-chat/admin/model-slots/${slotId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function setDefaultModelSlot(slotId: number) {
  return requestApiData<ModelSlot>(`/api/codex-chat/admin/model-slots/${slotId}/default`, { method: 'POST' })
}

export function deleteModelSlot(slotId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/model-slots/${slotId}`, { method: 'DELETE' })
}

export function getModelUsage() {
  return requestApiData<ModelUsage>('/api/codex-chat/admin/model-usage', { cache: 'no-store' })
}

export function listChatGenerationPresets() {
  return requestApiData<ChatGenerationPreset[]>('/api/codex-chat/admin/generation-presets')
}

export function createChatGenerationPreset(input: ChatGenerationPresetInput) {
  return requestApiData<ChatGenerationPreset>('/api/codex-chat/admin/generation-presets', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** The parsed contents of a preset JSON file; every preset in it becomes a generation preset. */
export function importChatGenerationPresets(contents: unknown) {
  return requestApiData<ChatGenerationPreset[]>('/api/codex-chat/admin/generation-presets/import', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(contents) })
}

export function updateChatGenerationPreset(presetId: number, patch: Partial<ChatGenerationPresetInput>) {
  return requestApiData<ChatGenerationPreset>(`/api/codex-chat/admin/generation-presets/${presetId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteChatGenerationPreset(presetId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/generation-presets/${presetId}`, { method: 'DELETE' })
}

export const CHAT_USER_PROFILES_QUERY_KEY = ['codex-chat-user-profiles'] as const
export const CHAT_USER_PROFILE_LIMITS = { perAccount: 20, name: 30, persona: 4000 }

/** Who the account is in a chat: the name the models use for the user, a description for them, an avatar. */
export interface ChatUserProfile {
  id: number
  name: string
  persona: string
  avatar: string | null
  /** New chats take this profile without asking. */
  isDefault: boolean
  sortOrder: number
}

export type ChatUserProfileInput = Pick<ChatUserProfile, 'name' | 'persona' | 'avatar' | 'isDefault'>

export function listChatUserProfiles() {
  return requestApiData<ChatUserProfile[]>('/api/codex-chat/user-profiles')
}

export function createChatUserProfile(input: ChatUserProfileInput) {
  return requestApiData<ChatUserProfile>('/api/codex-chat/user-profiles', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function updateChatUserProfile(userProfileId: number, input: ChatUserProfileInput) {
  return requestApiData<ChatUserProfile>(`/api/codex-chat/user-profiles/${userProfileId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function deleteChatUserProfile(userProfileId: number) {
  return requestApiData<unknown>(`/api/codex-chat/user-profiles/${userProfileId}`, { method: 'DELETE' })
}

export function reorderChatUserProfiles(ids: number[]) {
  return requestApiData<ChatUserProfile[]>('/api/codex-chat/user-profiles/order', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ ids }) })
}

export const CHAT_FLAGS_QUERY_KEY = ['codex-chat-flags'] as const
export const CHAT_FLAG_LIMITS = { perAccount: 20, name: 30, content: 2000 }

/** One of the account's own instructions, switched on per chat and added to the messages sent while on. */
export interface ChatFlag {
  id: number
  /** `lucide:<name>` for a built-in icon, otherwise an emoji; empty shows the name's first letter. */
  icon: string
  name: string
  content: string
  sortOrder: number
}

export type ChatFlagInput = Pick<ChatFlag, 'icon' | 'name' | 'content'>
/** `pick`: not a flag but an item chosen in the status panel, sent with that message. */
export type ChatFlagSnapshot = Pick<ChatFlag, 'id' | 'icon' | 'name' | 'content'> & { pick?: true }

/** The snapshot a status panel pick becomes (what the server stores on the message). */
export function pickSnapshot(label: string): ChatFlagSnapshot {
  return { id: 0, icon: 'lucide:target', name: label, content: label, pick: true }
}

export function listChatFlags() {
  return requestApiData<ChatFlag[]>('/api/codex-chat/flags')
}

export function createChatFlag(input: ChatFlagInput) {
  return requestApiData<ChatFlag>('/api/codex-chat/flags', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function updateChatFlag(flagId: number, input: ChatFlagInput) {
  return requestApiData<ChatFlag>(`/api/codex-chat/flags/${flagId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function deleteChatFlag(flagId: number) {
  return requestApiData<unknown>(`/api/codex-chat/flags/${flagId}`, { method: 'DELETE' })
}

export function reorderChatFlags(ids: number[]) {
  return requestApiData<ChatFlag[]>('/api/codex-chat/flags/order', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ ids }) })
}

export function setChatThreadFlags(threadId: number, flagIds: number[]) {
  return requestApiData<{ flagIds: number[] }>(`/api/codex-chat/threads/${threadId}/flags`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ flagIds }) })
}

export const CHAT_APPEARANCE_QUERY_KEY = ['codex-chat-appearance'] as const
export const CHAT_APPEARANCE_LIMITS = { slots: 12, name: 20 }

/** A reader's chat appearance values, opaque to the server (flat scalars; the chat feature gives them meaning). */
export type ChatAppearanceValue = Record<string, string | number | boolean | null>
export interface ChatAppearanceSlot {
  id: number
  name: string
  appearance: ChatAppearanceValue
}
/** One account's appearance file: slots to apply quickly, the slot new chats start from, and each chat's own values. */
export interface ChatAppearanceFile {
  defaultSlotId: number | null
  slots: ChatAppearanceSlot[]
  threads: Record<string, ChatAppearanceValue>
}

export function getChatAppearance() {
  return requestApiData<ChatAppearanceFile>('/api/codex-chat/appearance')
}

export function saveChatAppearanceSlots(input: { defaultSlotId: number | null; slots: ChatAppearanceSlot[] }) {
  return requestApiData<{ defaultSlotId: number | null; slots: ChatAppearanceSlot[] }>('/api/codex-chat/appearance/slots', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

export function setChatThreadAppearance(threadId: number, appearance: ChatAppearanceValue | null) {
  return requestApiData<{ appearance: ChatAppearanceValue | null }>(`/api/codex-chat/threads/${threadId}/appearance`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ appearance }) })
}

/** The flag ids switched on in a chat (stored as JSON on the thread). */
export function readThreadFlagIds(thread: Pick<CodexChatThread, 'flag_ids'> | null | undefined): number[] {
  if (!thread?.flag_ids) return []
  try {
    const parsed: unknown = JSON.parse(thread.flag_ids)
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isSafeInteger(id)) : []
  } catch {
    return []
  }
}

export function updateChatProfile(profileId: number, patch: ChatProfileInput) {
  return requestApiData<ChatProfile>(`/api/codex-chat/admin/profiles/${profileId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

/** Marks a chat proposal saved (after the card's save or the editor's) so the card shows "saved" on every reload. */
export function markChatProposalSaved(proposalId: number, savedId?: number | null) {
  return requestApiData<{ id: number; savedId: number | null; saved: boolean }>(`/api/chat-proposals/${proposalId}/saved`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(savedId == null ? {} : { savedId }) })
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

/** A few things the user might say next, from the profile's suggestion model; `messageId` is the last message it was made after. */
export function suggestChatReplies(threadId: number, signal?: AbortSignal) {
  return requestApiData<{ suggestions: string[]; messageId: number | null }>(`/api/codex-chat/threads/${threadId}/suggest`, { method: 'POST', signal })
}

/** Set a display block's values by hand (the whole object), or `null` to put back its starting values. Rooms name the member. */
export function editChatBlock(threadId: number, key: string, data: Record<string, unknown> | null, profileId?: number) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/blocks/${encodeURIComponent(key)}`, {
    method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ ...(data === null ? { reset: true } : { data }), ...(profileId === undefined ? {} : { profileId }) }),
  })
}

export function updateCodexChatThreadContext(threadId: number, patch: { contextTurns?: number | null; maxTokens?: number | null; summaryEnabled?: boolean | null; summary?: string | null; authorNote?: string | null; authorNoteDepth?: number | null; userProfileId?: number | null; lorebookIds?: number[] }) {
  return requestApiData<CodexChatThread>(`/api/codex-chat/threads/${threadId}/context`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

/** Rewrite one stretch of an LLM chat's summary by hand. */
export function editChatSummarySegment(threadId: number, segmentId: number, content: string) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/summary-segments/${segmentId}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ content }) })
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

/** `userProfileId` left out: the server picks the default user profile; null: the plain user. */
/** `greetingIndex`: the greeting previewChatGreeting showed (absent: one chosen at random). */
export function createCodexChatThread(profileId: number, userProfileId?: number | null, greetingIndex?: number | null) {
  return requestApiData<CodexChatThread>('/api/codex-chat/threads', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ profileId, ...(userProfileId === undefined ? {} : { userProfileId }), ...(greetingIndex === undefined ? {} : { greetingIndex }) }) })
}

/** A new chat's opening before it is saved: one greeting (index null: none) and the user profile the chat would take. */
export function previewChatGreeting(profileId: number, userProfileId?: number | null) {
  const query = userProfileId === undefined ? '' : `?userProfileId=${userProfileId === null ? 'null' : userProfileId}`
  return requestApiData<{ index: number | null; text: string; userProfileId: number | null }>(`/api/codex-chat/profiles/${profileId}/greeting${query}`, { cache: 'no-store' })
}

export function createGroupChat(input: { profileIds: number[]; representativeId: number; title?: string; userProfileId?: number | null }) {
  return requestApiData<CodexChatThread>('/api/codex-chat/threads/group', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** `null` limits restore the defaults; a `null` maxTokens lets each profile's own cap apply. */
export function updateGroupChat(threadId: number, patch: { representativeId?: number; title?: string; chainLimit?: number | null; windowLimit?: number | null; maxTokens?: number | null }) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/group`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

/** One member's reply token cap in the room (null follows the room's cap, then the profile's). */
export function updateGroupChatMember(threadId: number, profileId: number, patch: { maxTokens?: number | null }) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/members/${profileId}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function addGroupChatMembers(threadId: number, profileIds: number[]) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/members`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ profileIds }) })
}

export function removeGroupChatMember(threadId: number, profileId: number) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/members/${profileId}`, { method: 'DELETE' })
}

/** `tail`: only the last messages (see CodexChatThreadDetail.messagesFrom); merge with mergeThreadTail. */
export function getCodexChatThread(threadId: number, tail?: number) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}${tail ? `?tail=${tail}` : ''}`, { cache: 'no-store' })
}

/**
 * A tail fetch laid over the full copy: the copy's messages before the tail, then the tail. Null when the copy cannot
 * be trusted — the history was rewritten since (edits, regeneration, variants move the context revision) or messages
 * are missing between the two — and a full fetch is needed.
 */
export function mergeThreadTail(full: CodexChatThreadDetail, tail: CodexChatThreadDetail): CodexChatThreadDetail | null {
  if (tail.messagesFrom === undefined) return tail
  if (full.messagesFrom !== undefined || full.thread.context_revision !== tail.thread.context_revision) return null
  const from = tail.messagesFrom
  const messages = [...full.messages.filter((message) => message.id < from), ...tail.messages]
  if (messages.length !== tail.messageCount) return null
  return { ...tail, messages, media: { ...full.media, ...tail.media }, messagesFrom: undefined, messageCount: undefined }
}

export function getCodexChatRunning(threadId: number) {
  return requestApiData<{ running: CodexChatThreadDetail['running']; latestMessageId: number | null }>(`/api/codex-chat/threads/${threadId}/running`, { cache: 'no-store' })
}

export function getCodexChatThreadMedia(threadId: number) {
  return requestApiData<CodexChatMediaItem[]>(`/api/codex-chat/threads/${threadId}/media`, { cache: 'no-store' })
}

/** What happens to the chat's own lorebook when the chat is deleted (default: it goes too). */
export type ThreadLorebookAction = { action: 'delete' } | { action: 'keep' } | { action: 'merge'; targetId: number; decisions?: LoreMergeDecision[] }

/** Deleting with a merge throws LoreDecisionsNeededError (nothing changed) while a duplicate has no decision. */
/** `backupDate` (the reader's `YYYY-MM-DD`): save the chat to the file store's 채팅 백업 folder first. */
export function deleteCodexChatThread(threadId: number, lorebook?: ThreadLorebookAction, backupDate?: string) {
  const body = { ...(lorebook ? { lorebook } : {}), ...(backupDate ? { backup: true, backupDate } : {}) }
  return requestWithMergePreview<{ lorebook?: unknown } | undefined>(`/api/codex-chat/threads/${threadId}`, { method: 'DELETE', ...(Object.keys(body).length ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}) })
}

export type ChatBulkResult = { threadId: number; status: 'done' | 'skipped' | 'failed'; reason?: string }

/** Archive, unarchive or delete several chats; each is reported on its own. `backupDate` backs deletions up first. */
export function bulkChatAction(threadIds: number[], action: 'archive' | 'unarchive' | 'delete', backupDate?: string) {
  return requestApiData<{ results: ChatBulkResult[] }>('/api/codex-chat/threads/bulk', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ threadIds, action, ...(backupDate ? { backup: true, backupDate } : {}) }) })
}

/** Today in the reader's time zone as `YYYY-MM-DD`: the day folder chat backups go to. */
export function chatBackupDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Where a backup made today lands in the file store. */
export const CHAT_BACKUP_FOLDER = '채팅 백업'

/** Like requestApiData, but a 409 carrying a merge preview becomes LoreDecisionsNeededError. */
async function requestWithMergePreview<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), { ...init, credentials: 'include', headers: { Accept: 'application/json', ...(init.headers ?? {}) } })
  const payload = (response.headers.get('content-type') ?? '').includes('application/json') ? await response.json() as { success?: boolean; data?: unknown; error?: string } : null
  if (response.status === 409) {
    const data = payload?.data as { status?: string; preview?: LoreMergePreview; missing?: string[] } | undefined
    if (data?.status === 'decisions' && data.preview) throw new LoreDecisionsNeededError(payload?.error ?? 'decisions', data.preview, data.missing ?? [])
  }
  if (!response.ok || !payload?.success) throw new Error(payload?.error || `Request failed: ${response.status}`)
  return payload.data as T
}

export const OWN_LOREBOOKS_QUERY_KEY = ['codex-chat-own-lorebooks'] as const
export const threadLorebooksQueryKey = (threadId: number) => ['codex-chat-thread-lorebooks', threadId] as const

/** The requester's account books (with entries) and the global books (count only). */
export function listOwnLorebooks() {
  return requestApiData<OwnedChatLorebook[]>('/api/codex-chat/lorebooks')
}

export function createOwnLorebook(input: { name: string; entries?: ChatLoreEntry[] }) {
  return requestApiData<OwnedChatLorebook>('/api/codex-chat/lorebooks', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** Null: an emptied chat book went away. */
export function updateOwnLorebook(lorebookId: number, patch: { name?: string; entries?: ChatLoreEntry[] }) {
  return requestApiData<OwnedChatLorebook | null>(`/api/codex-chat/lorebooks/${lorebookId}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteOwnLorebook(lorebookId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/lorebooks/${lorebookId}`, { method: 'DELETE' })
}

export function linkLorebookToProfile(lorebookId: number, profileId: number, linked: boolean) {
  return requestApiData<{ lorebookIds: number[] }>(`/api/codex-chat/lorebooks/${lorebookId}/profiles/${profileId}`, { method: linked ? 'PUT' : 'DELETE' })
}

export function getThreadLorebooks(threadId: number) {
  return requestApiData<ThreadLorebooks>(`/api/codex-chat/threads/${threadId}/lorebooks`, { cache: 'no-store' })
}

/** Replace the chat book's entries; it is made with its first entry (null once emptied). */
export function saveThreadLorebook(threadId: number, entries: ChatLoreEntry[]) {
  return requestApiData<OwnedChatLorebook | null>(`/api/codex-chat/threads/${threadId}/lorebook`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ entries }) })
}

export function previewLorebookMerge(targetId: number, input: { sourceId: number; entryIds?: string[] }) {
  return requestApiData<LoreMergePreview>(`/api/codex-chat/lorebooks/${targetId}/merge/preview`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** Throws LoreDecisionsNeededError while a duplicate has no decision. */
export function mergeLorebook(targetId: number, input: { sourceId: number; decisions: LoreMergeDecision[]; deleteSource?: boolean; entryIds?: string[] }) {
  return requestWithMergePreview<LoreMergeResult>(`/api/codex-chat/lorebooks/${targetId}/merge`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** The profile's summary model writes a merged text for each duplicate; nothing is saved. */
export function draftLorebookMerge(targetId: number, input: { sourceId: number; profileId: number; entryIds?: string[]; instruction?: string }) {
  return requestApiData<{ drafts: LoreMergeDraft[] }>(`/api/codex-chat/lorebooks/${targetId}/merge/draft`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }, { timeoutMs: 300_000 })
}

/** Save a save_lore proposal into the chat book (the server writes it). */
export function applyChatProposal(proposalId: number) {
  return requestApiData<{ proposal: unknown; book: OwnedChatLorebook | null }>(`/api/chat-proposals/${proposalId}/apply`, { method: 'POST' })
}

export function dismissChatProposal(proposalId: number) {
  return requestApiData<unknown>(`/api/chat-proposals/${proposalId}/dismiss`, { method: 'POST' })
}

export function interruptCodexChatThread(threadId: number) {
  return requestJson<{ success: boolean }>(`/api/codex-chat/threads/${threadId}/interrupt`, { method: 'POST' })
}

/**
 * Send a message and read the NDJSON turn stream. No timeout: a turn with generation jobs can run for minutes.
 * Aborting only stops reading; the server finishes and stores the reply.
 */
export async function streamCodexChatMessage(threadId: number, text: string, onEvent: (event: CodexChatStreamEvent) => void, signal?: AbortSignal, fileIds: string[] = [], flagIds: number[] = [], picks: string[] = [], mediaHashes: string[] = [], replyToMessageId?: number) {
  return streamChatOperation(`/api/codex-chat/threads/${threadId}/messages`, 'POST', { text, fileIds, flagIds, picks, mediaHashes, replyToMessageId }, onEvent, signal)
}

/** Carry on a cut last reply (API LLM direct chats); the stream reads like a regeneration. */
export function streamChatContinue(threadId: number, messageId: number, onEvent: (event: CodexChatStreamEvent) => void, signal?: AbortSignal) {
  return streamChatOperation(`/api/codex-chat/threads/${threadId}/messages/${messageId}/continue`, 'POST', {}, onEvent, signal)
}

/** Rewrite a reply's text by hand, without regenerating (API LLM direct chats). */
export function editChatReplyText(threadId: number, messageId: number, content: string) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/messages/${messageId}/text`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ content }) })
}

/** A new chat holding this one up to the message (API LLM direct chats). */
export function branchCodexChatThread(threadId: number, messageId: number, purpose: ChatBranchPurpose = 'continue') {
  return requestApiData<CodexChatThread>(`/api/codex-chat/threads/${threadId}/messages/${messageId}/branch`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ purpose }) })
}

/** Pin, archive or rename a chat from the chat list. */
export function updateChatListState(threadId: number, patch: { title?: string; pinned?: boolean; archived?: boolean }) {
  return requestApiData<CodexChatThread>(`/api/codex-chat/threads/${threadId}/list`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
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

/** Existing app media attached by reference. */
export type ChatMediaAttachment = { compositeHash: string; name: string; mimeType: string | null }
