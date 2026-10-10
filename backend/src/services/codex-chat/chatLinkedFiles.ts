import path from 'path'
import type { StoredFileEntry } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { searchStoredFiles } from '../fileStoreSearch'
import { FileStoreError, FileStoreService, MAX_TEXT_DOCUMENT_BYTES, TEXT_EXTENSIONS, applyTextEdits, fileOwnerKey, type TextEdit } from '../fileStoreService'
import { LOREBOOK_ROOT_FOLDER } from './chatLorebookFiles'

/**
 * Linked files: folders and text files of the chat owner's file store that a chat (`codex_chat_threads.linked_files`)
 * or a profile (`llm_chat_profiles.linked_files`) hands its characters. A request carries only a short index of them
 * (names and counts, never contents) beside the lore index; the characters search, open and — where the link allows
 * writing — write and edit them with the linked_* tools, which never leave the linked places. Lorebook folders cannot
 * be linked: writing there would skip the lore proposal flow.
 */

export type LinkedFileLink = { id: string; write: boolean }

/** One linked folder or file as a request sees it: the name the index and the tools use, and where it is. */
export type LinkedPlace = { label: string; entry: StoredFileEntry; write: boolean; via: 'thread' | 'profile'; owner: string }

export const MAX_LINKED_FILES = 20
/** Folders and files one index line names; the rest are counted. */
const INDEX_NAMES = 8
/** The whole index; over it, the longest lines fall back to their item count. */
export const LINKED_INDEX_MAX_TOKENS = 800
const READ_CHUNK_BYTES = 16_000

export const LINKED_TOOLS = {
  list: 'linked_list',
  search: 'linked_search',
  read: 'linked_read',
  write: 'linked_write',
  edit: 'linked_edit',
} as const
export const LINKED_TOOL_NAMES: readonly string[] = Object.values(LINKED_TOOLS)

export class LinkedFileError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export function normalizeLinkedFiles(value: unknown): LinkedFileLink[] {
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const links: LinkedFileLink[] = []
  for (const item of value) {
    const record = item && typeof item === 'object' ? item as { id?: unknown; write?: unknown } : null
    const id = typeof item === 'string' ? item : record?.id
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || seen.has(id)) continue
    seen.add(id)
    links.push({ id, write: record?.write === true })
  }
  return links.slice(0, MAX_LINKED_FILES)
}

function entryOf(owner: string, id: string): StoredFileEntry | null {
  try { return FileStoreService.get(owner, id) } catch { return null }
}

function isTextName(name: string) {
  return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())
}

/** Whether the entry is the owner's lorebook folder or inside it. */
export function isInsideLorebooks(owner: string, id: string) {
  const root = FileStoreService.findChild(owner, null, LOREBOOK_ROOT_FOLDER)
  if (!root || root.kind !== 'folder') return false
  return id === root.id || FileStoreService.relativePath(owner, root.id, id) !== null
}

/**
 * Links the owner may save: their own live folders and text files, none in the lorebooks. `kept` (the links saved
 * before) pass as they are, so a shared profile keeps another account's links while its owner edits the rest.
 */
export function assertLinkedFiles(owner: string, links: LinkedFileLink[], kept: LinkedFileLink[] = []) {
  for (const link of links) {
    if (kept.some((item) => item.id === link.id)) continue
    const entry = entryOf(owner, link.id)
    if (!entry) throw new LinkedFileError('연결할 파일이나 폴더를 찾을 수 없어.', 404)
    if (entry.kind === 'file' && !isTextName(entry.name)) throw new LinkedFileError(`텍스트 파일만 연결할 수 있어: ${entry.name}`)
    if (isInsideLorebooks(owner, entry.id)) throw new LinkedFileError('로어북 폴더는 연결할 수 없어. 로어북은 로어북 칸에서 연결해줘.')
  }
  return links
}

type ThreadRef = { id: number; account_id: number | null }

function threadRow(threadId: number) {
  return getUserSettingsDb().prepare('SELECT id, account_id, linked_files FROM codex_chat_threads WHERE id = ?').get(threadId) as (ThreadRef & { linked_files: string | null }) | undefined
}

export const LinkedFileStore = {
  /** The folders and files linked to this chat. */
  threadLinks(threadId: number): LinkedFileLink[] {
    return normalizeLinkedFiles(threadRow(threadId)?.linked_files ?? null)
  },

  /** Replace the chat's links; each must be a folder or text file of the chat owner (links kept as they were pass). */
  setThreadLinks(threadId: number, value: unknown): LinkedFileLink[] {
    const row = threadRow(threadId)
    if (!row) throw new LinkedFileError('채팅을 찾을 수 없어.', 404)
    const links = assertLinkedFiles(fileOwnerKey(row.account_id), normalizeLinkedFiles(value), normalizeLinkedFiles(row.linked_files))
    getUserSettingsDb().prepare('UPDATE codex_chat_threads SET linked_files = ? WHERE id = ?').run(links.length ? JSON.stringify(links) : null, threadId)
    return links
  },
}

function fold(value: string) {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * The places one request may use, in index order: the chat's links, then the profile's (a room: the room's, then the
 * speaking member's). Every place must be the chat owner's: a profile is shared, so another account's link is skipped
 * silently, as is a link that is gone or has moved into the lorebooks. Names that collide get a ` (2)` suffix.
 */
export function placesForRequest({ thread, profile }: { thread: ThreadRef | null; profile: { linkedFiles?: LinkedFileLink[] } | null }): LinkedPlace[] {
  if (!thread) return []
  const owner = fileOwnerKey(thread.account_id ?? null)
  const links = [
    ...LinkedFileStore.threadLinks(thread.id).map((link) => ({ ...link, via: 'thread' as const })),
    ...(profile?.linkedFiles ?? []).map((link) => ({ ...link, via: 'profile' as const })),
  ]
  const places: LinkedPlace[] = []
  const taken = new Set<string>()
  for (const link of links) {
    if (places.some((place) => place.entry.id === link.id)) continue
    const entry = entryOf(owner, link.id)
    if (!entry || (entry.kind === 'file' && !isTextName(entry.name)) || isInsideLorebooks(owner, entry.id)) continue
    // Brackets and slashes would break `[label]/path`.
    const base = entry.name.replace(/[[\]/]/g, ' ').replace(/\s+/g, ' ').trim() || entry.id.slice(0, 8)
    let label = base
    for (let n = 2; taken.has(fold(label)); n++) label = `${base} (${n})`
    taken.add(fold(label))
    places.push({ label, entry, write: link.write, via: link.via, owner })
  }
  return places
}

/** Folders first, then files; files by name from the end, so dated notes show their newest first. */
function childrenOf(place: LinkedPlace) {
  const listing = FileStoreService.list(place.owner, place.entry.id, 0, 200)
  const folders = listing.entries.filter((entry) => entry.kind === 'folder')
  const files = listing.entries.filter((entry) => entry.kind === 'file')
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
  return { folders, files, total: listing.total }
}

function mode(place: LinkedPlace) {
  return place.write ? '쓰기' : '읽기'
}

/**
 * `## 연결 파일`: one line per place (`[label] 쓰기 · sub/(12) · newest.md · … · 외 N개`, a file as `[label] 읽기 · 파일`),
 * then how to open them. Names only, so it changes when files come or go, not when one is edited. Over
 * LINKED_INDEX_MAX_TOKENS the longest lines fall back to their item count. '' without places.
 */
export function buildLinkedIndex(places: LinkedPlace[], estimate: (text: string) => number) {
  if (places.length === 0) return ''
  const lines = places.map((place) => {
    if (place.entry.kind === 'file') {
      const line = `[${place.label}] ${mode(place)} · 파일`
      return { full: line, short: line }
    }
    const { folders, files, total } = childrenOf(place)
    if (total === 0) {
      const line = `[${place.label}] ${mode(place)} · 비어 있음`
      return { full: line, short: line }
    }
    const names = [
      ...folders.slice(0, INDEX_NAMES).map((folder) => `${folder.name}/(${FileStoreService.list(place.owner, folder.id, 0, 1).total})`),
      ...files.slice(0, INDEX_NAMES).map((file) => file.name),
    ]
    const more = total - names.length
    return {
      full: `[${place.label}] ${mode(place)} · ${names.join(' · ')}${more > 0 ? ` · 외 ${more}개` : ''}`,
      short: `[${place.label}] ${mode(place)} · ${total}개 항목`,
    }
  })
  const writable = places.some((place) => place.write)
  const footer = `(이름만 있고 내용은 없어. 필요하면 ${LINKED_TOOLS.search}·${LINKED_TOOLS.list}·${LINKED_TOOLS.read}로 찾아 열어. 경로는 [이름]/하위경로${writable ? `. 쓰기 표시된 곳은 ${LINKED_TOOLS.write}·${LINKED_TOOLS.edit}로 쓰고 고쳐` : ''}.)`
  const shown = lines.map((line) => line.full)
  const text = () => ['## 연결 파일', ...shown, footer].join('\n')
  const order = lines.map((_, index) => index).filter((index) => lines[index].full !== lines[index].short)
    .sort((a, b) => lines[b].full.length - lines[a].full.length)
  for (const index of order) {
    if (estimate(text()) <= LINKED_INDEX_MAX_TOKENS) break
    shown[index] = lines[index].short
  }
  return text()
}

// ---- Paths --------------------------------------------------------------------------------------------------

type ResolvedPath = { place: LinkedPlace; segments: string[]; display: string }

/** `[label]/sub/file.md` (brackets optional) as its place and the path inside it. Never above the place. */
export function splitLinkedPath(places: LinkedPlace[], value: string): ResolvedPath {
  const text = value.normalize('NFC').trim().replace(/\\/g, '/')
  const bracket = /^\[([^\]]+)\]\/?(.*)$/s.exec(text)
  const slash = text.indexOf('/')
  const label = bracket ? bracket[1] : slash < 0 ? text : text.slice(0, slash)
  const rest = bracket ? bracket[2] : slash < 0 ? '' : text.slice(slash + 1)
  const place = places.find((item) => fold(item.label) === fold(label)) ?? places.find((item) => fold(item.entry.name) === fold(label))
  if (!place) throw new LinkedFileError(`Linked place not found: "${label}". Linked: ${places.map((item) => `[${item.label}]`).join(', ') || '(none)'}. Paths start with the name in brackets, e.g. [${places[0]?.label ?? '이름'}]/file.md.`, 404)
  const segments = rest.split('/').map((segment) => segment.trim()).filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new LinkedFileError('Paths cannot go above a linked place (no "." or "..").')
  if (place.entry.kind === 'file' && segments.length > 0) throw new LinkedFileError(`[${place.label}] is a single linked file; use the path [${place.label}] alone.`)
  return { place, segments, display: [`[${place.label}]`, ...segments].join('/') }
}

function resolveEntry(resolved: ResolvedPath): StoredFileEntry | null {
  const { place, segments } = resolved
  if (segments.length === 0) return entryOf(place.owner, place.entry.id)
  return FileStoreService.resolvePath(place.owner, place.entry.id, segments.join('/'))
}

/** The display path of an entry inside a place, or null when it is not inside it. */
function pathInPlace(place: LinkedPlace, entry: StoredFileEntry) {
  if (entry.id === place.entry.id) return `[${place.label}]`
  const relative = place.entry.kind === 'folder' ? FileStoreService.relativePath(place.owner, place.entry.id, entry.id) : null
  return relative === null ? null : `[${place.label}]/${relative}`
}

function sizeLabel(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function requireWritable(place: LinkedPlace) {
  if (!place.write) throw new LinkedFileError(`[${place.label}] is linked read-only. Ask the user to allow writing there, or write somewhere marked 쓰기.`, 403)
  if (isInsideLorebooks(place.owner, place.entry.id)) throw new LinkedFileError('Lorebook folders are not written through linked files; use save_lore.', 403)
}

// ---- Tool operations ---------------------------------------------------------------------------------------

/** No path: every place. A folder path: its folders (with item counts) and files (size, last change). */
export function listLinked(places: LinkedPlace[], value?: string) {
  if (!value?.trim()) {
    if (places.length === 0) return '(연결된 파일이 없어.)'
    return places.map((place) => {
      if (place.entry.kind === 'file') return `[${place.label}] ${mode(place)} · 파일 · ${sizeLabel(place.entry.size)}`
      return `[${place.label}] ${mode(place)} · 폴더 · ${FileStoreService.list(place.owner, place.entry.id, 0, 1).total}개 항목`
    }).join('\n')
  }
  const resolved = splitLinkedPath(places, value)
  const entry = resolveEntry(resolved)
  if (!entry) throw new LinkedFileError(`Not found: ${resolved.display}`, 404)
  if (entry.kind === 'file') return `${resolved.display} · 파일 · ${sizeLabel(entry.size)} · ${entry.updatedAt.slice(0, 16).replace('T', ' ')}`
  const listing = FileStoreService.list(resolved.place.owner, entry.id, 0, 200)
  if (listing.total === 0) return `${resolved.display}/ (비어 있음)`
  const lines = listing.entries.map((child) => child.kind === 'folder'
    ? `${child.name}/ (${FileStoreService.list(resolved.place.owner, child.id, 0, 1).total})`
    : `${child.name} · ${sizeLabel(child.size)} · ${child.updatedAt.slice(0, 16).replace('T', ' ')}`)
  return [`${resolved.display}/`, ...lines, ...(listing.total > listing.entries.length ? [`(외 ${listing.total - listing.entries.length}개)`] : [])].join('\n')
}

/** Files and folders inside the linked places whose name or text holds every word (see searchStoredFiles). */
export async function searchLinked(places: LinkedPlace[], query: string, limit = 20) {
  if (places.length === 0) return '(연결된 파일이 없어.)'
  const owner = places[0].owner
  const result = await searchStoredFiles(owner, query, 200)
  const hits = result.hits.flatMap((hit) => {
    for (const place of places) {
      const at = pathInPlace(place, hit.entry)
      if (at) return [{ at, hit }]
    }
    return []
  }).slice(0, limit)
  if (hits.length === 0) return `(연결된 곳에서 "${query}"를 찾지 못했어.)`
  return hits.map(({ at, hit }) => `${at}${hit.entry.kind === 'folder' ? '/' : ''}${hit.snippet ? `\n  …${hit.snippet.replace(/\s+/g, ' ').trim()}…` : ''}`).join('\n')
}

/** A UTF-8 text chunk of a linked file, as data; `nextOffset` continues. */
export async function readLinked(places: LinkedPlace[], value: string, offset = 0) {
  const resolved = splitLinkedPath(places, value)
  const entry = resolveEntry(resolved)
  if (!entry) throw new LinkedFileError(`Not found: ${resolved.display}`, 404)
  if (entry.kind !== 'file') throw new LinkedFileError(`${resolved.display} is a folder; list it with ${LINKED_TOOLS.list}.`)
  const read = await FileStoreService.readText(resolved.place.owner, entry.id, offset, READ_CHUNK_BYTES)
  return [
    `[파일 ${resolved.display}]`,
    // The file cannot end the data block early.
    read.text.replace(/^﻿/, '').replace(/\[\/파일\]/g, '[/ 파일]'),
    '[/파일]',
    ...(read.nextOffset !== null ? [`(${read.size}바이트 중 ${read.nextOffset}바이트까지 읽음. 이어 읽으려면 ${LINKED_TOOLS.read}(target=${JSON.stringify(resolved.display)}, offset=${read.nextOffset}))`] : []),
  ].join('\n')
}

/** A new text document (folders on the way are made), or a whole file replaced with `overwrite`. */
export function writeLinked(places: LinkedPlace[], value: string, text: string, overwrite = false) {
  const resolved = splitLinkedPath(places, value)
  const { place, segments } = resolved
  requireWritable(place)
  if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_DOCUMENT_BYTES) throw new LinkedFileError('A document can be 2 MB at most.', 413)
  if (place.entry.kind === 'file') {
    if (!overwrite) throw new LinkedFileError(`[${place.label}] already exists; set overwrite to replace it, or change part of it with ${LINKED_TOOLS.edit}.`, 409)
    const saved = FileStoreService.updateText(place.owner, place.entry.id, text)
    return `${resolved.display}에 썼어 (${sizeLabel(saved.size)}).`
  }
  if (segments.length === 0) throw new LinkedFileError(`Give a file name inside [${place.label}], e.g. [${place.label}]/notes.md.`)
  let parentId = place.entry.id
  for (const folder of segments.slice(0, -1)) parentId = FileStoreService.ensureFolder(place.owner, parentId, folder).id
  try {
    const saved = FileStoreService.writeText(place.owner, parentId, segments[segments.length - 1], text, { create: !overwrite })
    return `${resolved.display}에 썼어 (${sizeLabel(saved.size)}).`
  } catch (error) {
    if (error instanceof FileStoreError && error.status === 409 && !overwrite) {
      throw new LinkedFileError(`${resolved.display} already exists; set overwrite to replace it, or change part of it with ${LINKED_TOOLS.edit}.`, 409)
    }
    throw error
  }
}

/** Add to the end of a linked text file, or replace exact text in it (nothing is saved when one edit fails). */
export function editLinked(places: LinkedPlace[], value: string, change: { append?: string; edits?: TextEdit[] }) {
  if ((change.append === undefined) === (change.edits === undefined)) throw new LinkedFileError('Give either append or edits.')
  const resolved = splitLinkedPath(places, value)
  requireWritable(resolved.place)
  const entry = resolveEntry(resolved)
  if (!entry) throw new LinkedFileError(`Not found: ${resolved.display}. Make it with ${LINKED_TOOLS.write}.`, 404)
  if (entry.kind !== 'file') throw new LinkedFileError(`${resolved.display} is a folder.`)
  let replaced = 0
  const saved = FileStoreService.editText(resolved.place.owner, entry.id, (text) => {
    if (change.append !== undefined) return text + change.append
    const edited = applyTextEdits(text, change.edits!)
    replaced = edited.replaced
    return edited.text
  })
  return `${resolved.display}을 고쳤어 (${sizeLabel(saved.size)}${change.edits ? `, ${replaced}군데 바꿈` : ''}).`
}

// ---- The context tab ---------------------------------------------------------------------------------------

export type LinkedFileView = {
  id: string
  name: string
  kind: 'folder' | 'file' | null
  write: boolean
  via: 'thread' | 'profile'
  /** The folder it sits in, from the store root (`/` at the top), and that folder's id (null: the top). */
  path: string | null
  parentId: string | null
  /** Folders: items directly inside; files: bytes. */
  count: number | null
  size: number | null
  /** The profiles (a room: its members) whose links bring it; empty for one linked to the chat only. */
  profiles: Array<{ id: number; name: string }>
  /** Gone from the store, in the lorebooks, or not this owner's: the request skips it. */
  missing: boolean
}

function folderPath(owner: string, parentId: string | null) {
  if (parentId === null) return '/'
  try { return `/${FileStoreService.list(owner, parentId, 0, 1).breadcrumbs.map((item) => item.name).join('/')}` } catch { return null }
}

/** Describe links for the owner's screens: names, where they are, sizes, and whether a request can use them. */
export function describeLinkedFiles(owner: string, links: LinkedFileLink[], via: 'thread' | 'profile' = 'thread'): LinkedFileView[] {
  return links.map((link) => {
    const entry = entryOf(owner, link.id)
    const usable = entry !== null && !(entry.kind === 'file' && !isTextName(entry.name)) && !isInsideLorebooks(owner, entry.id)
    return {
      id: link.id,
      name: entry?.name ?? link.id.slice(0, 8),
      kind: entry?.kind ?? null,
      write: link.write,
      via,
      path: entry ? folderPath(owner, entry.parentId) : null,
      parentId: entry?.parentId ?? null,
      count: entry?.kind === 'folder' ? FileStoreService.list(owner, entry.id, 0, 1).total : null,
      size: entry?.kind === 'file' ? entry.size : null,
      profiles: [],
      missing: !usable,
    }
  })
}

/** The context tab: the chat's own links, then the profiles' (each once, naming the profiles that bring it). */
export function threadLinkedFiles(thread: ThreadRef, profiles: Array<{ id: number; name: string; linkedFiles?: LinkedFileLink[] }>) {
  const owner = fileOwnerKey(thread.account_id ?? null)
  const own = describeLinkedFiles(owner, LinkedFileStore.threadLinks(thread.id))
  const fromProfiles = new Map<string, LinkedFileView>()
  for (const profile of profiles) {
    for (const view of describeLinkedFiles(owner, profile.linkedFiles ?? [], 'profile')) {
      // Another account's link on a shared profile is not this chat's business.
      if (view.missing || own.some((item) => item.id === view.id)) continue
      const seen = fromProfiles.get(view.id) ?? view
      seen.profiles.push({ id: profile.id, name: profile.name })
      fromProfiles.set(view.id, seen)
    }
  }
  return [...own, ...fromProfiles.values()]
}
