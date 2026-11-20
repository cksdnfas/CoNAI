import fs from 'fs'
import { createHash } from 'crypto'
import type { StoredFileEntry, WorkspaceBatchResult, WorkspaceEntry, WorkspaceOperation, WorkspaceText } from '@conai/shared'
import { FileStoreError, FileStoreService, applyTextEdits } from '../fileStoreService'
import { storedFilePath } from '../fileStorePaths'
import { withFileStoreWrites } from '../fileStoreWriteTransaction'
import { statRevision } from '../../utils/fileHash'
import { workspaceTarget, WORKSPACE_READ_BUDGET } from '../workspaceService'

/** A plugin works inside this file-box folder: `플러그인/<plugin name>`, found or created on every open (a user may rename or delete it). */
const PARENT = '플러그인'
const MAX_DESCENDANTS = 10_000
const WRITER = { via: 'app' } as const

export function ensurePluginFolder(owner: string, plugin: { id: string; name: string }): StoredFileEntry {
  const parent = FileStoreService.ensureFolder(owner, null, PARENT)
  try { return FileStoreService.ensureFolder(owner, parent.id, plugin.name) } catch (error) {
    if (!(error instanceof FileStoreError) || error.status === 409) throw error
    return FileStoreService.ensureFolder(owner, parent.id, plugin.id)
  }
}

function missing(): never { throw new FileStoreError('파일 또는 폴더를 찾을 수 없어.', 404) }
const parentOf = (target: string) => target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : ''
const nameOf = (target: string) => target.slice(target.lastIndexOf('/') + 1)
const fileRevision = (owner: string, id: string) => statRevision(fs.statSync(storedFilePath(owner, id), { bigint: true }))

function find(owner: string, folderId: string, target: string) {
  const entry = target === '' ? FileStoreService.get(owner, folderId) : FileStoreService.resolvePath(owner, folderId, target)
  return entry ?? missing()
}
function folderIn(owner: string, folderId: string, target: string) {
  const entry = target === '' ? FileStoreService.get(owner, folderId) : FileStoreService.resolvePath(owner, folderId, target)
  if (entry?.kind !== 'folder') missing()
  return entry
}
function children(owner: string, folderId: string, offset = 0, limit = 200) {
  return FileStoreService.list(owner, folderId, offset, limit)
}
/** Every file under a folder, as `relative path → revision`, so a folder's revision changes when anything below it does. */
function digest(owner: string, folder: StoredFileEntry) {
  const hash = createHash('sha256').update(folder.id)
  let count = 0
  const walk = (id: string, prefix: string) => {
    for (let offset = 0; ; offset += 200) {
      const page = children(owner, id, offset)
      for (const entry of page.entries) {
        if (++count > MAX_DESCENDANTS) throw new FileStoreError('폴더 이동은 하위 항목 10,000개까지 지원해.')
        const relative = `${prefix}${entry.name}`
        hash.update(relative).update(entry.kind === 'file' ? fileRevision(owner, entry.id) : 'folder')
        if (entry.kind === 'folder') walk(entry.id, `${relative}/`)
      }
      if (offset + 200 >= page.total) return
    }
  }
  walk(folder.id, '')
  return hash.digest('hex')
}
function revisionOf(owner: string, entry: StoredFileEntry) { return entry.kind === 'file' ? fileRevision(owner, entry.id) : digest(owner, entry) }

/** The workspace operations plugins use, over one file-box folder. Targets are relative to that folder. */
export const PluginFolder = {
  get(owner: string, folderId: string) { return folderIn(owner, folderId, '') },
  stat(owner: string, folderId: string, target: string) {
    target = workspaceTarget(target)
    const entry = find(owner, folderId, target)
    return { target, kind: entry.kind, size: entry.size, revision: revisionOf(owner, entry) }
  },
  entries(owner: string, folderId: string, target = '', offset = 0) {
    target = workspaceTarget(target, true)
    const folder = folderIn(owner, folderId, target)
    const page = children(owner, folder.id, offset, 100)
    const entries: WorkspaceEntry[] = page.entries.map((entry) => ({ id: entry.id, target: target ? `${target}/${entry.name}` : entry.name, kind: entry.kind, size: entry.size }))
    return { entries, nextOffset: offset + 100 < page.total ? offset + 100 : null }
  },
  read(owner: string, folderId: string, targets: Array<{ target: string; offset?: number; limit?: number; revision?: string }>) {
    if (!targets.length || targets.length > 32) throw new FileStoreError('한 번에 1~32개 파일을 읽을 수 있어.')
    let budget = WORKSPACE_READ_BUDGET
    const files: WorkspaceText[] = []
    for (const input of targets) {
      const target = workspaceTarget(input.target)
      const entry = find(owner, folderId, target)
      if (entry.kind !== 'file') throw new FileStoreError('일반 파일만 읽을 수 있어.')
      const { text: whole, revision } = FileStoreService.readEditableText(owner, entry.id)
      if (input.revision !== undefined && revision !== input.revision) throw new FileStoreError('파일이 변경됐어. 처음부터 다시 읽어줘.', 409)
      const bytes = Buffer.from(whole)
      const size = bytes.length, offset = input.offset ?? 0, limit = Math.min(input.limit ?? 131072, budget)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > size || !Number.isSafeInteger(limit) || limit < 4 || limit > WORKSPACE_READ_BUDGET) throw new FileStoreError('잘못된 읽기 범위야.')
      // Start and end on whole UTF-8 characters so `nextOffset` continues exactly where this chunk stopped.
      let start = offset
      while (start < size && (bytes[start] & 0xc0) === 0x80) start++
      let end = Math.min(size, offset + limit)
      while (end > start && end < size && (bytes[end] & 0xc0) === 0x80) end--
      files.push({ target, text: bytes.subarray(start, end).toString('utf8'), revision, size, offset: start, nextOffset: end < size ? end : null })
      budget -= end - offset
      if (budget < 4) break
    }
    return { files, remaining: targets.slice(files.length), truncated: files.length < targets.length }
  },
  /** One batch, in order, stopping at the first failure. Retrying a finished request is the caller's job (the plugin proposal keeps its result). */
  apply(owner: string, folderId: string, requestId: string, operations: WorkspaceOperation[], checkAccess: () => void = () => {}, signal?: AbortSignal): WorkspaceBatchResult {
    const result: WorkspaceBatchResult = { requestId, status: 'completed', results: [] }
    try {
      for (const operation of operations) {
        signal?.throwIfAborted()
        checkAccess()
        const target = workspaceTarget(operation.target)
        const parent = () => folderIn(owner, folderId, parentOf(target))
        if (operation.kind === 'mkdir') {
          FileStoreService.createFolder(owner, parent().id, nameOf(target))
          result.results.push({ target })
        } else if (operation.kind === 'move') {
          result.results.push(withFileStoreWrites(() => {
            const entry = find(owner, folderId, target)
            if (revisionOf(owner, entry) !== operation.expectedRevision) throw new FileStoreError('이동할 파일이나 폴더 내용이 변경됐어.', 409)
            const destination = workspaceTarget(operation.destination)
            if (destination.toLowerCase().startsWith(`${target.toLowerCase()}/`)) throw new FileStoreError('폴더를 자기 안으로 이동할 수 없어.')
            const into = folderIn(owner, folderId, parentOf(destination)), name = nameOf(destination)
            const sameEntry = FileStoreService.findChild(owner, into.id, name)
            if (sameEntry && sameEntry.id !== entry.id) throw new FileStoreError('이동할 위치에 같은 이름이 있어.', 409)
            if (into.id !== entry.parentId) FileStoreService.move(owner, [entry.id], into.id, { id: entry.id, name })
            else if (name !== entry.name) FileStoreService.rename(owner, entry.id, name)
            return { target: destination, revision: revisionOf(owner, FileStoreService.get(owner, entry.id)) }
          }))
        } else if (operation.kind === 'delete') {
          throw new FileStoreError('플러그인은 삭제할 수 없어.', 403)
        } else {
          const existing = FileStoreService.resolvePath(owner, folderId, target)
          let text: string
          if (operation.kind === 'edit') {
            if (existing?.kind !== 'file') missing()
            const current = FileStoreService.readEditableText(owner, existing.id)
            if (current.revision !== operation.expectedRevision) throw new FileStoreError('파일이 변경됐어. 최신 리비전으로 다시 요청해줘.', 409)
            text = applyTextEdits(current.text, operation.edits).text
          } else text = operation.text
          if (text.includes('\0')) throw new FileStoreError('NUL 문자는 텍스트 문서에 저장할 수 없어.')
          if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new FileStoreError('텍스트는 8MB까지 저장할 수 있어.')
          const expected = operation.expectedRevision
          const written = FileStoreService.writeText(owner, parent().id, nameOf(target), text, expected === null ? { create: true, source: WRITER } : { expectedRevision: expected, source: WRITER })
          result.results.push({ target, revision: written.revision })
        }
      }
    } catch (error) {
      result.status = 'failed'
      result.error = error instanceof Error ? error.message : '파일 작업 실패'
      if (error instanceof FileStoreError && error.status === 409) result.conflict = true
    }
    return result
  },
}
