import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { ChatProfileError } from './chatProfileError'

/**
 * A model slot: a named LLM connection + model. Chat profiles (and, through them, workflow nodes) reference slots by id
 * per role and resolve them at request time, so changing a slot's model reaches every profile that uses it.
 * Slots hold connection + model only; temperature, reasoning and the like stay on the profile.
 */
export type ModelRole = 'chat' | 'summary' | 'translation' | 'suggest'

export const MODEL_ROLES: readonly ModelRole[] = ['chat', 'summary', 'translation', 'suggest']

export type ModelSlot = {
  id: number
  name: string
  providerName: string
  model: string
  isDefault: boolean
  sortOrder: number
  /** Profiles that reference this slot, with the roles they use it for. */
  profiles: Array<{ id: number; name: string; roles: ModelRole[] }>
  createdDate: string
  updatedDate: string
}

export type ModelSlotInput = {
  name?: unknown
  providerName?: unknown
  model?: unknown
  isDefault?: unknown
  /** Bind existing profiles whose direct connection + model equals this slot's (and that have no slot for that role yet). */
  adoptProfiles?: unknown
}

export type AdoptedCounts = Record<ModelRole, number>

/** The llm_chat_profiles columns each role reads: its slot id and its direct connection / model pair. */
export const ROLE_COLUMNS: Record<ModelRole, { slot: string; provider: string; model: string }> = {
  chat: { slot: 'model_slot_id', provider: 'provider_name', model: 'model' },
  summary: { slot: 'summary_slot_id', provider: 'summary_provider_name', model: 'summary_model' },
  translation: { slot: 'translation_slot_id', provider: 'translation_provider_name', model: 'translation_model' },
  suggest: { slot: 'suggest_slot_id', provider: 'suggest_provider_name', model: 'suggest_model' },
}

const NAME_MAX_LENGTH = 80
const MODEL_MAX_LENGTH = 200
const LLM_PROVIDER_TYPES = ['llm_openai_compatible', 'llm_ollama']

type SlotRow = {
  id: number
  name: string
  provider_name: string
  model: string
  is_default: number
  sort_order: number
  created_date: string
  updated_date: string
}

type SlotProfileRow = { id: number; name: string; model_slot_id: number | null; summary_slot_id: number | null; translation_slot_id: number | null; suggest_slot_id: number | null }

function slotProfiles() {
  return getUserSettingsDb().prepare(`
    SELECT id, name, model_slot_id, summary_slot_id, translation_slot_id, suggest_slot_id FROM llm_chat_profiles
    WHERE model_slot_id IS NOT NULL OR summary_slot_id IS NOT NULL OR translation_slot_id IS NOT NULL OR suggest_slot_id IS NOT NULL
    ORDER BY sort_order ASC, id ASC
  `).all() as SlotProfileRow[]
}

function toSlot(row: SlotRow, profiles: SlotProfileRow[]): ModelSlot {
  return {
    id: row.id,
    name: row.name,
    providerName: row.provider_name,
    model: row.model,
    isDefault: row.is_default === 1,
    sortOrder: row.sort_order,
    profiles: profiles.flatMap((profile) => {
      const roles = MODEL_ROLES.filter((role) => profile[ROLE_COLUMNS[role].slot as keyof SlotProfileRow] === row.id)
      return roles.length > 0 ? [{ id: profile.id, name: profile.name, roles }] : []
    }),
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

function slotName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name.length < 1 || name.length > NAME_MAX_LENGTH) throw new ChatProfileError('모델 이름은 1자 이상 80자 이하로 적어줘.')
  return name
}

function slotModel(value: unknown) {
  const model = typeof value === 'string' ? value.trim() : ''
  if (model.length < 1 || model.length > MODEL_MAX_LENGTH) throw new ChatProfileError('모델 이름을 적어줘. 200자까지 쓸 수 있어.')
  return model
}

function llmConnectionName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  const provider = name ? ExternalApiProvider.findByName(name) : null
  if (!provider || !LLM_PROVIDER_TYPES.includes(provider.provider_type)) throw new ChatProfileError('LLM 연결을 찾을 수 없어.')
  return provider.provider_name
}

function assertNameFree(name: string, exceptId: number) {
  const taken = getUserSettingsDb().prepare('SELECT id FROM llm_model_slots WHERE name = ? COLLATE NOCASE AND id != ?').get(name, exceptId)
  if (taken) throw new ChatProfileError('같은 이름의 모델이 이미 있어.')
}

function adoptProfiles(slot: { id: number; providerName: string; model: string }): AdoptedCounts {
  const db = getUserSettingsDb()
  const counts: AdoptedCounts = { chat: 0, summary: 0, translation: 0, suggest: 0 }
  for (const role of MODEL_ROLES) {
    const columns = ROLE_COLUMNS[role]
    // The chat pair only counts for API LLM profiles; an empty model means "the connection's default" and never equals a named model.
    counts[role] = db.prepare(`
      UPDATE llm_chat_profiles SET ${columns.slot} = @id
      WHERE ${columns.slot} IS NULL AND ${columns.provider} = @provider AND ${columns.model} = @model
      ${role === 'chat' ? "AND COALESCE(engine, 'llm') = 'llm'" : ''}
    `).run({ id: slot.id, provider: slot.providerName, model: slot.model }).changes
  }
  return counts
}

export const ModelSlotStore = {
  list() {
    const rows = getUserSettingsDb().prepare('SELECT * FROM llm_model_slots ORDER BY sort_order ASC, id ASC').all() as SlotRow[]
    const profiles = slotProfiles()
    return rows.map((row) => toSlot(row, profiles))
  },

  find(slotId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM llm_model_slots WHERE id = ?').get(slotId) as SlotRow | undefined
    return row ? toSlot(row, slotProfiles()) : null
  },

  findDefault() {
    const row = getUserSettingsDb().prepare('SELECT * FROM llm_model_slots WHERE is_default = 1 ORDER BY id ASC LIMIT 1').get() as SlotRow | undefined
    return row ? toSlot(row, slotProfiles()) : null
  },

  /** The connection + model of a slot without its profile list (the request-time lookup). */
  target(slotId: number | null | undefined): { id: number; name: string; providerName: string; model: string } | null {
    if (slotId === null || slotId === undefined) return null
    const row = getUserSettingsDb().prepare('SELECT id, name, provider_name, model FROM llm_model_slots WHERE id = ?').get(slotId) as Pick<SlotRow, 'id' | 'name' | 'provider_name' | 'model'> | undefined
    return row ? { id: row.id, name: row.name, providerName: row.provider_name, model: row.model } : null
  },

  defaultTarget(): { id: number; name: string; providerName: string; model: string } | null {
    const row = getUserSettingsDb().prepare('SELECT id, name, provider_name, model FROM llm_model_slots WHERE is_default = 1 ORDER BY id ASC LIMIT 1').get() as Pick<SlotRow, 'id' | 'name' | 'provider_name' | 'model'> | undefined
    return row ? { id: row.id, name: row.name, providerName: row.provider_name, model: row.model } : null
  },

  /** The id when that slot exists, else null. */
  existing(slotId: unknown): number | null {
    const id = Number(slotId)
    if (!Number.isSafeInteger(id) || id <= 0) return null
    const row = getUserSettingsDb().prepare('SELECT id FROM llm_model_slots WHERE id = ?').get(id) as { id: number } | undefined
    return row ? row.id : null
  },

  create(input: ModelSlotInput): { slot: ModelSlot; adopted: AdoptedCounts } {
    const db = getUserSettingsDb()
    const name = slotName(input.name)
    const providerName = llmConnectionName(input.providerName)
    const model = slotModel(input.model)
    return db.transaction(() => {
      assertNameFree(name, 0)
      const sortOrder = ((db.prepare('SELECT MAX(sort_order) AS max FROM llm_model_slots').get() as { max: number | null }).max ?? -1) + 1
      const id = Number(db.prepare('INSERT INTO llm_model_slots (name, provider_name, model, sort_order) VALUES (?, ?, ?, ?)').run(name, providerName, model, sortOrder).lastInsertRowid)
      if (input.isDefault === true) {
        db.prepare('UPDATE llm_model_slots SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(id)
      }
      const adopted = input.adoptProfiles === true ? adoptProfiles({ id, providerName, model }) : { chat: 0, summary: 0, translation: 0, suggest: 0 }
      return { slot: ModelSlotStore.find(id) as ModelSlot, adopted }
    })()
  },

  /** Fields left out keep their value. Returns null when the slot does not exist. */
  update(slotId: number, input: ModelSlotInput): { slot: ModelSlot; adopted: AdoptedCounts } | null {
    const db = getUserSettingsDb()
    const current = ModelSlotStore.find(slotId)
    if (!current) return null
    const name = input.name === undefined ? current.name : slotName(input.name)
    const providerName = input.providerName === undefined ? current.providerName : llmConnectionName(input.providerName)
    const model = input.model === undefined ? current.model : slotModel(input.model)
    return db.transaction(() => {
      assertNameFree(name, slotId)
      db.prepare("UPDATE llm_model_slots SET name = ?, provider_name = ?, model = ?, updated_date = datetime('now') WHERE id = ?").run(name, providerName, model, slotId)
      if (input.isDefault === true) {
        db.prepare('UPDATE llm_model_slots SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(slotId)
      } else if (input.isDefault === false) {
        db.prepare('UPDATE llm_model_slots SET is_default = 0 WHERE id = ?').run(slotId)
      }
      const adopted = input.adoptProfiles === true ? adoptProfiles({ id: slotId, providerName, model }) : { chat: 0, summary: 0, translation: 0, suggest: 0 }
      return { slot: ModelSlotStore.find(slotId) as ModelSlot, adopted }
    })()
  },

  /** The one default slot: the new-profile starting point and the fallback of a chat role with no model of its own. */
  setDefault(slotId: number) {
    const db = getUserSettingsDb()
    if (!ModelSlotStore.find(slotId)) return null
    db.prepare('UPDATE llm_model_slots SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(slotId)
    return ModelSlotStore.find(slotId)
  },

  /** Profiles that pointed at the slot fall back to their direct connection + model; deleting the default leaves none. */
  delete(slotId: number) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const deleted = db.prepare('DELETE FROM llm_model_slots WHERE id = ?').run(slotId).changes > 0
      for (const role of MODEL_ROLES) {
        const column = ROLE_COLUMNS[role].slot
        db.prepare(`UPDATE llm_chat_profiles SET ${column} = NULL WHERE ${column} = ?`).run(slotId)
      }
      return deleted
    })()
  },
}

/** Slots and profiles whose pairs name this connection (any role, even one a slot currently shadows): what blocks its deletion. */
export function modelReferencesOfConnection(providerName: string): { slots: string[]; profiles: string[] } {
  const db = getUserSettingsDb()
  const slots = (db.prepare('SELECT name FROM llm_model_slots WHERE provider_name = ? ORDER BY sort_order ASC, id ASC').all(providerName) as Array<{ name: string }>).map((row) => row.name)
  const profiles = (db.prepare(`
    SELECT name FROM llm_chat_profiles
    WHERE (COALESCE(engine, 'llm') = 'llm' AND provider_name = @name) OR summary_provider_name = @name OR translation_provider_name = @name OR suggest_provider_name = @name
    ORDER BY sort_order ASC, id ASC
  `).all({ name: providerName }) as Array<{ name: string }>).map((row) => row.name)
  return { slots, profiles }
}
