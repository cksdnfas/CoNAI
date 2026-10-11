import { getUserSettingsDb } from '../../database/userSettingsDb'
import { FileStoreService, fileOwnerKey } from '../fileStoreService'
import { ChatGroupStore } from './chatGroupStore'
import { LinkedFileError, threadLinkedFiles } from './chatLinkedFiles'
import { ChatProfileStore } from './chatProfiles'

/**
 * Minutes: a chat (a 1:1 LLM chat or a room) whose summary is on may keep each new summary stretch as a record in a
 * linked folder it may write — `<folder>/회의록/<date>.md`, one `## from – until · title` part per stretch. They are
 * records: editing or clearing the summary later leaves them as written, and a folder no longer linked for writing
 * stops them silently.
 */

export const MINUTES_FOLDER = '회의록'

type MinutesThread = { id: number; account_id: number | null; kind?: string | null; profile_id: number | null }

function threadProfiles(thread: MinutesThread) {
  const ids = thread.kind === 'group' ? ChatGroupStore.members(thread.id).map((member) => member.profile_id) : thread.profile_id ? [thread.profile_id] : []
  return ids.flatMap((id) => ChatProfileStore.find(id) ?? [])
}

/** The folders the chat may keep minutes in: linked folders (its own or its profiles') that allow writing. */
export function minutesFolders(thread: MinutesThread) {
  return threadLinkedFiles(thread, threadProfiles(thread)).filter((view) => view.kind === 'folder' && view.write && !view.missing)
}

function threadRow(threadId: number) {
  return getUserSettingsDb().prepare('SELECT id, account_id, kind, profile_id, title, minutes_folder_id FROM codex_chat_threads WHERE id = ?')
    .get(threadId) as (MinutesThread & { title: string; minutes_folder_id: string | null }) | undefined
}

export const ChatMinutesStore = {
  /** Keep minutes in this folder (one of `minutesFolders`), or stop (null). */
  set(threadId: number, folderId: unknown) {
    const thread = threadRow(threadId)
    if (!thread) throw new LinkedFileError('채팅을 찾을 수 없어.', 404)
    if (folderId !== null && (typeof folderId !== 'string' || !minutesFolders(thread).some((view) => view.id === folderId))) {
      throw new LinkedFileError('회의록은 쓰기로 연결한 폴더에만 남길 수 있어.')
    }
    getUserSettingsDb().prepare('UPDATE codex_chat_threads SET minutes_folder_id = ? WHERE id = ?').run(folderId, threadId)
  },
}

/** SQLite's `YYYY-MM-DD HH:MM:SS` (UTC) as the server's local time. */
function localTime(value: string) {
  const date = new Date(`${value.replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? '' : 'Z'}`)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

const pad = (value: number) => String(value).padStart(2, '0')
const dayOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const clockOf = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`

/**
 * Add one new summary stretch to the chat's minutes, when it keeps them. `firstAt`/`lastAt`: when its first and last
 * messages were written; the file is the last one's day. Never throws: the summary is saved either way.
 */
export function appendMinutes(threadId: number, stretch: { content: string; firstAt: string; lastAt: string }) {
  try {
    const thread = threadRow(threadId)
    if (!thread?.minutes_folder_id) return
    const folder = minutesFolders(thread).find((view) => view.id === thread.minutes_folder_id)
    if (!folder) return
    const owner = fileOwnerKey(thread.account_id)
    const first = localTime(stretch.firstAt)
    const last = localTime(stretch.lastAt)
    const span = dayOf(first) === dayOf(last) ? `${clockOf(first)} – ${clockOf(last)}` : `${dayOf(first).slice(5)} ${clockOf(first)} – ${clockOf(last)}`
    const part = `## ${span} · ${thread.title.replace(/\s+/g, ' ').trim()}\n${stretch.content.trim()}\n`
    const source = { via: 'app' as const, accountId: thread.account_id, threadId }
    const parentId = FileStoreService.ensureFolder(owner, folder.id, MINUTES_FOLDER).id
    const name = `${dayOf(last)}.md`
    const existing = FileStoreService.findChild(owner, parentId, name)
    if (existing?.kind === 'file') {
      FileStoreService.editText(owner, existing.id, (text) => `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}${part}`, { source, history: false })
    } else {
      FileStoreService.writeText(owner, parentId, name, part, { create: true, source, history: false })
    }
  } catch (error) {
    console.warn(`[chat] minutes of chat ${threadId} not written:`, error instanceof Error ? error.message : error)
  }
}
