// Chat lorebooks: entries, own and per-thread books, and merging. deleteCodexChatThread is here because deleting a chat applies a lorebook merge decision (this keeps requestWithMergePreview private to this file).
// Lower layer than api-codex-chat.ts, which re-exports this file: import only from api-codex-chat-core and the modules before this one, never from api-codex-chat.ts.

import { ApiRequestError, requestApiData } from '@/lib/api-request'
import { JSON_HEADERS, requestRevisionChecked } from './api-codex-chat-core'

export const CHAT_LOREBOOKS_QUERY_KEY = ['codex-chat-lorebooks'] as const
export const CHAT_LOREBOOK_SUMMARIES_QUERY_KEY = [...CHAT_LOREBOOKS_QUERY_KEY, 'summary'] as const
export const chatLorebookQueryKey = (lorebookId: number) => [...CHAT_LOREBOOKS_QUERY_KEY, 'detail', lorebookId] as const

/** A full chat profile (admin). */
/** How secondary keywords narrow a primary match: any also present, not all, none, or all. */
export type LoreSecondaryLogic = 'andAny' | 'notAll' | 'notAny' | 'andAll'

export interface ChatLoreEntry {
  language?: import('@conai/shared').BilingualLore['language']
  translation?: import('@conai/shared').LoreTranslation | null
  source?: import('@conai/shared').ChatLoreSource
  id: string
  /** What the book's index calls the entry; empty: the first keyword (see loreEntryTitle). */
  title?: string
  /** `/pattern/flags` is a regular expression. */
  keys: string[]
  secondaryKeys?: string[]
  /** The same keywords in the lore key language (ChatAdminSettings.loreKeyLanguage); matched together with the English ones. */
  localKeys?: string[]
  localSecondaryKeys?: string[]
  secondaryLogic?: LoreSecondaryLogic
  content: string
  enabled: boolean
  constant: boolean
  order: number
  caseSensitive: boolean
  sticky?: number
  cooldown?: number
  delay?: number
  group?: string
  /** Recursive scan: only the chat's text, never another entry's, brings this entry in. */
  excludeRecursion?: boolean
  /** Recursive scan: this entry's text brings in no other entry. */
  preventRecursion?: boolean
  /** A text file in the book's folder (`자료/x.md`); account and chat books only. `fileId` follows it when moved. */
  file?: string | null
  fileId?: string | null
}

/** The entry's title as the index shows it: its own, else the first keyword, else the start of its text. */
export function loreEntryTitle(entry: Pick<ChatLoreEntry, 'title' | 'keys' | 'content' | 'localKeys' | 'translation'>) {
  return entry.translation?.title || entry.title?.trim() || entry.keys[0] || entry.localKeys?.[0] || entry.content.slice(0, 20)
}

/** `global`: the admin's shared books. `account`: a folder under the account's 로어북/. `chat`: one chat's own book. */
export type ChatLorebookKind = 'global' | 'account' | 'chat'

/** A shared lorebook; profiles link it by id, so editing or re-importing it reaches every linked profile. */
export interface ChatLorebook {
  id: number
  revision: string
  name: string
  kind?: ChatLorebookKind
  entries: ChatLoreEntry[]
  profiles: Array<{ id: number; name: string }>
  /** Account books: chats sharing it are connected (history search across them). False: lore only. */
  connectsChats?: boolean
  createdDate: string
  updatedDate: string
}

/** An account or chat book (a file-store folder); global ones come with no entries, only their count. */
export interface OwnedChatLorebook extends ChatLorebook {
  kind: ChatLorebookKind
  threadId: number | null
  folderId: string | null
  entryCount?: number
}

export type ChatLorebookSummary = Omit<ChatLorebook, 'entries'> & { entryCount: number }

/** Linkable lorebooks without their entry bodies; the parent key also covers existing lorebook invalidations. */
export function listChatLorebookSummaries() {
  return requestApiData<ChatLorebookSummary[]>('/api/codex-chat/lorebooks?summary=1')
}

/** A book the chat's requests attach besides its own: linked to this chat, or brought by the profile (a room: members). */
export interface ThreadLoreBook {
  id: number
  revision: string
  name: string
  kind: ChatLorebookKind
  via: 'thread' | 'profile'
  folderId: string | null
  entries: ChatLoreEntry[]
  profiles: Array<{ id: number; name: string }>
}

export interface ThreadLorebooks {
  entryUsage?: Record<string, { turnsAgo?: number; sourceMessageId?: number | null }>
  chatBook: OwnedChatLorebook | null
  linkedIds: number[]
  /** The linked account book save_lore writes to; null: the chat's own book. */
  recordBookId: number | null
  books: ThreadLoreBook[]
}


export type LoreMergeChoice = 'source' | 'target' | 'both' | 'merged'
export type LoreMergeDecision = { entryId: string; choice: LoreMergeChoice; content?: string }
export interface LoreMergeItem {
  entry: ChatLoreEntry
  status: 'new' | 'duplicate'
  duplicateOf?: ChatLoreEntry
  /** The starting text of "합친 결과". */
  suggested?: string
}
export interface LoreMergePreview {
  source: OwnedChatLorebook
  target: OwnedChatLorebook
  items: LoreMergeItem[]
  files: Array<{ file: string; clash: boolean }>
  /** What "맡기기" tells the model unless rewritten. */
  defaultInstruction: string
}
export type LoreMergeResult = { status: 'merged'; book: OwnedChatLorebook; added: number; updated: number; skipped: number; files: number; sourceDeleted: boolean; sourceError?: string }
export type LoreMergeDraft = { entryId: string; content: string } | { entryId: string; error: string }

/** A 409 answer that carries the merge preview: some duplicates still need a decision. */
export class LoreDecisionsNeededError extends Error {
  readonly preview: LoreMergePreview
  readonly missing: string[]
  constructor(message: string, preview: LoreMergePreview, missing: string[]) {
    super(message)
    this.preview = preview
    this.missing = missing
  }
}

export function listChatLorebooks() {
  return requestApiData<ChatLorebook[]>('/api/codex-chat/admin/lorebooks')
}

export function getChatLorebook(lorebookId: number, signal?: AbortSignal) {
  return requestApiData<ChatLorebook>(`/api/codex-chat/admin/lorebooks/${lorebookId}`, { signal, cache: 'no-store' })
}

export function createChatLorebook(input: { name: string; entries?: ChatLoreEntry[] }) {
  return requestApiData<ChatLorebook>('/api/codex-chat/admin/lorebooks', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** A new lorebook from a file, or (with `lorebookId`) that book's entries replaced from a newer file. */
export function importChatLorebook(file: File, lorebookId?: number) {
  const body = new FormData()
  body.append('file', file)
  const path = lorebookId ? `/api/codex-chat/admin/lorebooks/${lorebookId}/import` : '/api/codex-chat/admin/lorebooks/import'
  return requestApiData<ChatLorebook>(path, { method: 'POST', body })
}

export function updateChatLorebook(lorebookId: number, patch: { name?: string; entries?: ChatLoreEntry[]; revision?: string }) {
  return requestRevisionChecked<ChatLorebook>(`/api/codex-chat/admin/lorebooks/${lorebookId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteChatLorebook(lorebookId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/admin/lorebooks/${lorebookId}`, { method: 'DELETE' })
}

/** What happens to the chat's own lorebook when the chat is deleted (default: it goes too). */
export type ThreadLorebookAction = { action: 'delete' } | { action: 'keep' } | { action: 'merge'; targetId: number; decisions?: LoreMergeDecision[] }

/** Deleting with a merge throws LoreDecisionsNeededError (nothing changed) while a duplicate has no decision. */
/** `backupDate` (the reader's `YYYY-MM-DD`): save the chat to the file store's 채팅 백업 folder first. */
export function deleteCodexChatThread(threadId: number, lorebook?: ThreadLorebookAction, backupDate?: string) {
  const body = { ...(lorebook ? { lorebook } : {}), ...(backupDate ? { backup: true, backupDate } : {}) }
  return requestWithMergePreview<{ lorebook?: unknown } | undefined>(`/api/codex-chat/threads/${threadId}`, { method: 'DELETE', ...(Object.keys(body).length ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}) })
}

/** Like requestApiData, but a 409 carrying a merge preview becomes LoreDecisionsNeededError. */
async function requestWithMergePreview<T>(path: string, init: RequestInit): Promise<T> {
  try {
    return await requestApiData<T>(path, init, { timeoutMs: 0 })
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409) {
      const data = error.data as { status?: string; preview?: LoreMergePreview; missing?: string[] } | undefined
      if (data?.status === 'decisions' && data.preview) throw new LoreDecisionsNeededError(error.message, data.preview, data.missing ?? [])
    }
    throw error
  }
}

export const OWN_LOREBOOKS_QUERY_KEY = ['codex-chat-own-lorebooks'] as const
export const ownLorebookQueryKey = (lorebookId: number) => [...OWN_LOREBOOKS_QUERY_KEY, 'detail', lorebookId] as const
export const threadLorebooksQueryKey = (threadId: number) => ['codex-chat-thread-lorebooks', threadId] as const

/** The shared account books (with entries) and the global books (count only). */
export function listOwnLorebooks() {
  return requestApiData<OwnedChatLorebook[]>('/api/codex-chat/lorebooks')
}

export function getOwnLorebook(lorebookId: number, signal?: AbortSignal) {
  return requestApiData<OwnedChatLorebook>(`/api/codex-chat/lorebooks/${lorebookId}`, { signal, cache: 'no-store' })
}

export function createOwnLorebook(input: { name: string; entries?: ChatLoreEntry[]; connectsChats?: boolean }) {
  return requestApiData<OwnedChatLorebook>('/api/codex-chat/lorebooks', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** Null: an emptied chat book went away. */
export function updateOwnLorebook(lorebookId: number, patch: { name?: string; entries?: ChatLoreEntry[]; connectsChats?: boolean; revision?: string }) {
  return requestRevisionChecked<OwnedChatLorebook | null>(`/api/codex-chat/lorebooks/${lorebookId}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(patch) })
}

export function deleteOwnLorebook(lorebookId: number) {
  return requestApiData<{ deleted: boolean }>(`/api/codex-chat/lorebooks/${lorebookId}`, { method: 'DELETE' })
}

export function getThreadLorebooks(threadId: number) {
  return requestApiData<ThreadLorebooks>(`/api/codex-chat/threads/${threadId}/lorebooks`, { cache: 'no-store' })
}

/** Replace the chat book's entries; it is made with its first entry (null once emptied). */
export function saveThreadLorebook(threadId: number, entries: ChatLoreEntry[], revision?: string) {
  return requestRevisionChecked<OwnedChatLorebook | null>(`/api/codex-chat/threads/${threadId}/lorebook`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ entries, revision }) })
}

function sameLoreValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a).filter((key) => a[key] !== undefined)
  return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length && keys.every((key) => sameLoreValue(a[key], b[key]))
}

/** Permanent IDs identify entries, never array positions. Draft order, then latest-only additions in their order. */
export function mergeLoreEntries(base: ChatLoreEntry[], latest: ChatLoreEntry[], draft: ChatLoreEntry[]) {
  const before = new Map(base.map((entry) => [entry.id, entry]))
  const remote = new Map(latest.map((entry) => [entry.id, entry]))
  const local = new Map(draft.map((entry) => [entry.id, entry]))
  const conflicts: string[] = []
  const entries: ChatLoreEntry[] = []
  for (const id of new Set([...local.keys(), ...remote.keys(), ...before.keys()])) {
    const original = before.get(id)
    const mine = local.get(id)
    const theirs = remote.get(id)
    const mineChanged = !sameLoreValue(original, mine)
    const theirsChanged = !sameLoreValue(original, theirs)
    if (mineChanged && theirsChanged && !sameLoreValue(mine, theirs)) conflicts.push(id)
    const chosen = mineChanged ? mine : theirs
    if (chosen) entries.push(chosen)
  }
  return { entries, conflicts }
}

/** Replace only conflicting entries; unrelated local and remote changes have already been merged. */
export function latestLoreEntryConflicts(merged: ChatLoreEntry[], latest: ChatLoreEntry[], conflicts: string[]) {
  const ids = new Set(conflicts)
  const remote = new Map(latest.map((entry) => [entry.id, entry]))
  const present = new Set(merged.map((entry) => entry.id))
  return [
    ...merged.flatMap((entry) => ids.has(entry.id) ? remote.get(entry.id) ?? [] : entry),
    ...latest.filter((entry) => ids.has(entry.id) && !present.has(entry.id)),
  ]
}

/** Keep the chat book as an account book, linked to this chat (and recorded into when the chat book was). */
export function keepThreadLorebook(threadId: number) {
  return requestApiData<OwnedChatLorebook>(`/api/codex-chat/threads/${threadId}/lorebook/keep`, { method: 'POST' })
}

/** A new empty account book, linked to this chat and made the book save_lore writes to. */
export function createThreadLorebook(threadId: number, name: string) {
  return requestApiData<OwnedChatLorebook>(`/api/codex-chat/threads/${threadId}/lorebooks`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }) })
}

export function previewLorebookMerge(targetId: number, input: { sourceId: number; entryIds?: string[] }) {
  return requestApiData<LoreMergePreview>(`/api/codex-chat/lorebooks/${targetId}/merge/preview`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** Throws LoreDecisionsNeededError while a duplicate has no decision. */
export function mergeLorebook(targetId: number, input: { sourceId: number; decisions: LoreMergeDecision[]; deleteSource?: boolean; entryIds?: string[] }) {
  return requestWithMergePreview<LoreMergeResult>(`/api/codex-chat/lorebooks/${targetId}/merge`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) })
}

/** The profile's summary model writes a merged text for each duplicate; nothing is saved. */
export function draftLorebookMerge(targetId: number, input: { sourceId: number; profileId: number; entryIds?: string[]; instruction?: string }) {
  return requestApiData<{ drafts: LoreMergeDraft[] }>(`/api/codex-chat/lorebooks/${targetId}/merge/draft`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }, { timeoutMs: 300_000 })
}

/** The profile's translation model (else its summary model) writes the entries' keywords in `language`; nothing is saved. */
export function fillLoreKeys(input: { profileId: number; language: string; entries: Array<{ id: string; title: string; keys: string[]; content: string }> }) {
  return requestApiData<{ keys: Record<string, string[]>; failed: string[] }>('/api/codex-chat/lorebooks/key-fill', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }, { timeoutMs: 600_000 })
}
export function translateLoreEntry(profileId: number, entry: Pick<ChatLoreEntry, 'title' | 'keys' | 'content'>, signal?: AbortSignal) {
  return requestApiData<Pick<ChatLoreEntry, 'title' | 'keys' | 'content' | 'language' | 'translation'>>('/api/codex-chat/lorebooks/translate', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ profileId, entry }), signal }, { timeoutMs: 200_000 })
}
