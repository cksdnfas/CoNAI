import { randomUUID } from 'node:crypto'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { ChatProfileError } from './chatProfileError'
import { TYPESAFE_DEFAULT_MODEL } from '../judge/typesafeClient'

/**
 * The models of the LLM connections. A connection is a server (address, key, limits); each row here is one model it
 * serves, listed under it in Settings → LLM. Chat profiles (per role, and their judge), judge presets, user profiles
 * and chats reference rows by id and resolve them at request time, so changing a row's model reaches everything that
 * uses it. One row is the default (★): new profiles start on it and a chat role with no model of its own uses it.
 * The table and the code keep the older "slot" name.
 */
export type ModelRole = 'chat' | 'summary' | 'translation' | 'suggest'

export const MODEL_ROLES: readonly ModelRole[] = ['chat', 'summary', 'translation', 'suggest']

/** What a profile uses a row for: one of its model roles, or its judge. */
export type ModelUseRole = ModelRole | 'judge'

/** Connections whose models chat roles can use. */
export const LLM_CONNECTION_TYPES: readonly string[] = ['llm_openai_compatible', 'llm_ollama']
/** Connections that hold models at all: the LLM ones and the TypeSafe decision models (judges only). */
export const MODEL_CONNECTION_TYPES: readonly string[] = [...LLM_CONNECTION_TYPES, 'decision_typesafe']

export type ModelSlot = {
  id: number
  providerName: string
  /** The connection's display name (its name when it has none or is gone). */
  providerLabel: string
  /** Null when the connection is gone. */
  providerType: string | null
  model: string
  /** `connection · model`, how pickers name the row. */
  label: string
  isDefault: boolean
  sortOrder: number
  /**
   * The highest rating tier (rating_tiers.tier_order) of media this model may be shown; null: no ceiling. Profiles
   * that follow their model, workflow nodes and vision reviews use it (chatContentRating.ts).
   */
  contentRatingMaxTier: number | null
  /** Profiles that reference this row, with what they use it for. */
  profiles: Array<{ id: number; name: string; roles: ModelUseRole[] }>
  /** Judge presets that ask this model (as the judge or as the escalation LLM). */
  judgePresets: Array<{ id: number; name: string }>
  /** User profiles that write reply suggestions with it. */
  userProfiles: number
  /** Chats whose completion reaction uses it. */
  chats: number
  createdDate: string
  updatedDate: string
}

/** The request-time lookup of a row. */
export type ModelTarget = { id: number; providerName: string; model: string; label: string }

/** The llm_chat_profiles slot column of each role. */
export const ROLE_SLOT_COLUMNS: Record<ModelRole, string> = {
  chat: 'model_slot_id',
  summary: 'summary_slot_id',
  translation: 'translation_slot_id',
  suggest: 'suggest_slot_id',
}

const MODEL_MAX_LENGTH = 200

type SlotRow = {
  id: number
  provider_name: string
  model: string
  is_default: number
  sort_order: number
  content_rating_max_tier: number | null
  created_date: string
  updated_date: string
}

type ProfileUseRow = { id: number; name: string; engine: string | null; model_slot_id: number | null; summary_slot_id: number | null; translation_slot_id: number | null; suggest_slot_id: number | null; judge_slot_id: number | null }

type Usage = {
  profiles: Map<number, ModelSlot['profiles']>
  judgePresets: Map<number, ModelSlot['judgePresets']>
  userProfiles: Map<number, number>
  chats: Map<number, number>
}

function push<T>(map: Map<number, T[]>, key: number | null, value: T) {
  if (key === null) return
  const list = map.get(key) ?? []
  list.push(value)
  map.set(key, list)
}

function count(map: Map<number, number>, key: number | null) {
  if (key !== null) map.set(key, (map.get(key) ?? 0) + 1)
}

/** Every reference to every row, read once per listing. */
function collectUsage(): Usage {
  const db = getUserSettingsDb()
  const usage: Usage = { profiles: new Map(), judgePresets: new Map(), userProfiles: new Map(), chats: new Map() }
  const profiles = db.prepare(`
    SELECT id, name, engine, model_slot_id, summary_slot_id, translation_slot_id, suggest_slot_id, judge_slot_id FROM llm_chat_profiles
    WHERE model_slot_id IS NOT NULL OR summary_slot_id IS NOT NULL OR translation_slot_id IS NOT NULL OR suggest_slot_id IS NOT NULL OR judge_slot_id IS NOT NULL
    ORDER BY sort_order ASC, id ASC
  `).all() as ProfileUseRow[]
  for (const profile of profiles) {
    const bySlot = new Map<number, ModelUseRole[]>()
    const add = (slotId: number | null, role: ModelUseRole) => {
      if (slotId !== null) bySlot.set(slotId, [...(bySlot.get(slotId) ?? []), role])
    }
    for (const role of MODEL_ROLES) add(profile[ROLE_SLOT_COLUMNS[role] as keyof ProfileUseRow] as number | null, role)
    add(profile.judge_slot_id, 'judge')
    for (const [slotId, roles] of bySlot) push(usage.profiles, slotId, { id: profile.id, name: profile.name, roles })
  }
  const presets = db.prepare('SELECT id, name, model_slot_id, escalation_slot_id FROM chat_judge_presets ORDER BY name COLLATE NOCASE ASC, id ASC').all() as Array<{ id: number; name: string; model_slot_id: number | null; escalation_slot_id: number | null }>
  for (const preset of presets) {
    push(usage.judgePresets, preset.model_slot_id, { id: preset.id, name: preset.name })
    if (preset.escalation_slot_id !== preset.model_slot_id) push(usage.judgePresets, preset.escalation_slot_id, { id: preset.id, name: preset.name })
  }
  for (const row of db.prepare('SELECT model_slot_id FROM chat_user_profiles WHERE model_slot_id IS NOT NULL').all() as Array<{ model_slot_id: number }>) count(usage.userProfiles, row.model_slot_id)
  for (const row of db.prepare('SELECT reaction_model_slot_id FROM codex_chat_threads WHERE reaction_model_slot_id IS NOT NULL').all() as Array<{ reaction_model_slot_id: number }>) count(usage.chats, row.reaction_model_slot_id)
  return usage
}

function connectionOf(providerName: string) {
  const provider = ExternalApiProvider.findByName(providerName)
  return { label: provider?.display_name || providerName, type: provider?.provider_type ?? null }
}

function toSlot(row: SlotRow, usage: Usage, connections: Map<string, { label: string; type: string | null }>): ModelSlot {
  const connection = connections.get(row.provider_name) ?? connectionOf(row.provider_name)
  connections.set(row.provider_name, connection)
  return {
    id: row.id,
    providerName: row.provider_name,
    providerLabel: connection.label,
    providerType: connection.type,
    model: row.model,
    label: `${connection.label} · ${row.model}`,
    isDefault: row.is_default === 1,
    sortOrder: row.sort_order,
    contentRatingMaxTier: row.content_rating_max_tier ?? null,
    profiles: usage.profiles.get(row.id) ?? [],
    judgePresets: usage.judgePresets.get(row.id) ?? [],
    userProfiles: usage.userProfiles.get(row.id) ?? 0,
    chats: usage.chats.get(row.id) ?? 0,
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

export function isSlotUsed(slot: Pick<ModelSlot, 'profiles' | 'judgePresets' | 'userProfiles' | 'chats'>) {
  return slot.profiles.length > 0 || slot.judgePresets.length > 0 || slot.userProfiles > 0 || slot.chats > 0
}

/** "세라, 미나 · 판단 프리셋 기본 · 사용자 프로필 2" — who holds a row, for refusals. */
function describeUse(slot: ModelSlot) {
  return [
    slot.profiles.length > 0 ? slot.profiles.map((profile) => profile.name).join(', ') : null,
    slot.judgePresets.length > 0 ? `판단 프리셋 ${slot.judgePresets.map((preset) => preset.name).join(', ')}` : null,
    slot.userProfiles > 0 ? `사용자 프로필 ${slot.userProfiles}` : null,
    slot.chats > 0 ? `채팅 반응 ${slot.chats}` : null,
  ].filter(Boolean).join(' · ')
}

function modelName(value: unknown) {
  const model = typeof value === 'string' ? value.trim() : ''
  if (model.length < 1 || model.length > MODEL_MAX_LENGTH) throw new ChatProfileError('모델 ID를 적어줘. 200자까지 쓸 수 있어.')
  return model
}

/** A saved content rating ceiling: null (none) or a tier position (rating_tiers.tier_order). */
export function contentRatingTier(value: unknown): number | null {
  if (value === null || value === '') return null
  const tier = Number(value)
  if (!Number.isSafeInteger(tier) || tier < 1 || tier > 1000) throw new ChatProfileError('허용 등급 값이 올바르지 않아.')
  return tier
}

function modelConnectionName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  const provider = name ? ExternalApiProvider.findByName(name) : null
  if (!provider || !MODEL_CONNECTION_TYPES.includes(provider.provider_type)) throw new ChatProfileError('LLM 연결을 찾을 수 없어.')
  return provider.provider_name
}

const LLM_ROW_SQL = `SELECT s.id FROM llm_model_slots s JOIN external_api_providers p ON p.provider_name = s.provider_name
  WHERE p.provider_type IN (${LLM_CONNECTION_TYPES.map((type) => `'${type}'`).join(', ')})`

/**
 * Keeps exactly one default while any LLM row exists: the given row, else the first LLM row when none is marked.
 * Only an LLM model can be the default (it is what chats fall back to); TypeSafe rows never are.
 */
function settleDefault(preferId?: number) {
  const db = getUserSettingsDb()
  if (preferId !== undefined) {
    db.prepare('UPDATE llm_model_slots SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(preferId)
    return
  }
  if (db.prepare(`${LLM_ROW_SQL} AND s.is_default = 1`).get()) return
  db.prepare('UPDATE llm_model_slots SET is_default = 0').run()
  const first = db.prepare(`${LLM_ROW_SQL} ORDER BY s.sort_order ASC, s.id ASC LIMIT 1`).get() as { id: number } | undefined
  if (first) db.prepare('UPDATE llm_model_slots SET is_default = 1 WHERE id = ?').run(first.id)
}

function insertRow(providerName: string, model: string) {
  const db = getUserSettingsDb()
  const sortOrder = ((db.prepare('SELECT MAX(sort_order) AS max FROM llm_model_slots').get() as { max: number | null }).max ?? -1) + 1
  // The name column is a leftover of named slots (unique, not shown); a fresh token keeps it unique.
  const id = Number(db.prepare('INSERT INTO llm_model_slots (name, provider_name, model, sort_order) VALUES (?, ?, ?, ?)').run(randomUUID(), providerName, model, sortOrder).lastInsertRowid)
  settleDefault()
  return id
}

function findRowId(providerName: string, model: string) {
  const row = getUserSettingsDb().prepare('SELECT id FROM llm_model_slots WHERE provider_name = ? AND model = ? ORDER BY id ASC LIMIT 1').get(providerName, model) as { id: number } | undefined
  return row?.id ?? null
}

export const ModelSlotStore = {
  list() {
    const rows = getUserSettingsDb().prepare('SELECT * FROM llm_model_slots ORDER BY sort_order ASC, id ASC').all() as SlotRow[]
    const usage = collectUsage()
    const connections = new Map<string, { label: string; type: string | null }>()
    return rows.map((row) => toSlot(row, usage, connections))
  },

  find(slotId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM llm_model_slots WHERE id = ?').get(slotId) as SlotRow | undefined
    return row ? toSlot(row, collectUsage(), new Map()) : null
  },

  findDefault() {
    const row = getUserSettingsDb().prepare('SELECT * FROM llm_model_slots WHERE is_default = 1 ORDER BY id ASC LIMIT 1').get() as SlotRow | undefined
    return row ? toSlot(row, collectUsage(), new Map()) : null
  },

  /** The connection + model of a row without its usage (the request-time lookup). */
  target(slotId: number | null | undefined): ModelTarget | null {
    if (slotId === null || slotId === undefined) return null
    const row = getUserSettingsDb().prepare('SELECT id, provider_name, model FROM llm_model_slots WHERE id = ?').get(slotId) as Pick<SlotRow, 'id' | 'provider_name' | 'model'> | undefined
    return row ? { id: row.id, providerName: row.provider_name, model: row.model, label: `${connectionOf(row.provider_name).label} · ${row.model}` } : null
  },

  defaultTarget(): ModelTarget | null {
    const row = getUserSettingsDb().prepare('SELECT id FROM llm_model_slots WHERE is_default = 1 ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined
    return row ? ModelSlotStore.target(row.id) : null
  },

  /** A row's content rating ceiling (see ModelSlot.contentRatingMaxTier); null for no ceiling or no such row. */
  contentRatingMaxTier(slotId: number | null | undefined): number | null {
    if (slotId === null || slotId === undefined) return null
    const row = getUserSettingsDb().prepare('SELECT content_rating_max_tier FROM llm_model_slots WHERE id = ?').get(slotId) as { content_rating_max_tier: number | null } | undefined
    return row?.content_rating_max_tier ?? null
  },

  /** The id when that row exists, else null. */
  existing(slotId: unknown): number | null {
    const id = Number(slotId)
    if (slotId === null || slotId === undefined || slotId === '' || !Number.isSafeInteger(id) || id <= 0) return null
    const row = getUserSettingsDb().prepare('SELECT id FROM llm_model_slots WHERE id = ?').get(id) as { id: number } | undefined
    return row ? row.id : null
  },

  /**
   * A row id for a saved field: null for empty, else the row, which must exist and sit on a connection of `kinds`
   * (a connection that is gone passes, so a profile saved before it went keeps saving).
   */
  checked(slotId: unknown, kinds: readonly string[] = LLM_CONNECTION_TYPES): number | null {
    if (slotId === null || slotId === undefined || slotId === '') return null
    const id = ModelSlotStore.existing(slotId)
    const target = id === null ? null : ModelSlotStore.target(id)
    if (!target) throw new ChatProfileError('모델을 찾을 수 없어.')
    const type = ExternalApiProvider.findByName(target.providerName)?.provider_type
    if (type && !kinds.includes(type)) throw new ChatProfileError(kinds.includes('decision_typesafe') ? '판단에 쓸 수 없는 모델이야.' : '판단 모델은 채팅에 쓸 수 없어. LLM 연결의 모델을 골라줘.')
    return id
  },

  /**
   * The row of a connection's model, created when missing; null when it does not exist and `create` is false.
   * An empty model means the connection's primary model. Callers that still send a connection + model pair (old
   * clients, MCP, card import) land on a row this way.
   */
  ensure(providerName: unknown, model: unknown, options: { create?: boolean } = {}): number | null {
    const connection = modelConnectionName(providerName)
    // A TypeSafe connection with no model of its own asks TypeSafe's default model.
    const fallback = () => primaryModelOf(connection) ?? (ExternalApiProvider.findByName(connection)?.provider_type === 'decision_typesafe' ? TYPESAFE_DEFAULT_MODEL : null)
    const name = typeof model === 'string' && model.trim() ? modelName(model) : fallback()
    if (!name) throw new ChatProfileError('이 연결에 등록된 모델이 없어. 설정 › LLM에서 모델을 먼저 추가해줘.')
    const found = findRowId(connection, name)
    if (found !== null || options.create === false) return found
    return insertRow(connection, name)
  },

  /** Rows of one connection, in list order. */
  ofConnection(providerName: string) {
    return ModelSlotStore.list().filter((slot) => slot.providerName === providerName)
  },

  /**
   * Make a connection's rows exactly `models` (in that order): missing ones are added, the rest removed. A row still in
   * use is never removed; the whole change is refused instead, naming who uses it.
   */
  syncConnection(providerName: unknown, models: unknown) {
    const connection = modelConnectionName(providerName)
    if (!Array.isArray(models)) throw new ChatProfileError('모델 목록이 필요해.')
    const wanted = [...new Set(models.map(modelName))]
    const db = getUserSettingsDb()
    db.transaction(() => {
      const current = ModelSlotStore.ofConnection(connection)
      const blocked = current.filter((slot) => !wanted.includes(slot.model) && isSlotUsed(slot))
      if (blocked.length > 0) {
        throw new ChatProfileError(`쓰는 곳이 있어서 뺄 수 없어: ${blocked.map((slot) => `${slot.model} (${describeUse(slot)})`).join(', ')}`)
      }
      for (const slot of current) {
        if (!wanted.includes(slot.model)) db.prepare('DELETE FROM llm_model_slots WHERE id = ?').run(slot.id)
      }
      for (const model of wanted) {
        if (findRowId(connection, model) === null) insertRow(connection, model)
      }
      // Rows of this connection follow the order of the list, inside the connection's place in the overall order.
      const ids = wanted.map((model) => findRowId(connection, model) as number)
      const orders = (db.prepare(`SELECT sort_order FROM llm_model_slots WHERE id IN (${ids.map(() => '?').join(', ') || 'NULL'}) ORDER BY sort_order ASC`).all(...ids) as Array<{ sort_order: number }>).map((row) => row.sort_order)
      ids.forEach((id, index) => db.prepare('UPDATE llm_model_slots SET sort_order = ? WHERE id = ?').run(orders[index], id))
      settleDefault()
    })()
    return ModelSlotStore.ofConnection(connection)
  },

  /** Change a row's model or content rating ceiling; everything that references the row follows. Null when the row does not exist. */
  update(slotId: number, input: { model?: unknown; isDefault?: unknown; contentRatingMaxTier?: unknown }) {
    const db = getUserSettingsDb()
    const current = ModelSlotStore.target(slotId)
    if (!current) return null
    const model = input.model === undefined ? current.model : modelName(input.model)
    db.transaction(() => {
      const taken = findRowId(current.providerName, model)
      if (taken !== null && taken !== slotId) throw new ChatProfileError('이 연결에 같은 모델이 이미 있어.')
      db.prepare("UPDATE llm_model_slots SET model = ?, updated_date = datetime('now') WHERE id = ?").run(model, slotId)
      if (input.contentRatingMaxTier !== undefined) {
        db.prepare('UPDATE llm_model_slots SET content_rating_max_tier = ? WHERE id = ?').run(contentRatingTier(input.contentRatingMaxTier), slotId)
      }
      if (input.isDefault === true) ModelSlotStore.setDefault(slotId)
    })()
    return ModelSlotStore.find(slotId)
  },

  /** The one default row: the new-profile starting point and the model of a chat role with none of its own. */
  setDefault(slotId: number) {
    const target = ModelSlotStore.target(slotId)
    if (!target) return null
    const type = ExternalApiProvider.findByName(target.providerName)?.provider_type
    if (!type || !LLM_CONNECTION_TYPES.includes(type)) throw new ChatProfileError('기본 모델은 LLM 연결의 모델만 될 수 있어.')
    settleDefault(slotId)
    return ModelSlotStore.find(slotId)
  },

  /** Removes an unused row (refused while anything references it); the default passes to the first row left. */
  delete(slotId: number) {
    const slot = ModelSlotStore.find(slotId)
    if (!slot) return false
    if (isSlotUsed(slot)) throw new ChatProfileError(`쓰는 곳이 있어서 지울 수 없어: ${describeUse(slot)}`)
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const deleted = db.prepare('DELETE FROM llm_model_slots WHERE id = ?').run(slotId).changes > 0
      settleDefault()
      return deleted
    })()
  },
}

/** A connection's primary model: its default row when the default is on it, else its first row; null with none. */
export function primaryModelOf(providerName: string): string | null {
  const row = getUserSettingsDb().prepare('SELECT model FROM llm_model_slots WHERE provider_name = ? ORDER BY is_default DESC, sort_order ASC, id ASC LIMIT 1').get(providerName) as { model: string } | undefined
  return row?.model ?? null
}

/** Rows of this connection that something still uses (what blocks deleting the connection), with who uses them. */
export function modelReferencesOfConnection(providerName: string): { models: string[] } {
  return { models: ModelSlotStore.ofConnection(providerName).filter(isSlotUsed).map((slot) => `${slot.model} (${describeUse(slot)})`) }
}

/** Drop a deleted connection's rows (all unused, see modelReferencesOfConnection). */
export function deleteModelsOfConnection(providerName: string) {
  const db = getUserSettingsDb()
  db.transaction(() => {
    db.prepare('DELETE FROM llm_model_slots WHERE provider_name = ?').run(providerName)
    settleDefault()
  })()
}

/**
 * A connection saved with a `default_model` key (an API caller, an old client): the model becomes one of its rows
 * and the key is dropped, since a connection no longer holds a model of its own.
 */
export function adoptConnectionDefaultModel(providerName: string) {
  const db = getUserSettingsDb()
  const row = db.prepare('SELECT provider_type, additional_config FROM external_api_providers WHERE provider_name = ?').get(providerName) as { provider_type: string; additional_config: string | null } | undefined
  if (!row?.additional_config || !MODEL_CONNECTION_TYPES.includes(row.provider_type)) return
  let config: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(row.additional_config)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    config = parsed as Record<string, unknown>
  } catch {
    return
  }
  if (!('default_model' in config) && !('model' in config)) return
  const model = [config.default_model, config.model].find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
  db.transaction(() => {
    if (model && findRowId(providerName, model) === null) insertRow(providerName, model)
    const next = { ...config }
    delete next.default_model
    delete next.model
    db.prepare('UPDATE external_api_providers SET additional_config = ?, updated_at = CURRENT_TIMESTAMP WHERE provider_name = ?').run(JSON.stringify(next), providerName)
  })()
}
