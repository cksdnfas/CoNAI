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

/** Every entry of these books as selectLoreEntries takes them; files are read only for an entry that matched. */
export function keyedLoreEntries(books: AttachedLoreBook[]): KeyedLoreEntry[] {
  return books.flatMap((book) => book.entries.map((entry) => ({
    key: loreEntryKey(book.id, entry),
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
export function buildLoreIndex(books: AttachedLoreBook[], estimate: (text: string) => number, render: (text: string) => string, toolOffered: boolean) {
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
  const text = () => ['## 로어북 목차', ...shown, footer].join('\n')
  const order = lines.map((_, index) => index).filter((index) => lines[index].full !== lines[index].short)
    .sort((a, b) => keepRank(lines[a].book) - keepRank(lines[b].book) || b - a)
  for (const index of order) {
    if (estimate(text()) <= LORE_INDEX_MAX_TOKENS) break
    shown[index] = lines[index].short
  }
  return text()
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
