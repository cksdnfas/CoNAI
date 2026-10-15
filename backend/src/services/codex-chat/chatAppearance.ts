import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'
import { getUserSettingsDb } from '../../database/userSettingsDb'

/**
 * Chat appearance: how a reader sees their chats (text size, avatar size, layout…). Each chat keeps its own values;
 * named slots hold values to apply quickly, and the default slot is copied into a chat when it is created (a later
 * change to the slot leaves existing chats alone). Slots and individual chats use separate account-scoped
 * user_preferences rows. Legacy JSON files are imported once; the frontend still owns the values' meaning.
 */

export const CHAT_APPEARANCE_LIMITS = { slots: 12, name: 20, bytes: 4096 }

export type ChatAppearanceValue = Record<string, string | number | boolean | null>
export type ChatAppearanceSlot = { id: number; name: string; appearance: ChatAppearanceValue }
export type ChatAppearanceFile = {
  /** The slot a new chat starts from; null starts from the built-in defaults. */
  defaultSlotId: number | null
  slots: ChatAppearanceSlot[]
  /** Thread id → that chat's values. */
  threads: Record<string, ChatAppearanceValue>
}

export class ChatAppearanceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A flat object of scalars, within the size cap; anything else is dropped or refused. */
function normalizeValue(value: unknown, strict: boolean): ChatAppearanceValue | null {
  if (!isPlainObject(value)) {
    if (strict) throw new ChatAppearanceError('모양 값이 올바르지 않아.')
    return null
  }
  const out: ChatAppearanceValue = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') out[key] = entry
  }
  if (JSON.stringify(out).length > CHAT_APPEARANCE_LIMITS.bytes) {
    if (strict) throw new ChatAppearanceError('모양 값이 너무 커.')
    return null
  }
  return out
}

function normalizeSlots(value: unknown, strict: boolean): ChatAppearanceSlot[] {
  if (!Array.isArray(value)) {
    if (strict) throw new ChatAppearanceError('슬롯 목록이 올바르지 않아.')
    return []
  }
  if (value.length > CHAT_APPEARANCE_LIMITS.slots) throw new ChatAppearanceError(`슬롯은 ${CHAT_APPEARANCE_LIMITS.slots}개까지야.`)
  const slots: ChatAppearanceSlot[] = []
  const seen = new Set<number>()
  let nextId = 1
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      if (strict) throw new ChatAppearanceError('슬롯이 올바르지 않아.')
      continue
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!name || name.length > CHAT_APPEARANCE_LIMITS.name) {
      if (strict) throw new ChatAppearanceError(`슬롯 이름은 1~${CHAT_APPEARANCE_LIMITS.name}자로 정해줘.`)
      continue
    }
    const appearance = normalizeValue(entry.appearance, strict)
    if (!appearance) continue
    const id = Number(entry.id)
    slots.push({ id: Number.isSafeInteger(id) && id > 0 && !seen.has(id) ? id : 0, name, appearance })
    if (slots[slots.length - 1].id > 0) seen.add(slots[slots.length - 1].id)
  }
  // Slots sent without an id (new ones) get the next free one.
  for (const slot of slots) if (slot.id === 0) {
    while (seen.has(nextId)) nextId += 1
    slot.id = nextId
    seen.add(nextId)
  }
  return slots
}

function normalizeFile(value: unknown): ChatAppearanceFile {
  const raw = isPlainObject(value) ? value : {}
  const slots = normalizeSlots(raw.slots, false)
  const defaultId = Number(raw.defaultSlotId)
  const threads: Record<string, ChatAppearanceValue> = {}
  if (isPlainObject(raw.threads)) {
    for (const [key, entry] of Object.entries(raw.threads)) {
      const appearance = normalizeValue(entry, false)
      if (appearance && /^\d+$/.test(key)) threads[key] = appearance
    }
  }
  return { defaultSlotId: slots.some((slot) => slot.id === defaultId) ? defaultId : null, slots, threads }
}

type AppearanceSlots = Pick<ChatAppearanceFile, 'defaultSlotId' | 'slots'>
const UPSERT = 'INSERT INTO user_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'

/** The slots row also marks a completed migration; importing and marking it are one transaction. */
function accountStore(accountId: number | null) {
  if (accountId !== null && (!Number.isSafeInteger(accountId) || accountId < 1)) throw new ChatAppearanceError('잘못된 계정이야.')
  const prefix = `chat_appearance:${accountId ?? 'guest'}:`
  const db = getUserSettingsDb()
  if (!db.prepare('SELECT 1 FROM user_preferences WHERE key = ?').get(`${prefix}slots`)) {
    let parsed: unknown = null
    const file = path.join(runtimePaths.saveDir, 'chat-appearance', `${accountId ?? 'guest'}.json`)
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ChatAppearanceError('기존 채팅 모양 파일을 읽을 수 없어. 파일을 확인해줘.', 500)
    }
    const data = normalizeFile(parsed)
    db.transaction(() => {
      // Another connection may have imported this account while the file was being read.
      if (db.prepare('SELECT 1 FROM user_preferences WHERE key = ?').get(`${prefix}slots`)) return
      const insert = db.prepare('INSERT INTO user_preferences (key, value) VALUES (?, ?)')
      insert.run(`${prefix}slots`, JSON.stringify({ defaultSlotId: data.defaultSlotId, slots: data.slots }))
      for (const [id, value] of Object.entries(data.threads)) insert.run(`${prefix}thread:${id}`, JSON.stringify(value))
    }).immediate()
  }
  return { db, prefix }
}

function readSlots(store: ReturnType<typeof accountStore>): AppearanceSlots {
  const row = store.db.prepare('SELECT value FROM user_preferences WHERE key = ?').get(`${store.prefix}slots`) as { value: string }
  return JSON.parse(row.value) as AppearanceSlots
}

function threadKey(prefix: string, threadId: number) {
  if (!Number.isSafeInteger(threadId) || threadId < 1) throw new ChatAppearanceError('잘못된 채팅이야.')
  return `${prefix}thread:${threadId}`
}

export const ChatAppearanceStore = {
  /** Compatibility snapshot; normal edits update only one row. */
  read(accountId: number | null, liveThreadIds?: Iterable<number>): ChatAppearanceFile {
    const store = accountStore(accountId)
    return store.db.transaction(() => {
      const live = liveThreadIds ? new Set([...liveThreadIds].map(String)) : null
      const threads: ChatAppearanceFile['threads'] = {}
      const rows = store.db.prepare('SELECT key, value FROM user_preferences WHERE key GLOB ?').all(`${store.prefix}thread:*`) as Array<{ key: string; value: string }>
      const remove = store.db.prepare('DELETE FROM user_preferences WHERE key = ?')
      for (const row of rows) {
        const id = row.key.slice(`${store.prefix}thread:`.length)
        if (live && !live.has(id)) remove.run(row.key)
        else threads[id] = JSON.parse(row.value) as ChatAppearanceValue
      }
      return { ...readSlots(store), threads }
    }).immediate()
  },

  /** Replaces the slots and the default; chats keep their own values. */
  saveSlots(accountId: number | null, input: { defaultSlotId: unknown; slots: unknown }) {
    const slots = normalizeSlots(input.slots, true)
    const defaultId = input.defaultSlotId === null || input.defaultSlotId === undefined ? null : Number(input.defaultSlotId)
    if (defaultId !== null && !slots.some((slot) => slot.id === defaultId)) throw new ChatAppearanceError('기본 슬롯이 목록에 없어.')
    const { db, prefix } = accountStore(accountId)
    const data = { defaultSlotId: defaultId, slots }
    db.prepare(UPSERT).run(`${prefix}slots`, JSON.stringify(data))
    return data
  },

  threadAppearance(accountId: number | null, threadId: number): ChatAppearanceValue | null {
    const { db, prefix } = accountStore(accountId)
    const row = db.prepare('SELECT value FROM user_preferences WHERE key = ?').get(threadKey(prefix, threadId)) as { value: string } | undefined
    return row ? JSON.parse(row.value) as ChatAppearanceValue : null
  },

  /** This chat's values; null clears them (the chat then shows the built-in defaults). */
  setThread(accountId: number | null, threadId: number, appearance: unknown) {
    const value = appearance === null || appearance === undefined ? null : normalizeValue(appearance, true)
    const { db, prefix } = accountStore(accountId)
    const key = threadKey(prefix, threadId)
    if (value) db.prepare(UPSERT).run(key, JSON.stringify(value))
    else db.prepare('DELETE FROM user_preferences WHERE key = ?').run(key)
    return value
  },

  /** A new chat starts from the default slot, copied so the slot can change later without touching this chat. */
  threadCreated(accountId: number | null, threadId: number) {
    const store = accountStore(accountId)
    store.db.transaction(() => {
      const data = readSlots(store)
      const slot = data.slots.find((entry) => entry.id === data.defaultSlotId)
      if (slot) store.db.prepare(UPSERT).run(threadKey(store.prefix, threadId), JSON.stringify(slot.appearance))
    }).immediate()
  },

  threadDeleted(accountId: number | null, threadId: number) {
    const { db, prefix } = accountStore(accountId)
    db.prepare('DELETE FROM user_preferences WHERE key = ?').run(threadKey(prefix, threadId))
  },
}
