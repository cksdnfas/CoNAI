import { getUserSettingsDb } from '../../database/userSettingsDb'
import { CODEX_CHAT_SCOPES, type CodexChatScope } from './codexChatSettings'
import { LLM_CHAT_CONTEXT_TURNS_RANGE } from './llmChatSettings'

const NAME_MAX_LENGTH = 60
const MODEL_MAX_LENGTH = 200
const TEXT_MAX_LENGTH = 20_000
const AVATAR_MAX_LENGTH = 300_000
const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/

export type LlmChatProfile = {
  id: number
  name: string
  /** Small data URL (resized in the browser). */
  avatar: string | null
  /** `external_api_providers.provider_name` of an LLM connection. */
  providerName: string
  /** Empty uses the connection's default model. */
  model: string
  systemPrompt: string
  characterDescription: string
  exampleDialogue: string
  userPersona: string
  /** Stored as the first assistant message of a new chat. */
  greeting: string
  temperature: number | null
  maxTokens: number | null
  mcpEnabled: boolean
  mcpScopes: CodexChatScope[]
  /** Null inherits the global LLM chat settings. */
  contextTurns: number | null
  summaryEnabled: boolean | null
  /** Null summarizes with the chat's own connection/model. */
  summaryProviderName: string | null
  summaryModel: string
  isEnabled: boolean
  sortOrder: number
  createdDate: string
  updatedDate: string
}

export type LlmChatProfileInput = Partial<Omit<LlmChatProfile, 'id' | 'createdDate' | 'updatedDate'>>

type ProfileRow = {
  id: number
  name: string
  avatar: string | null
  provider_name: string
  model: string | null
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
  summary_enabled: number | null
  summary_provider_name: string | null
  summary_model: string | null
  is_enabled: number
  sort_order: number
  created_date: string
  updated_date: string
}

export class LlmChatProfileError extends Error {}

function parseScopes(value: unknown): CodexChatScope[] {
  let list: unknown = value
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value)
    } catch {
      list = []
    }
  }
  return Array.isArray(list) ? CODEX_CHAT_SCOPES.filter((scope) => list.includes(scope)) : []
}

function toProfile(row: ProfileRow): LlmChatProfile {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    providerName: row.provider_name,
    model: row.model ?? '',
    systemPrompt: row.system_prompt,
    characterDescription: row.character_description,
    exampleDialogue: row.example_dialogue,
    userPersona: row.user_persona,
    greeting: row.greeting,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    mcpEnabled: row.mcp_enabled === 1,
    mcpScopes: parseScopes(row.mcp_scopes),
    contextTurns: row.context_turns,
    summaryEnabled: row.summary_enabled === null ? null : row.summary_enabled === 1,
    summaryProviderName: row.summary_provider_name,
    summaryModel: row.summary_model ?? '',
    isEnabled: row.is_enabled === 1,
    sortOrder: row.sort_order,
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

function text(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function optionalNumber(value: unknown, min: number, max: number, integer: boolean) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new LlmChatProfileError('숫자 값이 올바르지 않아.')
  }
  const clamped = Math.min(max, Math.max(min, number))
  return integer ? Math.round(clamped) : clamped
}

/** Validate a full profile (create) or a merged update, returning the column values. */
function toColumns(input: LlmChatProfileInput) {
  const name = text(input.name, NAME_MAX_LENGTH)
  if (!name) {
    throw new LlmChatProfileError('프로필 이름이 필요해.')
  }
  const providerName = text(input.providerName, 200)
  if (!providerName) {
    throw new LlmChatProfileError('LLM 연결을 골라줘.')
  }
  const avatar = typeof input.avatar === 'string' && input.avatar ? input.avatar : null
  if (avatar && (avatar.length > AVATAR_MAX_LENGTH || !AVATAR_PATTERN.test(avatar))) {
    throw new LlmChatProfileError('아바타 이미지가 올바르지 않거나 너무 커.')
  }

  return {
    name,
    avatar,
    provider_name: providerName,
    model: text(input.model, MODEL_MAX_LENGTH) || null,
    system_prompt: text(input.systemPrompt, TEXT_MAX_LENGTH),
    character_description: text(input.characterDescription, TEXT_MAX_LENGTH),
    example_dialogue: text(input.exampleDialogue, TEXT_MAX_LENGTH),
    user_persona: text(input.userPersona, TEXT_MAX_LENGTH),
    greeting: text(input.greeting, TEXT_MAX_LENGTH),
    temperature: optionalNumber(input.temperature, 0, 2, false),
    max_tokens: optionalNumber(input.maxTokens, 1, 1_000_000, true),
    mcp_enabled: input.mcpEnabled ? 1 : 0,
    mcp_scopes: JSON.stringify(parseScopes(input.mcpScopes ?? ['read'])),
    context_turns: optionalNumber(input.contextTurns, LLM_CHAT_CONTEXT_TURNS_RANGE.min, LLM_CHAT_CONTEXT_TURNS_RANGE.max, true),
    summary_enabled: input.summaryEnabled === null || input.summaryEnabled === undefined ? null : input.summaryEnabled ? 1 : 0,
    summary_provider_name: text(input.summaryProviderName, 200) || null,
    summary_model: text(input.summaryModel, MODEL_MAX_LENGTH) || null,
    is_enabled: input.isEnabled === false ? 0 : 1,
    sort_order: optionalNumber(input.sortOrder, -1_000_000, 1_000_000, true) ?? 0,
  }
}

export const LlmChatProfileStore = {
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

  create(input: LlmChatProfileInput) {
    const columns = toColumns(input)
    const names = Object.keys(columns)
    const result = getUserSettingsDb().prepare(`
      INSERT INTO llm_chat_profiles (${names.join(', ')}) VALUES (${names.map((name) => `@${name}`).join(', ')})
    `).run(columns)
    return LlmChatProfileStore.find(Number(result.lastInsertRowid)) as LlmChatProfile
  },

  update(profileId: number, patch: LlmChatProfileInput) {
    const current = LlmChatProfileStore.find(profileId)
    if (!current) {
      return null
    }
    const columns = toColumns({ ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) })
    getUserSettingsDb().prepare(`
      UPDATE llm_chat_profiles SET ${Object.keys(columns).map((name) => `${name} = @${name}`).join(', ')}, updated_date = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...columns, id: profileId })
    return LlmChatProfileStore.find(profileId)
  },

  /** Chats that used the profile stay readable; they just can't send until it is restored. */
  delete(profileId: number) {
    return getUserSettingsDb().prepare('DELETE FROM llm_chat_profiles WHERE id = ?').run(profileId).changes > 0
  },
}
