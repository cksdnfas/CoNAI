import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { McpRequester } from '../../mcp/context'
import { AuthAccount } from '../../models/AuthAccount'
import type { ChatOrderKind } from './chatOrders'

/**
 * Chat flags: instructions an account writes once ("draw the scene with NovelAI", "answer briefly") and switches on
 * per chat. The flags on when a message is sent are copied onto that message and added to what the model reads for
 * it only, so the user's own text stays as typed and old instructions are not resent with the history.
 *
 * Flags an admin writes are shared: every account sees them. An account that edits one keeps its own copy of the text
 * (chat_flag_overrides) and can go back to the original; deleting one only hides it for that account.
 */

export const CHAT_FLAG_LIMITS = { perAccount: 20, name: 30, content: 2000, icon: 40 }

export type ChatFlag = {
  id: number
  /** `lucide:<name>` for a built-in icon, otherwise an emoji; empty shows the name's first letter. */
  icon: string
  name: string
  content: string
  sortOrder: number
  /** An admin's flag, shown to every account. */
  shared: boolean
  /** Shared flag whose text this account changed (non-admin only). */
  edited: boolean
  /** Shared flag this account hid; listed only where flags are managed. */
  hidden: boolean
}

/** Who is reading or changing flags: admins write the shared ones. */
export type ChatFlagViewer = Pick<McpRequester, 'accountId' | 'accountType'>

/**
 * What a message keeps of a flag, so editing or deleting the flag later does not change past messages. `pick`: not a
 * flag but an item the user chose in the status panel (`data-pick` in a block template), sent with this message.
 * `choice`: a pick that answers the chat's question card (offer_choices) of that id. `order`: an order from a reply's
 * bar, on messages sent while orders still went out as messages (now they are done on the reply, see chatOrderRunner).
 */
export type ChatFlagSnapshot = Pick<ChatFlag, 'id' | 'icon' | 'name' | 'content'> & { pick?: true; choice?: { id: number; question: string }; order?: ChatOrderKind }

export const CHAT_PICK_LIMITS = { perMessage: 12, length: 120 }
const PICK_ICON = 'lucide:target'

/** Items picked in the status panel for this message, from a request body. */
export function parsePicks(value: unknown): ChatFlagSnapshot[] {
  if (!Array.isArray(value)) return []
  const labels = [...new Set(value.map((item) => (typeof item === 'string' ? item.replace(/\s+/g, ' ').trim().slice(0, CHAT_PICK_LIMITS.length) : '')).filter(Boolean))]
  return labels.slice(0, CHAT_PICK_LIMITS.perMessage).map((label) => ({ id: 0, icon: PICK_ICON, name: label, content: label, pick: true }))
}

type ChatFlagRow = { id: number; account_id: number | null; icon: string; name: string; content: string; sort_order: number; is_global: number | null }
type ChatFlagOverrideRow = { account_id: number; flag_id: number; icon: string | null; name: string | null; content: string | null; hidden: number; sort_order: number | null }

export class ChatFlagError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function toFlag(row: ChatFlagRow): ChatFlag {
  return { id: row.id, icon: row.icon, name: row.name, content: row.content, sortOrder: row.sort_order, shared: row.is_global === 1, edited: false, hidden: false }
}

function withOverride(row: ChatFlagRow, override: ChatFlagOverrideRow | undefined): ChatFlag {
  const flag = toFlag(row)
  if (!override) return flag
  return {
    ...flag,
    icon: override.icon ?? flag.icon,
    name: override.name ?? flag.name,
    content: override.content ?? flag.content,
    sortOrder: override.sort_order ?? flag.sortOrder,
    edited: override.icon !== null || override.name !== null || override.content !== null,
    hidden: override.hidden === 1,
  }
}

const isAdmin = (viewer: ChatFlagViewer) => viewer.accountType === 'admin'

/** Flags written before sharing: those of the admin (no account, or an admin account) become shared. */
function settleLegacyFlags() {
  const db = getUserSettingsDb()
  const rows = db.prepare('SELECT id, account_id FROM chat_flags WHERE is_global IS NULL').all() as Array<{ id: number; account_id: number | null }>
  if (rows.length === 0) return
  let adminIds = new Set<number>()
  try {
    const accountIds = rows.flatMap((row) => (row.account_id === null ? [] : [row.account_id]))
    adminIds = new Set(AuthAccount.findByIds(accountIds).filter((account) => account.account_type === 'admin').map((account) => account.id))
  } catch {
    // No auth database (personal mode): only the account-less flags are the admin's.
  }
  const mark = db.prepare('UPDATE chat_flags SET is_global = ? WHERE id = ?')
  db.transaction(() => {
    for (const row of rows) mark.run(row.account_id === null || adminIds.has(row.account_id) ? 1 : 0, row.id)
  })()
}

function findRow(flagId: number) {
  return getUserSettingsDb().prepare('SELECT * FROM chat_flags WHERE id = ?').get(flagId) as ChatFlagRow | undefined
}

/** The viewer's flag `flagId` to change: their own, or a shared one. Others' private flags read as missing. */
function requireVisible(viewer: ChatFlagViewer, flagId: number) {
  settleLegacyFlags()
  const row = findRow(flagId)
  if (!row || (row.is_global !== 1 && row.account_id !== viewer.accountId)) throw new ChatFlagError('플래그를 찾을 수 없어.', 404)
  return row
}

/** A non-admin's change to a shared flag lives on their account; without one there is nowhere to keep it. */
function overrideAccount(viewer: ChatFlagViewer) {
  if (viewer.accountId === null) throw new ChatFlagError('공유 플래그는 로그인해야 고칠 수 있어.', 403)
  return viewer.accountId
}

function writeOverride(accountId: number, flagId: number, patch: Partial<Pick<ChatFlagOverrideRow, 'icon' | 'name' | 'content' | 'hidden' | 'sort_order'>>) {
  const db = getUserSettingsDb()
  db.prepare('INSERT OR IGNORE INTO chat_flag_overrides (account_id, flag_id) VALUES (?, ?)').run(accountId, flagId)
  const columns = Object.keys(patch) as Array<keyof typeof patch>
  if (columns.length === 0) return
  db.prepare(`UPDATE chat_flag_overrides SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_date = CURRENT_TIMESTAMP WHERE account_id = ? AND flag_id = ?`)
    .run(...columns.map((column) => patch[column] ?? null), accountId, flagId)
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
  const picks = flags.filter((flag) => flag.pick && !flag.choice).map((flag) => flag.content.trim()).filter(Boolean)
  const answers = new Map<string, string[]>()
  for (const flag of flags) if (flag.pick && flag.choice) answers.set(flag.choice.question, [...(answers.get(flag.choice.question) ?? []), flag.content.trim()])
  return [
    lines.length > 0 ? `[사용자 지시: 이번 메시지에 적용]\n${lines.map((line) => `- ${line}`).join('\n')}` : '',
    picks.length > 0 ? `[사용자 선택: 상태창에서 고른 항목]\n${picks.map((line) => `- ${line}`).join('\n')}` : '',
    ...[...answers].map(([question, labels]) => `[선택지 답: ${question}]\n${labels.map((line) => `- ${line}`).join('\n')}`),
  ].filter(Boolean).join('\n\n')
}

export const ChatFlagStore = {
  /**
   * The viewer's flags in tray order: their own and every shared one (with their changes). `includeHidden` adds the
   * shared flags they hid, for the flag manager.
   */
  list(viewer: ChatFlagViewer, { includeHidden = false }: { includeHidden?: boolean } = {}): ChatFlag[] {
    settleLegacyFlags()
    const db = getUserSettingsDb()
    const rows = db.prepare('SELECT * FROM chat_flags WHERE is_global = 1 OR account_id IS ? ORDER BY sort_order, id').all(viewer.accountId) as ChatFlagRow[]
    // Admins change the shared flags themselves, so their own view is the original.
    const overrides = isAdmin(viewer) || viewer.accountId === null
      ? new Map<number, ChatFlagOverrideRow>()
      : new Map((db.prepare('SELECT * FROM chat_flag_overrides WHERE account_id = ?').all(viewer.accountId) as ChatFlagOverrideRow[]).map((row) => [row.flag_id, row]))
    return rows
      .map((row) => (row.is_global === 1 ? withOverride(row, overrides.get(row.id)) : toFlag(row)))
      .filter((flag) => includeHidden || !flag.hidden)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
  },

  /** An admin's new flag is shared; anyone else's is their own. Each side has its own limit. */
  create(viewer: ChatFlagViewer, input: Record<string, unknown>) {
    settleLegacyFlags()
    const flag = normalizeInput(input)
    const db = getUserSettingsDb()
    const shared = isAdmin(viewer)
    const { count } = (shared
      ? db.prepare('SELECT COUNT(*) AS count FROM chat_flags WHERE is_global = 1').get()
      : db.prepare('SELECT COUNT(*) AS count FROM chat_flags WHERE is_global = 0 AND account_id IS ?').get(viewer.accountId)) as { count: number }
    if (count >= CHAT_FLAG_LIMITS.perAccount) throw new ChatFlagError(`플래그는 ${CHAT_FLAG_LIMITS.perAccount}개까지 만들 수 있어.`)
    const last = Math.max(-1, ...ChatFlagStore.list(viewer, { includeHidden: true }).map((entry) => entry.sortOrder))
    const result = db.prepare('INSERT INTO chat_flags (account_id, icon, name, content, sort_order, is_global) VALUES (?, ?, ?, ?, ?, ?)')
      .run(viewer.accountId, flag.icon, flag.name, flag.content, last + 1, shared ? 1 : 0)
    return ChatFlagStore.list(viewer).find((entry) => entry.id === Number(result.lastInsertRowid)) as ChatFlag
  },

  /** Own flags and (for admins) shared ones change in place; anyone else's change to a shared flag is their copy. */
  update(viewer: ChatFlagViewer, flagId: number, input: Record<string, unknown>) {
    const flag = normalizeInput(input)
    const row = requireVisible(viewer, flagId)
    if (row.is_global === 1 && !isAdmin(viewer)) {
      // Text back to the original stores nothing, so later changes to the original reach this account again.
      writeOverride(overrideAccount(viewer), flagId, {
        icon: flag.icon === row.icon ? null : flag.icon,
        name: flag.name === row.name ? null : flag.name,
        content: flag.content === row.content ? null : flag.content,
      })
    } else {
      getUserSettingsDb().prepare('UPDATE chat_flags SET icon = ?, name = ?, content = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?')
        .run(flag.icon, flag.name, flag.content, flagId)
    }
    return ChatFlagStore.list(viewer, { includeHidden: true }).find((entry) => entry.id === flagId) as ChatFlag
  },

  /** Own flags (and, for admins, shared ones) are deleted; anyone else only hides a shared flag for themselves. */
  delete(viewer: ChatFlagViewer, flagId: number) {
    const row = requireVisible(viewer, flagId)
    if (row.is_global === 1 && !isAdmin(viewer)) {
      writeOverride(overrideAccount(viewer), flagId, { hidden: 1 })
      return
    }
    const db = getUserSettingsDb()
    db.transaction(() => {
      db.prepare('DELETE FROM chat_flags WHERE id = ?').run(flagId)
      db.prepare('DELETE FROM chat_flag_overrides WHERE flag_id = ?').run(flagId)
    })()
  },

  /** A hidden shared flag back in the viewer's tray, with the changes they had made. */
  restore(viewer: ChatFlagViewer, flagId: number) {
    const row = requireVisible(viewer, flagId)
    if (row.is_global !== 1 || isAdmin(viewer)) throw new ChatFlagError('숨긴 공유 플래그가 아니야.')
    writeOverride(overrideAccount(viewer), flagId, { hidden: 0 })
    return ChatFlagStore.list(viewer).find((entry) => entry.id === flagId) as ChatFlag
  },

  /** A shared flag back to the original text (shown again if hidden); its place in the tray stays. */
  reset(viewer: ChatFlagViewer, flagId: number) {
    const row = requireVisible(viewer, flagId)
    if (row.is_global !== 1 || isAdmin(viewer)) throw new ChatFlagError('공유 플래그가 아니야.')
    writeOverride(overrideAccount(viewer), flagId, { icon: null, name: null, content: null, hidden: 0 })
    return ChatFlagStore.list(viewer).find((entry) => entry.id === flagId) as ChatFlag
  },

  /** The viewer's flags in this order; flags missing from `ids` keep their place after them. */
  reorder(viewer: ChatFlagViewer, ids: number[]) {
    const db = getUserSettingsDb()
    const current = ChatFlagStore.list(viewer)
    const ordered = [...ids.flatMap((id) => current.filter((flag) => flag.id === id)), ...current.filter((flag) => !ids.includes(flag.id))]
    const ownsOrder = (flag: ChatFlag) => !flag.shared || isAdmin(viewer)
    // Without an account a shared flag's place cannot be kept apart from everyone's, so it stays where it is.
    const movable = viewer.accountId === null && !isAdmin(viewer) ? ordered.filter(ownsOrder) : ordered
    db.transaction(() => {
      movable.forEach((flag, index) => {
        if (ownsOrder(flag)) db.prepare('UPDATE chat_flags SET sort_order = ? WHERE id = ?').run(index, flag.id)
        else writeOverride(viewer.accountId as number, flag.id, { sort_order: index })
      })
    })()
    return ChatFlagStore.list(viewer, { includeHidden: true })
  },

  /** The viewer's flags among `ids` (as they read them), in their order; unknown, foreign or hidden ids are dropped. */
  resolve(viewer: ChatFlagViewer, ids: number[]): ChatFlagSnapshot[] {
    if (ids.length === 0) return []
    return ChatFlagStore.list(viewer).filter((flag) => ids.includes(flag.id)).map(({ id, icon, name, content }) => ({ id, icon, name, content }))
  },

  /** The flags switched on in a chat (kept as the user left them, until the next change). */
  setThreadFlags(threadId: number, ids: number[]) {
    getUserSettingsDb().prepare('UPDATE codex_chat_threads SET flag_ids = ? WHERE id = ?').run(ids.length > 0 ? JSON.stringify(ids) : null, threadId)
  },
}
