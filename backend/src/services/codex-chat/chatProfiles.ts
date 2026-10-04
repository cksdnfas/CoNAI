import { isCodexReasoningEffort, type CodexReasoningEffort } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { CHAT_SCOPES, readLegacyCodexChatSettings, type ChatScope } from './chatSettings'

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
} as const

export const CHAT_PROFILE_DEFAULTS = {
  contextTurns: 20,
  summaryTriggerTurns: 6,
  maxToolRounds: 8,
} as const

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
  /** Small data URL (resized in the browser). */
  avatar: string | null
  engine: ChatProfileEngine
  /** LLM: `external_api_providers.provider_name`. Empty for Codex. */
  providerName: string
  /** Empty uses the connection's (LLM) or the CLI's (Codex) default model. */
  model: string
  /** Codex only; empty uses the CLI / model default. */
  reasoningEffort: CodexReasoningEffort | ''
  systemPrompt: string
  characterDescription: string
  exampleDialogue: string
  userPersona: string
  /** Stored as the first assistant message of a new chat. */
  greeting: string
  temperature: number | null
  maxTokens: number | null
  mcpEnabled: boolean
  mcpScopes: ChatScope[]
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
  /** Model ↔ tool round trips allowed in one reply. */
  maxToolRounds: number
  isEnabled: boolean
  sortOrder: number
  createdDate: string
  updatedDate: string
}

export type ChatProfileInput = Partial<Omit<ChatProfile, 'id' | 'createdDate' | 'updatedDate'>>

type ProfileRow = {
  id: number
  name: string
  avatar: string | null
  engine: string | null
  provider_name: string
  model: string | null
  reasoning_effort: string | null
  system_prompt: string
  character_description: string
  example_dialogue: string
  user_persona: string
  greeting: string
  temperature: number | null
  max_tokens: number | null
  mcp_enabled: number
  mcp_scopes: string
  context_turns: number | null
  context_tokens: number | null
  summary_enabled: number | null
  summary_trigger_turns: number | null
  summary_prompt: string | null
  summary_provider_name: string | null
  summary_model: string | null
  max_tool_rounds: number | null
  is_enabled: number
  sort_order: number
  created_date: string
  updated_date: string
}

export class ChatProfileError extends Error {}

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

function toProfile(row: ProfileRow): ChatProfile {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    engine: row.engine === 'codex' ? 'codex' : 'llm',
    providerName: row.provider_name,
    model: row.model ?? '',
    reasoningEffort: isCodexReasoningEffort(row.reasoning_effort) ? row.reasoning_effort : '',
    systemPrompt: row.system_prompt,
    characterDescription: row.character_description,
    exampleDialogue: row.example_dialogue,
    userPersona: row.user_persona,
    greeting: row.greeting,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    mcpEnabled: row.mcp_enabled === 1,
    mcpScopes: parseScopes(row.mcp_scopes),
    contextTurns: row.context_turns ?? CHAT_PROFILE_DEFAULTS.contextTurns,
    contextTokens: row.context_tokens,
    summaryEnabled: row.summary_enabled === 1,
    summaryTriggerTurns: row.summary_trigger_turns ?? CHAT_PROFILE_DEFAULTS.summaryTriggerTurns,
    summaryPrompt: row.summary_prompt ?? '',
    summaryProviderName: row.summary_provider_name,
    summaryModel: row.summary_model ?? '',
    maxToolRounds: row.max_tool_rounds ?? CHAT_PROFILE_DEFAULTS.maxToolRounds,
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

/** The summary prompt a profile actually uses. */
export function resolveSummaryPrompt(profile: ChatProfile) {
  return profile.summaryPrompt.trim() || DEFAULT_CHAT_SUMMARY_PROMPT
}

/** Validate a full profile (create) or a merged update, returning the column values. */
function toColumns(input: ChatProfileInput) {
  const name = text(input.name, NAME_MAX_LENGTH)
  if (!name) {
    throw new ChatProfileError('프로필 이름이 필요해.')
  }
  const engine: ChatProfileEngine = input.engine === 'codex' ? 'codex' : 'llm'
  const providerName = engine === 'llm' ? text(input.providerName, 200) : ''
  if (engine === 'llm' && !providerName) {
    throw new ChatProfileError('LLM 연결을 골라줘.')
  }
  const avatar = typeof input.avatar === 'string' && input.avatar ? input.avatar : null
  if (avatar && (avatar.length > AVATAR_MAX_LENGTH || !AVATAR_PATTERN.test(avatar))) {
    throw new ChatProfileError('아바타 이미지가 올바르지 않거나 너무 커.')
  }
  if (input.reasoningEffort && !isCodexReasoningEffort(input.reasoningEffort)) {
    throw new ChatProfileError('추론 강도 값이 올바르지 않아.')
  }

  return {
    name,
    avatar,
    engine,
    provider_name: providerName,
    model: text(input.model, MODEL_MAX_LENGTH) || null,
    reasoning_effort: engine === 'codex' && input.reasoningEffort ? input.reasoningEffort : null,
    system_prompt: text(input.systemPrompt, TEXT_MAX_LENGTH),
    character_description: text(input.characterDescription, TEXT_MAX_LENGTH),
    example_dialogue: text(input.exampleDialogue, TEXT_MAX_LENGTH),
    user_persona: text(input.userPersona, TEXT_MAX_LENGTH),
    greeting: text(input.greeting, TEXT_MAX_LENGTH),
    temperature: optionalNumber(input.temperature, { min: 0, max: 2 }, false),
    max_tokens: optionalNumber(input.maxTokens, { min: 1, max: 1_000_000 }, true),
    mcp_enabled: input.mcpEnabled ? 1 : 0,
    mcp_scopes: JSON.stringify(parseScopes(input.mcpScopes ?? ['read'])),
    context_turns: optionalNumber(input.contextTurns, CHAT_PROFILE_LIMITS.contextTurns, true) ?? CHAT_PROFILE_DEFAULTS.contextTurns,
    context_tokens: optionalNumber(input.contextTokens, CHAT_PROFILE_LIMITS.contextTokens, true),
    summary_enabled: input.summaryEnabled ? 1 : 0,
    summary_trigger_turns: optionalNumber(input.summaryTriggerTurns, CHAT_PROFILE_LIMITS.summaryTriggerTurns, true) ?? CHAT_PROFILE_DEFAULTS.summaryTriggerTurns,
    summary_prompt: text(input.summaryPrompt, 4000),
    summary_provider_name: text(input.summaryProviderName, 200) || null,
    summary_model: text(input.summaryModel, MODEL_MAX_LENGTH) || null,
    max_tool_rounds: optionalNumber(input.maxToolRounds, CHAT_PROFILE_LIMITS.maxToolRounds, true) ?? CHAT_PROFILE_DEFAULTS.maxToolRounds,
    is_enabled: input.isEnabled === false ? 0 : 1,
    sort_order: optionalNumber(input.sortOrder, { min: -1_000_000, max: 1_000_000 }, true) ?? 0,
  }
}

export const ChatProfileStore = {
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
