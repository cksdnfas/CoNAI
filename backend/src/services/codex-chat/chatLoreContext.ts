import { getUserSettingsDb } from '../../database/userSettingsDb'
import { fileOwnerKey } from '../fileStoreService'
import {
  loreEntryKey,
  loreEntryTitle,
  normalizeLorebook,
  selectLoreEntries,
  type ChatLoreEntry,
  type ChatLorebookKind,
  type KeyedLoreEntry,
  type SelectedLore,
} from './chatLorebook'
import { OwnedLorebookStore, readEntryFileText, type OwnedLorebook } from './chatLorebookFiles'
import type { ChatProfile } from './chatProfiles'
import type { CodexChatThreadRecord } from './codexChatStore'

/**
 * The lorebooks one request carries, and how they reach the model:
 *
 *   ① the index — every attached book's entry titles, and the "always on" entries in full — in the second system
 *     message, beside the summary (changes only when a book or the summary does, so the persona prompt before it
 *     stays cached)
 *   ② keyword entries in `[참고 설정]` at lore depth, a small linked file along with its entry
 *   ③ a larger file through read_lore_file
 */

/** Titles one book shows in the index; a bigger book shows its entry count only. */
export const LORE_INDEX_MAX_TITLES = 40
/** The whole index; over it, global books give up their titles first, then account books. */
export const LORE_INDEX_MAX_TOKENS = 1500
/** Bytes of a linked file read for a request; more than this is never put in whole (see LORE_FILE_INLINE_MAX_TOKENS). */
const LORE_FILE_REQUEST_MAX_BYTES = 4096
export const READ_LORE_FILE_TOOL = 'read_lore_file'
/** What the index and read_lore_file call the chat's own book. */
export const CHAT_BOOK_LABEL = '이 채팅'

export type AttachedLoreBook = {
  id: number
  name: string
  /** CHAT_BOOK_LABEL for the chat's own book, else its name. */
  label: string
  kind: ChatLorebookKind
  /** The chat's own book, an account book linked to this chat, or a book of the profile. */
  via: 'chat' | 'thread' | 'profile'
  /** Account and chat books: the owner's file store and the book folder (linked files are read there). */
  owner: string | null
  folderId: string | null
  entries: ChatLoreEntry[]
}

type RequestThread = Pick<CodexChatThreadRecord, 'id' | 'account_id'>

function ownedBook(book: OwnedLorebook, owner: string, via: AttachedLoreBook['via']): AttachedLoreBook {
  return { id: book.id, name: book.name, label: via === 'chat' ? CHAT_BOOK_LABEL : book.name, kind: book.kind, via, owner, folderId: book.folderId, entries: book.entries }
}

/**
 * The books a request attaches, in index order: the chat's own book, the account books linked to this chat, then the
 * profile's books (account books, then global ones). Every account book must be the chat owner's: a profile is shared
 * across accounts, so another account's book on it is skipped silently. Without a chat (a profile preview) only the
 * profile's global books. A book attached twice counts once, where it first appears.
 */
export function booksForRequest({ thread, profile }: { thread: RequestThread | null; profile: Pick<ChatProfile, 'lorebookIds'> }): AttachedLoreBook[] {
  const books: AttachedLoreBook[] = []
  const seen = new Set<number>()
  const add = (book: AttachedLoreBook) => {
    if (seen.has(book.id)) return
    seen.add(book.id)
    books.push(book)
  }
  const owner = thread ? fileOwnerKey(thread.account_id ?? null) : null
  if (thread && owner) {
    const chat = OwnedLorebookStore.chatBookOf(thread.id)
    if (chat) add(ownedBook(chat, owner, 'chat'))
    for (const id of OwnedLorebookStore.threadLinks(thread.id)) {
      const book = OwnedLorebookStore.find(id, owner)
      if (book?.kind === 'account') add(ownedBook(book, owner, 'thread'))
    }
  }
  const ids = profile.lorebookIds
  if (ids.length > 0) {
    const rows = getUserSettingsDb().prepare(`SELECT id, name, kind, owner_key, entries FROM chat_lorebooks WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids) as Array<{ id: number; name: string; kind: ChatLorebookKind | null; owner_key: string | null; entries: string }>
    const byId = new Map(rows.map((row) => [row.id, row]))
    const global: AttachedLoreBook[] = []
    for (const id of ids) {
      const row = byId.get(id)
      if (!row) continue
      if ((row.kind ?? 'global') === 'global') {
        global.push({ id, name: row.name, label: row.name, kind: 'global', via: 'profile', owner: null, folderId: null, entries: normalizeLorebook(row.entries) })
      } else if (row.kind === 'account' && owner && row.owner_key === owner) {
        const book = OwnedLorebookStore.find(id, owner)
        if (book) add(ownedBook(book, owner, 'profile'))
      }
    }
    global.forEach(add)
  }
  return books
}

/** A book the context tab lists beside the chat's own one: where it comes from and the profiles that bring it. */
export type ThreadLoreBookView = {
  id: number
  name: string
  kind: ChatLorebookKind
  via: 'thread' | 'profile'
  /** The book folder (account books); null for a global book. */
  folderId: string | null
  entries: ChatLoreEntry[]
  /** The profiles (a room: its members) whose links bring this book; empty for one linked to the chat only. */
  profiles: Array<{ id: number; name: string }>
}

export type ThreadLorebooks = {
  entryUsage: Record<string, { turnsAgo?: number; sourceMessageId?: number | null }>
  chatBook: OwnedLorebook | null
  /** Account books linked to this chat only (`codex_chat_threads.lorebook_ids`). */
  linkedIds: number[]
  /** The other attached books, as the context tab lists them: the profiles' account books, those linked to this chat, then global ones. */
  books: ThreadLoreBookView[]
}

/**
 * What the context tab shows: the chat's own book and every other book its requests attach — for a room, the union
 * of the members' books (each book once, naming the members that bring it).
 */
export function threadLorebooks(thread: RequestThread, profiles: Array<Pick<ChatProfile, 'id' | 'name' | 'lorebookIds'>>): ThreadLorebooks {
  const chatBook = OwnedLorebookStore.chatBookOf(thread.id)
  const byId = new Map<number, ThreadLoreBookView>()
  const sources = profiles.length > 0 ? profiles : [{ id: 0, name: '', lorebookIds: [] }]
  for (const profile of sources) {
    for (const book of booksForRequest({ thread, profile })) {
      if (book.via === 'chat') continue
      const via = book.via === 'thread' ? 'thread' : 'profile'
      const seen = byId.get(book.id)
      const view = seen ?? { id: book.id, name: book.name, kind: book.kind, via, folderId: book.folderId, entries: book.entries, profiles: [] }
      if (via === 'profile' && profile.id > 0 && !view.profiles.some((entry) => entry.id === profile.id)) view.profiles.push({ id: profile.id, name: profile.name })
      if (!seen) byId.set(book.id, view)
    }
  }
  const rank = (book: ThreadLoreBookView) => (book.kind === 'global' ? 2 : book.via === 'thread' ? 1 : 0)
  const books = [...byId.values()].map((book, index) => ({ book, index })).sort((a, b) => rank(a.book) - rank(b.book) || a.index - b.index).map(({ book }) => book)
  const entryUsage = threadLoreUsage(thread, [...(chatBook ? [{ id: chatBook.id, entries: chatBook.entries }] : []), ...books])
  return { chatBook, linkedIds: OwnedLorebookStore.threadLinks(thread.id), books, entryUsage }
}

/** Read only active reply metadata, once per context fetch; no transcript bodies or usage state are persisted. */
export function threadLoreUsage(thread: RequestThread, books: Array<{ id: number; entries: ChatLoreEntry[] }>): ThreadLorebooks['entryUsage'] {
  const db = getUserSettingsDb()
  const rows = db.prepare("SELECT id, context_meta FROM codex_chat_messages WHERE thread_id = ? AND role = 'assistant' ORDER BY id DESC").all(thread.id) as Array<{ id: number; context_meta: string | null }>
  const last = new Map<string, number>()
  rows.forEach((row, turnsAgo) => {
    try {
      const meta = JSON.parse(row.context_meta ?? '{}') as { loreEntries?: Array<{ bookId: number; entryId: string; selected: boolean }> }
      for (const entry of meta.loreEntries ?? []) {
        const key = `${entry.bookId}:${entry.entryId}`
        if (entry.selected && !last.has(key)) last.set(key, turnsAgo)
      }
    } catch { /* Older replies without usable diagnostics have no usage record. */ }
  })
  const replies = new Map<number, Map<string, number>>()
  const result: ThreadLorebooks['entryUsage'] = {}
  for (const book of books) for (const entry of book.entries) {
    const key = `${book.id}:${entry.id}`
    const turnsAgo = last.get(key)
    const usage: ThreadLorebooks['entryUsage'][string] = turnsAgo === undefined ? {} : { turnsAgo }
    if (entry.source) {
      const source = entry.source
      if (!replies.has(source.threadId)) {
        const messages = db.prepare(`SELECT m.id, json_extract(CASE WHEN json_valid(m.routing) THEN m.routing ELSE '{}' END, '$.replyId') AS reply_id
          FROM codex_chat_messages m JOIN codex_chat_threads t ON t.id = m.thread_id WHERE t.id = ? AND t.account_id IS ? AND m.role = 'assistant'
          UNION ALL SELECT m.id, json_extract(a.value, '$.routing.replyId') AS reply_id
          FROM codex_chat_messages m JOIN codex_chat_threads t ON t.id = m.thread_id, json_each(CASE WHEN json_valid(m.alternatives) THEN m.alternatives ELSE '[]' END) a
          WHERE t.id = ? AND t.account_id IS ? AND m.role = 'assistant' AND a.type = 'object'`).all(source.threadId, thread.account_id, source.threadId, thread.account_id) as Array<{ id: number; reply_id: string | null }>
        const byReply = new Map<string, number>()
        for (const message of messages) if (message.reply_id) byReply.set(message.reply_id, message.id)
        replies.set(source.threadId, byReply)
      }
      usage.sourceMessageId = replies.get(source.threadId)!.get(source.replyId) ?? null
    }
    if (Object.keys(usage).length) result[key] = usage
  }
  return result
}

/** Every entry of these books as selectLoreEntries takes them; files are read only for an entry that matched. */
export function keyedLoreEntries(books: AttachedLoreBook[]): KeyedLoreEntry[] {
  return books.flatMap((book) => book.entries.map((entry) => ({
    key: loreEntryKey(book.id, entry),
    bookId: book.id,
    bookKind: book.kind,
    entry,
    book: book.label,
    file: entry.file && book.owner && book.folderId ? () => readEntryFileText(book, entry, LORE_FILE_REQUEST_MAX_BYTES) : undefined,
  })))
}

/** Whether any enabled entry of these books links a file (what read_lore_file is offered for). */
export function hasLoreFiles(books: AttachedLoreBook[]) {
  return books.some((book) => book.folderId !== null && book.entries.some((entry) => entry.enabled && entry.file))
}

/** Lower gives up its titles later when the index is over its cap. */
function keepRank(book: AttachedLoreBook) {
  return book.kind === 'global' ? 0 : book.kind === 'account' ? 1 : 2
}

/**
 * `## 로어북 목차`: one line per book with enabled entries (`[label] title · title(자료) · …`, or `[label] N개 항목` past
 * LORE_INDEX_MAX_TITLES), then how the bodies arrive. Over LORE_INDEX_MAX_TOKENS, books fall back to their count —
 * global books first, then account books, the later ones first. '' when no book has an enabled entry.
 */
export function buildLoreIndex(books: AttachedLoreBook[], estimate: (text: string) => number, render: (text: string) => string, toolOffered: boolean, includeGuidance = true) {
  const lines = books.flatMap((book) => {
    const entries = book.entries.filter((entry) => entry.enabled)
    if (entries.length === 0) return []
    const titles = entries.map((entry) => `${render(loreEntryTitle(entry)).replace(/\s+/g, ' ').trim()}${entry.file && book.folderId ? '(자료)' : ''}`)
    const short = `[${book.label}] ${entries.length}개 항목`
    return [{ book, short, full: titles.length <= LORE_INDEX_MAX_TITLES ? `[${book.label}] ${titles.join(' · ')}` : short }]
  })
  if (lines.length === 0) return ''
  const shown = lines.map((line) => line.full)
  const footer = toolOffered
    ? `(본문은 키워드가 나오면 참고 설정으로 간다. 자료가 필요하면 ${READ_LORE_FILE_TOOL}(책, 항목))`
    : '(본문은 키워드가 나오면 참고 설정으로 간다.)'
  const text = (withGuidance = true) => ['## 로어북 목차', ...shown, ...(withGuidance ? [footer] : [])].join('\n')
  const order = lines.map((_, index) => index).filter((index) => lines[index].full !== lines[index].short)
    .sort((a, b) => keepRank(lines[a].book) - keepRank(lines[b].book) || b - a)
  for (const index of order) {
    if (estimate(text()) <= LORE_INDEX_MAX_TOKENS) break
    shown[index] = lines[index].short
  }
  return text(includeGuidance)
}

/** Public book titles/counts with the same budget decisions, without the model's fixed instructions. */
export function buildLoreIndexContent(books: AttachedLoreBook[], estimate: (text: string) => number, render: (text: string) => string, toolOffered: boolean) {
  return buildLoreIndex(books, estimate, render, toolOffered, false)
}

/** One request's lore: the chosen entries (see selectLoreEntries), the index, and the books they came from. */
export type ChatLore = SelectedLore & { index: string; books: AttachedLoreBook[] }

/**
 * The lore of one request over `books`. `toolOffered`: read_lore_file is among the request's tools (the index and a
 * file left out say so). `inlineFiles` false leaves every file to the tool (Codex). `skip`: keyword entries already
 * given (Codex).
 */
export function selectRequestLore(
  profile: Pick<ChatProfile, 'lorebookIds' | 'loreScanDepth' | 'loreTokenBudget'>,
  books: AttachedLoreBook[],
  messages: ReadonlyArray<{ content: string; display_content?: string | null }> | undefined,
  estimate: (text: string) => number,
  render: (text: string) => string,
  options: { toolOffered: boolean; inlineFiles?: boolean; skip?: (key: string) => boolean },
): ChatLore {
  const selected = selectLoreEntries(profile, messages, estimate, render, {
    skip: options.skip,
    entries: keyedLoreEntries(books),
    files: {
      inline: options.inlineFiles ?? true,
      hint: (file, entry) => options.toolOffered
        ? `(자료 있음: ${file}; ${READ_LORE_FILE_TOOL}("${entry.book ?? ''}", "${entry.title.replace(/\s+/g, ' ')}")로 읽기)`
        : `(자료 있음: ${file})`,
    },
  })
  return { ...selected, index: buildLoreIndex(books, estimate, render, options.toolOffered), books }
}

/** The lore part of the second system message: the index, then the "always on" entries ('' for neither). */
export function loreIndexText(lore: Pick<ChatLore, 'index' | 'constant'>) {
  return [lore.index, lore.constant ? `## 상시 항목\n${lore.constant}` : ''].filter(Boolean).join('\n\n')
}
