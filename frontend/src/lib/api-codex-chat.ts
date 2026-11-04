import { ApiRequestError, requestApiData, requestJson } from '@/lib/api-request'
import { buildApiUrl } from '@/lib/api-url'
import type { QueryClient } from '@tanstack/react-query'
import type { ChatProfileFolder, ChatProfileFolderFields } from '@conai/shared'
export type { ChatProfileFolder } from '@conai/shared'
import type { ChatAssetVisionReview, ChatAssetBatch, ChatAssetBatchInput, ChatAssetApplyInput, ChatAssetApplyResult, ChatAssetOwner, CharacterSetting, ChatProfileCharacterLink, ChatProfileCharacterLinkInput } from '@conai/shared'
export type { ChatAssetBatch, ChatAssetBatchInput, ChatAssetKind, ChatAssetReview, ChatAssetVisionReview, ChatAssetCandidate, ChatAssetAttempt, ChatAssetApplyInput, ChatAssetApplyResult, ChatAssetOwner } from '@conai/shared'
import type { ChatJudgeDiagnostics, ChatFileChange, ChatProfileAgentSettings } from '@conai/shared'
export type { ChatSkillSectionChange, ChatSkillSectionFields } from '@conai/shared'
import type { ChatStreamEvent, ChatTranslationLanguage, CodexReasoningEffort, StoredFileEntry, ChatMessageRouting, ChatPageSnapshot, ChatProposal, ChatTask, ChatChoiceAnswer } from '@conai/shared'
import { JSON_HEADERS, requestRevisionChecked } from './api-codex-chat-core'
import type { ChatScope } from './api-codex-chat-core'
import type { ChatBlocksState, ChatDisplayBlock, ChatTypeface } from './api-codex-chat-resources'
import type { ChatLorebookKind, OwnedChatLorebook } from './api-codex-chat-lorebooks'
import type { ChatFlagSnapshot, ChatOrderKind } from './api-codex-chat-account'

// The rest of this API lives in the api-codex-chat-* modules; importers keep using this one path.
export * from './api-codex-chat-resources'
export * from './api-codex-chat-lorebooks'
export * from './api-codex-chat-account'
export type { ChatScope } from './api-codex-chat-core'
export { ChatRevisionConflictError, isChatRevisionConflict } from './api-codex-chat-core'

/** The admin route of an asset owner: a chat profile, or a character library setting (same sub-routes and bodies). */
const assetOwnerPath = (owner: ChatAssetOwner) => owner.kind === 'profile' ? `/api/codex-chat/admin/profiles/${owner.id}` : `/api/character-library/settings/${owner.id}`
const assetBatchPath = (owner: ChatAssetOwner, batchId?: number) => `${assetOwnerPath(owner)}/asset-batches${batchId === undefined ? '' : `/${batchId}`}`
/** Browser storage key of an owner; profiles keep their bare id. */
export const chatAssetOwnerKey = (owner: ChatAssetOwner) => owner.kind === 'profile' ? String(owner.id) : `setting:${owner.id}`
export class ChatAssetSubmissionError extends Error {
  readonly owner: ChatAssetOwner
  readonly batchId: number | null
  constructor(message: string, owner: ChatAssetOwner, batchId: number | null) {
    super(message)
    this.owner = owner
    this.batchId = batchId
  }
}
/** Keep the durable batch identity when submission stopped after creating some jobs. */
export async function createChatAssetBatch(owner: ChatAssetOwner, input: ChatAssetBatchInput) {
  const response = await fetch(buildApiUrl(assetBatchPath(owner)), { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  const payload = (response.headers.get('content-type') ?? '').includes('application/json') ? await response.json() as { success?: boolean; data?: ChatAssetBatch; error?: string; batchId?: number } : null
  if (!response.ok || !payload?.success || !payload.data) throw new ChatAssetSubmissionError(payload?.error || `Request failed: ${response.status}`, owner, Number.isSafeInteger(payload?.batchId) && payload!.batchId! > 0 ? payload!.batchId! : null)
  return payload.data
}
export function getChatAssetBatch(owner: ChatAssetOwner, batchId: number, signal?: AbortSignal) {
  return requestApiData<ChatAssetBatch>(assetBatchPath(owner, batchId), { signal, cache: 'no-store' })
}
export const chatAssetBatchQueryKey = (owner: ChatAssetOwner, batchId: number) => ['chat-asset-batch', owner.kind, owner.id, batchId] as const
/** A candidates group's images in the candidate archive; its visible count sits under the same prefix. */
export const chatAssetCandidatesQueryKey = (groupId: number) => ['chat-asset-candidates', groupId] as const
export function draftChatAppearance(profile: ChatProfileInput, signal?: AbortSignal) {
  return requestApiData<{ appearance: string }>('/api/codex-chat/admin/profiles/appearance-draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }), signal }, { timeoutMs: 120000 })
}
export function regenerateChatAssetSlot(owner: ChatAssetOwner, batchId: number, slotKey: string, attempt: number, useCurrentPreset = false) {
  return requestApiData<ChatAssetBatch>(`${assetBatchPath(owner, batchId)}/slots/${encodeURIComponent(slotKey)}/regenerate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attempt, useCurrentPreset }) })
}
export function cancelChatAssetSlot(owner: ChatAssetOwner, batchId: number, slotKey: string) {
  return requestApiData<ChatAssetBatch>(`${assetBatchPath(owner, batchId)}/slots/${encodeURIComponent(slotKey)}/cancel`, { method: 'POST' })
}
export function chooseChatAssetSlot(owner: ChatAssetOwner, batchId: number, slotKey: string, compositeHash: string) {
  return requestApiData<ChatAssetBatch>(`${assetBatchPath(owner, batchId)}/slots/${encodeURIComponent(slotKey)}/choose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compositeHash }) })
}
export function reviewChatAssetVision(owner: ChatAssetOwner, batchId: number, slotKey: string, modelSlotId: number, compositeHash: string, signal?: AbortSignal) {
  return requestApiData<ChatAssetVisionReview>(`${assetBatchPath(owner, batchId)}/slots/${encodeURIComponent(slotKey)}/vision-review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelSlotId, compositeHash }), signal })
}
export function applyChatAssetBatch(owner: ChatAssetOwner, batchId: number, input: ChatAssetApplyInput = {}) {
  return requestApiData<ChatAssetApplyResult>(`${assetBatchPath(owner, batchId)}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}
/** Choose one slot's candidate and apply only that slot. */
export function applyChatAssetSlot(owner: ChatAssetOwner, batchId: number, slotKey: string, compositeHash: string) {
  return requestApiData<ChatAssetApplyResult>(`${assetBatchPath(owner, batchId)}/slots/${encodeURIComponent(slotKey)}/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compositeHash }) })
}
/** Put a library image on one emotion of the owner's expression group, replacing the one it had. */
export function setChatProfileExpression(owner: Extract<ChatAssetOwner, { kind: 'profile' }>, name: string, compositeHash: string): Promise<{ expressionGroupId: number; profile: ChatProfile }>
export function setChatProfileExpression(owner: Extract<ChatAssetOwner, { kind: 'setting' }>, name: string, compositeHash: string): Promise<{ expressionGroupId: number; setting: CharacterSetting }>
export function setChatProfileExpression(owner: ChatAssetOwner, name: string, compositeHash: string) {
  return requestApiData<unknown>(`${assetOwnerPath(owner)}/expressions/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compositeHash }) })
}
/** Empty one emotion of the owner's expression group. */
export function clearChatProfileExpression(owner: ChatAssetOwner, name: string) {
  return requestApiData<{ expressionGroupId: number | null }>(`${assetOwnerPath(owner)}/expressions/${encodeURIComponent(name)}`, { method: 'DELETE' })
}
export function applyChatProfileAssetsProposal(proposalId: number) {
  return requestApiData<{ proposal: ChatProposal; batch?: ChatAssetBatch; result?: ChatAssetApplyResult }>(`/api/chat-proposals/${proposalId}/apply`, { method: 'POST' })
}
export type ChatEngine = 'llm' | 'codex' | 'claude'
export type ChatLlmRuntime = 'direct' | 'pi'
export type ChatDiagnosticsScope = 'none' | 'view' | 'content' | 'prompts'

export type ChatContextKind = 'persona' | 'system-prompt' | 'prompt-section' | 'guidance' | 'lore-index' | 'constant-lore' | 'lore' | 'summary' | 'example' | 'window' | 'reference' | 'author-note' | 'state' | 'flags' | 'user-persona' | 'recall' | 'page' | 'continuation' | 'last-instruction' | 'tool-definition' | 'tool-result' | 'group-header' | 'summary-instruction' | 'translation-instruction' | 'judge'
export type ChatContextPart = { kind: ChatContextKind; role: string; position: number; estTokens: number; hash: string }
export type ChatContextLore = { key: string; bookId: number; bookKind: ChatLorebookKind; entryId: string; title: string; selected: boolean; reason: string; matched: string[]; hash?: string; file?: 'inline' | 'hint'; remaining?: number; via?: string }

/** Text-free request composition; old records keep the v1 fields alone. */
export interface ChatContextMeta {
  model: string | null
  windowFromMessageId: number | null
  sentMessages: number
  summaryUntilMessageId: number | null
  recalledSegments: number
  lore: string[]
  memories: number
  estimatedTokens: number
  promptTokens?: number | null
  version?: 2
  engine?: ChatEngine
  opaqueContext?: boolean
  runtime?: 'direct' | 'pi' | 'claude-code' | 'codex'
  session?: { resumed: boolean; compacted?: boolean }
  /** Effective scope at read time, including the replying profile's restriction. */
  scope?: ChatDiagnosticsScope
  profileId?: number
  sections?: Array<ChatContextPart & { parts?: ChatContextPart[] }>
  loreEntries?: ChatContextLore[]
  loreSkipped?: Array<Pick<ChatContextLore, 'entryId' | 'bookId' | 'title' | 'reason'>>
  loreUnmatched?: number
  recall?: Array<{ segmentId: number; score: number; terms: string[]; hash: string }>
  window?: { fromId: number | null; sent: number; droppedTurns: number }
  toolRounds?: number
  codexKeys?: string[]
  tokenUsage?: { contextTokens: number | null; inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null }
  /** The judge's answers that steered this reply. */
  judge?: ChatJudgeDiagnostics
  truncated?: boolean
}

export type ChatDiagnosticText = { kind: ChatContextKind; id?: number | string; hash: string; text?: string; promptText?: string; changedSince?: boolean; unavailable?: boolean; bookId?: number; entryId?: string }
export interface ChatDiagnostics {
  meta: ChatContextMeta
  scope: Exclude<ChatDiagnosticsScope, 'none'>
  alternative: number
  texts?: ChatDiagnosticText[]
  raw?: unknown
}

/** Who answers the chats' web_search tool: a Codex or Claude Code run with only its web search (model null: its default). */
export type WebResearchSettings = { engine: 'off' | 'codex' | 'claude'; model: string | null; dailyLimit: number | null }
/**
 * `toolRoundLimit`: the one tool limit, model ↔ tool round trips per reply for every profile, engine and plugin run (1–200).
 * `loreSelectionLimit`: keyword lore entries a judge or plugin selection keeps, best matches first.
 */
export type ChatAdminSettings = { enabled: boolean; diagnostics: { enabled: boolean; captureRaw: boolean; captureLimit: number }; loreAutoSave: boolean; loreKeyLanguage: string | null; webResearch: WebResearchSettings; piCodemode: boolean; toolRoundLimit: number; loreSelectionLimit: number }
export { TOOL_ROUND_LIMITS, LORE_SELECTION_LIMITS } from '@conai/shared'

export const CHAT_SCOPES: ChatScope[] = ['read', 'generate', 'organize', 'configure']
export const CHAT_PROFILES_QUERY_KEY = ['codex-chat-profiles'] as const
export const CHAT_PROFILE_DEFAULTS_QUERY_KEY = ['codex-chat-profile-defaults'] as const
export const CHAT_ADMIN_PROFILES_QUERY_KEY = ['codex-chat-admin-profiles'] as const
export const CHAT_ADMIN_SETTINGS_QUERY_KEY = ['codex-chat-admin-settings'] as const
export const CHAT_STATUS_QUERY_KEY = ['codex-chat-status'] as const
export const CHAT_HEALTH_QUERY_KEY = ['codex-chat-health'] as const
export const CHAT_MESSAGE_PAGE_SIZE = 80

/** Why a profile's chat connection is down (see the backend's connectionHealthState). */
export type ChatConnectionDownReason = 'unreachable' | 'auth' | 'quota' | 'model_missing' | 'disabled' | 'not_installed' | 'not_signed_in'

export interface ChatProfileConnectionDown {
  reason: ChatConnectionDownReason
  /** The connection's display name (Codex / Claude Code for those engines). */
  connection: string
  checkedAt: string
}

/** Usable profiles whose chat connection is down, by profile id; a working profile is absent. */
export interface ChatHealth {
  profiles: Record<string, ChatProfileConnectionDown>
}

export interface CodexChatStatus {
  /** The chat master switch. */
  enabled: boolean
  /** save_lore saves right away unless a chat says otherwise (see CodexChatThread.lore_auto_save). */
  loreAutoSave?: boolean
  /** The lore key language (see ChatAdminSettings). */
  loreKeyLanguage?: string | null
  /** This session can use at least one engine. */
  canUse: boolean
  codex: { canUse: boolean }
  llm: { canUse: boolean }
  claude: { canUse: boolean }
  scopes: ChatScope[]
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
  groupId: number
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
export type ChatProfileAssetKind = 'avatar' | 'background' | 'reference'
/** x/y are cover overflow positions in percent (0–100); scale is the zoom factor. */
export type ChatAvatarCrop = { x: number; y: number; scale: number }

/** Additive asset fields; optional while the existing editor still creates legacy drafts. */
export interface ChatProfileAssetFields {
  appearance?: string
  referenceHash?: string | null
  avatarHash?: string | null
  avatarCrop?: ChatAvatarCrop | null
  backgroundHash?: string | null
  assetVersion?: string | null
  /** False when the server has no avatar to serve for this profile (absent on drafts and older payloads). */
  hasAvatar?: boolean
  /** The server may return a chat-only thumbnail without granting access to the original. */
  avatarThumbnailUrl?: string | null
}

export interface ChatProfileSummary extends ChatProfileAssetFields, ChatProfileFolderFields {
  expressionGroupId?: number | null
  tagline: string
  model: string
  /** The line the chat UI shows for the model: `slot · model`, `connection · model` or `Codex · model`. */
  modelLabel: string
  canReadFileText: boolean
  /** What a reply's bar can order this character to do (`choices` only in a direct chat); absent on older servers. */
  orders?: ChatOrderKind[]
  /** The composer offers reply suggestions (a connection is set up to answer them). */
  suggestEnabled: boolean
  /** The chat can be connected to the current page (monitor button). */
  pageAssist: boolean
  /** The library setting the profile looks like (folders and name); sent only to readers of the character library. */
  characterLink?: Pick<ChatProfileCharacterLink, 'settingId' | 'synced' | 'settingName' | 'path'> | null
  id: number
  name: string
  /** Kept optional for older servers; current lists serve avatar bytes through the asset route. */
  avatar?: string | null
  engine: ChatEngine
  isEnabled: boolean
  usable: boolean
  /** Context defaults a chat can override (LLM profiles). */
  contextTurns: number
  summaryEnabled: boolean
  /** LLM profiles: reply token cap (null: the server's default), reasoning effort ('' not sent) and budget, both counted in the cap. */
  maxTokens: number | null
  reasoningEffort: CodexReasoningEffort | ''
  reasoningBudgetTokens: number | null
  /** Where keyword lore and the author's note go (turns before the end), and the default note a chat falls back to. */
  loreDepth: number
  authorNote: string
  style: ChatStyle
  /** Null: no background image. Otherwise part of the image URL, so it changes with the image. */
  backgroundVersion: string | null
}

/** A reply cap at or under this, with reasoning not turned off, may be spent on thinking before any answer. */
const THINKING_CAP_WARN_TOKENS = 1024

/** Whether an LLM reply cap is small enough that reasoning may use it all up (reasoning not 'none', the cap set and low). */
export function thinkingMayFillCap(reasoningEffort: string, maxTokens: number | null) {
  return reasoningEffort !== 'none' && maxTokens !== null && maxTokens <= THINKING_CAP_WARN_TOKENS
}

/** An image copied in from a character card (`chat-asset:<name>` in profile and message text). */
export function chatAssetUrl(name: string) {
  return buildApiUrl(`/api/codex-chat/assets/${encodeURIComponent(name)}`)
}

/** Library media linked from chat text (`media:<hash>.<ext>`), served by the chat route so every chat user sees it. */
export function chatMediaUrl(compositeHash: string, extension: string) {
  return buildApiUrl(`/api/codex-chat/media/${encodeURIComponent(compositeHash)}.${encodeURIComponent(extension)}`)
}

export function chatMediaThumbnailUrl(compositeHash: string) {
  return buildApiUrl(`/api/codex-chat/media/${encodeURIComponent(compositeHash)}/thumbnail`)
}

export type ChatLocalizedMedia = {
  texts: string[]
  saved: number
  items: Array<{ url: string; compositeHash: string; extension: string; finalUrl: string | null }>
  failed: Array<{ url: string; reason: string }>
  /** Links left for another run (one run copies 30 at most). */
  remaining: number
  messages: number
}

/**
 * Copy the web images and videos these texts show into the image library (under `채팅 카드/<name>`); returns the texts
 * pointing at the copies. `only` fetches just those links, again even if copied before.
 */
export function localizeChatImages(texts: string[], options: { name?: string; only?: string[] } = {}) {
  return requestApiData<ChatLocalizedMedia>('/api/codex-chat/admin/chat-assets/localize', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ texts, ...options }) })
}

export type ChatMediaInfo = {
  compositeHash: string
  available: boolean
  mimeType: string | null
  fileSize: number | null
  width: number | null
  height: number | null
  duration: number | null
  sourceUrl: string | null
  finalUrl: string | null
}

export function getChatMediaInfo(hashes: string[]) {
  return requestApiData<ChatMediaInfo[]>('/api/codex-chat/admin/chat-media/info', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ hashes }) })
}

/** Chat profiles (names) and messages that show these library media. */
export function getChatMediaUsage(hashes: string[]) {
  return requestApiData<{ profiles: string[]; messages: number }>('/api/codex-chat/admin/chat-media/usage', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ hashes }) })
}

export function chatProfileAssetUrl(profileId: number, kind: ChatProfileAssetKind, version?: string | null) {
  return buildApiUrl(`/api/codex-chat/profiles/${profileId}/assets/${kind}${version ? `?v=${encodeURIComponent(version)}` : ''}`)
}

export type ChatProfileAssetResult = { compositeHash: string; extension: string }
/** Where an imported image lands: a profile's character group (by name, the profile may be unsaved) or a library setting. */
export type ChatAssetUploadTarget = { characterName: string } | { settingId: number }

export function uploadChatProfileAsset(file: File, target: ChatAssetUploadTarget) {
  const body = new FormData()
  body.append('file', file)
  if ('settingId' in target) body.append('settingId', String(target.settingId))
  else body.append('characterName', target.characterName)
  return requestApiData<ChatProfileAssetResult>('/api/codex-chat/admin/chat-assets/upload', { method: 'POST', body })
}

export function downloadChatProfileAsset(url: string, target: ChatAssetUploadTarget) {
  return requestApiData<ChatProfileAssetResult>('/api/codex-chat/admin/chat-assets/url', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url, ...target }) })
}

export function importChatProfileAssetFromFileStore(fileId: string, target: ChatAssetUploadTarget) {
  return requestApiData<ChatProfileAssetResult>('/api/codex-chat/admin/chat-assets/from-file-store', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ fileId, ...target }) })
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

/** One message of a new chat's opening, saved into the chat as an ordinary message. */
export interface ChatOpeningMessage {
  role: 'user' | 'assistant'
  content: string
}

/** `agentEnabled`: other profiles may call this one during a chat; `agentDescription` tells them when. */
export interface ChatProfile extends ChatProfileAssetFields, ChatProfileAgentSettings {
  folderId?: number | null
  folderPath?: ChatProfileFolderFields['folderPath']
  libraryReferenceHash?: string | null
  revision: string
  backgroundRevision: number
  /** The effective expression group on synced profiles; also returned by the single-profile admin read. */
  expressionGroupId?: number | null
  /** Linked shared lorebooks, in priority order. */
  lorebookIds: number[]
  /** Linked shared display blocks, in display order; the server fills `style.blocks` from them. */
  blockIds: number[]
  loreScanDepth: number
  loreTokenBudget: number
  /** API LLM: keyword lore is merged in this many turns before the end (0: the latest message). */
  loreDepth: number
  /** How many times chosen lore entries' text is scanned for further entries (0: off, at most 5). */
  loreRecursionDepth: number
  /** Default author's note for the profile's chats (a chat can set its own). */
  authorNote: string
  tagline: string
  id: number
  name: string
  avatar: string | null
  engine: ChatEngine
  /** Codex / Claude Code: the engine's own model. API LLM profiles use `modelSlotId`. */
  model: string
  /** API LLM: 'pi' runs chat replies through the pi agent, which keeps the chat as a session and folds it itself. */
  llmRuntime: ChatLlmRuntime
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
  /** The opening of every new chat (and reset), saved as real messages around the greeting (max 100). */
  openingHistory: ChatOpeningMessage[]
  /** How many openingHistory messages come before the greeting. */
  greetingPosition: number
  temperature: number | null
  maxTokens: number | null
  mcpEnabled: boolean
  /** Permission groups whose accounts may chat with this profile; empty means everyone with the engine's permission. Administrators always may. */
  allowedGroupKeys: string[]
  mcpScopes: ChatScope[]
  /** Only these tools; null offers every tool the scopes allow. */
  toolAllowlist: string[] | null
  /** Additional feature permissions used only by this profile's enabled tools; never account or administration grants. */
  delegatedPermissions: string[]
  /** Generation presets the profile draws with; any linked withholds free-form generation and workflow lookups. */
  generationPresetIds: number[]
  toolOutputLimit: number
  contextTurns: number
  contextTokens: number | null
  summaryEnabled: boolean
  summaryTriggerTurns: number
  summaryPrompt: string
  /** Notes for translating this profile's replies (voice, how it addresses the user, a glossary); `{{char}}`/`{{user}}` filled. */
  translationInstructions: string
  /** With a translation model: the language the chat model reads and writes (my messages are translated into it). */
  translationModelLanguage: ChatTranslationLanguage
  /** With a translation model: the language I write and read (the replies are translated into it). */
  translationDisplayLanguage: ChatTranslationLanguage
  /** Reply suggestions on the composer's sparkle button; with no model of its own it uses the chat's (Codex: a one-shot run). */
  suggestEnabled: boolean
  /**
   * Model rows (a connection's model) per role. Chat null: the default model. Summary / suggestions null: the chat's
   * model. Translation null: no translation (when set, messages go to the chat model in its language, replies are shown in mine).
   */
  modelSlotId: number | null
  summarySlotId: number | null
  translationSlotId: number | null
  suggestSlotId: number | null
  /** A profile (another one or this one) that writes the suggestions with its own model and prompt; wins over the suggest role. */
  suggestProfileId: number | null
  /** Or a user profile that writes them with its own model and description (only in its account's chats). */
  suggestUserProfileId: number | null
  /** Read-only: as a suggestion writer, its model is set and its connection works. */
  suggestWriterReady?: boolean
  /** LLM: the model can look at images (view_images). */
  visionEnabled: boolean
  /** Ceiling on the rating of media the model is shown: its model row's, or `contentRatingTierId` (Codex / Claude Code: always its own). */
  contentRatingMode: 'model' | 'custom'
  /** The highest rating tier (id) shown; null: no ceiling. */
  contentRatingTierId: number | null
  pageAssist: boolean
  /** The model may propose chat lorebook entries (save_lore). */
  allowLoreProposals: boolean
  /** File store folders and text files its characters may open (and write where allowed) in any chat of the owner. */
  linkedFiles: LinkedFileLink[]
  /** The project workspaces it works in (1:1 and group chats, board calls), and whether it may write in each; a chat adds more or turns one off. */
  workspaces: Array<{ id: string; write: boolean }>
  /** Shared skills its chat model may load with use_skill, in the order its system prompt lists them. */
  skillIds: number[]
  /** The judge preset steering each turn (null: no judge) and a judge model instead of the preset's (null: the preset's). */
  judgePresetId: number | null
  judgeSlotId: number | null
  style: ChatStyle
  backgroundVersion: string | null
  isEnabled: boolean
  sortOrder: number
  createdDate: string
  updatedDate: string
  /**
   * Admin responses: the character library setting the profile links to. While synced, the appearance, reference,
   * avatar and expressions above are the setting's.
   */
  characterLink?: ChatProfileCharacterLink | null
}

/** What a card import kept as it was, kept in another form, and left out. */
export interface ChatCardImportReport {
  kept: string[]
  converted: string[]
  dropped: string[]
}

/** `background`: a new image (data URL), null to remove it, left out to keep the current one. */
export type ChatProfileInput = Partial<Omit<ChatProfile, 'id' | 'folderPath' | 'libraryReferenceHash' | 'revision' | 'backgroundRevision' | 'expressionGroupId' | 'createdDate' | 'updatedDate' | 'backgroundVersion' | 'suggestWriterReady' | 'assetVersion' | 'hasAvatar' | 'avatarThumbnailUrl' | 'characterLink'>> & {
  background?: string | null
  /** The library link to set (null removes it; left out keeps it). While synced the appearance fields are not sent. */
  characterLink?: ChatProfileCharacterLinkInput
}

/** The profile fields that are the linked setting's while synced (the server ignores them in a save then). */
export const CHAT_PROFILE_SYNCED_KEYS = ['appearance', 'referenceHash', 'avatarHash', 'avatarCrop', 'avatar'] as const satisfies ReadonlyArray<keyof ChatProfileInput>

/** Two library links name the same setting, sync and outfit (a stored link's name and path aside). */
export function sameCharacterLink(left: ChatProfileCharacterLinkInput | undefined, right: ChatProfileCharacterLinkInput | undefined) {
  return (left?.settingId ?? null) === (right?.settingId ?? null) && Boolean(left?.synced) === Boolean(right?.synced) && (left?.outfit ?? null) === (right?.outfit ?? null)
}

/** A deliberate resolution or cancellation, not a failed request. */
export class ChatEditorResolution extends Error {
  constructor(message: string, cause: unknown) { super(message, { cause }) }
}

/**
 * A draft's emoticon groups after the server changed the stored list from `previous` to `updated` (a link change
 * swaps expression groups): the groups it added go first, the ones it removed go, the draft's other edits stay.
 */
export function emoticonGroupsAfterServerChange(previous: readonly number[], updated: readonly number[], current: readonly number[]) {
  const added = updated.filter((id) => !previous.includes(id))
  const removed = previous.filter((id) => !updated.includes(id))
  return [...added, ...current.filter((id) => !added.includes(id) && !removed.includes(id))]
}

/**
 * What a profile save sends: while synced to a library setting, none of the look's fields (they are the setting's).
 * Given the `stored` link, the link is sent only when it changes (so a link made elsewhere meanwhile stays).
 */
export function chatProfileSaveInput(input: ChatProfileInput, stored?: ChatProfileCharacterLinkInput): ChatProfileInput {
  const next: ChatProfileInput = { ...input }
  if (stored !== undefined && sameCharacterLink(input.characterLink, stored)) delete next.characterLink
  if (input.characterLink?.synced) for (const key of CHAT_PROFILE_SYNCED_KEYS) delete next[key]
  return next
}

/**
 * Profiles whose look changed elsewhere (synced to a changed library setting): refetch the profile lists that hold
 * one of them and their emoticons; portraits follow the lists' asset versions.
 */
export function invalidateChatProfileViews(queryClient: QueryClient, profileIds: ReadonlySet<number>) {
  const holds = (data: unknown) => Array.isArray(data) && data.some((entry) => profileIds.has((entry as { id?: number }).id ?? 0))
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: CHAT_PROFILE_LIBRARY_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, predicate: ({ state }) => holds(state.data) }),
    queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY, predicate: ({ state }) => holds(state.data) }),
    ...[...profileIds].map((id) => queryClient.invalidateQueries({ queryKey: chatProfileEmoticonsQueryKey(id) })),
  ])
}

export interface ChatProfileDefaults {
  /** The chat representative model's default prompt: a new profile starts with it. */
  systemPrompt: string
  loreScanDepth: number
  loreTokenBudget: number
  loreDepth: number
  loreRecursionDepth: number
  contextTurns: number
  summaryTriggerTurns: number
  toolOutputLimit: number
  summaryPrompt: string
  scopes: ChatScope[]
  style: ChatStyle
}

export type { ChatToolCall as CodexChatToolCall } from '@conai/shared'
import type { ChatToolCall as CodexChatToolCall } from '@conai/shared'

export interface CodexChatThread {
  id: number
  /** Chat lists: the chat's unfinished task (progress ring). */
  task?: import('@conai/shared').ChatTaskSummary | null
  /** Chat lists: the automation that made this room for itself (filed under 자동화), or null. */
  automation?: import('@conai/shared').ChatAutomationRoomKind | null
  /** save_lore saves right away (1), leaves a card (0), or follows the chat settings (null). */
  lore_auto_save?: 0 | 1 | null
  /** The writable linked folder each new summary stretch is also kept in (회의록/<date>.md); null: none. */
  minutes_folder_id?: string | null
  /** Private attachment context pauses shared minutes, even when a folder remains selected. */
  minutes_paused?: boolean
  codex_thread_id: string | null
  title: string
  engine: ChatEngine
  profile_id: number | null
  /** Overrides of the profile (null follows it). */
  context_turns: number | null
  summary_enabled: 0 | 1 | null
  reaction_enabled: 0 | 1
  reaction_model_slot_id: number | null
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
  /** The owner has read up to this message (null: none read). */
  last_read_message_id?: number | null
  /** Chat lists: replies after the read mark. */
  unread_count?: number
  /** Chat lists: its unread replies count on the shell badge (plugin and agent rooms default off, other chats on). */
  notify_enabled?: boolean
  created_date: string
  updated_date: string
}

/** Directory projection; context/settings are fetched only with the selected thread's detail. */
export type CodexChatThreadSummary = Pick<CodexChatThread,
  'id' | 'title' | 'engine' | 'profile_id' | 'kind' | 'pinned' | 'archived' |
  'branched_from_thread_id' | 'branched_at_message_id' | 'branch_purpose' | 'created_date' | 'updated_date' |
  'member_profile_ids' | 'preview' | 'running' | 'unread_count' | 'task' | 'automation' | 'notify_enabled'>

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
  /** Replies: the text files their tools wrote, each with an undo. */
  fileChanges?: ChatFileChange[]
  created_date: string
}

/** Media kind of an image a transcript references (so videos can play inline). */
export interface CodexChatMediaInfo {
  /** File/thumbnail base bound to a stored assistant result; grants no library access. */
  resultMediaUrl?: string
  postprocessStatus?: string | null
  historyId?: number
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
  /** A `tail` fetch: the id of the first message sent, and how many the thread has in all. */
  messagesFrom?: number
  messageCount?: number
  /** A bounded reply edit also returns the changed message and the revision immediately before the edit. */
  changedMessage?: CodexChatMessage
  previousContextRevision?: number
  /** Whether an older server page exists before the first loaded message. */
  hasMoreBefore?: boolean
  /** Client cache only: older pages were explicitly requested, so refresh/restore their range too. */
  historyLoaded?: boolean
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
  /** The judge preset that picks who answers unaddressed messages and whether the room goes on (null: none). */
  judgePresetId: number | null
}

/** One image a chat brought in: `generated` by its jobs, or `found` through searches and lookups. */
export interface CodexChatMediaItem {
  resultMediaUrl?: string
  postprocessStatus?: string | null
  historyId?: number
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

export function getCodexChatStatus() {
  return requestApiData<CodexChatStatus>('/api/codex-chat/status', { cache: 'no-store' })
}

/** `recheck` checks every connection again now instead of reusing a recent result. */
export function getChatHealth(recheck = false) {
  return requestApiData<ChatHealth>(`/api/codex-chat/health${recheck ? '?recheck=1' : ''}`, { cache: 'no-store' })
}

export function listChatProfiles() {
  return requestApiData<ChatProfileSummary[]>('/api/codex-chat/profiles', { cache: 'no-store' })
}

export function getChatAdminSettings() {
  return requestApiData<ChatAdminSettings>('/api/codex-chat/admin/settings', { cache: 'no-store' })
}

export function updateChatAdminSettings(patch: { enabled?: boolean; diagnostics?: Partial<ChatAdminSettings['diagnostics']>; loreAutoSave?: boolean; loreKeyLanguage?: string | null; webResearch?: Partial<WebResearchSettings>; piCodemode?: boolean; toolRoundLimit?: number; loreSelectionLimit?: number }) {
  return requestApiData<ChatAdminSettings>('/api/codex-chat/admin/settings', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function getChatDiagnostics(threadId: number, messageId: number, alternative: number, signal?: AbortSignal) {
  return requestApiData<ChatDiagnostics>(`/api/codex-chat/threads/${threadId}/messages/${messageId}/diagnostics?alternative=${alternative}`, { cache: 'no-store', signal })
}

export function exportChatDiagnostics(threadId: number, messageId: number, alternative: number) {
  return requestApiData<{ file: StoredFileEntry; path: string }>(`/api/codex-chat/threads/${threadId}/messages/${messageId}/diagnostics/export?alternative=${alternative}`, { method: 'POST' })
}

export function getChatProfileDefaults() {
  return requestApiData<ChatProfileDefaults>('/api/codex-chat/admin/profile-defaults', { cache: 'no-store' })
}

export function listChatAdminProfiles() {
  return requestApiData<ChatProfile[]>('/api/codex-chat/admin/profiles', { cache: 'no-store' })
}

export const CHAT_PROFILE_FOLDERS_QUERY_KEY = ['chat-profile-folders'] as const
export const CHAT_PROFILE_LIBRARY_QUERY_KEY = ['chat-profile-library'] as const
export function listChatProfileFolders() {
  return requestApiData<ChatProfileFolder[]>('/api/codex-chat/admin/profile-folders')
}
export function createChatProfileFolder(input: { name: string; parentId: number | null }) {
  return requestApiData<ChatProfileFolder>('/api/codex-chat/admin/profile-folders', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}
export function updateChatProfileFolder(id: number, input: { name?: string; parentId?: number | null }) {
  return requestApiData<ChatProfileFolder>(`/api/codex-chat/admin/profile-folders/${id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(input) })
}
export function deleteChatProfileFolder(id: number) {
  return requestApiData<{ parentId: number | null }>(`/api/codex-chat/admin/profile-folders/${id}`, { method: 'DELETE' })
}
export function listChatProfilePage(scope: { folderId: number | null; query: string; limit: number; offset: number }) {
  const params = new URLSearchParams({ folder: scope.folderId === null ? 'root' : String(scope.folderId), q: scope.query, limit: String(scope.limit), offset: String(scope.offset) })
  return requestApiData<{ items: ChatProfile[]; total: number; hasMore: boolean }>(`/api/codex-chat/admin/profiles?${params}`)
}

export function getChatAdminProfile(profileId: number) {
  return requestApiData<ChatProfile>(`/api/codex-chat/admin/profiles/${profileId}`, { cache: 'no-store' })
}

export function listChatProfileNames() {
  return requestApiData<Array<{ id: number; name: string }>>('/api/codex-chat/admin/profile-names')
}

/** With folderId: replace the listed cards' positions in that folder, returning null. Legacy calls return the directory in folder-tree order. */
export function reorderChatProfiles(ids: number[], folderId?: number | null) {
  return requestApiData<ChatProfile[] | null>('/api/codex-chat/admin/profiles/order', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ ids, folderId }) })
}

/** `copyOf`: the profile this one copies; it keeps that profile's links and gets its own copy of its expressions. */
export function createChatProfile(input: ChatProfileInput, copyOf?: number) {
  return requestApiData<ChatProfile>('/api/codex-chat/admin/profiles', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(copyOf ? { ...input, copyOf } : input) })
}

/** A chat exported as CoNAI JSON, back in as a new chat; `notes` say what did not come along. */
export function importCodexChatThread(file: File) {
  const body = new FormData()
  body.append('file', file)
  return requestApiData<{ thread: CodexChatThread; notes: string[] }>('/api/codex-chat/threads/import', { method: 'POST', body })
}

/** CoNAI chat JSON files from the shared file store (chat backups) as new chats, each reported on its own. */
export function importChatFromFiles(fileIds: string[]) {
  return requestApiData<{ results: Array<{ fileId: string; name: string; threadId?: number; notes?: string[]; error?: string }> }>('/api/codex-chat/threads/import-files', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ fileIds }) })
}

export function importChatProfileCard(file: File) {
  const body = new FormData()
  body.append('file', file)
  return requestApiData<ChatProfileInput & { importReport?: ChatCardImportReport }>('/api/codex-chat/admin/profiles/import-card', { method: 'POST', body })
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

export function updateChatProfile(profileId: number, patch: ChatProfileInput, revision?: string) {
  return requestRevisionChecked<ChatProfile>(`/api/codex-chat/admin/profiles/${profileId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ ...patch, ...(revision === undefined ? {} : { revision }) }) })
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
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/blocks/${encodeURIComponent(key)}?tail=${CHAT_MESSAGE_PAGE_SIZE}`, {
    method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ ...(data === null ? { reset: true } : { data }), ...(profileId === undefined ? {} : { profileId }) }),
  })
}

export function updateCodexChatThreadContext(threadId: number, patch: { loreAutoSave?: boolean | null; contextTurns?: number | null; maxTokens?: number | null; summaryEnabled?: boolean | null; summary?: string | null; authorNote?: string | null; authorNoteDepth?: number | null; userProfileId?: number | null; lorebookIds?: number[]; loreRecordBookId?: number | null; linkedFiles?: LinkedFileLink[]; minutesFolderId?: string | null; reactionEnabled?: boolean; reactionModelSlotId?: number | null }) {
  return requestApiData<CodexChatThread>(`/api/codex-chat/threads/${threadId}/context`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

/** Rewrite one stretch of an LLM chat's summary by hand. */
export function editChatSummarySegment(threadId: number, segmentId: number, content: string) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/summary-segments/${segmentId}?tail=${CHAT_MESSAGE_PAGE_SIZE}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ content }) })
}

export function summarizeCodexChatThread(threadId: number) {
  return requestApiData<CodexChatThread>(`/api/codex-chat/threads/${threadId}/summarize`, { method: 'POST' })
}

export function clearCodexChatThread(threadId: number) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/clear?tail=${CHAT_MESSAGE_PAGE_SIZE}`, { method: 'POST' })
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
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/messages/${messageId}/alternative?tail=${CHAT_MESSAGE_PAGE_SIZE}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ index }) })
}

export function listCodexChatThreads() {
  // Bootstrap/selection consumers need only the first page, not the complete directory.
  return listCodexChatThreadPage({ bootstrap: true }).then((page) =>
    page.default_thread && !page.data.some((room) => room.id === page.default_thread?.id) ? [...page.data, page.default_thread] : page.data)
}

export type ChatRoomListOptions = {
  archive?: 'all' | 'active' | 'archived'
  kind?: 'direct' | 'group'
  query?: string
  pinnedFirst?: boolean
  limit?: number
  /** Preserve default selection even when automation rooms fill the newest page. */
  bootstrap?: boolean
}
export type ChatRoomPage = {
  data: CodexChatThreadSummary[]
  pagination: { total: number; has_more: boolean; next_cursor: string | null }
  has_automation: boolean
  has_archived_chats: boolean
  has_archived_automation: boolean
  default_thread?: CodexChatThreadSummary | null
}

export function listCodexChatThreadPage(options: ChatRoomListOptions = {}, cursor?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 40) })
  if (options.archive) params.set('archive', options.archive)
  if (options.kind) params.set('kind', options.kind)
  if (options.query?.trim()) params.set('query', options.query.trim())
  if (options.pinnedFirst) params.set('pinned_first', 'true')
  if (options.bootstrap) params.set('bootstrap', 'true')
  if (cursor) params.set('cursor', cursor)
  return requestJson<ChatRoomPage>(`/api/codex-chat/threads?${params}`, { cache: 'no-store', signal })
}

/** Targeted summaries for selected rooms, branch ancestors and routine targets outside a loaded page. */
export async function getCodexChatThreadSummaries(ids: number[], signal?: AbortSignal) {
  const unique = [...new Set(ids)]
  const result: CodexChatThreadSummary[] = []
  for (let offset = 0; offset < unique.length; offset += 100) {
    const params = new URLSearchParams({ ids: unique.slice(offset, offset + 100).join(',') })
    result.push(...await requestApiData<CodexChatThreadSummary[]>(`/api/codex-chat/threads?${params}`, { cache: 'no-store', signal }))
  }
  return result
}

export function getCodexChatDirectoryUnread() {
  return requestApiData<number>('/api/codex-chat/threads/unread-count', { cache: 'no-store' })
}

/** `userProfileId` left out: the server picks the default user profile; null: the plain user. */
/** `greetingIndex`: the greeting previewChatGreeting showed (absent: one chosen at random). */
export function createCodexChatThread(profileId: number, userProfileId?: number | null, greetingIndex?: number | null, flagIds?: number[]) {
  return requestApiData<CodexChatThread>('/api/codex-chat/threads', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ profileId, ...(userProfileId === undefined ? {} : { userProfileId }), ...(greetingIndex === undefined ? {} : { greetingIndex }), ...(flagIds === undefined ? {} : { flagIds }) }) })
}

/**
 * A new chat's opening before it is saved: one greeting (index null: none), the opening history before and after it
 * (filled for the user profile) and the user profile the chat would take.
 */
export function previewChatGreeting(profileId: number, userProfileId?: number | null) {
  const query = userProfileId === undefined ? '' : `?userProfileId=${userProfileId === null ? 'null' : userProfileId}`
  return requestApiData<{ index: number | null; text: string; greetings: string[]; userProfileId: number | null; before: ChatOpeningMessage[]; after: ChatOpeningMessage[] }>(`/api/codex-chat/profiles/${profileId}/greeting${query}`, { cache: 'no-store' })
}

export function createGroupChat(input: { profileIds: number[]; representativeId: number; title?: string; userProfileId?: number | null }) {
  return requestApiData<CodexChatThread>('/api/codex-chat/threads/group', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** `null` limits restore the defaults; a `null` maxTokens lets each profile's own cap apply. */
export function updateGroupChat(threadId: number, patch: { representativeId?: number; title?: string; chainLimit?: number | null; windowLimit?: number | null; maxTokens?: number | null; judgePresetId?: number | null }) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/group?tail=${CHAT_MESSAGE_PAGE_SIZE}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

/** One member's reply token cap in the room (null follows the room's cap, then the profile's). */
export function updateGroupChatMember(threadId: number, profileId: number, patch: { maxTokens?: number | null }) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/members/${profileId}?tail=${CHAT_MESSAGE_PAGE_SIZE}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function addGroupChatMembers(threadId: number, profileIds: number[]) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/members?tail=${CHAT_MESSAGE_PAGE_SIZE}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ profileIds }) })
}

export function removeGroupChatMember(threadId: number, profileId: number) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/members/${profileId}?tail=${CHAT_MESSAGE_PAGE_SIZE}`, { method: 'DELETE' })
}

/** `tail`: only the last messages (see CodexChatThreadDetail.messagesFrom); merge with mergeThreadTail. */
export function getCodexChatThread(threadId: number, tail?: number, before?: number, signal?: AbortSignal) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}${tail ? `?tail=${tail}${before === undefined ? '' : `&before=${before}`}` : ''}`, { cache: 'no-store', signal })
}

/**
 * A tail fetch laid over the full copy: the copy's messages before the tail, then the tail. Null when the copy cannot
 * be trusted — the history was rewritten since (edits, regeneration, variants move the context revision) or messages
 * are missing between the two — and a fresh tail is needed.
 */
export function mergeThreadTail(full: CodexChatThreadDetail, tail: CodexChatThreadDetail): CodexChatThreadDetail | null {
  if (tail.messagesFrom === undefined) return tail
  if (full.thread.id !== tail.thread.id) return null
  if (full.thread.context_revision !== tail.thread.context_revision) {
    // Only this exact, single-message rewrite can safely retain the previous pages. Any intervening rewrite
    // requires a fresh history instead; the response carries the changed message even outside the tail.
    const changed = tail.changedMessage
    if (!changed || tail.previousContextRevision !== full.thread.context_revision
      || tail.thread.context_revision <= full.thread.context_revision) return null
    const outsideTail = changed.id < tail.messagesFrom && full.messages.some((message) => message.id === changed.id)
    full = { ...full, thread: { ...full.thread, context_revision: tail.thread.context_revision },
      messages: full.messages.map((message) => message.id === changed.id ? changed : message),
      historyLoaded: full.historyLoaded || outsideTail }
  }
  const from = tail.messagesFrom
  const combined = [...full.messages.filter((message) => message.id < from), ...tail.messages]
  const added = (tail.messageCount ?? tail.messages.length) - (full.messageCount ?? full.messages.length)
  if (added < 0 || combined.length !== full.messages.length + added) return null
  const messages = full.historyLoaded ? combined : combined.slice(-CHAT_MESSAGE_PAGE_SIZE)
  const partial = messages.length < (tail.messageCount ?? messages.length)
  return { ...tail, messages, media: { ...full.media, ...tail.media }, messagesFrom: partial ? messages[0]?.id : undefined, hasMoreBefore: partial, historyLoaded: full.historyLoaded }
}

/** Prepend a cursor page only to the exact active history it was requested for. */
export function mergeThreadBefore(current: CodexChatThreadDetail, page: CodexChatThreadDetail, before: number): CodexChatThreadDetail | null {
  if (current.thread.id !== page.thread.id || current.thread.context_revision !== page.thread.context_revision
    || current.messages[0]?.id !== before || page.messages.some((message) => message.id >= before)) return null
  const messages = [...page.messages, ...current.messages]
  return { ...current, messages, media: { ...page.media, ...current.media }, messagesFrom: page.hasMoreBefore ? messages[0]?.id : undefined, hasMoreBefore: page.hasMoreBefore, historyLoaded: current.historyLoaded || page.messages.length > 0 }
}

export function getCodexChatRunning(threadId: number) {
  return requestApiData<{ running: CodexChatThreadDetail['running']; latestMessageId: number | null }>(`/api/codex-chat/threads/${threadId}/running`, { cache: 'no-store' })
}

export function getCodexChatThreadMedia(threadId: number) {
  return requestApiData<CodexChatMediaItem[]>(`/api/codex-chat/threads/${threadId}/media`, { cache: 'no-store' })
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

/** A file store folder or text file linked to a chat or a profile; `write` lets its characters write there. */
export type LinkedFileLink = { id: string; write: boolean }

/** A link as the context tab and the profile editor show it. */
export interface LinkedFileView {
  id: string
  name: string
  kind: 'folder' | 'file' | null
  write: boolean
  via: 'thread' | 'profile'
  /** The folder it sits in, from the store root, and its id (null: the top). */
  path: string | null
  parentId: string | null
  /** Folders: items directly inside. */
  count: number | null
  size: number | null
  /** The profiles (a room: its members) whose links bring it. */
  profiles: Array<{ id: number; name: string }>
  /** Unavailable, not text, or in the lorebooks: requests skip it. */
  missing: boolean
}

export const threadLinkedFilesQueryKey = (threadId: number) => ['codex-chat-thread-linked-files', threadId] as const

/** The chat's own links, then those its profile (a room: every member) brings. */
export function getThreadLinkedFiles(threadId: number) {
  return requestApiData<LinkedFileView[]>(`/api/codex-chat/threads/${threadId}/linked-files`, { cache: 'no-store' })
}

/** Undo what one reply's tools did to a file: back to the version before it, or remove a file it made. */
export function undoChatFileChange(threadId: number, replyId: string, fileId: string) {
  return requestApiData<ChatFileChange>(`/api/codex-chat/threads/${threadId}/file-changes/undo`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ replyId, fileId }) })
}

/** Names and places of links in the shared file store (the profile editor). */
export function describeLinkedFiles(links: LinkedFileLink[]) {
  return requestApiData<LinkedFileView[]>('/api/codex-chat/linked-files/describe', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ links }) })
}

/** Save a save_lore proposal into the chat book (the server writes it). */
export function applyChatProposal(proposalId: number) {
  return requestApiData<{ proposal: unknown; book: OwnedChatLorebook | null }>(`/api/chat-proposals/${proposalId}/apply`, { method: 'POST' })
}

export function applyChatProfileFolderProposal(proposalId: number) {
  return requestApiData<Extract<ChatProposal, { kind: 'profile_folder' }>>(`/api/chat-proposals/${proposalId}/apply`, { method: 'POST' })
}

export function undoChatLoreProposal(proposalId: number, force = false, expectedHash?: string) {
  return requestApiData<{ proposal?: ChatProposal; book?: OwnedChatLorebook; changed?: boolean; currentHash?: string }>(`/api/chat-proposals/${proposalId}/undo`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ force, expectedHash }) })
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
export async function streamCodexChatMessage(threadId: number, text: string, onEvent: (event: CodexChatStreamEvent) => void, signal?: AbortSignal, fileIds: string[] = [], flagIds: number[] = [], picks: string[] = [], mediaHashes: string[] = [], replyToMessageId?: number, pageContext?: ChatPageSnapshot, choice?: ChatChoiceAnswer) {
  return streamChatOperation(`/api/codex-chat/threads/${threadId}/messages`, 'POST', { text, fileIds, flagIds, picks, mediaHashes, replyToMessageId, pageContext, choice }, onEvent, signal)
}

/**
 * An order from a character's reply (its bar), carried out on that reply: what it makes lands in it, no message is
 * added. Resolves once the job went through (its images may still be generating); rejects with the reason otherwise.
 */
export async function runChatOrder(threadId: number, messageId: number, kind: ChatOrderKind, signal?: AbortSignal) {
  let failure: string | null = null
  await streamChatOperation(`/api/codex-chat/threads/${threadId}/messages/${messageId}/order`, 'POST', { kind }, (event) => {
    if (event.type === 'error') failure = event.message
  }, signal)
  if (failure) throw new Error(failure)
}

export function checkChatPageProposal<T extends Extract<ChatProposal, { kind: 'page_fields' | 'workflow_graph' | 'page_action' }>>(proposal: T, undo = false) {
  return requestApiData<T>(`/api/chat-proposals/${proposal.id}/page-check`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ instanceId: proposal.page.instanceId, connectionId: proposal.page.connectionId, revision: proposal.kind !== 'page_fields' ? proposal.revision : undefined, undo }) })
}

export function acknowledgeChatPageProposal<T extends Extract<ChatProposal, { kind: 'page_fields' | 'workflow_graph' | 'page_action' }>>(proposal: T) {
  return requestApiData<T>(`/api/chat-proposals/${proposal.id}/page-applied`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ instanceId: proposal.page.instanceId, connectionId: proposal.page.connectionId, revision: proposal.kind !== 'page_fields' ? proposal.revision : undefined }) })
}

export const chatTaskQueryKey = (threadId: number | null) => ['codex-chat-task', threadId] as const

/** The chat's newest multi-step task, or null. */
export function getChatTask(threadId: number) {
  return requestApiData<ChatTask | null>(`/api/codex-chat/threads/${threadId}/task`)
}

export function setChatTaskState(threadId: number, action: 'pause' | 'resume' | 'cancel', extension?: { taskId: number; budget: ChatTask['budget'] }) {
  return requestApiData<ChatTask>(`/api/codex-chat/threads/${threadId}/task/${action}`, { method: 'POST', ...(extension ? { headers: JSON_HEADERS, body: JSON.stringify({ extension }) } : {}) })
}

/** Approve a task plan card; the server starts the task. */
export function approveChatTaskPlan(proposalId: number) {
  return requestApiData<unknown>(`/api/chat-proposals/${proposalId}/task-approve`, { method: 'POST' })
}

/** The connected tab's answer to a page operation the chat ran: the new screen, or why it could not run. */
export function answerChatPageCommand(commandId: string, answer: { ok: true; page: ChatPageSnapshot } | { ok: false; error: string }) {
  return requestApiData<void>(`/api/codex-chat/page-commands/${encodeURIComponent(commandId)}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(answer) })
}

/** Carry on a cut last reply (API LLM direct chats); the stream reads like a regeneration. */
export function streamChatContinue(threadId: number, messageId: number, onEvent: (event: CodexChatStreamEvent) => void, signal?: AbortSignal) {
  return streamChatOperation(`/api/codex-chat/threads/${threadId}/messages/${messageId}/continue`, 'POST', {}, onEvent, signal)
}

/** Rewrite a reply's text by hand, without regenerating (API LLM direct chats). */
export function editChatReplyText(threadId: number, messageId: number, content: string) {
  return requestApiData<CodexChatThreadDetail>(`/api/codex-chat/threads/${threadId}/messages/${messageId}/text?tail=${CHAT_MESSAGE_PAGE_SIZE}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ content }) })
}

/** A new chat holding this one up to the message (API LLM direct chats). */
export function branchCodexChatThread(threadId: number, messageId: number, purpose: ChatBranchPurpose = 'continue') {
  return requestApiData<CodexChatThread>(`/api/codex-chat/threads/${threadId}/messages/${messageId}/branch`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ purpose }) })
}

/** The owner has seen this chat up to `messageId`: replies up to it stop counting as unread. */
export function markCodexChatThreadRead(threadId: number, messageId: number) {
  return requestApiData<undefined>(`/api/codex-chat/threads/${threadId}/read`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ messageId }) })
}

/** Pin, archive, rename or (un)mute a chat from the chat list. */
export function updateChatListState(threadId: number, patch: { title?: string; pinned?: boolean; archived?: boolean; notify?: boolean }) {
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
    const payload = await response.json().catch(() => null) as { error?: string; code?: string; data?: unknown } | null
    throw new ApiRequestError(payload?.error || `Request failed: ${response.status}`, response.status, payload?.code, payload?.data)
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line) onEvent(JSON.parse(line) as CodexChatStreamEvent)
        newlineIndex = buffer.indexOf('\n')
      }
    }
    if (buffer.trim()) onEvent(JSON.parse(buffer.trim()) as CodexChatStreamEvent)
  } finally {
    // Cancellation can reject after a transport abort; keep the original parse/callback/transport error.
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

/** Existing app media attached by reference. */
export type ChatMediaAttachment = { compositeHash: string; name: string; mimeType: string | null }
