import fs from 'fs'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { FileStoreService } from '../fileStoreService'
import { storedFilePath } from '../fileStorePaths'
import { LOREBOOK_MAX_ENTRIES, loreEntryKeys, loreEntryTitle, type ChatLoreEntry } from './chatLorebook'
import {
  LOREBOOK_JSON,
  LOREBOOK_MARKDOWN,
  LORE_FILES_FOLDER,
  LorebookError,
  OwnedLorebookStore,
  foldLoreTitle,
  type OwnedLorebook,
} from './chatLorebookFiles'
import { resolveProfileModel } from './chatModelRoles'
import { ChatProfileStore } from './chatProfiles'
import { completeSummary, SUMMARY_TIMEOUT_MS } from './llmChatContext'

/**
 * Merging one book (a chat book or an account book) into an account book of the same owner: the source's entries are
 * appended to the target, its files copied into the target's 자료/. An entry with the same title as a target entry, or
 * the same keyword set, is a duplicate and needs a decision (see MergeDecision); there is no looser similarity on
 * purpose (a wrong match costs more than a missed one). The source is never changed here: the caller deletes it when
 * the person chose to.
 */

/**
 * What happens to a duplicate. `source`: the source text replaces the target entry's (the target keeps its id, the
 * keywords become the union, the source's file is taken when the target has none). `target`: the source entry is
 * skipped. `both`: the source entry is appended as its own entry (a ` (2)` title when the titles are equal).
 * `merged`: `content` replaces the target entry's text (keywords as for `source`).
 */
export type MergeChoice = 'source' | 'target' | 'both' | 'merged'
export type MergeDecision = { entryId: string; choice: MergeChoice; content?: string }

export type MergeItem = {
  /** The source entry. */
  entry: ChatLoreEntry
  status: 'new' | 'duplicate'
  /** The target entry it duplicates. */
  duplicateOf?: ChatLoreEntry
  /** The editable starting text of "합친 결과": both texts, a blank line between (one of them when it holds the other). */
  suggested?: string
}

/** A source file and whether its name is taken where it goes (it is then copied as `name (2).ext`). */
export type MergeFile = { file: string; clash: boolean }

/** `defaultInstruction`: what "맡기기" tells the model unless the person rewrites it. */
export type MergePreview = { source: OwnedLorebook; target: OwnedLorebook; items: MergeItem[]; files: MergeFile[]; defaultInstruction: string }

export type MergeResult = { book: OwnedLorebook; added: number; updated: number; skipped: number; files: number }

/** Duplicates without a decision: nothing was changed, the preview goes back so the person can decide. */
export class MergeDecisionsMissingError extends LorebookError {
  constructor(readonly preview: MergePreview, readonly missing: string[]) {
    super('중복 항목을 어떻게 할지 골라줘.', 409)
  }
}

const CHOICES: readonly MergeChoice[] = ['source', 'target', 'both', 'merged']
const MERGED_CONTENT_MAX_LENGTH = 20_000
const ENTRY_ID_MAX_LENGTH = 80

// ---- Books ----------------------------------------------------------------------------------------------------

function booksOf(sourceId: number, targetId: number, owner: string) {
  if (sourceId === targetId) throw new LorebookError('같은 로어북끼리는 병합할 수 없어.')
  const target = OwnedLorebookStore.find(targetId, owner)
  if (!target) throw new LorebookError('병합할 로어북을 찾을 수 없어.', 404)
  if (target.kind !== 'account') throw new LorebookError('계정 로어북에만 병합할 수 있어.')
  const source = OwnedLorebookStore.find(sourceId, owner)
  if (!source) throw new LorebookError('가져올 로어북을 찾을 수 없어.', 404)
  return { source, target }
}

function keySet(entry: ChatLoreEntry) {
  return [...new Set(loreEntryKeys(entry).map((key) => key.normalize('NFC').trim().toLowerCase()).filter(Boolean))].sort()
}

/** The same title (folded), or the same non-empty keyword set (order and case aside). */
function isDuplicate(a: ChatLoreEntry, b: ChatLoreEntry) {
  if (foldLoreTitle(loreEntryTitle(a)) === foldLoreTitle(loreEntryTitle(b))) return true
  const keysA = keySet(a)
  const keysB = keySet(b)
  return keysA.length > 0 && keysA.length === keysB.length && keysA.every((key, index) => key === keysB[index])
}

function idFilter(value: unknown) {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) throw new LorebookError('entryIds는 항목 id 목록이어야 해.')
  return new Set(value.filter((id): id is string => typeof id === 'string'))
}

/** Whitespace runs folded to one space, for comparing two texts. */
function foldText(text: string) {
  return text.trim().replace(/\s+/g, ' ')
}

/** The target text and the source text, a blank line between; just one of them when they are equal or one holds the other. */
function suggestedText(targetText: string, sourceText: string) {
  const target = targetText.trim()
  const source = sourceText.trim()
  if (foldText(target).includes(foldText(source))) return target
  if (foldText(source).includes(foldText(target))) return source
  return `${target}\n\n${source}`
}

function itemsOf(source: OwnedLorebook, target: OwnedLorebook, entryIds: Set<string> | null): MergeItem[] {
  return source.entries.filter((entry) => !entryIds || entryIds.has(entry.id)).map((entry) => {
    const duplicateOf = target.entries.find((candidate) => isDuplicate(entry, candidate))
    return duplicateOf
      ? { entry, status: 'duplicate' as const, duplicateOf, suggested: suggestedText(duplicateOf.content, entry.content) }
      : { entry, status: 'new' as const }
  })
}

// ---- Files ----------------------------------------------------------------------------------------------------

type SourceFile = { id: string; rel: string; name: string; dirs: string[] }

/** Every file of the source book but its lorebook.json / lorebook.md: those under 자료/ keep their place under the target's 자료/, the rest go straight into it. */
function sourceFiles(book: OwnedLorebook, owner: string): SourceFile[] {
  const result: SourceFile[] = []
  const walk = (folderId: string, prefix: string[], depth: number) => {
    if (depth > 32) return
    for (let offset = 0; ; offset += 200) {
      const page = FileStoreService.list(owner, folderId, offset, 200)
      for (const child of page.entries) {
        if (child.kind === 'folder') {
          walk(child.id, [...prefix, child.name], depth + 1)
          continue
        }
        if (prefix.length === 0 && [LOREBOOK_JSON, LOREBOOK_MARKDOWN].includes(child.name.toLowerCase())) continue
        const inMaterials = prefix[0] === LORE_FILES_FOLDER
        result.push({ id: child.id, rel: [...prefix, child.name].join('/'), name: child.name, dirs: inMaterials ? prefix.slice(1) : [] })
      }
      if (offset + page.entries.length >= page.total || page.entries.length === 0) break
    }
  }
  if (book.folderId) walk(book.folderId, [], 0)
  return result
}

/** The live folder `자료/a/b` under the target, or null while it does not exist. */
function targetFolder(owner: string, target: OwnedLorebook, dirs: string[]) {
  if (!target.folderId) return null
  const found = FileStoreService.resolvePath(owner, target.folderId, [LORE_FILES_FOLDER, ...dirs].join('/'))
  return found?.kind === 'folder' ? found : null
}

type PlannedFile = { source: SourceFile; dirs: string[]; name: string; clash: boolean }

/** Where each source file lands: its name, or the first free `name (n).ext` when the target (or an earlier file) has it. */
function planFiles(owner: string, source: OwnedLorebook, target: OwnedLorebook): PlannedFile[] {
  const planned = new Map<string, Set<string>>()
  return sourceFiles(source, owner).map((file) => {
    const dirKey = file.dirs.join('/').toLowerCase()
    const taken = planned.get(dirKey) ?? new Set<string>()
    planned.set(dirKey, taken)
    const folder = targetFolder(owner, target, file.dirs)
    const used = (name: string) => taken.has(name.toLowerCase()) || Boolean(folder && FileStoreService.findChild(owner, folder.id, name))
    const clash = used(file.name)
    const dot = file.name.lastIndexOf('.')
    const [stem, extension] = dot > 0 ? [file.name.slice(0, dot), file.name.slice(dot)] : [file.name, '']
    let name = file.name
    for (let n = 2; used(name); n++) {
      if (n > 999) throw new LorebookError(`같은 이름의 자료가 너무 많아: ${file.name}`, 409)
      name = `${stem} (${n})${extension}`
    }
    taken.add(name.toLowerCase())
    return { source: file, dirs: file.dirs, name, clash }
  })
}

// ---- Preview --------------------------------------------------------------------------------------------------

/** What a merge would do: each source entry new or a duplicate (with the target entry it matches), and the files. */
export function previewMerge(sourceId: number, targetId: number, owner: string, options: { entryIds?: unknown } = {}): MergePreview {
  const { source, target } = booksOf(sourceId, targetId, owner)
  return {
    source,
    target,
    items: itemsOf(source, target, idFilter(options.entryIds)),
    files: planFiles(owner, source, target).map((file) => ({ file: file.source.rel, clash: file.clash })),
    defaultInstruction: MERGE_DRAFT_INSTRUCTION,
  }
}

export function hasDuplicates(preview: MergePreview) {
  return preview.items.some((item) => item.status === 'duplicate')
}

/** The decisions for the preview's duplicates; any duplicate left without one stops the merge (MergeDecisionsMissingError). */
function decisionsFor(preview: MergePreview, value: unknown) {
  if (value !== undefined && value !== null && !Array.isArray(value)) throw new LorebookError('decisions는 목록이어야 해.')
  const byId = new Map<string, MergeDecision>()
  for (const raw of (value ?? []) as unknown[]) {
    if (!raw || typeof raw !== 'object') throw new LorebookError('병합 결정이 올바르지 않아.')
    const { entryId, choice, content } = raw as Record<string, unknown>
    if (typeof entryId !== 'string' || !CHOICES.includes(choice as MergeChoice)) throw new LorebookError('병합 결정이 올바르지 않아.')
    if (choice === 'merged' && (typeof content !== 'string' || !content.trim())) throw new LorebookError('합친 결과 본문이 비어 있어.')
    byId.set(entryId, { entryId, choice: choice as MergeChoice, content: typeof content === 'string' ? content.trim().slice(0, MERGED_CONTENT_MAX_LENGTH) : undefined })
  }
  const missing = preview.items.filter((item) => item.status === 'duplicate' && !byId.has(item.entry.id)).map((item) => item.entry.id)
  if (missing.length > 0) throw new MergeDecisionsMissingError(preview, missing)
  return byId
}

/** Throws MergeDecisionsMissingError when a duplicate has no decision; nothing is changed. */
export function assertMergeDecisions(preview: MergePreview, decisions: unknown) {
  decisionsFor(preview, decisions)
}

// ---- Apply ----------------------------------------------------------------------------------------------------

function unionKeys(a: string[], b: string[]) {
  return [...new Set([...a, ...b])]
}

/**
 * Merge `sourceId` into `targetId` in one transaction: files copied first (their links re-pointed), then the entries,
 * then the target written through its lorebook.json. The source is left as it is.
 */
export function applyMerge(sourceId: number, targetId: number, owner: string, decisionsValue: unknown, options: { entryIds?: unknown } = {}): MergeResult {
  const preview = previewMerge(sourceId, targetId, owner, options)
  const decisions = decisionsFor(preview, decisionsValue)
  const { target } = preview
  const db = getUserSettingsDb()
  const copied: string[] = []
  try {
    return db.transaction(() => {
      // Files: the copies, and where each source file now is (by id, and by its old path for a link without an id).
      const moved = new Map<string, { file: string; fileId: string }>()
      for (const plan of planFiles(owner, preview.source, target)) {
        let folder = FileStoreService.ensureFolder(owner, target.folderId, LORE_FILES_FOLDER)
        for (const dir of plan.dirs) folder = FileStoreService.ensureFolder(owner, folder.id, dir)
        const copy = FileStoreService.copyFile(owner, plan.source.id, folder.id, plan.name, { silent: true })
        copied.push(copy.id)
        const link = { file: [LORE_FILES_FOLDER, ...plan.dirs, copy.name].join('/'), fileId: copy.id }
        moved.set(plan.source.id, link)
        moved.set(plan.source.rel.toLowerCase(), link)
      }
      const linkOf = (entry: ChatLoreEntry) => {
        const link = (entry.fileId && moved.get(entry.fileId)) || (entry.file && moved.get(entry.file.toLowerCase())) || null
        return link ?? { file: null, fileId: null }
      }

      const entries = target.entries.map((entry) => ({ ...entry }))
      const ids = new Set(entries.map((entry) => entry.id))
      let order = entries.reduce((max, entry) => Math.max(max, entry.order), -1)
      const freeId = (base: string) => {
        const stem = base.slice(0, ENTRY_ID_MAX_LENGTH - 5)
        let id = base.slice(0, ENTRY_ID_MAX_LENGTH)
        for (let n = 2; ids.has(id); n++) id = `${stem}-${n}`
        ids.add(id)
        return id
      }
      const append = (entry: ChatLoreEntry, title = entry.title) => {
        entries.push({ ...entry, ...linkOf(entry), id: freeId(entry.id), title, order: ++order })
      }
      const takeOver = (into: ChatLoreEntry, from: ChatLoreEntry, content: string) => {
        into.content = content
        into.keys = unionKeys(into.keys, from.keys)
        into.localKeys = unionKeys(into.localKeys ?? [], from.localKeys ?? [])
        if (!into.file) Object.assign(into, linkOf(from))
      }
      let added = 0
      let updated = 0
      let skipped = 0
      for (const item of preview.items) {
        if (item.status === 'new') {
          append(item.entry)
          added++
          continue
        }
        const decision = decisions.get(item.entry.id) as MergeDecision
        const into = entries.find((entry) => entry.id === item.duplicateOf?.id)
        if (decision.choice === 'target' || !into) {
          skipped++
        } else if (decision.choice === 'both') {
          const titles = new Set(entries.map((entry) => foldLoreTitle(loreEntryTitle(entry))))
          const base = loreEntryTitle(item.entry)
          let title = item.entry.title
          if (titles.has(foldLoreTitle(base))) {
            let n = 2
            while (titles.has(foldLoreTitle(`${base} (${n})`))) n++
            title = `${base} (${n})`
          }
          append(item.entry, title)
          added++
        } else {
          takeOver(into, item.entry, decision.choice === 'merged' ? decision.content as string : item.entry.content)
          updated++
        }
      }
      if (entries.length > LOREBOOK_MAX_ENTRIES) throw new LorebookError(`합치면 항목이 ${LOREBOOK_MAX_ENTRIES}개를 넘어.`, 409)
      const book = OwnedLorebookStore.update(target.id, owner, { entries }) as OwnedLorebook
      return { book, added, updated, skipped, files: copied.length }
    }).immediate()
  } catch (error) {
    // The rows went with the transaction; their blobs did not.
    for (const id of copied) fs.rmSync(storedFilePath(owner, id), { force: true })
    throw error
  }
}

// ---- Drafts by a profile's model ------------------------------------------------------------------------------

export const MERGE_DRAFT_INSTRUCTION = '두 항목을 하나로 합쳐. 이름은 그대로 쓰고, 두 쪽의 사실을 모두 남기고, 중복만 줄여. 합친 본문만 출력해.'
const MERGE_DRAFT_MAX_ENTRIES = 30
const MERGE_INSTRUCTION_MAX_LENGTH = 2000

export type MergeDraft = { entryId: string; content: string } | { entryId: string; error: string }

function draftEntryText(entry: ChatLoreEntry) {
  return [`제목: ${loreEntryTitle(entry)}`, loreEntryKeys(entry).length ? `키워드: ${loreEntryKeys(entry).join(', ')}` : '', '', entry.content.trim()].filter((line, index) => index === 2 || line).join('\n')
}

/**
 * "프로필에게 맡기기": for each duplicate (or the given ones), the profile's summary model (its chat model when it has
 * none) writes one merged text. Nothing is saved; the drafts fill the "합친 결과" fields. The whole call is bounded by
 * the summary timeout; an entry that fails, or is not reached in time, comes back with its error.
 */
export async function draftMerge(sourceId: number, targetId: number, owner: string, input: { profileId?: unknown; entryIds?: unknown; instruction?: unknown }, signal?: AbortSignal): Promise<{ drafts: MergeDraft[] }> {
  const preview = previewMerge(sourceId, targetId, owner)
  const profile = ChatProfileStore.find(Number(input.profileId))
  if (!profile) throw new LorebookError('프로필을 찾을 수 없어.', 404)
  if (!resolveProfileModel(profile, 'summary')) throw new LorebookError('이 프로필에는 합치기에 쓸 모델이 없어.')
  const wanted = idFilter(input.entryIds)
  const duplicates = preview.items.filter((item) => item.status === 'duplicate' && (!wanted || wanted.has(item.entry.id))).slice(0, MERGE_DRAFT_MAX_ENTRIES)
  // The person's instruction is the default rewritten, so it replaces it; empty falls back to the default.
  const instruction = typeof input.instruction === 'string' ? input.instruction.trim().slice(0, MERGE_INSTRUCTION_MAX_LENGTH) : ''
  const system = instruction || MERGE_DRAFT_INSTRUCTION
  const sourceLabel = preview.source.kind === 'chat' ? '채팅 책' : '원본 책'
  const timeout = AbortSignal.timeout(SUMMARY_TIMEOUT_MS)
  const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout
  const drafts: MergeDraft[] = []
  for (const item of duplicates) {
    if (bounded.aborted) {
      drafts.push({ entryId: item.entry.id, error: '시간이 다 돼서 못 합쳤어.' })
      continue
    }
    try {
      const content = await completeSummary(profile, system, `## A (${sourceLabel})\n${draftEntryText(item.entry)}\n\n## B (대상 책)\n${draftEntryText(item.duplicateOf as ChatLoreEntry)}`, bounded)
      drafts.push({ entryId: item.entry.id, content })
    } catch (error) {
      drafts.push({ entryId: item.entry.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { drafts }
}
