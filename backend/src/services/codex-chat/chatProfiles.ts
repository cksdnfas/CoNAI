import { isCodexReasoningEffort, type CodexReasoningEffort } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { CHAT_SCOPES, readLegacyCodexChatSettings, type ChatScope } from './chatSettings'
import { isLlmReasoningEffort, parseLlmExtraParams, type LlmGenerationOptions } from '../llmGenerationOptions'
import { BACKGROUND_MAX_LENGTH, BACKGROUND_PATTERN, normalizeChatStyle, type ChatStyle } from './chatStyle'
import { ChatLorebookStore, normalizeLorebookIds } from './chatLorebook'
import { ChatSharedBlockStore, normalizeBlockIds } from './chatDisplayBlocks'
import { ChatProfileError } from './chatProfileError'
import { ChatToolPresetStore } from './chatToolPresets'
import { ChatGenerationPresetStore, normalizeGenerationPresetIds } from './chatGenerationPresets'
import { ModelSlotStore } from './modelSlots'

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
export type ChatProfileEngine = 'llm' | 'codex'

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
  diagnosticsScope: 'view' | 'content' | null
  /** Small data URL (resized in the browser). */
  avatar: string | null
  engine: ChatProfileEngine
  /** LLM: `external_api_providers.provider_name`. Empty for Codex. */
  providerName: string
  /** Empty uses the connection's (LLM) or the CLI's (Codex) default model. */
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
  /** The shared tool preset (chat_tool_presets) whose scopes and allowlist apply; null keeps the profile's own below. */
  toolPresetId: number | null
  /** Read-only: the linked preset's name; a missing linked preset revokes its tool grant. */
  toolPresetName?: string | null
  mcpScopes: ChatScope[]
  /** Only these tools (within the scopes); null offers every tool the scopes allow. */
  toolAllowlist: string[] | null
  /** Generation presets (chat_generation_presets) the profile draws with; any linked withholds free-form generation. */
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
  /** Null summarizes with the chat's own connection/model. */
  summaryProviderName: string | null
  summaryModel: string
  /**
   * Translation model: user messages go to the chat model in English and replies are shown in Korean, with the
   * other text kept for the reader. Null: no translation. Empty model uses the connection's default.
   */
  translationProviderName: string | null
  translationModel: string
  /**
   * Notes the translation model follows when it puts this profile's replies into Korean: the character's voice, how it
   * addresses the user, a glossary. `{{char}}` / `{{user}}` are filled. The user's messages are translated without it.
   */
  translationInstructions: string
  /**
   * Reply suggestions: the composer's sparkle button asks a model for a few things the user might say next.
   * Null provider uses the chat's own connection (a Codex profile: its Codex model, in a one-shot run). Empty model
   * uses the connection's default.
   */
  suggestEnabled: boolean
  suggestProviderName: string | null
  suggestModel: string
  /**
   * Model slots (llm_model_slots) per role. A slot wins over the role's direct connection + model above; null keeps the
   * direct pair. A slot that went missing reads as null. Codex profiles have no chat slot.
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
  /** The model may propose chat lorebook entries (save_lore) for the user to save. */
  allowLoreProposals: boolean
  /** Typeface, roleplay colours, background dimming. */
  style: ChatStyle
  /** Chat background as a data URL; served on its own route, never inside profile lists. */
  background: string | null
  isEnabled: boolean
  sortOrder: number
  createdDate: string
  updatedDate: string
}

export type ChatProfileInput = Partial<Omit<ChatProfile, 'id' | 'createdDate' | 'updatedDate'>>

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
  diagnostics_scope: 'view' | 'content' | null
  avatar: string | null
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
  tool_preset_id: number | null
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
  allow_lore_proposals: number | null
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
  // A missing linked preset revokes its grant; it cannot restore the profile's older direct grant.
  const preset = row.tool_preset_id === null ? null : ChatToolPresetStore.find(row.tool_preset_id)
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
    diagnosticsScope: row.diagnostics_scope ?? null,
    avatar: row.avatar,
    engine: row.engine === 'codex' ? 'codex' : 'llm',
    providerName: row.provider_name,
    model: row.model ?? '',
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
    toolPresetId: row.tool_preset_id,
    toolPresetName: preset ? preset.name : null,
    mcpScopes: preset ? preset.scopes : row.tool_preset_id !== null ? [] : parseScopes(row.mcp_scopes),
    toolAllowlist: preset ? preset.toolAllowlist : row.tool_preset_id !== null ? [] : allowlist ? allowlist.filter((name): name is string => typeof name === 'string') : null,
    toolOutputLimit: row.tool_output_limit ?? CHAT_PROFILE_DEFAULTS.toolOutputLimit,
    generationPresetIds: ChatGenerationPresetStore.existing(normalizeGenerationPresetIds(row.generation_preset_ids)),
    contextTurns: row.context_turns ?? CHAT_PROFILE_DEFAULTS.contextTurns,
    contextTokens: row.context_tokens,
    summaryEnabled: row.summary_enabled === 1,
    summaryTriggerTurns: row.summary_trigger_turns ?? CHAT_PROFILE_DEFAULTS.summaryTriggerTurns,
    summaryPrompt: row.summary_prompt ?? '',
    summaryProviderName: row.summary_provider_name,
    summaryModel: row.summary_model ?? '',
    translationProviderName: row.translation_provider_name,
    translationModel: row.translation_model ?? '',
    translationInstructions: row.translation_instructions ?? '',
    suggestEnabled: row.suggest_enabled === 1,
    suggestProviderName: row.suggest_provider_name,
    suggestModel: row.suggest_model ?? '',
    // A slot that no longer exists reads as unset (the next save clears the column).
    modelSlotId: ModelSlotStore.existing(row.model_slot_id),
    summarySlotId: ModelSlotStore.existing(row.summary_slot_id),
    translationSlotId: ModelSlotStore.existing(row.translation_slot_id),
    suggestSlotId: ModelSlotStore.existing(row.suggest_slot_id),
    suggestProfileId: row.suggest_profile_id,
    suggestUserProfileId: row.suggest_profile_id === null ? row.suggest_user_profile_id : null,
    maxToolRounds: row.max_tool_rounds ?? CHAT_PROFILE_DEFAULTS.maxToolRounds,
    visionEnabled: row.vision_enabled === 1,
    allowLoreProposals: row.allow_lore_proposals !== 0,
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
    reasoningEffort: isLlmReasoningEffort(profile.reasoningEffort) ? profile.reasoningEffort : null,
    reasoningBudgetTokens: profile.reasoningBudgetTokens,
    extraParams,
  }
}

/** The summary prompt a profile actually uses. */
export function resolveSummaryPrompt(profile: ChatProfile) {
  return profile.summaryPrompt.trim() || DEFAULT_CHAT_SUMMARY_PROMPT
}

/** Validate a full profile (create) or a merged update, returning the column values. */
function toColumns(input: ChatProfileInput) {
  if (input.diagnosticsScope != null && input.diagnosticsScope !== 'view' && input.diagnosticsScope !== 'content') {
    throw new ChatProfileError('진단 범위가 올바르지 않아.')
  }
  const name = text(input.name, NAME_MAX_LENGTH)
  if (!name) {
    throw new ChatProfileError('프로필 이름이 필요해.')
  }
  const engine: ChatProfileEngine = input.engine === 'codex' ? 'codex' : 'llm'
  const providerName = engine === 'llm' ? text(input.providerName, 200) : ''
  const slotId = (value: unknown) => {
    if (value === null || value === undefined || value === '') return null
    const id = ModelSlotStore.existing(value)
    if (id === null) throw new ChatProfileError('모델을 찾을 수 없어.')
    return id
  }
  // Codex has no connection, so no chat slot; its helper roles (summary, translation, suggestions) still use slots.
  const modelSlotId = engine === 'llm' ? slotId(input.modelSlotId) : null
  if (engine === 'llm' && !providerName && modelSlotId === null) {
    throw new ChatProfileError('LLM 연결을 골라줘.')
  }
  const avatar = typeof input.avatar === 'string' && input.avatar ? input.avatar : null
  if (avatar && (avatar.length > AVATAR_MAX_LENGTH || !AVATAR_PATTERN.test(avatar))) {
    throw new ChatProfileError('아바타 이미지가 올바르지 않거나 너무 커.')
  }
  const background = typeof input.background === 'string' && input.background ? input.background : null
  if (background && (background.length > BACKGROUND_MAX_LENGTH || !BACKGROUND_PATTERN.test(background))) {
    throw new ChatProfileError('배경 이미지가 올바르지 않거나 너무 커.')
  }
  if (input.reasoningEffort && (engine === 'codex' ? !isCodexReasoningEffort(input.reasoningEffort) : !isLlmReasoningEffort(input.reasoningEffort))) {
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
    diagnostics_scope: input.diagnosticsScope ?? null,
    tagline: text(input.tagline, 200),
    lorebook_ids: JSON.stringify(ChatLorebookStore.existing(normalizeLorebookIds(input.lorebookIds))),
    block_ids: JSON.stringify(ChatSharedBlockStore.existing(normalizeBlockIds(input.blockIds))),
    lore_scan_depth: optionalNumber(input.loreScanDepth, { min: 1, max: 100 }, true) ?? CHAT_PROFILE_DEFAULTS.loreScanDepth,
    lore_token_budget: optionalNumber(input.loreTokenBudget, { min: 0, max: 32768 }, true) ?? CHAT_PROFILE_DEFAULTS.loreTokenBudget,
    lore_depth: optionalNumber(input.loreDepth, { min: 0, max: 20 }, true) ?? CHAT_PROFILE_DEFAULTS.loreDepth,
    author_note: text(input.authorNote, AUTHOR_NOTE_MAX_LENGTH) || null,
    avatar,
    engine,
    provider_name: providerName,
    model: text(input.model, MODEL_MAX_LENGTH) || null,
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
    tool_preset_id: input.toolPresetId === null || input.toolPresetId === undefined ? null : ChatToolPresetStore.existing(input.toolPresetId),
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
    summary_provider_name: text(input.summaryProviderName, 200) || null,
    summary_model: text(input.summaryModel, MODEL_MAX_LENGTH) || null,
    translation_provider_name: text(input.translationProviderName, 200) || null,
    translation_model: text(input.translationModel, MODEL_MAX_LENGTH) || null,
    translation_instructions: text(input.translationInstructions, TRANSLATION_INSTRUCTIONS_MAX_LENGTH) || null,
    suggest_enabled: input.suggestEnabled ? 1 : 0,
    suggest_provider_name: text(input.suggestProviderName, 200) || null,
    suggest_model: text(input.suggestModel, MODEL_MAX_LENGTH) || null,
    model_slot_id: modelSlotId,
    summary_slot_id: slotId(input.summarySlotId),
    translation_slot_id: slotId(input.translationSlotId),
    suggest_slot_id: slotId(input.suggestSlotId),
    suggest_profile_id: optionalNumber(input.suggestProfileId, { min: 1, max: Number.MAX_SAFE_INTEGER }, true),
    suggest_user_profile_id: input.suggestProfileId ? null : optionalNumber(input.suggestUserProfileId, { min: 1, max: Number.MAX_SAFE_INTEGER }, true),
    max_tool_rounds: optionalNumber(input.maxToolRounds, CHAT_PROFILE_LIMITS.maxToolRounds, true) ?? CHAT_PROFILE_DEFAULTS.maxToolRounds,
    vision_enabled: input.visionEnabled ? 1 : 0,
    allow_lore_proposals: input.allowLoreProposals === false ? 0 : 1,
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
    return toProfile({ ...toColumns(input), id: profileId, created_date: now, updated_date: now } as ProfileRow)
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
    const names = Object.keys(columns)
    const result = getUserSettingsDb().prepare(`
      INSERT INTO llm_chat_profiles (${names.join(', ')}) VALUES (${names.map((name) => `@${name}`).join(', ')})
    `).run(columns)
    return ChatProfileStore.find(Number(result.lastInsertRowid)) as ChatProfile
  },

  update(profileId: number, patch: ChatProfileInput) {
    const current = ChatProfileStore.find(profileId)
    if (!current) {
      return null
    }
    const columns = toColumns({ ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) })
    if (columns.engine !== current.engine && getUserSettingsDb().prepare(`
      SELECT 1 FROM codex_chat_threads WHERE profile_id = ?
      UNION ALL SELECT 1 FROM chat_group_members WHERE profile_id = ? LIMIT 1
    `).get(profileId, profileId)) {
      throw new ChatProfileError('대화에서 사용 중인 프로필의 엔진은 바꿀 수 없어. 다른 엔진은 새 프로필로 만들어줘.')
    }
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
