import { isCodexReasoningEffort, type CodexReasoningEffort } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { CHAT_SCOPES, readLegacyCodexChatSettings, type ChatScope } from './chatSettings'
import { isClaudeReasoningEffort, isLlmReasoningEffort, parseLlmExtraParams, type LlmGenerationOptions } from '../llmGenerationOptions'
import { BACKGROUND_MAX_LENGTH, BACKGROUND_PATTERN, normalizeChatStyle, type ChatStyle } from './chatStyle'
import { ChatLorebookStore, normalizeLorebookIds } from './chatLorebook'
import { ChatSharedBlockStore, normalizeBlockIds } from './chatDisplayBlocks'
import { ChatProfileError } from './chatProfileError'
import { AuthPermissionGroup } from '../../models/AuthPermissionGroup'
import { ChatGenerationPresetStore, normalizeGenerationPresetIds } from './chatGenerationPresets'
import { LLM_CONNECTION_TYPES, MODEL_CONNECTION_TYPES, ModelSlotStore } from './modelSlots'
import { ChatJudgePresetStore } from './chatJudgePresets'
import { fileProfileAssetsUnderGroup, normalizeAvatarCrop, normalizeProfileAssetHash, type ChatAvatarCrop } from './chatProfileAssets'

const NAME_MAX_LENGTH = 60
const MODEL_MAX_LENGTH = 200
const TEXT_MAX_LENGTH = 20_000
const AVATAR_MAX_LENGTH = 300_000
const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/

export const CHAT_PROFILE_LIMITS = {
  contextTurns: { min: 1, max: 200 },
  contextTokens: { min: 1024, max: 4_000_000 },
  summaryTriggerTurns: { min: 1, max: 200 },
  maxToolRounds: { min: 1, max: 20 },
  toolOutputLimit: { min: 500, max: 100_000 },
} as const

export const CHAT_PROFILE_DEFAULTS = {
  loreScanDepth: 4,
  loreTokenBudget: 1024,
  /** Turns before the end where keyword lore is merged in (0: the latest user message). */
  loreDepth: 4,
  contextTurns: 20,
  summaryTriggerTurns: 6,
  maxToolRounds: 8,
  /** Characters of one tool result handed to the model within a reply. */
  toolOutputLimit: 12_000,
} as const

export const AUTHOR_NOTE_MAX_LENGTH = 4000
/** Text caps toColumns applies to the profile fields a chat may propose (the setup tools validate with the same numbers). */
const TRANSLATION_INSTRUCTIONS_MAX_LENGTH = 4000
export const CHAT_PROFILE_TEXT_LIMITS = { name: NAME_MAX_LENGTH, tagline: 200, text: TEXT_MAX_LENGTH, authorNote: AUTHOR_NOTE_MAX_LENGTH, sections: 30, sectionTitle: 80, alternateGreetings: 100 } as const
const MAX_PROMPT_SECTIONS = 30
const SECTION_TITLE_MAX_LENGTH = 80

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

export type ChatProfile = {
  id: number
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
  /** Codex: the CLI effort. API LLM: none / low / medium / high (sent as reasoning_effort). Empty: not set. */
  reasoningEffort: CodexReasoningEffort | ''
  /** API LLM: reasoning token budget (reasoning_budget_tokens); null leaves it to the server. */
  reasoningBudgetTokens: number | null
  /** API LLM: extra request fields as a JSON object text (e.g. chat_template_kwargs); empty for none. */
  extraParams: string
  systemPrompt: string
  promptSections: ChatPromptSection[]
  /** Randomly selected with alternateGreetings as the first assistant message on chat creation/reset. */
  greeting: string
  alternateGreetings: string[]
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
  /** LLM context: recent turns sent with each request, capped by `contextTokens` when set. */
  contextTurns: number
  contextTokens: number | null
  summaryEnabled: boolean
  /** Fold older turns into the summary once this many have left the window. */
  summaryTriggerTurns: number
  /** Empty uses DEFAULT_CHAT_SUMMARY_PROMPT. */
  summaryPrompt: string
  /**
   * Notes the translation model follows when it puts this profile's replies into Korean: the character's voice, how it
   * addresses the user, a glossary. `{{char}}` / `{{user}}` are filled. The user's messages are translated without it.
   */
  translationInstructions: string
  /**
   * Reply suggestions: the composer's sparkle button asks a model for a few things the user might say next.
   * With no model of its own (`suggestSlotId`) it uses the chat's (a Codex profile: its Codex model, in a one-shot run).
   */
  suggestEnabled: boolean
  /**
   * Model rows (llm_model_slots, a connection's model) per role. Chat null: the default row. Summary / suggestions
   * null: the chat's model. Translation null: no translation (user messages go to the chat model in English and
   * replies are shown in Korean when set). A row that went missing reads as null. Codex profiles have no chat row.
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
  /** Model ↔ tool round trips allowed in one reply. */
  maxToolRounds: number
  /** LLM: the model can look at images (view_images results are sent to it). */
  visionEnabled: boolean
  /** Page assistant: a direct chat with this profile can be connected to the current CoNAI page. */
  pageAssist: boolean
  /** The model may propose chat lorebook entries (save_lore) for the user to save. */
  allowLoreProposals: boolean
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

export type ChatProfileInput = Partial<Omit<ChatProfile, 'id' | 'createdDate' | 'updatedDate'>> & LegacyModelPairs

/** Each role's slot field and the legacy pair keys that stand for it. */
const LEGACY_PAIR_KEYS: Array<[keyof ChatProfileInput, keyof LegacyModelPairs, keyof ChatProfileInput]> = [
  ['modelSlotId', 'providerName', 'model'],
  ['summarySlotId', 'summaryProviderName', 'summaryModel'],
  ['translationSlotId', 'translationProviderName', 'translationModel'],
  ['suggestSlotId', 'suggestProviderName', 'suggestModel'],
  ['judgeSlotId', 'judgeProviderName', 'judgeModel'],
]

type ProfileRow = {
  id: number
  name: string
  tagline: string
  lorebook_ids: string | null
  block_ids: string | null
  lore_scan_depth: number
  lore_token_budget: number
  lore_depth: number | null
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
  suggest_enabled: number | null
  suggest_provider_name: string | null
  suggest_model: string | null
  model_slot_id: number | null
  summary_slot_id: number | null
  translation_slot_id: number | null
  suggest_slot_id: number | null
  suggest_profile_id: number | null
  suggest_user_profile_id: number | null
  max_tool_rounds: number | null
  chat_style: string | null
  background_image: string | null
  vision_enabled: number | null
  page_assist: number | null
  allow_lore_proposals: number | null
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

/**
 * The greeting at `index` of chatGreetings (the one a new chat previewed), or one chosen uniformly when there is no
 * such index; no greeting keeps the chat empty.
 */
export function pickChatGreeting(profile: Pick<ChatProfile, 'greeting' | 'alternateGreetings'>, index?: number | null): string {
  const greetings = chatGreetings(profile)
  if (typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < greetings.length) return greetings[index]
  return greetings.length > 0 ? greetings[Math.floor(Math.random() * greetings.length)] : ''
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
    return [{
      id: text(record.id, 40) || `s${index}-${Date.now().toString(36)}`,
      title,
      content,
      kind: record.kind === 'dialogue' || record.kind === 'post' ? record.kind : 'text' as const,
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

function toProfile(row: ProfileRow): ChatProfile {
  const storedSections = parseJsonArray(row.prompt_sections)
  const allowlist = parseJsonArray(row.tool_allowlist)
  const blockIds = normalizeBlockIds(row.block_ids)
  let avatarCrop: ChatAvatarCrop | null = null
  try { avatarCrop = normalizeAvatarCrop(row.avatar_crop ? JSON.parse(row.avatar_crop) : null) } catch { /* Keep malformed legacy crops unset. */ }
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline ?? '',
    lorebookIds: normalizeLorebookIds(row.lorebook_ids),
    blockIds,
    loreScanDepth: row.lore_scan_depth ?? CHAT_PROFILE_DEFAULTS.loreScanDepth,
    loreTokenBudget: row.lore_token_budget ?? CHAT_PROFILE_DEFAULTS.loreTokenBudget,
    loreDepth: row.lore_depth ?? CHAT_PROFILE_DEFAULTS.loreDepth,
    authorNote: row.author_note ?? '',
    avatar: row.avatar,
    appearance: row.appearance ?? '',
    referenceHash: row.reference_hash ?? null,
    avatarHash: row.avatar_hash ?? null,
    avatarCrop,
    backgroundHash: row.background_hash ?? null,
    engine: row.engine === 'codex' ? 'codex' : row.engine === 'claude' ? 'claude' : 'llm',
    model: row.engine === 'codex' || row.engine === 'claude' ? row.model ?? '' : '',
    reasoningEffort: isCodexReasoningEffort(row.reasoning_effort) ? row.reasoning_effort : '',
    reasoningBudgetTokens: row.reasoning_budget_tokens,
    extraParams: row.extra_params ?? '',
    systemPrompt: row.system_prompt,
    promptSections: storedSections ? normalizeSections(storedSections) : legacySections(row),
    greeting: row.greeting,
    alternateGreetings: normalizeAlternateGreetings(parseJsonArray(row.alternate_greetings)),
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    mcpEnabled: row.mcp_enabled === 1,
    allowedGroupKeys: (parseJsonArray(row.allowed_group_keys) ?? []).filter((key): key is string => typeof key === 'string'),
    mcpScopes: parseScopes(row.mcp_scopes),
    toolAllowlist: allowlist ? allowlist.filter((name): name is string => typeof name === 'string') : null,
    toolOutputLimit: row.tool_output_limit ?? CHAT_PROFILE_DEFAULTS.toolOutputLimit,
    generationPresetIds: ChatGenerationPresetStore.existing(normalizeGenerationPresetIds(row.generation_preset_ids)),
    contextTurns: row.context_turns ?? CHAT_PROFILE_DEFAULTS.contextTurns,
    contextTokens: row.context_tokens,
    summaryEnabled: row.summary_enabled === 1,
    summaryTriggerTurns: row.summary_trigger_turns ?? CHAT_PROFILE_DEFAULTS.summaryTriggerTurns,
    summaryPrompt: row.summary_prompt ?? '',
    translationInstructions: row.translation_instructions ?? '',
    suggestEnabled: row.suggest_enabled === 1,
    // A row that no longer exists reads as unset (the next save clears the column).
    modelSlotId: ModelSlotStore.existing(row.model_slot_id),
    summarySlotId: ModelSlotStore.existing(row.summary_slot_id),
    translationSlotId: ModelSlotStore.existing(row.translation_slot_id),
    suggestSlotId: ModelSlotStore.existing(row.suggest_slot_id),
    suggestProfileId: row.suggest_profile_id,
    suggestUserProfileId: row.suggest_profile_id === null ? row.suggest_user_profile_id : null,
    maxToolRounds: row.max_tool_rounds ?? CHAT_PROFILE_DEFAULTS.maxToolRounds,
    visionEnabled: row.vision_enabled === 1,
    pageAssist: row.page_assist === 1,
    allowLoreProposals: row.allow_lore_proposals !== 0,
    judgePresetId: ChatJudgePresetStore.existing(row.judge_preset_id),
    judgeSlotId: ModelSlotStore.existing(row.judge_slot_id),
    // Display blocks live in chat_display_blocks; the profile only links them (the style column's own list is legacy).
    style: { ...normalizeChatStyle(row.chat_style), blocks: ChatSharedBlockStore.blocksOf(blockIds) },
    background: row.background_image,
    isEnabled: row.is_enabled === 1,
    sortOrder: row.sort_order,
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

function text(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function optionalNumber(value: unknown, range: { min: number; max: number }, integer: boolean) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new ChatProfileError('숫자 값이 올바르지 않아.')
  }
  const clamped = Math.min(range.max, Math.max(range.min, number))
  return integer ? Math.round(clamped) : clamped
}

/**
 * Whether the profile's model sees images: Codex models always do (its editor has no switch, so a stored
 * `visionEnabled` there is only left over from another engine); LLM and Claude follow the profile's switch.
 */
export function profileSeesImages(profile: Pick<ChatProfile, 'engine' | 'visionEnabled'>) {
  return profile.engine === 'codex' || profile.visionEnabled
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

/** The summary prompt a profile actually uses. */
export function resolveSummaryPrompt(profile: ChatProfile) {
  return profile.summaryPrompt.trim() || DEFAULT_CHAT_SUMMARY_PROMPT
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
function toColumns(input: ChatProfileInput, options: { draft?: boolean } = {}) {
  const name = text(input.name, NAME_MAX_LENGTH)
  if (!name) {
    throw new ChatProfileError('프로필 이름이 필요해.')
  }
  const engine: ChatProfileEngine = input.engine === 'codex' ? 'codex' : input.engine === 'claude' ? 'claude' : 'llm'
  // A role's row: its id, or a legacy connection + model pair, which lands on that connection's row.
  const roleSlot = (slotId: unknown, providerName: unknown, model: unknown, kinds: readonly string[] = LLM_CONNECTION_TYPES) => {
    if (slotId !== null && slotId !== undefined && slotId !== '') return ModelSlotStore.checked(slotId, kinds)
    if (typeof providerName !== 'string' || !providerName.trim()) return null
    const id = ModelSlotStore.ensure(providerName, model, { create: options.draft !== true })
    return id === null ? null : ModelSlotStore.checked(id, kinds)
  }
  // Codex has no connection, so no chat row; its helper roles (summary, translation, suggestions) still use rows.
  const modelSlotId = engine === 'llm' ? roleSlot(input.modelSlotId, input.providerName, input.model) : null
  if (engine === 'llm' && modelSlotId === null && !ModelSlotStore.defaultTarget()) {
    throw new ChatProfileError('모델을 골라줘. 설정 › LLM에서 연결에 모델을 먼저 추가해야 해.')
  }
  const avatar = typeof input.avatar === 'string' && input.avatar ? input.avatar : null
  if (avatar && (avatar.length > AVATAR_MAX_LENGTH || !AVATAR_PATTERN.test(avatar))) {
    throw new ChatProfileError('아바타 이미지가 올바르지 않거나 너무 커.')
  }
  const background = typeof input.background === 'string' && input.background ? input.background : null
  if (background && (background.length > BACKGROUND_MAX_LENGTH || !BACKGROUND_PATTERN.test(background))) {
    throw new ChatProfileError('배경 이미지가 올바르지 않거나 너무 커.')
  }
  if (input.reasoningEffort && (engine === 'codex' ? !isCodexReasoningEffort(input.reasoningEffort) : engine === 'claude' ? !isClaudeReasoningEffort(input.reasoningEffort) : !isLlmReasoningEffort(input.reasoningEffort))) {
    throw new ChatProfileError('추론 강도 값이 올바르지 않아.')
  }
  let extraParams = ''
  if (engine === 'llm' && typeof input.extraParams === 'string' && input.extraParams.trim()) {
    try {
      parseLlmExtraParams(input.extraParams)
    } catch (error) {
      throw new ChatProfileError(error instanceof Error ? error.message : '추가 파라미터가 올바르지 않아.')
    }
    extraParams = input.extraParams.trim().slice(0, 20_000)
  }

  return {
    name,
    tagline: text(input.tagline, 200),
    lorebook_ids: JSON.stringify(ChatLorebookStore.existing(normalizeLorebookIds(input.lorebookIds))),
    block_ids: JSON.stringify(ChatSharedBlockStore.existing(normalizeBlockIds(input.blockIds))),
    lore_scan_depth: optionalNumber(input.loreScanDepth, { min: 1, max: 100 }, true) ?? CHAT_PROFILE_DEFAULTS.loreScanDepth,
    lore_token_budget: optionalNumber(input.loreTokenBudget, { min: 0, max: 32768 }, true) ?? CHAT_PROFILE_DEFAULTS.loreTokenBudget,
    lore_depth: optionalNumber(input.loreDepth, { min: 0, max: 20 }, true) ?? CHAT_PROFILE_DEFAULTS.loreDepth,
    author_note: text(input.authorNote, AUTHOR_NOTE_MAX_LENGTH) || null,
    avatar,
    appearance: text(input.appearance, TEXT_MAX_LENGTH) || null,
    reference_hash: normalizeProfileAssetHash(input.referenceHash),
    avatar_hash: normalizeProfileAssetHash(input.avatarHash),
    avatar_crop: input.avatarCrop == null ? null : JSON.stringify(normalizeAvatarCrop(input.avatarCrop)),
    background_hash: normalizeProfileAssetHash(input.backgroundHash),
    engine,
    // The pair columns are the older form of the model rows (see LegacyModelPairs); a save clears them.
    provider_name: '',
    model: engine === 'llm' ? null : text(input.model, MODEL_MAX_LENGTH) || null,
    reasoning_effort: input.reasoningEffort || null,
    reasoning_budget_tokens: engine === 'llm' ? optionalNumber(input.reasoningBudgetTokens, { min: 1, max: 1_000_000 }, true) : null,
    extra_params: extraParams || null,
    system_prompt: text(input.systemPrompt, TEXT_MAX_LENGTH),
    prompt_sections: JSON.stringify(normalizeSections(input.promptSections ?? [])),
    // The fixed columns are superseded by prompt_sections; cleared so an old row is not read as legacy again.
    character_description: '',
    example_dialogue: '',
    user_persona: '',
    greeting: text(input.greeting, TEXT_MAX_LENGTH),
    alternate_greetings: JSON.stringify(normalizeAlternateGreetings(input.alternateGreetings)),
    temperature: optionalNumber(input.temperature, { min: 0, max: 2 }, false),
    max_tokens: optionalNumber(input.maxTokens, { min: 1, max: 1_000_000 }, true),
    mcp_enabled: input.mcpEnabled ? 1 : 0,
    allowed_group_keys: JSON.stringify(normalizeAllowedGroupKeys(input.allowedGroupKeys)),
    mcp_scopes: JSON.stringify(parseScopes(input.mcpScopes ?? ['read'])),
    tool_allowlist: Array.isArray(input.toolAllowlist)
      ? JSON.stringify([...new Set(input.toolAllowlist.filter((name): name is string => typeof name === 'string' && /^[a-z0-9_]{1,64}$/.test(name)))])
      : null,
    tool_output_limit: optionalNumber(input.toolOutputLimit, CHAT_PROFILE_LIMITS.toolOutputLimit, true) ?? CHAT_PROFILE_DEFAULTS.toolOutputLimit,
    generation_preset_ids: JSON.stringify(ChatGenerationPresetStore.existing(normalizeGenerationPresetIds(input.generationPresetIds))),
    context_turns: optionalNumber(input.contextTurns, CHAT_PROFILE_LIMITS.contextTurns, true) ?? CHAT_PROFILE_DEFAULTS.contextTurns,
    context_tokens: optionalNumber(input.contextTokens, CHAT_PROFILE_LIMITS.contextTokens, true),
    summary_enabled: input.summaryEnabled ? 1 : 0,
    summary_trigger_turns: optionalNumber(input.summaryTriggerTurns, CHAT_PROFILE_LIMITS.summaryTriggerTurns, true) ?? CHAT_PROFILE_DEFAULTS.summaryTriggerTurns,
    summary_prompt: text(input.summaryPrompt, 4000),
    summary_provider_name: null,
    summary_model: null,
    translation_provider_name: null,
    translation_model: null,
    translation_instructions: text(input.translationInstructions, TRANSLATION_INSTRUCTIONS_MAX_LENGTH) || null,
    suggest_enabled: input.suggestEnabled ? 1 : 0,
    suggest_provider_name: null,
    suggest_model: null,
    model_slot_id: modelSlotId,
    summary_slot_id: roleSlot(input.summarySlotId, input.summaryProviderName, input.summaryModel),
    translation_slot_id: roleSlot(input.translationSlotId, input.translationProviderName, input.translationModel),
    suggest_slot_id: roleSlot(input.suggestSlotId, input.suggestProviderName, input.suggestModel),
    suggest_profile_id: optionalNumber(input.suggestProfileId, { min: 1, max: Number.MAX_SAFE_INTEGER }, true),
    suggest_user_profile_id: input.suggestProfileId ? null : optionalNumber(input.suggestUserProfileId, { min: 1, max: Number.MAX_SAFE_INTEGER }, true),
    max_tool_rounds: optionalNumber(input.maxToolRounds, CHAT_PROFILE_LIMITS.maxToolRounds, true) ?? CHAT_PROFILE_DEFAULTS.maxToolRounds,
    vision_enabled: input.visionEnabled ? 1 : 0,
    page_assist: input.pageAssist ? 1 : 0,
    allow_lore_proposals: input.allowLoreProposals === false ? 0 : 1,
    // Every engine can be judged (a Codex chat gets the directives and status fields only, see chatJudge).
    judge_preset_id: judgePresetId(input.judgePresetId),
    judge_provider_name: null,
    judge_model: null,
    judge_slot_id: roleSlot(input.judgeSlotId, input.judgeProviderName, input.judgeModel, MODEL_CONNECTION_TYPES),
    chat_style: JSON.stringify({ ...normalizeChatStyle(input.style), blocks: [] }),
    background_image: background,
    is_enabled: input.isEnabled === false ? 0 : 1,
    sort_order: optionalNumber(input.sortOrder, { min: -1_000_000, max: 1_000_000 }, true) ?? 0,
  }
}

export const ChatProfileStore = {
  /** A profile as it would be saved, without saving it (prompt preview of an unsaved draft). */
  draft(input: ChatProfileInput, profileId = 0): ChatProfile {
    const now = new Date().toISOString()
    return toProfile({ ...toColumns(input, { draft: true }), id: profileId, created_date: now, updated_date: now } as ProfileRow)
  },

  list(options: { enabledOnly?: boolean } = {}) {
    const rows = getUserSettingsDb().prepare(`
      SELECT * FROM llm_chat_profiles ${options.enabledOnly ? 'WHERE is_enabled = 1' : ''} ORDER BY sort_order ASC, id ASC
    `).all() as ProfileRow[]
    return rows.map(toProfile)
  },

  find(profileId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM llm_chat_profiles WHERE id = ?').get(profileId) as ProfileRow | undefined
    return row ? toProfile(row) : null
  },

  create(input: ChatProfileInput) {
    const columns = toColumns(input)
    fileProfileAssetsUnderGroup(columns.name, [columns.avatar_hash, columns.background_hash, columns.reference_hash])
    const names = Object.keys(columns)
    const result = getUserSettingsDb().prepare(`
      INSERT INTO llm_chat_profiles (${names.join(', ')}) VALUES (${names.map((name) => `@${name}`).join(', ')})
    `).run(columns)
    return ChatProfileStore.find(Number(result.lastInsertRowid)) as ChatProfile
  },

  update(profileId: number, patch: ChatProfileInput, assetDatabase?: ReturnType<typeof getUserSettingsDb>) {
    const current = ChatProfileStore.find(profileId)
    if (!current) {
      return null
    }
    const merged: ChatProfileInput = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) }
    // A legacy pair in the patch replaces the role's current row unless the patch names a row too.
    for (const [slotKey, providerKey] of LEGACY_PAIR_KEYS) {
      if (typeof patch[providerKey] === 'string' && patch[providerKey] && patch[slotKey] === undefined) delete merged[slotKey]
    }
    // The current editor still writes legacy images; changing one invalidates its migrated hash.
    if (patch.avatar !== undefined && patch.avatar !== current.avatar && (patch.avatarHash === undefined || patch.avatarHash === current.avatarHash)) merged.avatarHash = null
    if (patch.background !== undefined && patch.background !== current.background && (patch.backgroundHash === undefined || patch.backgroundHash === current.backgroundHash)) merged.backgroundHash = null
    const columns = toColumns(merged)
    if (columns.engine !== current.engine && getUserSettingsDb().prepare(`
      SELECT 1 FROM codex_chat_threads WHERE profile_id = ?
      UNION ALL SELECT 1 FROM chat_group_members WHERE profile_id = ? LIMIT 1
    `).get(profileId, profileId)) {
      throw new ChatProfileError('대화에서 사용 중인 프로필의 엔진은 바꿀 수 없어. 다른 엔진은 새 프로필로 만들어줘.')
    }
    fileProfileAssetsUnderGroup(columns.name, [columns.avatar_hash, columns.background_hash, columns.reference_hash], assetDatabase)
    getUserSettingsDb().prepare(`
      UPDATE llm_chat_profiles SET ${Object.keys(columns).map((name) => `${name} = @${name}`).join(', ')}, updated_date = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...columns, id: profileId })
    return ChatProfileStore.find(profileId)
  },

  /** Chats that used the profile stay readable; they just can't send until another profile replaces it. */
  delete(profileId: number) {
    return getUserSettingsDb().prepare('DELETE FROM llm_chat_profiles WHERE id = ?').run(profileId).changes > 0
  },
}

let codexProfileMigrationChecked = false

/**
 * One-time move from the old server-wide Codex chat settings to a "Codex" profile: model, reasoning effort, MCP
 * scopes and on/off carry over, and existing Codex chats are attached to it so they keep working.
 */
export function ensureCodexProfileMigrated() {
  if (codexProfileMigrationChecked) {
    return
  }
  codexProfileMigrationChecked = true

  const db = getUserSettingsDb()
  const orphanThreads = (db.prepare("SELECT COUNT(*) AS count FROM codex_chat_threads WHERE engine = 'codex' AND profile_id IS NULL").get() as { count: number }).count
  const hasCodexProfile = (db.prepare("SELECT COUNT(*) AS count FROM llm_chat_profiles WHERE engine = 'codex'").get() as { count: number }).count > 0
  const legacy = readLegacyCodexChatSettings()
  if (hasCodexProfile && orphanThreads === 0) {
    return
  }
  if (!hasCodexProfile && !legacy && orphanThreads === 0) {
    return
  }

  db.transaction(() => {
    let profileId = (db.prepare("SELECT id FROM llm_chat_profiles WHERE engine = 'codex' ORDER BY id LIMIT 1").get() as { id: number } | undefined)?.id
    if (profileId === undefined) {
      const scopes = parseScopes(legacy?.scopes ?? CHAT_SCOPES)
      profileId = ChatProfileStore.create({
        name: 'Codex',
        engine: 'codex',
        model: typeof legacy?.model === 'string' ? legacy.model : '',
        reasoningEffort: isCodexReasoningEffort(legacy?.reasoningEffort) ? legacy.reasoningEffort : '',
        mcpEnabled: scopes.length > 0,
        mcpScopes: scopes,
        isEnabled: true,
      }).id
    }
    db.prepare("UPDATE codex_chat_threads SET profile_id = ? WHERE engine = 'codex' AND profile_id IS NULL").run(profileId)
  })()
}
