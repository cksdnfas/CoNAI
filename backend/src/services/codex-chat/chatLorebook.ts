import { createHash } from 'crypto'
import { getUserSettingsDb } from '../../database/userSettingsDb'

export type ChatLoreEntry = {
  id: string
  keys: string[]
  content: string
  enabled: boolean
  constant: boolean
  order: number
  caseSensitive: boolean
}

/** A shared lorebook. Profiles link it by id, so editing or re-importing it reaches every linked profile. */
export type ChatLorebook = {
  id: number
  name: string
  entries: ChatLoreEntry[]
  /** Profiles that link this book. */
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

export const LOREBOOK_MAX_ENTRIES = 500
export const PROFILE_MAX_LOREBOOKS = 20
const LOREBOOK_NAME_MAX_LENGTH = 80

/**
 * Accepts this app's entries, character card books (keys / insertion_order / case_sensitive), SillyTavern world
 * info (key / disable / order / caseSensitive) and NovelAI lorebooks (text / forceActivation).
 */
export function normalizeLorebook(value: unknown): ChatLoreEntry[] {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.slice(0, LOREBOOK_MAX_ENTRIES).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const row = entry as Record<string, unknown>
    let id = typeof row.id === 'string' ? row.id.trim().slice(0, 80) : ''
    if (!id || ids.has(id)) id = `lore-${index}-${ids.size}`
    while (ids.has(id)) id += '-'
    ids.add(id)
    const keys = Array.isArray(row.keys) ? row.keys : Array.isArray(row.key) ? row.key : []
    const content = typeof row.content === 'string' ? row.content : typeof row.text === 'string' ? row.text : ''
    const order = typeof row.order === 'number' ? row.order : row.insertion_order
    return [{
      id,
      keys: [...new Set(keys.filter((key): key is string => typeof key === 'string').map((key) => key.trim().slice(0, 100)).filter(Boolean))].slice(0, 20),
      content: content.trim().slice(0, 20_000),
      enabled: row.enabled !== false && row.disable !== true,
      constant: row.constant === true || row.forceActivation === true,
      order: typeof order === 'number' && Number.isFinite(order) ? Math.max(-10_000, Math.min(10_000, Math.round(order))) : index,
      caseSensitive: row.caseSensitive === true || row.case_sensitive === true,
    }]
  })
}

export function normalizeLorebookIds(value: unknown): number[] {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, PROFILE_MAX_LOREBOOKS)
}

type LorebookRow = { id: number; name: string; entries: string; created_date: string; updated_date: string }

function lorebookName(value: unknown) {
  return (typeof value === 'string' ? value.trim().slice(0, LOREBOOK_NAME_MAX_LENGTH) : '') || '로어북'
}

function linkedProfiles() {
  const rows = getUserSettingsDb().prepare("SELECT id, name, lorebook_ids FROM llm_chat_profiles WHERE lorebook_ids IS NOT NULL AND lorebook_ids != '[]' ORDER BY sort_order ASC, id ASC").all() as Array<{ id: number; name: string; lorebook_ids: string }>
  return rows.map((row) => ({ id: row.id, name: row.name, lorebookIds: normalizeLorebookIds(row.lorebook_ids) }))
}

function toLorebook(row: LorebookRow, profiles: ReturnType<typeof linkedProfiles>): ChatLorebook {
  return {
    id: row.id,
    name: row.name,
    entries: normalizeLorebook(row.entries),
    profiles: profiles.filter((profile) => profile.lorebookIds.includes(row.id)).map(({ id, name }) => ({ id, name })),
    createdDate: row.created_date,
    updatedDate: row.updated_date,
  }
}

export const ChatLorebookStore = {
  list() {
    const rows = getUserSettingsDb().prepare('SELECT * FROM chat_lorebooks ORDER BY name COLLATE NOCASE ASC, id ASC').all() as LorebookRow[]
    const profiles = linkedProfiles()
    return rows.map((row) => toLorebook(row, profiles))
  },

  find(lorebookId: number) {
    const row = getUserSettingsDb().prepare('SELECT * FROM chat_lorebooks WHERE id = ?').get(lorebookId) as LorebookRow | undefined
    return row ? toLorebook(row, linkedProfiles()) : null
  },

  /** Ids of these that still exist, in the given order. */
  existing(ids: number[]) {
    if (ids.length === 0) return []
    const found = new Set((getUserSettingsDb().prepare(`SELECT id FROM chat_lorebooks WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number }>).map((row) => row.id))
    return ids.filter((id) => found.has(id))
  },

  /** The entries of these books in book order (missing books are skipped), keyed `book:entry:content hash`. */
  keyedEntriesOf(ids: number[]) {
    if (ids.length === 0) return []
    const rows = getUserSettingsDb().prepare(`SELECT id, entries FROM chat_lorebooks WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as Array<{ id: number; entries: string }>
    const byId = new Map(rows.map((row) => [row.id, normalizeLorebook(row.entries)]))
    return ids.flatMap((bookId) => (byId.get(bookId) ?? []).map((entry) => ({
      key: `${bookId}:${entry.id}:${createHash('sha1').update(entry.content).digest('hex').slice(0, 10)}`,
      entry,
    })))
  },

  create(input: { name?: unknown; entries?: unknown }) {
    const result = getUserSettingsDb().prepare('INSERT INTO chat_lorebooks (name, entries) VALUES (?, ?)').run(lorebookName(input.name), JSON.stringify(normalizeLorebook(input.entries ?? [])))
    return ChatLorebookStore.find(Number(result.lastInsertRowid)) as ChatLorebook
  },

  update(lorebookId: number, patch: { name?: unknown; entries?: unknown }) {
    const current = ChatLorebookStore.find(lorebookId)
    if (!current) return null
    getUserSettingsDb().prepare('UPDATE chat_lorebooks SET name = ?, entries = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?').run(
      patch.name === undefined ? current.name : lorebookName(patch.name),
      JSON.stringify(patch.entries === undefined ? current.entries : normalizeLorebook(patch.entries)),
      lorebookId,
    )
    return ChatLorebookStore.find(lorebookId)
  },

  /** Also unlinks the book from every profile. */
  delete(lorebookId: number) {
    const db = getUserSettingsDb()
    return db.transaction(() => {
      const unlink = db.prepare('UPDATE llm_chat_profiles SET lorebook_ids = ? WHERE id = ?')
      for (const profile of linkedProfiles()) {
        if (profile.lorebookIds.includes(lorebookId)) unlink.run(JSON.stringify(profile.lorebookIds.filter((id) => id !== lorebookId)), profile.id)
      }
      return db.prepare('DELETE FROM chat_lorebooks WHERE id = ?').run(lorebookId).changes > 0
    })()
  },
}

type LoreProfile = { lorebookIds: number[]; loreScanDepth: number; loreTokenBudget: number }

/**
 * The entries a reply gets, each with a stable key (`book:entry:content hash`) so a caller that keeps context
 * (Codex) can skip what it already sent. Books are read at send time so edits apply at once. No messages means a
 * prompt preview: constant entries only. Matching never evaluates regex or code.
 */
export function selectLoreEntries(profile: LoreProfile, messages: ReadonlyArray<{ content: string }> | undefined, estimate: (text: string) => number, render: (text: string) => string, options: { skip?: (key: string) => boolean } = {}) {
  const lorebook = ChatLorebookStore.keyedEntriesOf(profile.lorebookIds)
  if (lorebook.length === 0) return { text: '', keys: [] as string[] }
  const recent = messages?.slice(-profile.loreScanDepth).map((message) => message.content).join('\n') ?? ''
  const folded = recent.toLowerCase()
  const entries = lorebook.filter(({ key, entry }) => !options.skip?.(key) && entry.enabled && entry.content.trim() && (entry.constant || (messages !== undefined && entry.keys.some((word) => word && (entry.caseSensitive ? recent.includes(word) : folded.includes(word.toLowerCase())))))).sort((a, b) => a.entry.order - b.entry.order)
  let text = ''
  const keys: string[] = []
  for (const { key, entry } of entries) {
    const candidate = [text, render(entry.content)].filter(Boolean).join('\n\n')
    if (estimate(candidate) <= profile.loreTokenBudget) {
      text = candidate
      keys.push(key)
    }
  }
  return { text, keys }
}

export function buildLorebookText(profile: LoreProfile, messages: ReadonlyArray<{ content: string }> | undefined, estimate: (text: string) => number, render: (text: string) => string) {
  return selectLoreEntries(profile, messages, estimate, render).text
}
