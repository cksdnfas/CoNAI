import type { ChatJudgeChoiceOption, ChatJudgeFollowUp, ChatJudgeItem, ChatJudgePreset, ChatJudgePresetInput, ChatJudgeUncertain } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { ChatProfileError } from './chatProfileError'
import { JUDGE_FOLLOW_UP_DEFAULTS, JUDGE_ITEM_DEFAULTS } from './chatJudgeDefaults'

/**
 * Judge presets (see @conai/shared chatJudge): profiles reference one by id, so tuning a preset reaches every profile
 * that uses it. Items and follow-up settings are stored as JSON and normalized on every read and write.
 */

export const JUDGE_LIMITS = {
  name: 80,
  items: 16,
  itemName: 40,
  instructions: 2000,
  criteria: 600,
  options: 12,
  optionLabel: 40,
  directive: 2000,
  tools: 24,
  window: { min: 1, max: 30 },
  maxConsecutive: { min: 0, max: 3 },
  delaySeconds: { min: 0, max: 600 },
} as const

/** Connection types a judge preset can ask: the decision model, or an LLM answering in JSON. */
export const JUDGE_PROVIDER_TYPES = ['decision_typesafe', 'llm_openai_compatible', 'llm_ollama'] as const
const LLM_PROVIDER_TYPES = ['llm_openai_compatible', 'llm_ollama']
const UNCERTAIN: readonly ChatJudgeUncertain[] = ['default', 'yes', 'no', 'llm']
const ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
const TOOL_PATTERN = /^[a-z0-9_]{1,64}\*?$/

type PresetRow = {
  id: number
  name: string
  provider_name: string | null
  model: string
  escalation_provider_name: string | null
  escalation_model: string
  items: string
  follow_up: string
  created_date: string
  updated_date: string
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}

function text(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function clamp(value: unknown, range: { min: number; max: number }, fallback: number, integer = true) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(number)) return fallback
  const clamped = Math.min(range.max, Math.max(range.min, number))
  return integer ? Math.round(clamped) : clamped
}

function threshold(value: unknown, fallback: number) {
  return Math.round(clamp(value, { min: 0, max: 1 }, fallback, false) * 100) / 100
}

/** A free item id, derived from the name when none is given. */
function itemId(value: unknown, taken: Set<string>) {
  let id = typeof value === 'string' && ITEM_ID_PATTERN.test(value) ? value : ''
  if (!id || taken.has(id)) {
    let n = taken.size + 1
    while (taken.has(`item-${n}`)) n += 1
    id = `item-${n}`
  }
  taken.add(id)
  return id
}

function normalizeOptions(value: unknown): ChatJudgeChoiceOption[] {
  const list = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  return list.flatMap((entry) => {
    const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null
    const label = text(record?.label, JUDGE_LIMITS.optionLabel).replace(/\s+/g, '_')
    if (!label || seen.has(label.toLowerCase())) return []
    seen.add(label.toLowerCase())
    return [{ label, description: text(record?.description, JUDGE_LIMITS.criteria), yes: record?.yes === true }]
  }).slice(0, JUDGE_LIMITS.options)
}

export function normalizeJudgeItems(value: unknown): ChatJudgeItem[] {
  const list = Array.isArray(value) ? value : []
  const taken = new Set<string>()
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const instructions = text(record.instructions, JUDGE_LIMITS.instructions)
    const criteria = record.criteria && typeof record.criteria === 'object' ? record.criteria as Record<string, unknown> : {}
    const kind = record.kind === 'choice' ? 'choice' : 'noul'
    const stage = record.stage === 'after' ? 'after' : 'before'
    const yesThreshold = threshold(record.yesThreshold, JUDGE_ITEM_DEFAULTS.yesThreshold)
    const noThreshold = Math.min(yesThreshold, threshold(record.noThreshold, JUDGE_ITEM_DEFAULTS.noThreshold))
    const tools = [...new Set((Array.isArray(record.tools) ? record.tools : []).filter((tool): tool is string => typeof tool === 'string' && TOOL_PATTERN.test(tool)))].slice(0, JUDGE_LIMITS.tools)
    const item: ChatJudgeItem = {
      id: itemId(record.id, taken),
      name: text(record.name, JUDGE_LIMITS.itemName) || '판단 항목',
      enabled: record.enabled !== false,
      stage,
      kind,
      instructions,
      criteria: { yes: text(criteria.yes, JUDGE_LIMITS.criteria), no: text(criteria.no, JUDGE_LIMITS.criteria) },
      options: kind === 'choice' ? normalizeOptions(record.options) : [],
      window: clamp(record.window, JUDGE_LIMITS.window, JUDGE_ITEM_DEFAULTS.window),
      yesThreshold,
      noThreshold,
      uncertain: UNCERTAIN.includes(record.uncertain as ChatJudgeUncertain) ? record.uncertain as ChatJudgeUncertain : 'default',
      // After the reply an item only decides the follow-up; it has no tools to steer.
      tools: stage === 'after' ? [] : tools,
      directive: stage === 'after' ? '' : text(record.directive, JUDGE_LIMITS.directive),
    }
    return [item]
  }).slice(0, JUDGE_LIMITS.items)
}

/** Items the judge can actually ask: switched on, with a question, and a choice with a yes and a no option. */
export function askableJudgeItems(items: ChatJudgeItem[]) {
  return items.filter((item) => item.enabled && item.instructions && (item.kind === 'noul' || (item.options.length >= 2 && item.options.some((option) => option.yes) && item.options.some((option) => !option.yes))))
}

export function normalizeFollowUp(value: unknown): ChatJudgeFollowUp {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    maxConsecutive: clamp(record.maxConsecutive, JUDGE_LIMITS.maxConsecutive, JUDGE_FOLLOW_UP_DEFAULTS.maxConsecutive),
    delaySeconds: clamp(record.delaySeconds, JUDGE_LIMITS.delaySeconds, JUDGE_FOLLOW_UP_DEFAULTS.delaySeconds),
    directive: text(record.directive, JUDGE_LIMITS.directive),
  }
}

/** A judge connection name, checked: unknown or not a decision / LLM connection is refused. Empty: none. */
export function judgeConnectionName(value: unknown, kinds: readonly string[] = JUDGE_PROVIDER_TYPES) {
  const name = text(value, 200)
  if (!name) return null
  const provider = ExternalApiProvider.findByName(name)
  if (!provider || !kinds.includes(provider.provider_type)) throw new ChatProfileError(kinds === LLM_PROVIDER_TYPES ? 'LLM 연결을 찾을 수 없어.' : '판단 연결을 찾을 수 없어.')
  return name
}

/** A stored connection name, or null once that connection is gone (the next save clears it). */
export function existingJudgeConnection(name: string | null | undefined) {
  return name && ExternalApiProvider.findByName(name) ? name : null
}

function presetName(value: unknown) {
  const name = text(value, JUDGE_LIMITS.name)
  if (!name) throw new ChatProfileError('프리셋 이름을 적어줘.')
  return name
}

function profilesUsing(presetId: number) {
  return getUserSettingsDb().prepare('SELECT id, name FROM llm_chat_profiles WHERE judge_preset_id = ? ORDER BY sort_order ASC, id ASC').all(presetId) as Array<{ id: number; name: string }>
}

function toPreset(row: PresetRow): ChatJudgePreset {
  return {
    id: row.id,
    name: row.name,
    providerName: existingJudgeConnection(row.provider_name),
    model: row.model ?? '',
    escalationProviderName: existingJudgeConnection(row.escalation_provider_name),
    escalationModel: row.escalation_model ?? '',
    items: normalizeJudgeItems(parseJson(row.items)),
    followUp: normalizeFollowUp(parseJson(row.follow_up)),
    profiles: profilesUsing(row.id),
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

function toColumns(input: ChatJudgePresetInput) {
  return {
    name: presetName(input.name),
    provider_name: judgeConnectionName(input.providerName),
    model: text(input.model, 200),
    escalation_provider_name: judgeConnectionName(input.escalationProviderName, LLM_PROVIDER_TYPES),
    escalation_model: text(input.escalationModel, 200),
    items: JSON.stringify(normalizeJudgeItems(input.items)),
    follow_up: JSON.stringify(normalizeFollowUp(input.followUp)),
  }
}

export const ChatJudgePresetStore = {
  list() {
    const rows = getUserSettingsDb().prepare('SELECT * FROM chat_judge_presets ORDER BY name COLLATE NOCASE ASC, id ASC').all() as PresetRow[]
    return rows.map(toPreset)
  },

  find(presetId: number | null | undefined) {
    if (!presetId) return null
    const row = getUserSettingsDb().prepare('SELECT * FROM chat_judge_presets WHERE id = ?').get(presetId) as PresetRow | undefined
    return row ? toPreset(row) : null
  },

  /** The id when that preset exists, else null (a profile whose preset went missing has none). */
  existing(presetId: number | null | undefined) {
    if (!presetId) return null
    return getUserSettingsDb().prepare('SELECT 1 FROM chat_judge_presets WHERE id = ?').get(presetId) ? presetId : null
  },

  /** A preset as it would be saved, without saving it (testing an unsaved draft). */
  draft(input: ChatJudgePresetInput): ChatJudgePreset {
    const columns = toColumns({ ...input, name: input.name || '판단 프리셋' })
    return toPreset({ ...columns, id: 0, created_date: '', updated_date: '' })
  },

  create(input: ChatJudgePresetInput) {
    const columns = toColumns(input)
    const names = Object.keys(columns)
    const result = getUserSettingsDb().prepare(`INSERT INTO chat_judge_presets (${names.join(', ')}) VALUES (${names.map((name) => `@${name}`).join(', ')})`).run(columns)
    return ChatJudgePresetStore.find(Number(result.lastInsertRowid)) as ChatJudgePreset
  },

  update(presetId: number, patch: ChatJudgePresetInput) {
    const current = ChatJudgePresetStore.find(presetId)
    if (!current) return null
    const merged = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) }
    const columns = toColumns(merged)
    getUserSettingsDb().prepare(`UPDATE chat_judge_presets SET ${Object.keys(columns).map((name) => `${name} = @${name}`).join(', ')}, updated_date = CURRENT_TIMESTAMP WHERE id = @id`).run({ ...columns, id: presetId })
    return ChatJudgePresetStore.find(presetId)
  },

  /** Profiles that referenced it go back to judging nothing (exactly as without a judge). */
  delete(presetId: number) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      db.prepare('UPDATE llm_chat_profiles SET judge_preset_id = NULL WHERE judge_preset_id = ?').run(presetId)
      return db.prepare('DELETE FROM chat_judge_presets WHERE id = ?').run(presetId).changes > 0
    })()
  },
}

/** What a preset file holds: the export shape (`{ conai_judge_preset, preset }`), a bare preset, or an array of either. */
export function readJudgePresetFile(value: unknown): ChatJudgePresetInput[] {
  const entries = Array.isArray(value) ? value : [value]
  const read = entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const inner = record.preset && typeof record.preset === 'object' ? record.preset as Record<string, unknown> : record
    if (!Array.isArray(inner.items)) return []
    // Connections are this server's own; an imported preset picks its judge connection here.
    return [{ name: text(inner.name, JUDGE_LIMITS.name) || '판단 프리셋', items: normalizeJudgeItems(inner.items), followUp: normalizeFollowUp(inner.followUp) }]
  })
  if (read.length === 0) throw new ChatProfileError('가져올 판단 프리셋이 없어. 내보낸 프리셋 JSON을 골라줘.')
  return read.slice(0, 50)
}
