import type { ChatJudgeChoiceOption, ChatJudgeFollowUp, ChatJudgeItem, ChatJudgePreset, ChatJudgePresetInput, ChatJudgeUncertain } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ChatProfileError } from './chatProfileError'
import { LLM_CONNECTION_TYPES, MODEL_CONNECTION_TYPES, ModelSlotStore } from './modelSlots'
import { JUDGE_FOLLOW_UP_DEFAULTS, JUDGE_ITEM_DEFAULTS, JUDGE_OPTION_DEFAULTS, type JudgeOptions } from './chatJudgeDefaults'

/**
 * Judge presets (see @conai/shared chatJudge): profiles and group rooms reference one by id, so tuning a preset reaches
 * everything that uses it. Items, follow-up settings and the other sections are stored as JSON and normalized on every
 * read and write.
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
  loreCandidates: { min: 1, max: 12 },
} as const

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
  model_slot_id: number | null
  escalation_slot_id: number | null
  items: string
  follow_up: string
  options: string | null
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** The preset's sections beyond its items, each field falling back to its default. */
export function normalizeJudgeOptions(value: unknown): JudgeOptions {
  const options = record(value)
  const defaults = JUDGE_OPTION_DEFAULTS
  const room = record(options.room)
  const route = record(room.route)
  const next = record(room.next)
  const context = record(options.context)
  const lore = record(context.lore)
  const recall = record(context.recall)
  const fields = record(options.fields)
  const assets = record(options.assets)
  const enabled = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
  return {
    room: {
      window: clamp(room.window, JUDGE_LIMITS.window, defaults.room.window),
      route: { enabled: enabled(route.enabled, defaults.room.route.enabled), instructions: text(route.instructions, JUDGE_LIMITS.instructions), minProbability: threshold(route.minProbability, defaults.room.route.minProbability) },
      next: { enabled: enabled(next.enabled, defaults.room.next.enabled), instructions: text(next.instructions, JUDGE_LIMITS.instructions), continueThreshold: threshold(next.continueThreshold, defaults.room.next.continueThreshold) },
    },
    context: {
      window: clamp(context.window, JUDGE_LIMITS.window, defaults.context.window),
      lore: { enabled: enabled(lore.enabled, defaults.context.lore.enabled), candidates: clamp(lore.candidates, JUDGE_LIMITS.loreCandidates, defaults.context.lore.candidates), threshold: threshold(lore.threshold, defaults.context.lore.threshold) },
      recall: { enabled: enabled(recall.enabled, defaults.context.recall.enabled), threshold: threshold(recall.threshold, defaults.context.recall.threshold) },
    },
    fields: { enabled: enabled(fields.enabled, defaults.fields.enabled), window: clamp(fields.window, JUDGE_LIMITS.window, defaults.fields.window), threshold: threshold(fields.threshold, defaults.fields.threshold) },
    assets: { enabled: enabled(assets.enabled, defaults.assets.enabled) },
  }
}

/**
 * A judge model row: its id, or a legacy connection + model pair landing on that connection's row (not created for a
 * draft). Judges ask TypeSafe or LLM models; the escalation only LLM ones. Empty: none.
 */
function judgeSlot(slotId: unknown, providerName: unknown, model: unknown, kinds: readonly string[], draft: boolean) {
  if (slotId !== null && slotId !== undefined && slotId !== '') return ModelSlotStore.checked(slotId, kinds)
  if (typeof providerName !== 'string' || !providerName.trim()) return null
  const id = ModelSlotStore.ensure(providerName, model, { create: !draft })
  return id === null ? null : ModelSlotStore.checked(id, kinds)
}

function presetName(value: unknown) {
  const name = text(value, JUDGE_LIMITS.name)
  if (!name) throw new ChatProfileError('프리셋 이름을 적어줘.')
  return name
}

function profilesUsing(presetId: number) {
  return getUserSettingsDb().prepare('SELECT id, name FROM llm_chat_profiles WHERE judge_preset_id = ? ORDER BY sort_order ASC, id ASC').all(presetId) as Array<{ id: number; name: string }>
}

function roomsUsing(presetId: number) {
  return getUserSettingsDb().prepare("SELECT id, COALESCE(title, '') AS title FROM codex_chat_threads WHERE judge_preset_id = ? AND kind = 'group' ORDER BY id ASC").all(presetId) as Array<{ id: number; title: string }>
}

function toPreset(row: PresetRow): ChatJudgePreset {
  return {
    id: row.id,
    name: row.name,
    modelSlotId: ModelSlotStore.existing(row.model_slot_id),
    escalationSlotId: ModelSlotStore.existing(row.escalation_slot_id),
    items: normalizeJudgeItems(parseJson(row.items)),
    followUp: normalizeFollowUp(parseJson(row.follow_up)),
    ...normalizeJudgeOptions(parseJson(row.options)),
    profiles: profilesUsing(row.id),
    rooms: row.id ? roomsUsing(row.id) : [],
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

function toColumns(input: ChatJudgePresetInput, draft = false) {
  return {
    name: presetName(input.name),
    // The pair columns are the older form of the model rows; a save clears them.
    provider_name: null,
    model: '',
    escalation_provider_name: null,
    escalation_model: '',
    model_slot_id: judgeSlot(input.modelSlotId, input.providerName, input.model, MODEL_CONNECTION_TYPES, draft),
    escalation_slot_id: judgeSlot(input.escalationSlotId, input.escalationProviderName, input.escalationModel, LLM_CONNECTION_TYPES, draft),
    items: JSON.stringify(normalizeJudgeItems(input.items)),
    follow_up: JSON.stringify(normalizeFollowUp(input.followUp)),
    options: JSON.stringify(normalizeJudgeOptions({ room: input.room, context: input.context, fields: input.fields, assets: input.assets })),
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
    const columns = toColumns({ ...input, name: input.name || '판단 프리셋' }, true)
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
    const merged: ChatJudgePresetInput = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) }
    // A legacy pair in the patch replaces the current row unless the patch names a row too.
    if (patch.providerName && patch.modelSlotId === undefined) delete merged.modelSlotId
    if (patch.escalationProviderName && patch.escalationSlotId === undefined) delete merged.escalationSlotId
    const columns = toColumns(merged)
    getUserSettingsDb().prepare(`UPDATE chat_judge_presets SET ${Object.keys(columns).map((name) => `${name} = @${name}`).join(', ')}, updated_date = CURRENT_TIMESTAMP WHERE id = @id`).run({ ...columns, id: presetId })
    return ChatJudgePresetStore.find(presetId)
  },

  /** Profiles and rooms that referenced it go back to judging nothing (exactly as without a judge). */
  delete(presetId: number) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      db.prepare('UPDATE llm_chat_profiles SET judge_preset_id = NULL WHERE judge_preset_id = ?').run(presetId)
      db.prepare('UPDATE codex_chat_threads SET judge_preset_id = NULL WHERE judge_preset_id = ?').run(presetId)
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
    return [{ name: text(inner.name, JUDGE_LIMITS.name) || '판단 프리셋', items: normalizeJudgeItems(inner.items), followUp: normalizeFollowUp(inner.followUp), ...normalizeJudgeOptions(inner) }]
  })
  if (read.length === 0) throw new ChatProfileError('가져올 판단 프리셋이 없어. 내보낸 프리셋 JSON을 골라줘.')
  return read.slice(0, 50)
}
