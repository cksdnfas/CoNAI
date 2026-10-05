import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'

/**
 * Chat appearance: how a reader sees their chats (text size, avatar size, layout…). Each chat keeps its own values;
 * named slots hold values to apply quickly, and the default slot is copied into a chat when it is created (a later
 * change to the slot leaves existing chats alone). Everything of one account lives in one JSON file under the
 * runtime save directory; the values themselves are opaque here (the frontend owns their meaning).
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

const cache = new Map<string, ChatAppearanceFile>()

function fileOf(accountId: number | null) {
  const dir = path.join(runtimePaths.saveDir, 'chat-appearance')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${accountId ?? 'guest'}.json`)
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

function read(accountId: number | null): ChatAppearanceFile {
  const file = fileOf(accountId)
  const cached = cache.get(file)
  if (cached) return cached
  let parsed: unknown = null
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    // Missing or unreadable: start empty; the next write replaces it.
  }
  const data = normalizeFile(parsed)
  cache.set(file, data)
  return data
}

/** Written whole, to a temporary file first, so a crash mid-write cannot leave a half file. */
function write(accountId: number | null, data: ChatAppearanceFile) {
  const file = fileOf(accountId)
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data), 'utf8')
  fs.renameSync(temp, file)
  cache.set(file, data)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const ChatAppearanceStore = {
  /** The account's file; entries of chats that no longer exist are dropped when `liveThreadIds` is given. */
  read(accountId: number | null, liveThreadIds?: Iterable<number>): ChatAppearanceFile {
    const data = read(accountId)
    if (liveThreadIds) {
      const live = new Set([...liveThreadIds].map(String))
      const stale = Object.keys(data.threads).filter((key) => !live.has(key))
      if (stale.length > 0) {
        const threads = { ...data.threads }
        for (const key of stale) delete threads[key]
        write(accountId, { ...data, threads })
        return clone(cache.get(fileOf(accountId)) as ChatAppearanceFile)
      }
    }
    return clone(data)
  },

  /** Replaces the slots and the default; chats keep their own values. */
  saveSlots(accountId: number | null, input: { defaultSlotId: unknown; slots: unknown }) {
    const slots = normalizeSlots(input.slots, true)
    const defaultId = input.defaultSlotId === null || input.defaultSlotId === undefined ? null : Number(input.defaultSlotId)
    if (defaultId !== null && !slots.some((slot) => slot.id === defaultId)) throw new ChatAppearanceError('기본 슬롯이 목록에 없어.')
    const data = read(accountId)
    write(accountId, { ...data, defaultSlotId: defaultId, slots })
    return { defaultSlotId: defaultId, slots: clone(slots) }
  },

  threadAppearance(accountId: number | null, threadId: number): ChatAppearanceValue | null {
    return clone(read(accountId).threads[String(threadId)] ?? null)
  },

  /** This chat's values; null clears them (the chat then shows the built-in defaults). */
  setThread(accountId: number | null, threadId: number, appearance: unknown) {
    const value = appearance === null || appearance === undefined ? null : normalizeValue(appearance, true)
    const data = read(accountId)
    const threads = { ...data.threads }
    if (value) threads[String(threadId)] = value
    else delete threads[String(threadId)]
    write(accountId, { ...data, threads })
    return value
  },

  /** A new chat starts from the default slot, copied so the slot can change later without touching this chat. */
  threadCreated(accountId: number | null, threadId: number) {
    const data = read(accountId)
    const slot = data.slots.find((entry) => entry.id === data.defaultSlotId)
    if (!slot) return
    write(accountId, { ...data, threads: { ...data.threads, [String(threadId)]: clone(slot.appearance) } })
  },

  threadDeleted(accountId: number | null, threadId: number) {
    const data = read(accountId)
    if (!(String(threadId) in data.threads)) return
    const threads = { ...data.threads }
    delete threads[String(threadId)]
    write(accountId, { ...data, threads })
  },
}
