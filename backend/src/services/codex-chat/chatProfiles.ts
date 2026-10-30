import { CHAT_PROFILE_DEFAULTS, CHAT_PROFILE_LIMITS, CHAT_PROFILE_TEXT_LIMITS, CHAT_TRANSLATION_DEFAULTS, isChatTranslationLanguage, isCodexReasoningEffort, type ChatTranslationLanguage, type CodexReasoningEffort } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { CHAT_SCOPES, readLegacyCodexChatSettings, type ChatScope } from './chatSettings'
import { isClaudeReasoningEffort, isLlmReasoningEffort, parseLlmExtraParams, type LlmGenerationOptions } from '../llmGenerationOptions'
import { BACKGROUND_MAX_LENGTH, BACKGROUND_PATTERN, normalizeChatStyle, type ChatStyle } from './chatStyle'
import { ChatLorebookStore, normalizeLorebookIds } from './chatLorebook'
import { ChatSharedBlockStore, normalizeBlockIds } from './chatDisplayBlocks'
import { ChatProfileError, ChatRevisionConflict } from './chatProfileError'
import { AuthPermissionGroup } from '../../models/AuthPermissionGroup'
import { ChatGenerationPresetStore, normalizeGenerationPresetIds } from './chatGenerationPresets'
import { contentRatingTier, LLM_CONNECTION_TYPES, MODEL_CONNECTION_TYPES, ModelSlotStore } from './modelSlots'
import { ChatJudgePresetStore } from './chatJudgePresets'
import { normalizeLinkedFiles, type LinkedFileLink } from './chatLinkedFiles'
import { chatCharacterGroupPath, fileProfileAssetsUnderGroup, renameCharacterGroup, normalizeAvatarCrop, normalizeProfileAssetHash, type ChatAvatarCrop } from './chatProfileAssets'
import { keptGreetingPosition, normalizeGreetingPosition, normalizeOpeningHistory, TEXT_MAX_LENGTH, type ChatOpeningMessage } from './chatOpeningHistory'
import type { ChatProfileCharacterLink, ChatProfileCharacterLinkInput } from '@conai/shared'
import { CHARACTER_APPEARANCE_FIELDS, CHARACTER_PROFILE_COLUMNS, characterProfileDependencies, effectiveCharacterProfile, normalizeCharacterLink, detachedCharacterFields, storedCharacterStyle, type CharacterProfileRow } from './chatProfileCharacters'
import { characterChanged } from '../characterLibrary'
import { attachMainImagesDatabase } from '../../database/userSettingsBootstrap'
import { checkedProfileFolder } from './chatProfileFolders'
import { chatProfileFolderRankSql, chatProfileOrderSql, nextProfileSortOrder } from './chatProfileOrder'

const NAME_MAX_LENGTH = CHAT_PROFILE_TEXT_LIMITS.name
const MODEL_MAX_LENGTH = 200
const AVATAR_MAX_LENGTH = 300_000
const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/

// Ranges and defaults are shared with the editor and page assistants (@conai/shared chatLimits).
export { CHAT_PROFILE_LIMITS, CHAT_PROFILE_DEFAULTS, CHAT_PROFILE_TEXT_LIMITS }

export const AUTHOR_NOTE_MAX_LENGTH = CHAT_PROFILE_TEXT_LIMITS.authorNote
/** Text caps toColumns applies to the profile fields a chat may propose (the setup tools validate with the same numbers). */
const TRANSLATION_INSTRUCTIONS_MAX_LENGTH = CHAT_PROFILE_TEXT_LIMITS.translationInstructions
const PROFILE_SCALAR_TEXT_LIMITS: Record<string, number> = {
  name: CHAT_PROFILE_TEXT_LIMITS.name, tagline: CHAT_PROFILE_TEXT_LIMITS.tagline,
  agentDescription: CHAT_PROFILE_TEXT_LIMITS.agentDescription,
  systemPrompt: CHAT_PROFILE_TEXT_LIMITS.text, greeting: CHAT_PROFILE_TEXT_LIMITS.text,
  appearance: CHAT_PROFILE_TEXT_LIMITS.text, authorNote: CHAT_PROFILE_TEXT_LIMITS.authorNote,
  summaryPrompt: CHAT_PROFILE_TEXT_LIMITS.summaryPrompt, translationInstructions: CHAT_PROFILE_TEXT_LIMITS.translationInstructions,
}
const MAX_PROMPT_SECTIONS = CHAT_PROFILE_TEXT_LIMITS.sections
const SECTION_TITLE_MAX_LENGTH = CHAT_PROFILE_TEXT_LIMITS.sectionTitle
const PROFILE_FIELD_LABELS: Record<string, string> = {
  name: '프로필 이름', tagline: '한 줄 소개', systemPrompt: '시스템 프롬프트', greeting: '첫 인사',
  authorNote: '작가 노트', appearance: '외형', summaryPrompt: '요약 프롬프트', translationInstructions: '번역 지침',
  temperature: '온도', maxTokens: '최대 출력 토큰', contextTurns: '대화 문맥 턴 수', contextTokens: '최대 컨텍스트',
  summaryTriggerTurns: '요약 시작 턴 수', toolOutputLimit: '도구 출력 길이', loreRecursionDepth: '로어 재귀 깊이',
  loreScanDepth: '로어 검색 턴 수', loreTokenBudget: '로어 토큰 예산', loreDepth: '로어 삽입 깊이',
  reasoningBudgetTokens: '추론 토큰 예산', suggestProfileId: '추천 작성 프로필', suggestUserProfileId: '추천 사용자 프로필', sortOrder: '정렬 순서',
  summaryEnabled: '요약 사용', suggestEnabled: '답장 추천 사용', visionEnabled: '이미지 보기', allowLoreProposals: '로어 제안 허용',
  mcpEnabled: '도구 사용', pageAssist: '페이지 어시스턴트', isEnabled: '프로필 사용',
  agentEnabled: '에이전트로 사용', agentDescription: '에이전트 설명',
}

const LIST_FIELD_LABELS: Record<string, string> = { promptSections: '프롬프트 구역', alternateGreetings: '다른 인사', openingHistory: '시작 대화' }
const LIST_ITEM_FIELD_LABELS: Record<string, string> = { title: '제목', content: '내용', role: '역할' }

/** `promptSections[3].title` reads as "프롬프트 구역 4 제목", so the writer knows which entry to shorten. */
function fieldLabel(key: string) {
  if (PROFILE_FIELD_LABELS[key]) return PROFILE_FIELD_LABELS[key]
  const match = /^(\w+)(?:\[(\d+)\])?(?:\.(\w+))?$/.exec(key)
  const list = match && LIST_FIELD_LABELS[match[1]]
  if (!list) return key
  return [list, match[2] === undefined ? '' : String(Number(match[2]) + 1), match[3] ? LIST_ITEM_FIELD_LABELS[match[3]] ?? match[3] : ''].filter(Boolean).join(' ')
}

/**
 * A user-defined block of the prompt. `text` goes into the system prompt under its title; `dialogue` is example
 * conversation, sent as real user/assistant turns when its lines carry speaker labels.
 */
export type ChatPromptSection = {
  id: string
  title: string
  content: string
  /**
   * `text` joins the system prompt; `dialogue` becomes example turns; `post` goes after the latest message, where a
   * character card's post-history instructions belong.
   */
  kind: 'text' | 'dialogue' | 'post'
  enabled: boolean
}

export const DEFAULT_CHAT_SUMMARY_PROMPT = [
  '아래는 지금까지의 대화 요약과, 그 뒤에 이어진 대화야.',
  '두 내용을 합쳐서 이후 대화에 필요한 정보만 남긴 새 요약을 써줘.',
  '인물·관계·약속·설정·진행 중인 일·사용자의 선호, 그리고 이미지나 기록 ID처럼 다시 쓸 값은 빠뜨리지 마.',
  '요약만 출력하고 다른 말은 붙이지 마.',
].join('\n')

/** `llm`: an API LLM connection driven by CoNAI. `codex`: the server Codex CLI, which keeps its own context. */
export type ChatProfileEngine = 'llm' | 'codex' | 'claude'

/**
 * How an API LLM profile's chat replies run. `direct`: CoNAI builds every request and drives the tool rounds.
 * `pi`: the pi agent (piChatCompletion.ts) keeps the chat as a session on the same connection and model, and folds
 * its memory itself when the context fills, also in the middle of a long tool run.
 */
export type ChatLlmRuntime = 'direct' | 'pi'

/** Where a profile's content rating ceiling comes from: its model row's, or its own (`contentRatingTierId`). */
export type ChatContentRatingMode = 'model' | 'custom'

export type ChatProfile = {
  id: number
  folderId: number | null
  /** Opaque editor revision, including the synced character setting. */
  revision: string
  /** The omitted background image's own revision for editor merges. */
  backgroundRevision: number
  characterLink: ChatProfileCharacterLink | null
  /** Internal effective expression identity; the public link contract intentionally has no group id. */
  characterExpressionGroupId: number | null
  name: string
  tagline: string
  /** Shared lorebooks (chat_lorebooks) this profile uses, in priority order. */
  lorebookIds: number[]
  /** Shared display blocks (chat_display_blocks) this profile shows; resolved into `style.blocks` when read. */
  blockIds: number[]
  loreScanDepth: number
  loreTokenBudget: number
  /** API LLM: keyword lore goes this many turns before the end of the conversation. */
  loreDepth: number
  /** How many times chosen lore entries' text is scanned for further entries (0: off). */
  loreRecursionDepth: number
  /** Default author's note: scene direction every chat of this profile gets at `loreDepth` unless the chat sets its own. */
  authorNote: string
  /** Small data URL (resized in the browser). */
  avatar: string | null
  appearance: string
  referenceHash: string | null
  avatarHash: string | null
  avatarCrop: ChatAvatarCrop | null
  backgroundHash: string | null
  engine: ChatProfileEngine
  /** Codex / Claude Code: the engine's own model (empty: its default). API LLM profiles use `modelSlotId`. */
  model: string
  /** API LLM: how chat replies run (see ChatLlmRuntime); always `direct` for the other engines. */
  llmRuntime: ChatLlmRuntime
  /** Codex: the CLI effort. API LLM: none / low / medium / high (sent as reasoning_effort). Empty: not set. */
  reasoningEffort: CodexReasoningEffort | ''
  /** API LLM: reasoning token budget (reasoning_budget_tokens); null leaves it to the server. */
  reasoningBudgetTokens: number | null
  /** API LLM: extra request fields as a JSON object text (e.g. chat_template_kwargs); empty for none. */
  extraParams: string
  systemPrompt: string
  promptSections: ChatPromptSection[]
  /** Randomly selected with alternateGreetings and inserted at greetingPosition on chat creation/reset. */
  greeting: string
  alternateGreetings: string[]
  /** The opening of every new chat, saved as ordinary conversation messages. */
  openingHistory: ChatOpeningMessage[]
  /** How many openingHistory messages come before the greeting. */
  greetingPosition: number
  temperature: number | null
  maxTokens: number | null
  mcpEnabled: boolean
  /** Permission groups whose accounts may chat with this profile; empty means everyone with the engine's key. Administrators always may. */
  allowedGroupKeys: string[]
  mcpScopes: ChatScope[]
  /** General tools within the scopes; linked generation presets have their own explicit grant. */
  toolAllowlist: string[] | null
  /** Linking enables these generation tools; any linked withholds free-form generation. */
  generationPresetIds: number[]
  /** LLM: characters of one tool result the model sees within a reply. */
  toolOutputLimit: number
  /** LLM context: recent turns sent with each request, capped by the profile's context (profileContextTokens). */
  contextTurns: number
  /**
   * 최대 컨텍스트 of an API LLM profile (direct and pi): the context its requests fit in, the smaller of this and what
   * the server says it runs with. Null: the server's size, unknown when it does not say. Claude Code / Codex: unused.
   */
  contextTokens: number | null
  summaryEnabled: boolean
  /** Fold older turns into the summary once this many have left the window. */
  summaryTriggerTurns: number
  /** Empty uses DEFAULT_CHAT_SUMMARY_PROMPT. */
  summaryPrompt: string
  /**
   * Notes the translation model follows when it puts this profile's replies into the display language: the character's
   * voice, how it addresses the user, a glossary. `{{char}}` / `{{user}}` are filled. The user's messages are translated
   * without it.
   */
  translationInstructions: string
  /** With a translation model: the language the chat model reads and writes (the user's messages are translated into it). */
  translationModelLanguage: ChatTranslationLanguage
  /** With a translation model: the language the user writes and reads (the replies are translated into it). */
  translationDisplayLanguage: ChatTranslationLanguage
  /**
   * Reply suggestions: the composer's sparkle button asks a model for a few things the user might say next.
   * With no model of its own (`suggestSlotId`) it uses the chat's (a Codex profile: its Codex model, in a one-shot run).
   */
  suggestEnabled: boolean
  /**
   * Model rows (llm_model_slots, a connection's model) per role. Chat null: the default row. Summary / suggestions
   * null: the chat's model. Translation null: no translation (when set, user messages go to the chat model in its
   * language and replies are shown in the display language). A row that went missing reads as null. Codex profiles have no chat row.
   */
  modelSlotId: number | null
  summarySlotId: number | null
  translationSlotId: number | null
  suggestSlotId: number | null
  /**
   * A chat profile (another one, or this one) that writes the reply suggestions with its own model and prompt; it wins
   * over the suggest role's slot / connection. Null, or a profile that went missing or is off: the role applies.
   */
  suggestProfileId: number | null
  /**
   * Or a user profile that writes them with its own model and description (used only in that account's chats).
   * At most one of the two is set.
   */
  suggestUserProfileId: number | null
  /** LLM: the model can look at images (view_images results are sent to it). */
  visionEnabled: boolean
  /**
   * The ceiling on the rating of media the model is shown: its model row's (`model`), or `contentRatingTierId`
   * (`custom`). Codex / Claude Code profiles have no model row, so they always use their own.
   */
  contentRatingMode: ChatContentRatingMode
  /** Custom ceiling: the highest rating tier (rating_tiers.id) shown; null: no ceiling. */
  contentRatingTierId: number | null
  /** Page assistant: a direct chat with this profile can be connected to the current CoNAI page. */
  pageAssist: boolean
  /** The model may propose chat lorebook entries (save_lore) for the user to save. */
  allowLoreProposals: boolean
  agentEnabled: boolean
  agentDescription: string
  /** File store folders and text files its characters may open (and write, where `write`) in any chat of the owner. */
  linkedFiles: LinkedFileLink[]
  /**
   * The judge preset (chat_judge_presets) that steers each turn; null judges nothing (the chat behaves as without a
   * judge). A preset that went missing reads as null.
   */
  judgePresetId: number | null
  /** The judge model (a model row, TypeSafe or LLM) instead of the preset's own; null keeps the preset's. */
  judgeSlotId: number | null
  /** Typeface, roleplay colours, background dimming. */
  style: ChatStyle
  /** Chat background as a data URL; served on its own route, never inside profile lists. */
  background: string | null
  isEnabled: boolean
  sortOrder: number
  createdDate: string
  updatedDate: string
}

/**
 * The older way to name a role's model: a connection + model pair (empty model: the connection's primary model). Still
 * accepted from API callers, MCP and card import; saving lands it on that connection's model row (created if missing).
 */
export type LegacyModelPairs = {
  providerName?: string | null
  summaryProviderName?: string | null
  summaryModel?: string | null
  translationProviderName?: string | null
  translationModel?: string | null
  suggestProviderName?: string | null
  suggestModel?: string | null
  judgeProviderName?: string | null
  judgeModel?: string | null
}

export type ChatProfileInput = Partial<Omit<ChatProfile, 'id' | 'revision' | 'backgroundRevision' | 'createdDate' | 'updatedDate' | 'characterLink' | 'characterExpressionGroupId'>> & { characterLink?: ChatProfileCharacterLinkInput } & LegacyModelPairs

/** Each role's slot field and the legacy pair keys that stand for it. */
const LEGACY_PAIR_KEYS: Array<[keyof ChatProfileInput, keyof LegacyModelPairs, keyof ChatProfileInput]> = [
  ['modelSlotId', 'providerName', 'model'],
  ['summarySlotId', 'summaryProviderName', 'summaryModel'],
  ['translationSlotId', 'translationProviderName', 'translationModel'],
  ['suggestSlotId', 'suggestProviderName', 'suggestModel'],
  ['judgeSlotId', 'judgeProviderName', 'judgeModel'],
]

type ProfileRow = CharacterProfileRow & {
  id: number
  folder_id: number | null
  revision: number
  background_revision: number
  name: string
  tagline: string
  lorebook_ids: string | null
  block_ids: string | null
  lore_scan_depth: number
  lore_token_budget: number
  lore_depth: number | null
  lore_recursion_depth: number | null
  author_note: string | null
  avatar: string | null
  appearance: string | null
  reference_hash: string | null
  avatar_hash: string | null
  avatar_crop: string | null
  background_hash: string | null
  engine: string | null
  provider_name: string
  model: string | null
  llm_runtime: string | null
  reasoning_effort: string | null
  reasoning_budget_tokens: number | null
  extra_params: string | null
  system_prompt: string
  prompt_sections: string | null
  tool_allowlist: string | null
  tool_output_limit: number | null
  character_description: string
  example_dialogue: string
  user_persona: string
  greeting: string
  alternate_greetings: string | null
  opening_history: string | null
  greeting_position: number
  temperature: number | null
  max_tokens: number | null
  mcp_enabled: number
  mcp_scopes: string
  allowed_group_keys: string | null
  generation_preset_ids: string | null
  context_turns: number | null
  context_tokens: number | null
  summary_enabled: number | null
  summary_trigger_turns: number | null
  summary_prompt: string | null
  summary_provider_name: string | null
  summary_model: string | null
  translation_provider_name: string | null
  translation_model: string | null
  translation_instructions: string | null
  translation_model_language: string | null
  translation_display_language: string | null
  suggest_enabled: number | null
  suggest_provider_name: string | null
  suggest_model: string | null
  model_slot_id: number | null
  summary_slot_id: number | null
  translation_slot_id: number | null
  suggest_slot_id: number | null
  suggest_profile_id: number | null
  suggest_user_profile_id: number | null
  chat_style: string | null
  background_image: string | null
  vision_enabled: number | null
  content_rating_mode: string | null
  content_rating_tier_id: number | null
  page_assist: number | null
  allow_lore_proposals: number | null
  agent_enabled: number | null
  agent_description: string | null
  linked_files: string | null
  judge_preset_id: number | null
  judge_provider_name: string | null
  judge_model: string | null
  judge_slot_id: number | null
  is_enabled: number
  sort_order: number
  created_date: string
  updated_date: string
}

export { ChatProfileError }

function parseScopes(value: unknown): ChatScope[] {
  let list: unknown = value
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value)
    } catch {
      list = []
    }
  }
  return Array.isArray(list) ? CHAT_SCOPES.filter((scope) => list.includes(scope)) : []
}

function parseJsonArray(value: string | null): unknown[] | null {
  if (!value) {
    return null
  }
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function normalizeAlternateGreetings(value: unknown): string[] {
  return Array.isArray(value) ? value.slice(0, 100).filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, TEXT_MAX_LENGTH)).filter(Boolean) : []
}

/** The profile's non-empty greetings, the first greeting then the alternates. */
export function chatGreetings(profile: Pick<ChatProfile, 'greeting' | 'alternateGreetings'>): string[] {
  return [profile.greeting, ...profile.alternateGreetings].filter((greeting) => greeting.trim().length > 0)
}

export function normalizeSections(value: unknown): ChatPromptSection[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.slice(0, MAX_PROMPT_SECTIONS).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const title = text(record.title, SECTION_TITLE_MAX_LENGTH)
    const content = text(record.content, TEXT_MAX_LENGTH)
    if (!title && !content) return []
    const kind = record.kind === 'dialogue' || record.kind === 'post' ? record.kind : 'text' as const
    return [{
      id: text(record.id, 40) || `s${index}-${Date.now().toString(36)}`,
      title,
      content,
      kind,
      enabled: record.enabled !== false,
    }]
  })
}

/** Profiles made before free-form sections kept character / persona / example dialogue in fixed columns. */
function legacySections(row: ProfileRow): ChatPromptSection[] {
  const sections: Array<ChatPromptSection | null> = [
    row.character_description ? { id: 'legacy-character', title: `캐릭터: ${row.name}`, content: row.character_description, kind: 'text' as const, enabled: true } : null,
    row.user_persona ? { id: 'legacy-persona', title: '사용자', content: row.user_persona, kind: 'text' as const, enabled: true } : null,
    row.example_dialogue ? { id: 'legacy-dialogue', title: '대화 예시', content: row.example_dialogue, kind: 'dialogue' as const, enabled: true } : null,
  ]
  return sections.filter((section): section is ChatPromptSection => section !== null)
}

type ProfileListDependencies = {
  slots: Set<number>
  judges: Set<number>
  generationPresets: Set<number>
  blocks: Map<number, ChatStyle['blocks'][number]>
  characters: ReturnType<typeof characterProfileDependencies>
}

function toProfile(row: ProfileRow, dependencies?: ProfileListDependencies): ChatProfile {
  const storedSections = parseJsonArray(row.prompt_sections)
  const openingHistory = normalizeOpeningHistory(parseJsonArray(row.opening_history))
  const allowlist = parseJsonArray(row.tool_allowlist)
  const blockIds = normalizeBlockIds(row.block_ids)
  const slot = (id: number | null) => dependencies ? id !== null && dependencies.slots.has(id) ? id : null : ModelSlotStore.existing(id)
  const generationPresetIds = normalizeGenerationPresetIds(row.generation_preset_ids)
  const blocks = ChatSharedBlockStore.blocksOf(blockIds, dependencies?.blocks)
  let avatarCrop: ChatAvatarCrop | null = null
  try { avatarCrop = normalizeAvatarCrop(row.avatar_crop ? JSON.parse(row.avatar_crop) : null) } catch { /* Keep malformed legacy crops unset. */ }
  const profile: ChatProfile = {
    id: row.id,
    folderId: row.folder_id ?? null,
    revision: `${row.revision ?? 0}:${row.character_sync === 1 ? row.linked_revision ?? '' : ''}`,
    backgroundRevision: row.background_revision ?? 0,
    characterLink: null,
    characterExpressionGroupId: null,
    name: row.name,
    tagline: row.tagline ?? '',
    lorebookIds: normalizeLorebookIds(row.lorebook_ids),
    blockIds,
    loreScanDepth: row.lore_scan_depth ?? CHAT_PROFILE_DEFAULTS.loreScanDepth,
    loreTokenBudget: row.lore_token_budget ?? CHAT_PROFILE_DEFAULTS.loreTokenBudget,
    loreDepth: row.lore_depth ?? CHAT_PROFILE_DEFAULTS.loreDepth,
    loreRecursionDepth: row.lore_recursion_depth ?? CHAT_PROFILE_DEFAULTS.loreRecursionDepth,
    authorNote: row.author_note ?? '',
    avatar: row.avatar,
    appearance: row.appearance ?? '',
    referenceHash: row.reference_hash ?? null,
    avatarHash: row.avatar_hash ?? null,
    avatarCrop,
    backgroundHash: row.background_hash ?? null,
    engine: row.engine === 'codex' ? 'codex' : row.engine === 'claude' ? 'claude' : 'llm',
    model: row.engine === 'codex' || row.engine === 'claude' ? row.model ?? '' : '',
    llmRuntime: row.engine !== 'codex' && row.engine !== 'claude' && row.llm_runtime === 'pi' ? 'pi' : 'direct',
    reasoningEffort: isCodexReasoningEffort(row.reasoning_effort) ? row.reasoning_effort : '',
    reasoningBudgetTokens: row.reasoning_budget_tokens,
    extraParams: row.extra_params ?? '',
    systemPrompt: row.system_prompt,
    promptSections: storedSections ? normalizeSections(storedSections) : legacySections(row),
    greeting: row.greeting,
    alternateGreetings: normalizeAlternateGreetings(parseJsonArray(row.alternate_greetings)),
    openingHistory,
    greetingPosition: normalizeGreetingPosition(row.greeting_position, openingHistory.length),
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    mcpEnabled: row.mcp_enabled === 1,
    allowedGroupKeys: (parseJsonArray(row.allowed_group_keys) ?? []).filter((key): key is string => typeof key === 'string'),
    mcpScopes: parseScopes(row.mcp_scopes),
    toolAllowlist: allowlist ? allowlist.filter((name): name is string => typeof name === 'string') : null,
    toolOutputLimit: row.tool_output_limit ?? CHAT_PROFILE_DEFAULTS.toolOutputLimit,
    generationPresetIds: dependencies ? generationPresetIds.filter((id) => dependencies.generationPresets.has(id)) : ChatGenerationPresetStore.existing(generationPresetIds),
    contextTurns: row.context_turns ?? CHAT_PROFILE_DEFAULTS.contextTurns,
    contextTokens: row.context_tokens,
    summaryEnabled: row.summary_enabled === 1,
    summaryTriggerTurns: row.summary_trigger_turns ?? CHAT_PROFILE_DEFAULTS.summaryTriggerTurns,
    summaryPrompt: row.summary_prompt ?? '',
    translationInstructions: row.translation_instructions ?? '',
    translationModelLanguage: isChatTranslationLanguage(row.translation_model_language) ? row.translation_model_language : CHAT_TRANSLATION_DEFAULTS.modelLanguage,
    translationDisplayLanguage: isChatTranslationLanguage(row.translation_display_language) ? row.translation_display_language : CHAT_TRANSLATION_DEFAULTS.displayLanguage,
    suggestEnabled: row.suggest_enabled === 1,
    // A row that no longer exists reads as unset (the next save clears the column).
    modelSlotId: slot(row.model_slot_id),
    summarySlotId: slot(row.summary_slot_id),
    translationSlotId: slot(row.translation_slot_id),
    suggestSlotId: slot(row.suggest_slot_id),
    suggestProfileId: row.suggest_profile_id,
    suggestUserProfileId: row.suggest_profile_id === null ? row.suggest_user_profile_id : null,
    visionEnabled: row.vision_enabled === 1,
    contentRatingMode: row.engine !== 'codex' && row.engine !== 'claude' && row.content_rating_mode !== 'custom' ? 'model' : 'custom',
    contentRatingTierId: row.content_rating_tier_id ?? null,
    pageAssist: row.page_assist === 1,
    allowLoreProposals: row.allow_lore_proposals !== 0,
    agentEnabled: row.agent_enabled === 1,
    agentDescription: row.agent_description ?? '',
    linkedFiles: normalizeLinkedFiles(row.linked_files),
    judgePresetId: dependencies ? row.judge_preset_id !== null && dependencies.judges.has(row.judge_preset_id) ? row.judge_preset_id : null : ChatJudgePresetStore.existing(row.judge_preset_id),
    judgeSlotId: slot(row.judge_slot_id),
    // Display blocks live in chat_display_blocks; the profile only links them (the style column's own list is legacy).
    style: { ...normalizeChatStyle(row.chat_style), blocks },
    background: row.background_image,
    isEnabled: row.is_enabled === 1,
    sortOrder: row.sort_order,
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
  return effectiveCharacterProfile(profile, row, dependencies?.characters)
}

function text(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export function validateProfileText(label: string, value: unknown, maxLength: number, options: { required?: boolean } = {}) {
  label = fieldLabel(label)
  if (typeof value !== 'string') throw new ChatProfileError(`${label}에는 글자를 입력해줘.`)
  const trimmed = value.trim()
  if (options.required && !trimmed) throw new ChatProfileError(`${label}: 비워 둘 수 없어.`)
  if (trimmed.length > maxLength) throw new ChatProfileError(`${label}: 최대 ${maxLength}자까지 쓸 수 있어. (현재 ${trimmed.length}자)`)
  return trimmed
}

export function validateProfileFlag(label: string, value: unknown) {
  if (typeof value !== 'boolean') throw new ChatProfileError(`${fieldLabel(label)} 값은 참 또는 거짓이어야 해.`)
  return value
}

export function validateProfileNumber(label: string, value: unknown, range: { min: number; max: number }, options: { integer?: boolean; nullable?: boolean } = {}) {
  label = fieldLabel(label)
  if (value === null || value === '') {
    if (options.nullable) return null
    throw new ChatProfileError(`${label}에 숫자를 입력해줘. (${range.min}~${range.max})`)
  }
  const number = Number(value)
  if ((typeof value !== 'number' && typeof value !== 'string') || !Number.isFinite(number)) throw new ChatProfileError(`${label}에 숫자를 입력해줘. (${range.min}~${range.max})`)
  const clamped = Math.min(range.max, Math.max(range.min, number))
  return options.integer === false ? clamped : Math.round(clamped)
}

/** Shared scalar write contract; legacy row reads deliberately remain tolerant. */
export function normalizeProfileScalarField(key: string, value: unknown): unknown {
  if (Object.prototype.hasOwnProperty.call(CHAT_PROFILE_LIMITS, key)) {
    return validateProfileNumber(key, value, CHAT_PROFILE_LIMITS[key as keyof typeof CHAT_PROFILE_LIMITS], {
      integer: key !== 'temperature', nullable: ['temperature', 'maxTokens', 'contextTokens'].includes(key),
    })
  }
  if (['summaryEnabled', 'suggestEnabled', 'visionEnabled', 'allowLoreProposals', 'agentEnabled', 'mcpEnabled', 'pageAssist', 'isEnabled'].includes(key)) return validateProfileFlag(key, value)
  if (Object.prototype.hasOwnProperty.call(PROFILE_SCALAR_TEXT_LIMITS, key)) return validateProfileText(key, value, PROFILE_SCALAR_TEXT_LIMITS[key], { required: key === 'name' })
  return value
}

/**
 * Whether the profile's model sees images: Codex models always do (its editor has no switch, so a stored
 * `visionEnabled` there is only left over from another engine); LLM and Claude follow the profile's switch.
 */
export function profileSeesImages(profile: Pick<ChatProfile, 'engine' | 'visionEnabled'>) {
  return profile.engine === 'codex' || profile.visionEnabled
}

/**
 * Which agent keeps a profile's chat as a session of its own (claudeChatSessions.ts): Claude Code profiles, and API
 * LLM profiles that run through pi. Null: CoNAI sends the conversation itself (or Codex keeps its thread).
 */
export function sessionRuntimeOf(profile: Pick<ChatProfile, 'engine' | 'llmRuntime'>): 'claude' | 'pi' | null {
  if (profile.engine === 'claude') return 'claude'
  return profile.engine === 'llm' && profile.llmRuntime === 'pi' ? 'pi' : null
}

/** Tools that answer with pictures: offered only to a profile whose model sees images (profileSeesImages). */
const VISION_TOOLS = new Set(['view_images', 'view_media_frames'])

export function isVisionTool(toolName: string) {
  return VISION_TOOLS.has(toolName)
}

/** What an API LLM profile asks of each request (unset options are not sent). */
export function profileGenerationOptions(profile: ChatProfile): LlmGenerationOptions {
  let extraParams: Record<string, unknown> | null = null
  try {
    extraParams = parseLlmExtraParams(profile.extraParams)
  } catch {
    extraParams = null
  }
  return {
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    reasoningEffort: isLlmReasoningEffort(profile.reasoningEffort) || (profile.engine === 'claude' && isClaudeReasoningEffort(profile.reasoningEffort)) ? profile.reasoningEffort : null,
    reasoningBudgetTokens: profile.reasoningBudgetTokens,
    extraParams,
  }
}

/** The summary prompt a profile actually uses: its own, else the summary representative model's default prompt, else the built-in one. */
export function resolveSummaryPrompt(profile: ChatProfile) {
  return profile.summaryPrompt.trim() || ModelSlotStore.routePrompt('summary') || DEFAULT_CHAT_SUMMARY_PROMPT
}

/** Validate a full profile (create) or a merged update, returning the column values. */
/** Groups that can be named: custom groups and admin. Guest and anonymous would mean everyone, the same as an empty list. */
function normalizeAllowedGroupKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return []
  const known = new Set(AuthPermissionGroup.listAllGroups().map((group) => group.group_key).filter((key) => key !== 'guest' && key !== 'anonymous'))
  return [...new Set(value.filter((key): key is string => typeof key === 'string' && known.has(key)))]
}

function judgePresetId(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const id = ChatJudgePresetStore.existing(Number(value))
  if (id === null) throw new ChatProfileError('판단 프리셋을 찾을 수 없어.')
  return id
}

/** `draft`: a preview of an unsaved profile, which must not create model rows for legacy pairs. */
function toColumns(input: ChatProfileInput, options: { draft?: boolean; strictKeys?: Set<string> } = {}) {
  const strict = (key: string) => !options.strictKeys || options.strictKeys.has(key)
  input = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === undefined || !strict(key) ? value : normalizeProfileScalarField(key, value)])) as ChatProfileInput
  const optionalNumber = (key: keyof ChatProfileInput, range: { min: number; max: number }, integer: boolean) => {
    const value = input[key]
    if (value === undefined) return null
    if (!strict(key)) {
      const number = Number(value)
      if (value === null || value === '' || !Number.isFinite(number)) return null
      const clamped = Math.min(range.max, Math.max(range.min, number))
      return integer ? Math.round(clamped) : clamped
    }
    return validateProfileNumber(key, value, range, { integer, nullable: true })
  }
  const name = text(input.name, NAME_MAX_LENGTH)
  if (!name) {
    throw new ChatProfileError('프로필 이름이 필요해.')
  }
  const engine: ChatProfileEngine = input.engine === 'codex' ? 'codex' : input.engine === 'claude' ? 'claude' : 'llm'
  // A role's row: its id, or a legacy connection + model pair, which lands on that connection's row.
  const pending: Array<{ column: string; providerName: string; model: unknown; kinds: readonly string[] }> = []
  const roleSlot = (column: string, slotId: unknown, providerName: unknown, model: unknown, kinds: readonly string[] = LLM_CONNECTION_TYPES) => {
    const slotKey = column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    const providerKey = column === 'model_slot_id' ? 'providerName' : `${column.replace('_slot_id', '')}ProviderName`
    if (!strict(slotKey) && !strict(providerKey) && !strict('engine')) return ModelSlotStore.existing(slotId)
    if (slotId !== null && slotId !== undefined && slotId !== '') return ModelSlotStore.checked(slotId, kinds)
    if (typeof providerName !== 'string' || !providerName.trim()) return null
    const id = ModelSlotStore.ensure(providerName, model, { create: false, kinds })
    if (id === null) pending.push({ column, providerName, model, kinds })
    return id === null ? null : ModelSlotStore.checked(id, kinds)
  }
  // Codex has no connection, so no chat row; its helper roles (summary, translation, suggestions) still use rows.
  const modelSlotId = engine === 'llm' ? roleSlot('model_slot_id', input.modelSlotId, input.providerName, input.model) : null
  if (engine === 'llm' && modelSlotId === null && !pending.some((pair) => pair.column === 'model_slot_id') && !ModelSlotStore.defaultTarget()
    && ['engine', 'modelSlotId', 'providerName', 'model'].some(strict)) {
    throw new ChatProfileError('모델을 골라줘. 설정 › LLM에서 연결에 모델을 먼저 추가해야 해.')
  }
  const avatar = typeof input.avatar === 'string' && input.avatar ? input.avatar : null
  if (strict('avatar') && avatar && (avatar.length > AVATAR_MAX_LENGTH || !AVATAR_PATTERN.test(avatar))) {
    throw new ChatProfileError('아바타 이미지가 올바르지 않거나 너무 커.')
  }
  const background = typeof input.background === 'string' && input.background ? input.background : null
  if (strict('background') && background && (background.length > BACKGROUND_MAX_LENGTH || !BACKGROUND_PATTERN.test(background))) {
    throw new ChatProfileError('배경 이미지가 올바르지 않거나 너무 커.')
  }
  if (strict('reasoningEffort') && input.reasoningEffort && (engine === 'codex' ? !isCodexReasoningEffort(input.reasoningEffort) : engine === 'claude' ? !isClaudeReasoningEffort(input.reasoningEffort) : !isLlmReasoningEffort(input.reasoningEffort))) {
    throw new ChatProfileError('추론 강도 값이 올바르지 않아.')
  }
  let extraParams = ''
  if (engine === 'llm' && typeof input.extraParams === 'string' && input.extraParams.trim()) {
    if (strict('extraParams')) validateProfileText('추가 파라미터 JSON', input.extraParams, CHAT_PROFILE_TEXT_LIMITS.extraParams)
    if (strict('extraParams')) try {
      parseLlmExtraParams(input.extraParams)
    } catch (error) {
      throw new ChatProfileError(error instanceof Error ? error.message : '추가 파라미터가 올바르지 않아.')
    }
    extraParams = input.extraParams.trim()
  }

  const openingHistory = normalizeOpeningHistory(input.openingHistory)
  const characterLink = normalizeCharacterLink(input.characterLink)
  const columns = {
    name,
    folder_id: checkedProfileFolder(input.folderId),
    character_setting_id: characterLink?.settingId ?? null,
    character_sync: characterLink?.synced ? 1 : 0,
    tagline: text(input.tagline, CHAT_PROFILE_TEXT_LIMITS.tagline),
    lorebook_ids: JSON.stringify(ChatLorebookStore.existing(normalizeLorebookIds(input.lorebookIds))),
    block_ids: JSON.stringify(ChatSharedBlockStore.existing(normalizeBlockIds(input.blockIds))),
    lore_scan_depth: optionalNumber('loreScanDepth', CHAT_PROFILE_LIMITS.loreScanDepth, true) ?? CHAT_PROFILE_DEFAULTS.loreScanDepth,
    lore_token_budget: optionalNumber('loreTokenBudget', CHAT_PROFILE_LIMITS.loreTokenBudget, true) ?? CHAT_PROFILE_DEFAULTS.loreTokenBudget,
    lore_depth: optionalNumber('loreDepth', CHAT_PROFILE_LIMITS.loreDepth, true) ?? CHAT_PROFILE_DEFAULTS.loreDepth,
    lore_recursion_depth: optionalNumber('loreRecursionDepth', CHAT_PROFILE_LIMITS.loreRecursionDepth, true) ?? CHAT_PROFILE_DEFAULTS.loreRecursionDepth,
    author_note: text(input.authorNote, AUTHOR_NOTE_MAX_LENGTH) || null,
    avatar,
    appearance: text(input.appearance, TEXT_MAX_LENGTH) || null,
    reference_hash: strict('referenceHash') ? normalizeProfileAssetHash(input.referenceHash) : input.referenceHash ?? null,
    avatar_hash: strict('avatarHash') ? normalizeProfileAssetHash(input.avatarHash) : input.avatarHash ?? null,
    avatar_crop: input.avatarCrop == null ? null : JSON.stringify(normalizeAvatarCrop(input.avatarCrop)),
    background_hash: strict('backgroundHash') ? normalizeProfileAssetHash(input.backgroundHash) : input.backgroundHash ?? null,
    engine,
    // The pair columns are the older form of the model rows (see LegacyModelPairs); a save clears them.
    provider_name: '',
    model: engine === 'llm' ? null : text(input.model, MODEL_MAX_LENGTH) || null,
    llm_runtime: engine === 'llm' && input.llmRuntime === 'pi' ? 'pi' : null,
    reasoning_effort: input.reasoningEffort || null,
    reasoning_budget_tokens: engine === 'llm' ? optionalNumber('reasoningBudgetTokens', CHAT_PROFILE_LIMITS.maxTokens, true) : null,
    extra_params: extraParams || null,
    system_prompt: text(input.systemPrompt, TEXT_MAX_LENGTH),
    prompt_sections: JSON.stringify(normalizeSections(input.promptSections ?? [])),
    // The fixed columns are superseded by prompt_sections; cleared so an old row is not read as legacy again.
    character_description: '',
    example_dialogue: '',
    user_persona: '',
    greeting: text(input.greeting, TEXT_MAX_LENGTH),
    alternate_greetings: JSON.stringify(normalizeAlternateGreetings(input.alternateGreetings)),
    opening_history: JSON.stringify(openingHistory),
    greeting_position: keptGreetingPosition(input.openingHistory, input.greetingPosition),
    temperature: optionalNumber('temperature', CHAT_PROFILE_LIMITS.temperature, false),
    max_tokens: optionalNumber('maxTokens', CHAT_PROFILE_LIMITS.maxTokens, true),
    mcp_enabled: input.mcpEnabled ? 1 : 0,
    allowed_group_keys: JSON.stringify(normalizeAllowedGroupKeys(input.allowedGroupKeys)),
    mcp_scopes: JSON.stringify(parseScopes(input.mcpScopes ?? ['read'])),
    tool_allowlist: Array.isArray(input.toolAllowlist)
      ? JSON.stringify([...new Set(input.toolAllowlist.filter((name): name is string => typeof name === 'string' && /^[a-z0-9_]{1,64}$/.test(name)))])
      : null,
    tool_output_limit: optionalNumber('toolOutputLimit', CHAT_PROFILE_LIMITS.toolOutputLimit, true) ?? CHAT_PROFILE_DEFAULTS.toolOutputLimit,
    generation_preset_ids: JSON.stringify(ChatGenerationPresetStore.existing(normalizeGenerationPresetIds(input.generationPresetIds))),
    context_turns: optionalNumber('contextTurns', CHAT_PROFILE_LIMITS.contextTurns, true) ?? CHAT_PROFILE_DEFAULTS.contextTurns,
    context_tokens: optionalNumber('contextTokens', CHAT_PROFILE_LIMITS.contextTokens, true),
    summary_enabled: input.summaryEnabled ? 1 : 0,
    summary_trigger_turns: optionalNumber('summaryTriggerTurns', CHAT_PROFILE_LIMITS.summaryTriggerTurns, true) ?? CHAT_PROFILE_DEFAULTS.summaryTriggerTurns,
    summary_prompt: text(input.summaryPrompt, CHAT_PROFILE_TEXT_LIMITS.summaryPrompt),
    summary_provider_name: null,
    summary_model: null,
    translation_provider_name: null,
    translation_model: null,
    translation_instructions: text(input.translationInstructions, TRANSLATION_INSTRUCTIONS_MAX_LENGTH) || null,
    translation_model_language: isChatTranslationLanguage(input.translationModelLanguage) ? input.translationModelLanguage : null,
    translation_display_language: isChatTranslationLanguage(input.translationDisplayLanguage) ? input.translationDisplayLanguage : null,
    suggest_enabled: input.suggestEnabled ? 1 : 0,
    suggest_provider_name: null,
    suggest_model: null,
    model_slot_id: modelSlotId,
    summary_slot_id: roleSlot('summary_slot_id', input.summarySlotId, input.summaryProviderName, input.summaryModel),
    translation_slot_id: roleSlot('translation_slot_id', input.translationSlotId, input.translationProviderName, input.translationModel),
    suggest_slot_id: roleSlot('suggest_slot_id', input.suggestSlotId, input.suggestProviderName, input.suggestModel),
    suggest_profile_id: optionalNumber('suggestProfileId', { min: 1, max: Number.MAX_SAFE_INTEGER }, true),
    suggest_user_profile_id: input.suggestProfileId ? null : optionalNumber('suggestUserProfileId', { min: 1, max: Number.MAX_SAFE_INTEGER }, true),
    vision_enabled: input.visionEnabled ? 1 : 0,
    content_rating_mode: engine === 'llm' && input.contentRatingMode !== 'custom' ? 'model' : 'custom',
    content_rating_tier_id: strict('contentRatingTierId') ? contentRatingTier(input.contentRatingTierId ?? null) : input.contentRatingTierId ?? null,
    page_assist: input.pageAssist ? 1 : 0,
    allow_lore_proposals: input.allowLoreProposals === false ? 0 : 1,
    agent_enabled: input.agentEnabled === true ? 1 : 0,
    agent_description: input.agentDescription ?? '',
    linked_files: JSON.stringify(normalizeLinkedFiles(input.linkedFiles)),
    // Every engine can be judged (a Codex chat gets the directives and status fields only, see chatJudge).
    judge_preset_id: strict('judgePresetId') ? judgePresetId(input.judgePresetId) : input.judgePresetId ?? null,
    judge_provider_name: null,
    judge_model: null,
    judge_slot_id: roleSlot('judge_slot_id', input.judgeSlotId, input.judgeProviderName, input.judgeModel, MODEL_CONNECTION_TYPES),
    chat_style: JSON.stringify({ ...normalizeChatStyle(input.style), blocks: [] }),
    background_image: background,
    is_enabled: input.isEnabled === false ? 0 : 1,
    sort_order: optionalNumber('sortOrder', { min: -1_000_000, max: 1_000_000 }, true) ?? 0,
  }
  // All input is valid before the first model insert. The caller's transaction owns rows and profile together.
  if (!options.draft) for (const pair of pending) {
    (columns as Record<string, unknown>)[pair.column] = ModelSlotStore.ensure(pair.providerName, pair.model, { kinds: pair.kinds })
  }
  return columns
}

const ADMIN_PROFILE_COLUMNS = `id, folder_id, revision, background_revision, name, tagline, lorebook_ids, block_ids, lore_scan_depth, lore_token_budget,
  lore_depth, lore_recursion_depth, author_note, avatar, appearance, reference_hash, avatar_hash, avatar_crop,
  background_hash, engine, model, llm_runtime, reasoning_effort, reasoning_budget_tokens, extra_params, system_prompt,
  prompt_sections, tool_allowlist, tool_output_limit, character_description, example_dialogue, user_persona, greeting,
  alternate_greetings, opening_history, greeting_position, temperature, max_tokens, mcp_enabled, mcp_scopes,
  allowed_group_keys, generation_preset_ids, context_turns, context_tokens, summary_enabled, summary_trigger_turns,
  summary_prompt, translation_instructions, translation_model_language, translation_display_language, suggest_enabled,
  model_slot_id, summary_slot_id, translation_slot_id, suggest_slot_id, suggest_profile_id, suggest_user_profile_id,
  chat_style, vision_enabled, content_rating_mode, content_rating_tier_id, page_assist, allow_lore_proposals,
  agent_enabled, agent_description, linked_files, judge_preset_id, judge_slot_id, is_enabled, sort_order, created_date, updated_date,
  CASE WHEN background_image IS NOT NULL AND background_image != '' THEN 'present' ELSE NULL END AS background_image`

export const ChatProfileStore = {
  /** Agent discovery needs no prompts, assets, model slots or display blocks. */
  listAgents() {
    const rows = getUserSettingsDb().prepare(`SELECT id, name, agent_description, engine, allowed_group_keys
      FROM llm_chat_profiles WHERE is_enabled = 1 AND agent_enabled = 1 ORDER BY ${chatProfileOrderSql()}`).all() as
      Array<Pick<ProfileRow, 'id' | 'name' | 'agent_description' | 'engine' | 'allowed_group_keys'>>
    return rows.map(row => ({ id: row.id, name: row.name, agentDescription: row.agent_description ?? '',
      engine: (row.engine === 'codex' || row.engine === 'claude' ? row.engine : 'llm') as ChatProfileEngine,
      allowedGroupKeys: (parseJsonArray(row.allowed_group_keys) ?? []).filter((key): key is string => typeof key === 'string') }))
  },

  /** Read just the caller's tool configuration for delegation admission. */
  findToolGrant(profileId: number) {
    const row = getUserSettingsDb().prepare(`SELECT mcp_enabled, mcp_scopes, tool_allowlist, generation_preset_ids
      FROM llm_chat_profiles WHERE id = ? AND is_enabled = 1`).get(profileId) as
      Pick<ProfileRow, 'mcp_enabled' | 'mcp_scopes' | 'tool_allowlist' | 'generation_preset_ids'> | undefined
    if (!row) return null
    const allowlist = parseJsonArray(row.tool_allowlist)
    return { mcpEnabled: row.mcp_enabled === 1, mcpScopes: parseScopes(row.mcp_scopes),
      toolAllowlist: allowlist ? allowlist.filter((name): name is string => typeof name === 'string') : null,
      generationPresetIds: ChatGenerationPresetStore.existing(normalizeGenerationPresetIds(row.generation_preset_ids)) }
  },

  /**
   * A profile as it would be saved, without saving it (prompt preview of an unsaved draft). Only a linked draft reads
   * its setting; a caller previewing a stored profile passes the stored link when the draft keeps it.
   */
  draft(input: ChatProfileInput, profileId = 0): ChatProfile {
    const now = new Date().toISOString()
    const columns = toColumns(input, { draft: true })
    const linked = columns.character_setting_id === null ? {} : getUserSettingsDb().prepare(`SELECT ${CHARACTER_PROFILE_COLUMNS} FROM character_settings s WHERE s.id = ?`).get(columns.character_setting_id) as CharacterProfileRow
    return toProfile({ ...columns, ...linked, id: profileId, created_date: now, updated_date: now } as ProfileRow)
  },

  /** Name-only directory callers must not hydrate prompts, model roles, presets or blocks. */
  listNames(options: { enabledOnly?: boolean; ids?: number[] } = {}) {
    if (options.ids?.length === 0) return []
    const ids = options.ids ? [...new Set(options.ids)] : undefined
    const where = [
      ...(options.enabledOnly ? ['is_enabled = 1'] : []),
      ...(ids ? [`id IN (${ids.map(() => '?').join(', ')})`] : []),
    ]
    return getUserSettingsDb().prepare(`SELECT id, name FROM llm_chat_profiles ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${chatProfileOrderSql()}`)
      .all(...ids ?? []) as Array<Pick<ChatProfile, 'id' | 'name'>>
  },

  list(options: { enabledOnly?: boolean; directory?: boolean; admin?: boolean; folderId?: number | null; query?: string; limit?: number; offset?: number } = {}): ChatProfile[] {
    const db = getUserSettingsDb()
    // The public directory never sends prompts, greetings, linked-file contents or inline images.
    // Presence sentinels retain the legacy asset URLs without hydrating the base64 payloads.
    const projection = options.directory ? `id, folder_id, revision, background_revision, name, tagline, engine, model, llm_runtime, model_slot_id, summary_slot_id,
      translation_slot_id, suggest_slot_id, suggest_profile_id, suggest_user_profile_id, suggest_enabled,
      reasoning_effort, reasoning_budget_tokens, temperature, max_tokens, context_turns, context_tokens, summary_enabled,
      lore_depth, author_note, appearance, avatar_hash, avatar_crop, background_hash, reference_hash, chat_style, block_ids,
      mcp_enabled, mcp_scopes, tool_allowlist, allowed_group_keys, generation_preset_ids, allow_lore_proposals, agent_enabled, agent_description, page_assist, is_enabled, sort_order, created_date, updated_date,
      CASE WHEN avatar IS NOT NULL AND avatar != '' THEN 'present' ELSE NULL END AS avatar,
      CASE WHEN background_image IS NOT NULL AND background_image != '' THEN 'present' ELSE NULL END AS background_image` : options.admin ? ADMIN_PROFILE_COLUMNS : '*'
    const where = [options.enabledOnly ? 'is_enabled = 1' : '', options.folderId !== undefined ? 'folder_id IS @folderId' : '', options.query ? 'instr(lower(name), lower(@query)) > 0' : ''].filter(Boolean)
    const rank = options.folderId === undefined ? chatProfileFolderRankSql() : '0'
    const order = options.folderId === undefined ? 'profile_folder_rank, sort_order, id' : 'sort_order, id'
    const rows = db.prepare(`
      SELECT p.*, ${CHARACTER_PROFILE_COLUMNS} FROM
        (SELECT ${projection}${projection === '*' ? '' : ', character_setting_id, character_sync'}, ${rank} AS profile_folder_rank FROM llm_chat_profiles ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY ${order} ${options.limit !== undefined ? 'LIMIT @limit OFFSET @offset' : ''}) p
        LEFT JOIN character_settings s ON s.id = p.character_setting_id ORDER BY p.profile_folder_rank, p.sort_order, p.id
    `).all({ folderId: options.folderId ?? null, query: options.query ?? '', limit: options.limit ?? -1, offset: options.offset ?? 0 }) as ProfileRow[]
    if (!rows.length) return []
    const slots = new Set(ModelSlotStore.existingIds(rows.flatMap((row) =>
      [row.model_slot_id, row.summary_slot_id, row.translation_slot_id, row.suggest_slot_id, row.judge_slot_id].filter((id): id is number => id !== null))))
    const judgeIds = [...new Set(rows.flatMap((row) => row.judge_preset_id ? [row.judge_preset_id] : []))]
    const judges = new Set(ChatJudgePresetStore.existingIds(judgeIds))
    const generationPresets = new Set(ChatGenerationPresetStore.existing([...new Set(rows.flatMap((row) => normalizeGenerationPresetIds(row.generation_preset_ids)))]))
    const blockIds = new Set(rows.flatMap((row) => normalizeBlockIds(row.block_ids)))
    const blocks = ChatSharedBlockStore.byIds([...blockIds])
    const dependencies = { slots, judges, generationPresets, blocks, characters: characterProfileDependencies(rows) }
    return rows.map((row) => toProfile(row, dependencies))
  },

  /** Synchronous response serialization; never changes the meaning of find(). */
  mapDirectory<T>(serialize: (profile: ChatProfile) => T, profiles: ChatProfile[] = ChatProfileStore.list({ directory: true })): T[] {
    return ModelSlotStore.withReadSnapshot(() => profiles.map(serialize))
  },

  /** Workflow picker still exposes its legacy avatar field, but never loads prompts or backgrounds. */
  workflowOptions() {
    const rows = getUserSettingsDb().prepare(`SELECT p.id, p.name, CASE WHEN p.character_sync = 1 AND s.id IS NOT NULL THEN NULL ELSE p.avatar END AS avatar, p.model_slot_id, p.is_enabled
      FROM llm_chat_profiles p LEFT JOIN character_settings s ON s.id = p.character_setting_id
      WHERE p.engine IS NULL OR p.engine NOT IN ('codex', 'claude') ORDER BY ${chatProfileOrderSql('p.')}`).all() as Array<{ id: number; name: string; avatar: string | null; model_slot_id: number | null; is_enabled: number }>
    return ModelSlotStore.withReadSnapshot(() => rows.map((row) => {
      const target = ModelSlotStore.target(row.model_slot_id) ?? ModelSlotStore.defaultTarget()
      return { id: row.id, name: row.name, avatar: row.avatar, provider_name: target?.providerName ?? '', model: target?.model || null, is_enabled: row.is_enabled === 1 }
    }))
  },

  find(profileId: number): ChatProfile | null {
    const row = getUserSettingsDb().prepare(`SELECT p.*, ${CHARACTER_PROFILE_COLUMNS} FROM llm_chat_profiles p LEFT JOIN character_settings s ON s.id = p.character_setting_id WHERE p.id = ?`).get(profileId) as ProfileRow | undefined
    return row ? toProfile(row) : null
  },

  create(input: ChatProfileInput, copyOf?: ChatProfile): ChatProfile {
    const db = getUserSettingsDb(), nested = db.inTransaction
    const result = db.transaction(() => {
    const link = normalizeCharacterLink(input.characterLink)
    const initial = { ...input }
    if (link?.synced) for (const key of CHARACTER_APPEARANCE_FIELDS) delete initial[key]
    if (link?.synced && initial.style !== undefined) initial.style = storedCharacterStyle(input.name ?? '', normalizeChatStyle(undefined), initial.style, null, link, db)
    if (link && !link.synced && !copyOf) {
      attachMainImagesDatabase(db)
      Object.assign(initial, detachedCharacterFields(link.settingId, { name: input.name ?? '', style: normalizeChatStyle(input.style) }, input, db))
    }
    const columns = toColumns(initial)
    fileProfileAssetsUnderGroup(columns.name, [columns.avatar_hash, columns.background_hash, columns.reference_hash], link && !link.synced && !copyOf ? db : undefined)
    const names = Object.keys(columns)
    const result = getUserSettingsDb().prepare(`
      INSERT INTO llm_chat_profiles (${names.join(', ')}) VALUES (${names.map((name) => `@${name}`).join(', ')})
    `).run(columns)
    return ChatProfileStore.find(Number(result.lastInsertRowid)) as ChatProfile
    })()
    if (!nested && result.characterLink) characterChanged([], [result.characterLink.settingId], [result.id])
    return result
  },

  update(profileId: number, patch: ChatProfileInput, assetDatabase?: ReturnType<typeof getUserSettingsDb>, options: { deletingCharacterSetting?: boolean; revision?: string } = {}): ChatProfile | null {
    const db = getUserSettingsDb(), nested = db.inTransaction
    // Checked saves lock the record before reading it; asset grouping must use the same attached connection.
    if (options.revision !== undefined && !assetDatabase) {
      attachMainImagesDatabase(db)
      assetDatabase = db
    }
    let previousSettingId: number | null = null
    let linkChanged = false
    const transaction = db.transaction(() => {
    const stored = getUserSettingsDb().prepare('SELECT * FROM llm_chat_profiles WHERE id = ?').get(profileId) as ProfileRow | undefined
    if (!stored) {
      return null
    }
    if (options.revision !== undefined) {
      const latest = ChatProfileStore.find(profileId) as ChatProfile
      if (latest.revision !== options.revision) throw new ChatRevisionConflict(latest)
    }
    const current = toProfile(stored)
    previousSettingId = stored.character_setting_id ?? null
    const previousLink = previousSettingId === null ? null : { settingId: previousSettingId, synced: stored.character_sync === 1 }
    const nextLink = patch.characterLink === undefined ? previousLink : normalizeCharacterLink(patch.characterLink)
    linkChanged = previousLink?.settingId !== nextLink?.settingId || previousLink?.synced !== nextLink?.synced
    patch = { ...patch }
    if ((previousLink?.synced || nextLink?.synced) && patch.style !== undefined) patch.style = storedCharacterStyle(current.name, current.style, patch.style, previousLink, nextLink, db)
    let copyingCharacter = false
    if (nextLink?.synced) for (const key of CHARACTER_APPEARANCE_FIELDS) delete patch[key]
    else if ((nextLink && (!previousLink || previousLink.synced || nextLink.settingId !== previousLink.settingId)) || (!nextLink && previousLink?.synced)) {
      attachMainImagesDatabase(db)
      Object.assign(patch, detachedCharacterFields(nextLink?.settingId ?? previousLink!.settingId, { name: patch.name ?? current.name, style: normalizeChatStyle(patch.style ?? current.style) }, patch, db, options.deletingCharacterSetting === true))
      copyingCharacter = true
      assetDatabase = db
    }
    patch.characterLink = nextLink
    const merged: ChatProfileInput = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) }
    // A legacy pair in the patch replaces the role's current row unless the patch names a row too.
    for (const [slotKey, providerKey] of LEGACY_PAIR_KEYS) {
      if (typeof patch[providerKey] === 'string' && patch[providerKey] && patch[slotKey] === undefined) delete merged[slotKey]
    }
    // The current editor still writes legacy images; changing one invalidates its migrated hash.
    if (!copyingCharacter && patch.avatar !== undefined && patch.avatar !== current.avatar && (patch.avatarHash === undefined || patch.avatarHash === current.avatarHash)) merged.avatarHash = null
    if (patch.background !== undefined && patch.background !== current.background && (patch.backgroundHash === undefined || patch.backgroundHash === current.backgroundHash)) merged.backgroundHash = null
    const strictKeys = new Set(Object.entries(patch).filter(([, value]) => value !== undefined).map(([key]) => key))
    const columns = toColumns(merged, { strictKeys })
    // Unedited scalar content is not a new write: retain its exact stored representation, including legacy excess.
    for (const key of [...Object.keys(PROFILE_SCALAR_TEXT_LIMITS), ...Object.keys(CHAT_PROFILE_LIMITS), 'extraParams', 'reasoningBudgetTokens', 'sortOrder', 'promptSections', 'alternateGreetings', 'openingHistory']) {
      if (strictKeys.has(key)) continue
      const column = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
      // A new engine decides these engine-specific values afresh (a non-LLM profile clears them).
      if ((key === 'reasoningBudgetTokens' || key === 'extraParams') && strictKeys.has('engine')) continue
      ;(columns as Record<string, unknown>)[column] = (stored as unknown as Record<string, unknown>)[column]
    }
    if (columns.folder_id !== (stored.folder_id ?? null)) columns.sort_order = nextProfileSortOrder(columns.folder_id)
    if (columns.engine !== current.engine && getUserSettingsDb().prepare(`
      SELECT 1 FROM codex_chat_threads WHERE profile_id = ?
      UNION ALL SELECT 1 FROM chat_group_members WHERE profile_id = ? LIMIT 1
    `).get(profileId, profileId)) {
      throw new ChatProfileError('대화에서 사용 중인 프로필의 엔진은 바꿀 수 없어. 다른 엔진은 새 프로필로 만들어줘.')
    }
    // The character's library group follows the rename, unless another profile still goes by the old name.
    const oldGroup = chatCharacterGroupPath(current.name)
    if (columns.name !== current.name && !ChatProfileStore.listNames().some((profile) => profile.id !== profileId && chatCharacterGroupPath(profile.name) === oldGroup)) {
      renameCharacterGroup(current.name, columns.name, assetDatabase)
    }
    fileProfileAssetsUnderGroup(columns.name, [columns.avatar_hash, columns.background_hash, columns.reference_hash], assetDatabase)
    getUserSettingsDb().prepare(`
      UPDATE llm_chat_profiles SET ${Object.keys(columns).map((name) => `${name} = @${name}`).join(', ')}, updated_date = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...columns, id: profileId })
    return ChatProfileStore.find(profileId)
    })
    const result = options.revision === undefined ? transaction() : transaction.immediate()
    if (!nested && linkChanged && result) characterChanged([], [previousSettingId, result.characterLink?.settingId ?? null].filter((id): id is number => id !== null), [profileId])
    return result
  },

  /** Chats that used the profile stay readable; they just can't send until another profile replaces it. */
  delete(profileId: number) {
    const db = getUserSettingsDb()
    const row = db.transaction(() => {
      const row = db.prepare('SELECT character_setting_id, character_sync FROM llm_chat_profiles WHERE id = ?').get(profileId) as { character_setting_id: number | null; character_sync: number } | undefined
      if (row) db.prepare('DELETE FROM llm_chat_profiles WHERE id = ?').run(profileId)
      return row
    })()
    if (row?.character_sync === 1 && row.character_setting_id !== null) characterChanged([], [row.character_setting_id], [profileId])
    return Boolean(row)
  },

  /** A new profile joins the end of its folder. */
  nextSortOrder(folderId: number | null = null) {
    return nextProfileSortOrder(folderId)
  },

  /** Scoped calls replace the listed cards' positions only. Legacy unscoped calls reorder within each folder. */
  reorder(ids: number[], folderId?: number | null) {
    const db = getUserSettingsDb()
    db.transaction(() => {
      if (folderId !== undefined) checkedProfileFolder(folderId)
      const current = (db.prepare(`SELECT id FROM llm_chat_profiles ${folderId !== undefined ? 'WHERE folder_id IS ?' : ''} ORDER BY ${folderId === undefined ? chatProfileOrderSql() : 'sort_order, id'}`).all(...(folderId !== undefined ? [folderId] : [])) as Array<{ id: number }>).map((row) => row.id)
      const selected = new Set(ids), existing = new Set(current)
      if (selected.size !== ids.length || ids.some((id) => !existing.has(id))) throw new ChatProfileError('목록이 바뀌었어. 새로 불러온 뒤 순서를 바꿔줘.')
      let index = 0
      const ordered = folderId === undefined ? [...ids, ...current.filter((id) => !selected.has(id))] : current.map((id) => selected.has(id) ? ids[index++]! : id)
      const update = db.prepare('UPDATE llm_chat_profiles SET sort_order = ? WHERE id = ? AND sort_order != ?')
      ordered.forEach((id, position) => update.run(position, id, position))
    }).immediate()
  },
}

let codexProfileMigrationChecked = false

/**
 * One-time move from the old server-wide Codex chat settings to a "Codex" profile: model, reasoning effort, MCP
 * scopes and on/off carry over, and existing Codex chats are attached to it so they keep working.
 */
export function ensureCodexProfileMigrated() {
  if (codexProfileMigrationChecked) return
  // A failed migration must not break every chat request. A restart retries; only committed work is durable.
  codexProfileMigrationChecked = true
  try {
    const db = getUserSettingsDb()
    db.transaction(() => {
      if (db.prepare("SELECT 1 FROM chat_settings_migrations WHERE name = 'codex-profile'").get()) return
      const orphanThreads = (db.prepare("SELECT COUNT(*) AS count FROM codex_chat_threads WHERE engine = 'codex' AND profile_id IS NULL").get() as { count: number }).count
      let profileId = (db.prepare("SELECT id FROM llm_chat_profiles WHERE engine = 'codex' ORDER BY id LIMIT 1").get() as { id: number } | undefined)?.id
      const legacy = readLegacyCodexChatSettings()
      if (profileId === undefined && (legacy || orphanThreads > 0)) {
        const scopes = parseScopes(legacy?.scopes ?? CHAT_SCOPES)
        profileId = ChatProfileStore.create({
          name: 'Codex', engine: 'codex',
          model: typeof legacy?.model === 'string' ? legacy.model : '',
          reasoningEffort: isCodexReasoningEffort(legacy?.reasoningEffort) ? legacy.reasoningEffort : '',
          mcpEnabled: scopes.length > 0, mcpScopes: scopes, isEnabled: true,
        }).id
      }
      if (profileId !== undefined) db.prepare("UPDATE codex_chat_threads SET profile_id = ? WHERE engine = 'codex' AND profile_id IS NULL").run(profileId)
      db.prepare("INSERT INTO chat_settings_migrations (name) VALUES ('codex-profile')").run()
    }).immediate()
  } catch (error) {
    console.warn('[chat] Codex profile migration failed; deferred until restart:', error)
  }
}
