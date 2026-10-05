import { getUserSettingsDb } from '../../database/userSettingsDb'

/**
 * Chat flags: instructions an account writes once ("draw the scene with NovelAI", "answer briefly") and switches on
 * per chat. The flags on when a message is sent are copied onto that message and added to what the model reads for
 * it only, so the user's own text stays as typed and old instructions are not resent with the history.
 */

export const CHAT_FLAG_LIMITS = { perAccount: 20, name: 30, content: 2000, icon: 40 }

export type ChatFlag = {
  id: number
  /** `lucide:<name>` for a built-in icon, otherwise an emoji; empty shows the name's first letter. */
  icon: string
  name: string
  content: string
  sortOrder: number
}

/**
 * What a message keeps of a flag, so editing or deleting the flag later does not change past messages. `pick`: not a
 * flag but an item the user chose in the status panel (`data-pick` in a block template), sent with this message.
 */
export type ChatFlagSnapshot = Pick<ChatFlag, 'id' | 'icon' | 'name' | 'content'> & { pick?: true }

export const CHAT_PICK_LIMITS = { perMessage: 12, length: 120 }
const PICK_ICON = 'lucide:target'

/** Items picked in the status panel for this message, from a request body. */
export function parsePicks(value: unknown): ChatFlagSnapshot[] {
  if (!Array.isArray(value)) return []
  const labels = [...new Set(value.map((item) => (typeof item === 'string' ? item.replace(/\s+/g, ' ').trim().slice(0, CHAT_PICK_LIMITS.length) : '')).filter(Boolean))]
  return labels.slice(0, CHAT_PICK_LIMITS.perMessage).map((label) => ({ id: 0, icon: PICK_ICON, name: label, content: label, pick: true }))
}

type ChatFlagRow = { id: number; account_id: number | null; icon: string; name: string; content: string; sort_order: number }

export class ChatFlagError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function toFlag(row: ChatFlagRow): ChatFlag {
  return { id: row.id, icon: row.icon, name: row.name, content: row.content, sortOrder: row.sort_order }
}

function normalizeInput(input: Record<string, unknown>) {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  const icon = typeof input.icon === 'string' ? input.icon.trim() : ''
  if (!name || name.length > CHAT_FLAG_LIMITS.name) throw new ChatFlagError(`이름은 1~${CHAT_FLAG_LIMITS.name}자로 정해줘.`)
  if (!content || content.length > CHAT_FLAG_LIMITS.content) throw new ChatFlagError(`넣을 내용은 1~${CHAT_FLAG_LIMITS.content}자로 써줘.`)
  if (icon.length > CHAT_FLAG_LIMITS.icon) throw new ChatFlagError('아이콘이 너무 길어.')
  return { name, content, icon }
}

/** Ids from a request body: positive integers, each once, in order. */
export function parseFlagIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
}

export function parseFlagSnapshots(value: string | null | undefined): ChatFlagSnapshot[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is ChatFlagSnapshot => Boolean(entry) && typeof entry.content === 'string') : []
  } catch {
    return []
  }
}

/**
 * The block added after the user's message for the model. `fill` replaces {{char}}/{{user}} for the profile answering.
 * Empty when no flag was on.
 */
export function buildFlagDirective(flags: ChatFlagSnapshot[], fill: (text: string) => string = (text) => text) {
  const lines = flags.filter((flag) => !flag.pick).map((flag) => fill(flag.content).trim()).filter(Boolean)
  const picks = flags.filter((flag) => flag.pick).map((flag) => flag.content.trim()).filter(Boolean)
  return [
    lines.length > 0 ? `[사용자 지시: 이번 메시지에 적용]\n${lines.map((line) => `- ${line}`).join('\n')}` : '',
    picks.length > 0 ? `[사용자 선택: 상태창에서 고른 항목]\n${picks.map((line) => `- ${line}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

export const ChatFlagStore = {
  list(accountId: number | null) {
    const rows = getUserSettingsDb().prepare('SELECT * FROM chat_flags WHERE account_id IS ? ORDER BY sort_order, id').all(accountId) as ChatFlagRow[]
    return rows.map(toFlag)
  },

  create(accountId: number | null, input: Record<string, unknown>) {
    const flag = normalizeInput(input)
    const db = getUserSettingsDb()
    const { count, last } = db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(sort_order), -1) AS last FROM chat_flags WHERE account_id IS ?').get(accountId) as { count: number; last: number }
    if (count >= CHAT_FLAG_LIMITS.perAccount) throw new ChatFlagError(`플래그는 ${CHAT_FLAG_LIMITS.perAccount}개까지 만들 수 있어.`)
    const result = db.prepare('INSERT INTO chat_flags (account_id, icon, name, content, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(accountId, flag.icon, flag.name, flag.content, last + 1)
    return ChatFlagStore.list(accountId).find((entry) => entry.id === Number(result.lastInsertRowid)) as ChatFlag
  },

  update(accountId: number | null, flagId: number, input: Record<string, unknown>) {
    const flag = normalizeInput(input)
    const result = getUserSettingsDb().prepare('UPDATE chat_flags SET icon = ?, name = ?, content = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ? AND account_id IS ?')
      .run(flag.icon, flag.name, flag.content, flagId, accountId)
    if (!result.changes) throw new ChatFlagError('플래그를 찾을 수 없어.', 404)
    return ChatFlagStore.list(accountId).find((entry) => entry.id === flagId) as ChatFlag
  },

  delete(accountId: number | null, flagId: number) {
    const result = getUserSettingsDb().prepare('DELETE FROM chat_flags WHERE id = ? AND account_id IS ?').run(flagId, accountId)
    if (!result.changes) throw new ChatFlagError('플래그를 찾을 수 없어.', 404)
  },

  /** The account's flags in this order; flags missing from `ids` keep their place after them. */
  reorder(accountId: number | null, ids: number[]) {
    const db = getUserSettingsDb()
    const current = ChatFlagStore.list(accountId)
    const ordered = [...ids.flatMap((id) => current.filter((flag) => flag.id === id)), ...current.filter((flag) => !ids.includes(flag.id))]
    db.transaction(() => {
      ordered.forEach((flag, index) => db.prepare('UPDATE chat_flags SET sort_order = ? WHERE id = ?').run(index, flag.id))
    })()
    return ChatFlagStore.list(accountId)
  },

  /** The account's flags among `ids`, in the account's order (unknown or foreign ids are dropped). */
  resolve(accountId: number | null, ids: number[]): ChatFlagSnapshot[] {
    if (ids.length === 0) return []
    return ChatFlagStore.list(accountId).filter((flag) => ids.includes(flag.id)).map(({ id, icon, name, content }) => ({ id, icon, name, content }))
  },

  /** The flags switched on in a chat (kept as the user left them, until the next change). */
  setThreadFlags(threadId: number, ids: number[]) {
    getUserSettingsDb().prepare('UPDATE codex_chat_threads SET flag_ids = ? WHERE id = ?').run(ids.length > 0 ? JSON.stringify(ids) : null, threadId)
  },
}
