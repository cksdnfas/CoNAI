import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import type { StoredFileEntry } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { ensureFileStoreSchema } from '../../database/fileStoreSchema'
import { FileStoreError, FileStoreService, TEXT_EXTENSIONS, fileOwnerKey, type FileStoreChange } from '../fileStoreService'
import { storedFilePath } from '../fileStorePaths'
import { parseMemories } from './chatMemory'
import {
  LOREBOOK_NAME_MAX_LENGTH,
  PROFILE_MAX_LOREBOOKS,
  isSafeLoreFilePath,
  linkedProfiles,
  loreEntryTitle,
  normalizeLorebook,
  normalizeLorebookIds,
  toLorebook,
  type ChatLoreEntry,
  type ChatLorebook,
  type LoreFileText,
  type LorebookRow,
} from './chatLorebook'

/**
 * Account and chat lorebooks as folders of the owner's file store:
 *
 *   로어북/<book>/lorebook.json      the book (source of truth; chat_lorebooks.entries caches it)
 *   로어북/<book>/lorebook.md        the same, for people to read (rewritten on every save)
 *   로어북/<book>/자료/...            files entries point at (`file`, relative to the book folder)
 *   로어북/채팅/<chat>/...            a chat's own book, same shape
 *
 * The app writes lorebook.json and then the cache. A change made through the file store (the file page, the file
 * tools) reaches the cache through the store's change hook; startup re-reads every book once. When the file and the
 * cache disagree, the file wins.
 */

export const LOREBOOK_ROOT_FOLDER = '로어북'
export const CHAT_LOREBOOK_FOLDER = '채팅'
export const LORE_FILES_FOLDER = '자료'
export const LOREBOOK_JSON = 'lorebook.json'
export const LOREBOOK_MARKDOWN = 'lorebook.md'
const LOREBOOK_JSON_MAX_BYTES = 8 * 1024 * 1024
const CHAT_FOLDER_NAME_MAX_LENGTH = 60

export class LorebookError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

/** An account or chat book as its owner sees it. */
export type OwnedLorebook = ChatLorebook & { threadId: number | null; folderId: string | null }

type OwnedKind = 'account' | 'chat'

// ---- Names and paths ------------------------------------------------------------------------------------------

/** A name the file store accepts as a folder name ('' when nothing usable is left). */
function folderName(value: unknown, maxLength = LOREBOOK_NAME_MAX_LENGTH) {
  const cleaned = (typeof value === 'string' ? value : '').normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, maxLength).replace(/[. ]+$/, '')
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? '' : cleaned
}

function isTextPath(file: string) {
  return TEXT_EXTENSIONS.has(path.posix.extname(file).toLowerCase())
}

/** Entries from a person or a model: a `file` must stay inside the book folder and be a text file. */
function assertEntryFiles(entries: ChatLoreEntry[]) {
  for (const entry of entries) {
    if (!entry.file) continue
    if (!isSafeLoreFilePath(entry.file)) throw new LorebookError(`로어북 폴더 밖 파일은 연결할 수 없어: ${entry.file}`)
    if (!isTextPath(entry.file)) throw new LorebookError(`자료 파일은 텍스트(md·txt·json 같은 것)만 연결할 수 있어: ${entry.file}`)
  }
}

/** Entries read from a file a person may have edited: unsafe or non-text links are dropped, not refused. */
function withSafeFiles(entries: ChatLoreEntry[], where: string) {
  return entries.map((entry) => {
    if (!entry.file || (isSafeLoreFilePath(entry.file) && isTextPath(entry.file))) return entry
    console.warn(`[lorebook] ${where}: dropped the file link "${entry.file}" of entry ${entry.id} (outside the book or not text)`)
    return { ...entry, file: null, fileId: null }
  })
}

/**
 * Point every entry's `file` at where its `fileId` is now (moved or renamed inside the book); an id that left the
 * book, or became a non-text file, is let go and the path is kept. An entry with a path and no id takes the id of
 * the file found there.
 */
function relink(owner: string, folderId: string, entries: ChatLoreEntry[]) {
  let changed = false
  const next = entries.map((entry) => {
    let { file, fileId } = entry
    if (fileId) {
      const at = FileStoreService.relativePath(owner, folderId, fileId)
      if (at && isTextPath(at) && FileStoreService.resolvePath(owner, folderId, at)?.kind === 'file') file = at
      else fileId = null
    }
    if (!fileId && file && isSafeLoreFilePath(file)) {
      const found = FileStoreService.resolvePath(owner, folderId, file)
      if (found?.kind === 'file') {
        fileId = found.id
        file = FileStoreService.relativePath(owner, folderId, found.id) ?? file
      }
    }
    if (file === entry.file && fileId === entry.fileId) return entry
    changed = true
    return { ...entry, file, fileId }
  })
  return { entries: next, changed }
}

// ---- lorebook.json / lorebook.md ------------------------------------------------------------------------------

function stampOf(file: StoredFileEntry) {
  return `${file.id}:${file.updatedAt}:${file.size}`
}

/** This app's `{ name, entries }`, a bare entry list, or world info (entries keyed by uid). Null: not a lorebook. */
function parseLorebookJson(value: unknown): ChatLoreEntry[] | null {
  if (Array.isArray(value)) return normalizeLorebook(value)
  if (value && typeof value === 'object') {
    const entries = (value as { entries?: unknown }).entries
    if (Array.isArray(entries)) return normalizeLorebook(entries)
    if (entries && typeof entries === 'object') return normalizeLorebook(Object.values(entries))
  }
  return null
}

/** The book's lorebook.json: null when there is none; `entries` null when it cannot be read as a lorebook. */
function readLorebookJson(owner: string, folderId: string): { stamp: string; entries: ChatLoreEntry[] | null } | null {
  const file = FileStoreService.findChild(owner, folderId, LOREBOOK_JSON)
  if (!file || file.kind !== 'file') return null
  const stamp = stampOf(file)
  if (file.size > LOREBOOK_JSON_MAX_BYTES) return { stamp, entries: null }
  try {
    const text = fs.readFileSync(storedFilePath(owner, file.id), 'utf8').replace(/^﻿/, '')
    return { stamp, entries: parseLorebookJson(JSON.parse(text)) }
  } catch {
    return { stamp, entries: null }
  }
}

function renderJson(name: string, entries: ChatLoreEntry[]) {
  return `${JSON.stringify({ name, entries }, null, 2)}\n`
}

/** For people to read in the file page; the app never reads it back. */
function renderMarkdown(name: string, entries: ChatLoreEntry[]) {
  const lines = [`# ${name}`, '', '<!-- lorebook.json이 원본이야. 이 파일은 저장할 때마다 다시 써. -->', '']
  for (const entry of entries) {
    lines.push(`## ${loreEntryTitle(entry) || entry.id}`, '')
    const facts = [
      entry.keys.length ? `키워드: ${entry.keys.join(', ')}` : '',
      entry.secondaryKeys.length ? `보조 키워드: ${entry.secondaryKeys.join(', ')}` : '',
      entry.constant ? '상시' : '',
      entry.enabled ? '' : '꺼짐',
      entry.file ? `자료: ${entry.file}` : '',
    ].filter(Boolean)
    if (facts.length) lines.push(...facts.map((fact) => `- ${fact}`), '')
    if (entry.content) lines.push(entry.content, '')
  }
  return lines.join('\n')
}

// ---- Rows -----------------------------------------------------------------------------------------------------

function rowById(id: number) {
  return getUserSettingsDb().prepare('SELECT * FROM chat_lorebooks WHERE id = ?').get(id) as LorebookRow | undefined
}

function toOwned(row: LorebookRow): OwnedLorebook {
  return { ...toLorebook(row, linkedProfiles()), threadId: row.thread_id, folderId: row.folder_id }
}

/** Write the book's files, then its cache. */
function writeBook(row: LorebookRow, entries: ChatLoreEntry[]) {
  const owner = row.owner_key as string
  const folderId = row.folder_id as string
  const json = FileStoreService.writeText(owner, folderId, LOREBOOK_JSON, renderJson(row.name, entries), { silent: true })
  FileStoreService.writeText(owner, folderId, LOREBOOK_MARKDOWN, renderMarkdown(row.name, entries), { silent: true })
  getUserSettingsDb().prepare('UPDATE chat_lorebooks SET entries = ?, source_stamp = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(entries), stampOf(json), row.id)
}

/**
 * Bring the cache in line with lorebook.json (the file wins) and file links in line with where their files are.
 * No lorebook.json keeps the cache (the next save writes it again); one that does not parse is left alone too.
 */
function refreshBook(row: LorebookRow): LorebookRow {
  if (row.kind === 'global' || !row.owner_key || !row.folder_id) return row
  const read = readLorebookJson(row.owner_key, row.folder_id)
  if (!read) return row
  if (read.entries === null) console.warn(`[lorebook] Book ${row.id}: lorebook.json is not a readable lorebook; keeping the cached entries`)
  const base = read.entries === null ? normalizeLorebook(row.entries) : withSafeFiles(read.entries, `Book ${row.id}`)
  const { entries, changed } = relink(row.owner_key, row.folder_id, base)
  if (changed && read.entries !== null) {
    writeBook(row, entries)
  } else {
    const cached = JSON.stringify(entries)
    if (cached !== row.entries) {
      console.warn(`[lorebook] Book ${row.id}: the cache differed from lorebook.json; took the file`)
      getUserSettingsDb().prepare('UPDATE chat_lorebooks SET entries = ?, source_stamp = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?').run(cached, read.stamp, row.id)
    } else if (read.stamp !== row.source_stamp) {
      getUserSettingsDb().prepare('UPDATE chat_lorebooks SET source_stamp = ? WHERE id = ?').run(read.stamp, row.id)
    }
  }
  return rowById(row.id) ?? row
}

/** Re-read lorebook.json only when it is not the file the cache came from. */
function refreshIfStale(row: LorebookRow): LorebookRow {
  if (row.kind === 'global' || !row.owner_key || !row.folder_id) return row
  const file = FileStoreService.findChild(row.owner_key, row.folder_id, LOREBOOK_JSON)
  if (!file || stampOf(file) === row.source_stamp) return row
  return refreshBook(row)
}

/** Drop a book row and every link to it (profiles, chats). Its folder is the caller's business. */
function removeBookRow(bookId: number) {
  const db = getUserSettingsDb()
  db.transaction(() => {
    const unlinkProfile = db.prepare('UPDATE llm_chat_profiles SET lorebook_ids = ? WHERE id = ?')
    for (const profile of linkedProfiles()) {
      if (profile.lorebookIds.includes(bookId)) unlinkProfile.run(JSON.stringify(profile.lorebookIds.filter((id) => id !== bookId)), profile.id)
    }
    const threads = db.prepare("SELECT id, lorebook_ids FROM codex_chat_threads WHERE lorebook_ids IS NOT NULL AND lorebook_ids != '[]'").all() as Array<{ id: number; lorebook_ids: string }>
    const unlinkThread = db.prepare('UPDATE codex_chat_threads SET lorebook_ids = ? WHERE id = ?')
    for (const thread of threads) {
      const ids = normalizeLorebookIds(thread.lorebook_ids)
      if (ids.includes(bookId)) {
        const rest = ids.filter((id) => id !== bookId)
        unlinkThread.run(rest.length ? JSON.stringify(rest) : null, thread.id)
      }
    }
    db.prepare('DELETE FROM chat_lorebooks WHERE id = ?').run(bookId)
  })()
}

function lorebookRoot(owner: string) {
  return FileStoreService.ensureFolder(owner, null, LOREBOOK_ROOT_FOLDER)
}

function existingRoots(owner: string) {
  const root = FileStoreService.findChild(owner, null, LOREBOOK_ROOT_FOLDER)
  const usable = root?.kind === 'folder' ? root : null
  const chat = usable ? FileStoreService.findChild(owner, usable.id, CHAT_LOREBOOK_FOLDER) : null
  return { root: usable, chat: chat?.kind === 'folder' ? chat : null }
}

/** A folder holding a lorebook.json that the app has no row for becomes an account book. */
function adoptFolder(owner: string, folder: { id: string; name: string }) {
  const result = getUserSettingsDb().prepare("INSERT INTO chat_lorebooks (name, entries, kind, owner_key, folder_id) VALUES (?, '[]', 'account', ?, ?)")
    .run(folder.name.slice(0, LOREBOOK_NAME_MAX_LENGTH), owner, folder.id)
  console.log(`[lorebook] Found a new book folder "${folder.name}" (${owner})`)
  return rowById(Number(result.lastInsertRowid)) as LorebookRow
}

/** The book whose folder is `folderId` or holds it, if any. */
function enclosingBook(owner: string, folderId: string | null, byFolder: Map<string, LorebookRow>) {
  const parentOf = getUserSettingsDb().prepare('SELECT parent_id FROM stored_file_entries WHERE id = ? AND owner_key = ?')
  let current = folderId
  for (let depth = 0; current !== null && depth < 64; depth++) {
    const book = byFolder.get(current)
    if (book) return book
    current = ((parentOf.get(current, owner) as { parent_id: string | null } | undefined)?.parent_id) ?? null
  }
  return null
}

// ---- File store hook ------------------------------------------------------------------------------------------

/**
 * A write, rename, move or delete in someone's file store: books whose folder holds (or held) the entry re-read
 * lorebook.json and re-point their file links; a renamed book folder renames the book, a deleted one ends it; a
 * lorebook.json put into a new folder under 로어북/ makes that folder a book.
 */
export function handleFileStoreChange(change: FileStoreChange) {
  const db = getUserSettingsDb()
  const books = db.prepare('SELECT * FROM chat_lorebooks WHERE owner_key = ? AND folder_id IS NOT NULL').all(change.owner) as LorebookRow[]
  const byFolder = new Map(books.map((book) => [book.folder_id as string, book]))
  const touched = new Map<number, LorebookRow>()
  let roots: ReturnType<typeof existingRoots> | null = null
  for (const entry of change.entries) {
    const own = entry.kind === 'folder' ? byFolder.get(entry.id) : undefined
    if (own) {
      if (change.action === 'delete') {
        removeBookRow(own.id)
        byFolder.delete(entry.id)
        touched.delete(own.id)
      } else if (change.action === 'rename') {
        db.prepare('UPDATE chat_lorebooks SET name = ?, updated_date = CURRENT_TIMESTAMP WHERE id = ?').run(entry.name.slice(0, LOREBOOK_NAME_MAX_LENGTH), own.id)
      }
      continue
    }
    for (const parentId of new Set([entry.parentId, entry.previousParentId])) {
      if (parentId === undefined) continue
      const book = enclosingBook(change.owner, parentId, byFolder)
      if (book) touched.set(book.id, book)
    }
    if (entry.kind === 'file' && change.action !== 'delete' && entry.name.toLowerCase() === LOREBOOK_JSON && entry.parentId && !byFolder.has(entry.parentId)) {
      roots ??= existingRoots(change.owner)
      const parent = db.prepare("SELECT id, name, parent_id FROM stored_file_entries WHERE id = ? AND kind = 'folder' AND deleted_at IS NULL").get(entry.parentId) as { id: string; name: string; parent_id: string | null } | undefined
      if (parent && roots.root && parent.parent_id === roots.root.id && parent.id !== roots.chat?.id) {
        const adopted = adoptFolder(change.owner, parent)
        byFolder.set(parent.id, adopted)
        touched.set(adopted.id, adopted)
      }
    }
  }
  // Books that follow a changed file by id, wherever it went.
  const changedIds = new Set(change.entries.map((entry) => entry.id))
  for (const book of byFolder.values()) {
    if (!touched.has(book.id) && normalizeLorebook(book.entries).some((entry) => entry.fileId && changedIds.has(entry.fileId))) touched.set(book.id, book)
  }
  for (const book of touched.values()) {
    try {
      const current = rowById(book.id)
      if (current) refreshBook(current)
    } catch (error) {
      console.warn(`[lorebook] Book ${book.id} could not follow a file change:`, error instanceof Error ? error.message : error)
    }
  }
}

let unsubscribeHook: (() => void) | null = null
/** Idempotent; done on load, so any process that can write a book also follows the file store. */
export function registerLorebookFileHooks() {
  unsubscribeHook ??= FileStoreService.onChange(handleFileStoreChange)
}
registerLorebookFileHooks()

/**
 * Startup pass: every account's 로어북/ folder once. A folder directly under it with a lorebook.json and no row
 * becomes an account book; every book re-reads its lorebook.json (the file wins); a book whose folder is gone ends.
 */
export function reconcileLorebookFolders() {
  const db = getUserSettingsDb()
  const result = { created: 0, refreshed: 0, removed: 0 }
  const known = new Set((db.prepare('SELECT folder_id FROM chat_lorebooks WHERE folder_id IS NOT NULL').all() as Array<{ folder_id: string }>).map((row) => row.folder_id))
  const roots = db.prepare("SELECT id, owner_key FROM stored_file_entries WHERE parent_id IS NULL AND kind = 'folder' AND name_key = ? AND deleted_at IS NULL")
    .all(LOREBOOK_ROOT_FOLDER.toLowerCase()) as Array<{ id: string; owner_key: string }>
  for (const root of roots) {
    const folders = db.prepare("SELECT id, name, name_key FROM stored_file_entries WHERE owner_key = ? AND parent_id = ? AND kind = 'folder' AND deleted_at IS NULL")
      .all(root.owner_key, root.id) as Array<{ id: string; name: string; name_key: string }>
    for (const folder of folders) {
      if (known.has(folder.id) || folder.name_key === CHAT_LOREBOOK_FOLDER.toLowerCase()) continue
      if (FileStoreService.findChild(root.owner_key, folder.id, LOREBOOK_JSON)?.kind !== 'file') continue
      adoptFolder(root.owner_key, folder)
      result.created++
    }
  }
  const books = db.prepare("SELECT * FROM chat_lorebooks WHERE kind IN ('account', 'chat') AND folder_id IS NOT NULL").all() as LorebookRow[]
  const live = db.prepare("SELECT 1 FROM stored_file_entries WHERE id = ? AND owner_key = ? AND kind = 'folder' AND deleted_at IS NULL")
  for (const book of books) {
    try {
      if (!live.get(book.folder_id, book.owner_key)) {
        console.warn(`[lorebook] Book ${book.id} "${book.name}": its folder is gone; the book ends`)
        removeBookRow(book.id)
        result.removed++
        continue
      }
      const before = book.entries
      if (refreshBook(book).entries !== before) result.refreshed++
    } catch (error) {
      console.warn(`[lorebook] Book ${book.id} could not be reconciled:`, error instanceof Error ? error.message : error)
    }
  }
  return result
}

// ---- Store ----------------------------------------------------------------------------------------------------

function requireOwn(bookId: number, owner: string): LorebookRow {
  const row = rowById(bookId)
  if (!row || row.kind === 'global' || row.owner_key !== owner || !row.folder_id) throw new LorebookError('로어북을 찾을 수 없어.', 404)
  return refreshIfStale(row)
}

/** A folder name under `parentId` that nothing else uses: the name, else with the chat id, else counted. */
function freeFolderName(owner: string, parentId: string, base: string, threadId: number) {
  const candidates = [base, `${base} (${threadId})`]
  for (let n = 2; n < 100; n++) candidates.push(`${base} (${threadId}-${n})`)
  const name = candidates.find((candidate) => !FileStoreService.findChild(owner, parentId, candidate))
  if (!name) throw new LorebookError('채팅 로어북 폴더 이름을 정하지 못했어.', 409)
  return name
}

function accountBookName(value: unknown) {
  const name = folderName(value)
  if (!name) throw new LorebookError('로어북 이름을 입력해줘.')
  if (name.toLowerCase() === CHAT_LOREBOOK_FOLDER.toLowerCase()) throw new LorebookError(`"${CHAT_LOREBOOK_FOLDER}"는 채팅 로어북 자리라 이름으로 쓸 수 없어.`)
  return name
}

/** Entries as saved by a person or a model: validated links, then ids resolved inside the book folder. */
function preparedEntries(row: LorebookRow, value: unknown) {
  const entries = normalizeLorebook(value)
  assertEntryFiles(entries)
  return relink(row.owner_key as string, row.folder_id as string, entries).entries
}

function createChatBook(threadId: number, entries: ChatLoreEntry[]) {
  const db = getUserSettingsDb()
  const thread = db.prepare('SELECT id, account_id, title FROM codex_chat_threads WHERE id = ?').get(threadId) as { id: number; account_id: number | null; title: string } | undefined
  if (!thread) throw new LorebookError('채팅을 찾을 수 없어.', 404)
  const owner = fileOwnerKey(thread.account_id)
  return db.transaction(() => {
    const chatRoot = FileStoreService.ensureFolder(owner, lorebookRoot(owner).id, CHAT_LOREBOOK_FOLDER)
    const name = freeFolderName(owner, chatRoot.id, folderName(thread.title, CHAT_FOLDER_NAME_MAX_LENGTH) || `채팅 ${thread.id}`, thread.id)
    const folder = FileStoreService.createFolder(owner, chatRoot.id, name)
    FileStoreService.createFolder(owner, folder.id, LORE_FILES_FOLDER)
    const result = db.prepare("INSERT INTO chat_lorebooks (name, entries, kind, owner_key, folder_id, thread_id) VALUES (?, '[]', 'chat', ?, ?, ?)").run(name, owner, folder.id, thread.id)
    const row = rowById(Number(result.lastInsertRowid)) as LorebookRow
    writeBook(row, preparedEntries(row, entries))
    return rowById(row.id) as LorebookRow
  }).immediate()
}

function chatBookRow(threadId: number) {
  return getUserSettingsDb().prepare("SELECT * FROM chat_lorebooks WHERE kind = 'chat' AND thread_id = ?").get(threadId) as LorebookRow | undefined
}

/** A chat book left with no entries and no files of its own goes away (folder included): no entries, no folder. */
function isDisposable(row: LorebookRow) {
  const owner = row.owner_key as string
  const children = FileStoreService.list(owner, row.folder_id, 0, 200).entries
  return children.every((child) => (child.kind === 'file' && [LOREBOOK_JSON, LOREBOOK_MARKDOWN].includes(child.name.toLowerCase()))
    || (child.kind === 'folder' && child.name === LORE_FILES_FOLDER && FileStoreService.list(owner, child.id, 0, 1).total === 0))
}

export const OwnedLorebookStore = {
  /** The owner's books of these kinds, by name; caches refreshed first where lorebook.json changed. */
  list(owner: string, kinds: OwnedKind[] = ['account']): OwnedLorebook[] {
    if (kinds.length === 0) return []
    const rows = getUserSettingsDb().prepare(`SELECT * FROM chat_lorebooks WHERE owner_key = ? AND kind IN (${kinds.map(() => '?').join(', ')}) AND folder_id IS NOT NULL ORDER BY name COLLATE NOCASE ASC, id ASC`)
      .all(owner, ...kinds) as LorebookRow[]
    return rows.map((row) => toOwned(refreshIfStale(row)))
  },

  find(bookId: number, owner: string): OwnedLorebook | null {
    try { return toOwned(requireOwn(bookId, owner)) } catch { return null }
  },

  /** A new account book: `로어북/<name>/` with lorebook.json, lorebook.md and an empty 자료/. */
  create(owner: string, input: { name?: unknown; entries?: unknown }): OwnedLorebook {
    const name = accountBookName(input.name)
    const db = getUserSettingsDb()
    const row = db.transaction(() => {
      const root = lorebookRoot(owner)
      if (FileStoreService.findChild(owner, root.id, name)) throw new LorebookError(`같은 이름의 로어북이 있어: ${name}`, 409)
      const folder = FileStoreService.createFolder(owner, root.id, name)
      FileStoreService.createFolder(owner, folder.id, LORE_FILES_FOLDER)
      const result = db.prepare("INSERT INTO chat_lorebooks (name, entries, kind, owner_key, folder_id) VALUES (?, '[]', 'account', ?, ?)").run(name, owner, folder.id)
      const created = rowById(Number(result.lastInsertRowid)) as LorebookRow
      writeBook(created, preparedEntries(created, input.entries ?? []))
      return rowById(created.id) as LorebookRow
    }).immediate()
    return toOwned(row)
  },

  /**
   * Rename (the folder follows) and/or replace the entries: lorebook.json is written first, then the cache. A chat
   * book left empty is removed (null).
   */
  update(bookId: number, owner: string, patch: { name?: unknown; entries?: unknown }): OwnedLorebook | null {
    let row = requireOwn(bookId, owner)
    const db = getUserSettingsDb()
    return db.transaction(() => {
      if (patch.name !== undefined) {
        const name = row.kind === 'account' ? accountBookName(patch.name) : folderName(patch.name, CHAT_FOLDER_NAME_MAX_LENGTH)
        if (!name) throw new LorebookError('로어북 이름을 입력해줘.')
        if (name !== row.name) {
          FileStoreService.rename(owner, row.folder_id as string, name)
          db.prepare('UPDATE chat_lorebooks SET name = ? WHERE id = ?').run(name, row.id)
          row = rowById(row.id) as LorebookRow
        }
      }
      const entries = patch.entries === undefined ? normalizeLorebook(row.entries) : preparedEntries(row, patch.entries)
      if (row.kind === 'chat' && entries.length === 0 && isDisposable(row)) {
        FileStoreService.deleteTree(owner, row.folder_id as string, { silent: true })
        removeBookRow(row.id)
        return null
      }
      writeBook(row, entries)
      return toOwned(rowById(row.id) as LorebookRow)
    }).immediate()
  },

  /** The book, its folder (files included) and every link to it. */
  delete(bookId: number, owner: string) {
    const row = requireOwn(bookId, owner)
    try {
      FileStoreService.deleteTree(owner, row.folder_id as string, { silent: true })
    } catch (error) {
      // A folder already gone is fine; anything else (a file a chat still attaches) stops the delete.
      if (!(error instanceof FileStoreError && error.status === 404)) throw error
    }
    removeBookRow(row.id)
    return true
  },

  /** Link an account book to a profile. A profile is shared, so only the book's owner can link it. */
  linkProfile(profileId: number, bookId: number, owner: string) {
    const row = requireOwn(bookId, owner)
    if (row.kind !== 'account') throw new LorebookError('계정 로어북만 프로필에 연결할 수 있어.')
    const db = getUserSettingsDb()
    const profile = db.prepare('SELECT lorebook_ids FROM llm_chat_profiles WHERE id = ?').get(profileId) as { lorebook_ids: string | null } | undefined
    if (!profile) throw new LorebookError('프로필을 찾을 수 없어.', 404)
    const ids = normalizeLorebookIds(profile.lorebook_ids)
    if (ids.includes(bookId)) return ids
    if (ids.length >= PROFILE_MAX_LOREBOOKS) throw new LorebookError(`프로필에는 로어북을 ${PROFILE_MAX_LOREBOOKS}개까지 연결할 수 있어.`)
    const next = [...ids, bookId]
    db.prepare('UPDATE llm_chat_profiles SET lorebook_ids = ? WHERE id = ?').run(JSON.stringify(next), profileId)
    return next
  },

  unlinkProfile(profileId: number, bookId: number, owner: string) {
    requireOwn(bookId, owner)
    const db = getUserSettingsDb()
    const profile = db.prepare('SELECT lorebook_ids FROM llm_chat_profiles WHERE id = ?').get(profileId) as { lorebook_ids: string | null } | undefined
    if (!profile) throw new LorebookError('프로필을 찾을 수 없어.', 404)
    const next = normalizeLorebookIds(profile.lorebook_ids).filter((id) => id !== bookId)
    db.prepare('UPDATE llm_chat_profiles SET lorebook_ids = ? WHERE id = ?').run(JSON.stringify(next), profileId)
    return next
  },

  /** Account books linked to this chat only. */
  threadLinks(threadId: number) {
    const row = getUserSettingsDb().prepare('SELECT lorebook_ids FROM codex_chat_threads WHERE id = ?').get(threadId) as { lorebook_ids: string | null } | undefined
    return normalizeLorebookIds(row?.lorebook_ids ?? null)
  },

  /** Replace the chat's linked account books; each must be an account book of the chat's own owner. */
  setThreadLinks(threadId: number, value: unknown) {
    const db = getUserSettingsDb()
    const thread = db.prepare('SELECT account_id FROM codex_chat_threads WHERE id = ?').get(threadId) as { account_id: number | null } | undefined
    if (!thread) throw new LorebookError('채팅을 찾을 수 없어.', 404)
    const ids = normalizeLorebookIds(value)
    if (ids.length > 0) {
      const found = db.prepare(`SELECT id FROM chat_lorebooks WHERE kind = 'account' AND owner_key = ? AND id IN (${ids.map(() => '?').join(', ')})`).all(fileOwnerKey(thread.account_id), ...ids)
      if (found.length !== ids.length) throw new LorebookError('이 채팅에는 내 계정 로어북만 연결할 수 있어.')
    }
    db.prepare('UPDATE codex_chat_threads SET lorebook_ids = ? WHERE id = ?').run(ids.length ? JSON.stringify(ids) : null, threadId)
    return ids
  },

  /** The chat's own book, or null while it has had no entries. */
  chatBookOf(threadId: number): OwnedLorebook | null {
    const row = chatBookRow(threadId)
    return row ? toOwned(refreshIfStale(row)) : null
  },

  /** Replace the chat book's entries; the book (and its folder) comes into being with its first entry. */
  saveChatBook(threadId: number, value: unknown): OwnedLorebook | null {
    const current = chatBookRow(threadId)
    if (current) return OwnedLorebookStore.update(current.id, current.owner_key as string, { entries: value })
    const entries = normalizeLorebook(value)
    if (entries.length === 0) return null
    assertEntryFiles(entries)
    return toOwned(createChatBook(threadId, entries))
  },

  /** Append entries to the chat book (created when missing); entries whose id the book already has are skipped. */
  addChatBookEntries(threadId: number, value: unknown): OwnedLorebook | null {
    const added = normalizeLorebook(value)
    const current = OwnedLorebookStore.chatBookOf(threadId)
    const have = new Set(current?.entries.map((entry) => entry.id) ?? [])
    const fresh = added.filter((entry) => !have.has(entry.id))
    if (fresh.length === 0) return current
    return OwnedLorebookStore.saveChatBook(threadId, [...(current?.entries ?? []), ...fresh])
  },
}

// ---- Linked files ---------------------------------------------------------------------------------------------

/** Where a book's files are: the owner's file store and the book folder. */
export type LoreFileBook = { owner: string | null; folderId: string | null }

/** The live text file an entry links, inside its book folder; null when it has none, or it is gone or not text. */
export function loreEntryFile(book: LoreFileBook, entry: Pick<ChatLoreEntry, 'file'>): StoredFileEntry | null {
  if (!book.owner || !book.folderId || !entry.file || !isSafeLoreFilePath(entry.file) || !isTextPath(entry.file)) return null
  const found = FileStoreService.resolvePath(book.owner, book.folderId, entry.file)
  return found?.kind === 'file' && isTextPath(found.name) ? found : null
}

/**
 * The start of an entry's linked file as UTF-8 text, at most `maxBytes` (cut on a whole character; `truncated` when
 * there is more). Null when the entry links none, or the file is gone, binary or not UTF-8.
 */
export function readEntryFileText(book: LoreFileBook, entry: Pick<ChatLoreEntry, 'file'>, maxBytes: number): LoreFileText | null {
  const file = loreEntryFile(book, entry)
  if (!file) return null
  try {
    const handle = fs.openSync(storedFilePath(book.owner as string, file.id), 'r')
    let data: Buffer
    let truncated: boolean
    try {
      const size = fs.fstatSync(handle).size
      const buffer = Buffer.alloc(Math.min(size, Math.max(0, maxBytes)))
      const read = fs.readSync(handle, buffer, 0, buffer.length, 0)
      truncated = read < size
      let length = read
      if (truncated) {
        // Back off to the start of a character that did not fit whole.
        let start = read - 1
        while (start >= 0 && (buffer[start] & 0xc0) === 0x80) start--
        if (start >= 0) {
          const byte = buffer[start]
          const width = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4
          if (start + width > read) length = start
        }
      }
      data = buffer.subarray(0, length)
    } finally {
      fs.closeSync(handle)
    }
    if (data.includes(0)) return null
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '')
    return { name: path.posix.basename(entry.file as string), text, truncated }
  } catch {
    return null
  }
}

// ---- Migration ------------------------------------------------------------------------------------------------

/**
 * Pinned memories (codex_chat_threads.memories) become "always on" entries of each chat's book, then the column is
 * cleared for that chat. Per chat and idempotent: a chat whose memories are NULL is done, and an entry already moved
 * (same id) is not added twice if a start was cut short between the two steps.
 */
export function migratePinnedMemoriesToChatBooks(db: Database.Database) {
  let live: Database.Database
  try { live = getUserSettingsDb() } catch { return }
  // Only the live database: the file store and the cache must be the same database.
  if (live !== db) return
  ensureFileStoreSchema(db)
  const rows = db.prepare('SELECT id, memories FROM codex_chat_threads WHERE memories IS NOT NULL').all() as Array<{ id: number; memories: string }>
  let moved = 0
  for (const row of rows) {
    try {
      const items = parseMemories(row.memories)
      db.transaction(() => {
        if (items.length > 0) {
          OwnedLorebookStore.addChatBookEntries(row.id, items.map((item, index) => ({
            id: `memory-${item.id}`.slice(0, 80),
            title: item.text.trim().slice(0, 20),
            keys: [],
            content: item.text,
            constant: true,
            enabled: true,
            order: index,
          })))
        }
        db.prepare('UPDATE codex_chat_threads SET memories = NULL WHERE id = ?').run(row.id)
      }).immediate()
      moved += items.length
    } catch (error) {
      console.warn(`[lorebook] Pinned memories of chat ${row.id} stay for the next start:`, error instanceof Error ? error.message : error)
    }
  }
  if (moved > 0) console.log(`  ✅ Moved ${moved} pinned memories into chat lorebooks`)
}
