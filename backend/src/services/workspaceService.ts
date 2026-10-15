import fs from 'fs'
import path from 'path'
import os from 'os'
import { createHash, randomBytes } from 'crypto'
import type Database from 'better-sqlite3'
import type { WorkspaceProject, WorkspaceEntry, WorkspaceText, WorkspaceOperation, WorkspaceBinding, WorkspaceBatchResult } from '@conai/shared'
import { getUserSettingsDb } from '../database/userSettingsDb'
import { runtimePaths } from '../config/runtimePaths'
import { applyTextEdits, TEXT_EXTENSIONS } from './fileStoreService'
import { isPathInside as inside, WINDOWS_RESERVED_NAME } from '../utils/pathResolver'
import { statRevision as revision } from '../utils/fileHash'
import { publishRuntimeEvent } from './runtime-events/runtimeEventBus'

export class WorkspaceError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
const id = () => randomBytes(16).toString('hex')
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const initialized = new WeakSet<Database.Database>()
const MAX_TEXT = 8 * 1024 * 1024
const GUIDELINES = 'AI_GUIDELINES.md'
const hostname = os.hostname()
// Distinguish this process's live requests from persisted rows left by a reused PID.
const activeOperations = new Set<string>()
function changed(_actor: string, projectId: string) {
  publishRuntimeEvent({ name: 'workspace.changed', topic: 'workspaces', visibility: 'all', payload: { projectId } })
}
export const WORKSPACE_READ_BUDGET = 1024 * 1024
export const WORKSPACE_TOOLS = ['workspace_list', 'workspace_read', 'workspace_search', 'workspace_apply', 'workspace_publish_resources'] as const

function db() {
  const store = getUserSettingsDb()
  if (!initialized.has(store)) {
    store.exec(`
      CREATE TABLE IF NOT EXISTS workspace_projects (
        id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
        guidelines TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS workspace_projects_owner ON workspace_projects(owner_key, id);
      CREATE TABLE IF NOT EXISTS workspace_entries (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id), target TEXT NOT NULL,
        target_key TEXT NOT NULL, parent TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, UNIQUE(project_id, target_key));
      CREATE INDEX IF NOT EXISTS workspace_entries_parent ON workspace_entries(project_id, parent, target);
      CREATE INDEX IF NOT EXISTS workspace_entries_search ON workspace_entries(project_id, target);
      CREATE TABLE IF NOT EXISTS workspace_bindings (
        thread_id INTEGER PRIMARY KEY REFERENCES codex_chat_threads(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id), revision TEXT NOT NULL, writable INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_operations (
        project_id TEXT NOT NULL REFERENCES workspace_projects(id), request_id TEXT NOT NULL, input_hash TEXT NOT NULL,
        status TEXT NOT NULL, process_id INTEGER NOT NULL, hostname TEXT NOT NULL, result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(project_id, request_id));
      CREATE UNIQUE INDEX IF NOT EXISTS workspace_one_writer ON workspace_operations(project_id) WHERE status='running';
      CREATE INDEX IF NOT EXISTS workspace_operations_recent ON workspace_operations(project_id, created_at);
    `)
    initialized.add(store)
  }
  return store
}

type ProjectRow = { id: string; owner_key: string; name: string; revision: number; guidelines: string; created_at: string }
function project(row: ProjectRow): WorkspaceProject { return { id: row.id, name: row.name, revision: row.revision, guidelines: row.guidelines, createdAt: row.created_at } }
function requireProject(_actor: string, projectId: string) {
  if (!/^[a-f0-9]{32}$/.test(projectId)) throw new WorkspaceError('프로젝트를 찾을 수 없어.', 404)
  const row = db().prepare('SELECT * FROM workspace_projects WHERE id=?').get(projectId) as ProjectRow | undefined
  if (!row) throw new WorkspaceError('프로젝트를 찾을 수 없어.', 404)
  return row
}

export function workspaceTarget(value: string, allowRoot = false): string {
  if (allowRoot && value === '') return ''
  if (typeof value !== 'string' || value.length > 1000) throw new WorkspaceError('잘못된 프로젝트 경로야.')
  const parts = value.normalize('NFC').split('/')
  if (parts.length > 32 || parts.some(part => !part || part === '.' || part === '..' || /[\\:*?"<>|\x00-\x1f\x7f]/.test(part)
    || /[. ]$/.test(part) || Buffer.byteLength(part) > 200 || WINDOWS_RESERVED_NAME.test(part)
    || part.toLowerCase().startsWith('.workspace') || ['.git', 'node_modules'].includes(part.toLowerCase()))) throw new WorkspaceError('허용되지 않는 프로젝트 경로야.')
  return parts.join('/')
}
/** Rows under `target/`: a range on the (project_id, target) index instead of a substr scan. '0' sorts right after '/'. */
const UNDER = 'target >= ? AND target < ?'
const under = (target: string) => [`${target}/`, `${target}0`] as const
// The checked root per project, so every path lookup does not redo a dozen sync fs calls. A swapped
// root is still caught: resolved() lstats it on every call.
const checkedRoots = new Map<string, { root: string; at: number }>()
let forbiddenRoots: string[] | null = null
function root(_actor: string, projectId: string) {
  const cached = checkedRoots.get(projectId)
  if (cached && Date.now() - cached.at < 30_000) return cached.root
  const base = fs.realpathSync(runtimePaths.basePath)
  const folders = ['workspaces', projectId]
  let current = base
  for (const part of folders) {
    current = path.join(current, part)
    if (fs.existsSync(current) && (fs.lstatSync(current).isSymbolicLink() || !fs.lstatSync(current).isDirectory())) throw new WorkspaceError('작업 공간 경로가 안전하지 않아.', 403)
  }
  const candidate = path.resolve(base, ...folders)
  forbiddenRoots ??= [runtimePaths.uploadsDir, runtimePaths.tempDir, runtimePaths.saveDir, runtimePaths.artifactsDir, runtimePaths.databaseDir]
    .map(forbidden => (fs.existsSync(forbidden) ? fs.realpathSync(forbidden) : path.resolve(forbidden)))
  for (const forbidden of forbiddenRoots) {
    if (inside(forbidden, candidate) || inside(candidate, forbidden)) throw new WorkspaceError('작업 공간은 공개·임시·DB 경로와 분리해야 해.', 403)
  }
  if (fs.existsSync(candidate)) checkedRoots.set(projectId, { root: candidate, at: Date.now() })
  return candidate
}
async function resolved(owner: string, projectId: string, target: string, missingLeaf = false) {
  const base = root(owner, projectId)
  const parts = workspaceTarget(target, true).split('/').filter(Boolean)
  let current = base
  const rootStat = await fs.promises.lstat(base)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new WorkspaceError('잘못된 작업 폴더야.', 403)
  for (let index = 0; index < parts.length; index++) {
    const relative = parts.slice(0, index + 1).join('/')
    const registered = db().prepare('SELECT target FROM workspace_entries WHERE project_id=? AND target_key=?').get(projectId, relative.toLowerCase()) as { target: string } | undefined
    if (registered && registered.target !== relative) throw new WorkspaceError(`등록된 대소문자와 경로를 사용해줘: ${registered.target}`)
    current = path.join(current, parts[index])
    let stat: fs.Stats
    try { stat = await fs.promises.lstat(current) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && missingLeaf && index === parts.length - 1) return current
      throw new WorkspaceError('파일 또는 상위 폴더를 찾을 수 없어.', 404)
    }
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink > 1)) throw new WorkspaceError('링크·특수 파일은 사용할 수 없어.', 403)
    if (index < parts.length - 1 && !stat.isDirectory()) throw new WorkspaceError('상위 경로가 폴더가 아니야.')
  }
  const real = path.relative(await fs.promises.realpath(base), await fs.promises.realpath(current))
  if (path.isAbsolute(real) || real === '..' || real.startsWith(`..${path.sep}`)) throw new WorkspaceError('프로젝트 밖의 경로야.', 403)
  // An alias (a Windows 8.3 short name such as AI_GUI~1.MD) must not reach a file under another name.
  if (real.split(path.sep).join('/').toLowerCase() !== parts.join('/').toLowerCase()) throw new WorkspaceError('등록된 이름으로 경로를 써줘.')
  return current
}
const parent = (target: string) => target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : ''
function textTarget(target: string) { if (!TEXT_EXTENSIONS.has(path.extname(target).toLowerCase())) throw new WorkspaceError('UTF-8 텍스트 파일 형식만 작성할 수 있어.') }
async function fileRevision(file: string) { return revision(await fs.promises.stat(file, { bigint: true })) }
async function targetRevision(owner: string, projectId: string, target: string) {
  const file = await resolved(owner, projectId, target)
  const stat = await fs.promises.stat(file, { bigint: true })
  if (stat.isFile()) return revision(stat)
  const rows = db().prepare(`SELECT target FROM workspace_entries WHERE project_id=? AND ${UNDER} ORDER BY target LIMIT 10001`).all(projectId, ...under(target)) as Array<{ target: string }>
  if (rows.length > 10000) throw new WorkspaceError('폴더 이동은 하위 항목 10,000개까지 지원해.')
  const digest = createHash('sha256').update(revision(stat))
  for (const row of rows) {
    // A child the index still lists but the disk lost (a half-finished delete) must not make the folder unmovable.
    let child = 'missing'
    try { child = await fileRevision(await resolved(owner, projectId, row.target)) } catch (error) { if (!(error instanceof WorkspaceError && error.status === 404)) throw error }
    digest.update(row.target).update(child)
  }
  return digest.digest('hex')
}
/** fs errors carry the server's absolute path; the change log, MCP and plugins get a plain reason instead. */
function plainFsError(error: unknown) {
  if (error instanceof WorkspaceError || !(error instanceof Error)) return error instanceof Error ? error.message : '파일 작업 실패'
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EEXIST' || code === 'ENOTEMPTY') return '같은 이름이 이미 있어.'
  if (code === 'ENOENT') return '파일 또는 폴더를 찾을 수 없어.'
  if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') return '파일이 사용 중이거나 권한이 없어.'
  if (error.name === 'AbortError') return '요청이 취소됐어.'
  return '파일 작업 실패'
}
// A running row from another host is a container that died mid-change (Docker gives each new container a new
// hostname). Its PID can't be probed from here, so it is reclaimed once no real batch could still be running.
const FOREIGN_LOCK_MS = 10 * 60_000
const KEPT_OPERATIONS = 200
function remember(projectId: string, target: string, kind: 'file' | 'folder', size: number) {
  db().prepare(`INSERT INTO workspace_entries(id,project_id,target,target_key,parent,kind,size) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(project_id,target_key) DO UPDATE SET size=excluded.size`).run(id(), projectId, target, target.toLowerCase(), parent(target), kind, size)
}

export const WorkspaceService = {
  async stat(owner: string, projectId: string, target: string) {
    requireProject(owner, projectId)
    target = workspaceTarget(target)
    const info = await fs.promises.stat(await resolved(owner, projectId, target))
    return { target, kind: info.isDirectory() ? 'folder' as const : 'file' as const, size: info.size, revision: await targetRevision(owner, projectId, target) }
  },
  list(_actor: string, offset = 0) {
    const rows = db().prepare('SELECT id,name,revision,created_at FROM workspace_projects ORDER BY created_at DESC,id LIMIT 51 OFFSET ?').all(offset) as Array<Pick<ProjectRow, 'id' | 'name' | 'revision' | 'created_at'>>
    return rows.map(row => ({ id: row.id, name: row.name, revision: row.revision, createdAt: row.created_at }))
  },
  get(owner: string, projectId: string) { return project(requireProject(owner, projectId)) },
  /** Name and guidelines from the project settings dialog. The guidelines go through the same file write as any edit, so they are logged and bump the revision. */
  async update(owner: string, projectId: string, input: { name?: string; guidelines?: string; revision: number }, checkAccess: () => void = () => {}) {
    const current = requireProject(owner, projectId)
    if (current.revision !== input.revision) throw new WorkspaceError('다른 곳에서 프로젝트 지침이 바뀌었어. 다시 열어줘.', 409)
    const name = input.name?.trim()
    if (name !== undefined && (!name || name.length > 100)) throw new WorkspaceError('이름은 1~100자로 입력해줘.')
    if (input.guidelines !== undefined && input.guidelines !== current.guidelines) {
      if (Buffer.byteLength(input.guidelines) > 64000) throw new WorkspaceError('프로젝트 지침은 64KB까지 저장할 수 있어.')
      const file = await resolved(owner, projectId, GUIDELINES, true)
      let expectedRevision: string | null = null
      try { expectedRevision = await fileRevision(file) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      // A write that landed while the file revision was read would otherwise be overwritten unseen.
      if (requireProject(owner, projectId).revision !== input.revision) throw new WorkspaceError('다른 곳에서 프로젝트 지침이 바뀌었어. 다시 열어줘.', 409)
      const result = await this.apply(owner, projectId, `project-${id()}`, [{ kind: 'write', target: GUIDELINES, text: input.guidelines, expectedRevision }], checkAccess, undefined, { guidelines: true })
      if (result.status !== 'completed') throw new WorkspaceError(result.error ?? '프로젝트 지침을 저장하지 못했어.', 409)
    }
    if (name !== undefined && name !== current.name) {
      db().prepare('UPDATE workspace_projects SET name=? WHERE id=?').run(name, projectId)
      changed(owner, projectId)
    }
    return this.get(owner, projectId)
  },
  async create(owner: string, name: string, guidelines = '') {
    const clean = name.trim()
    if (!clean || clean.length > 100 || Buffer.byteLength(guidelines) > 64000) throw new WorkspaceError('이름은 1~100자, 지침은 64KB까지 입력해줘.')
    const projectId = id()
    const folder = root(owner, projectId)
    await fs.promises.mkdir(folder, { recursive: true, mode: 0o700 })
    await fs.promises.writeFile(path.join(folder, GUIDELINES), guidelines, { flag: 'wx', mode: 0o600 })
    db().transaction(() => {
      db().prepare('INSERT INTO workspace_projects(id,owner_key,name,guidelines) VALUES(?,?,?,?)').run(projectId, owner, clean, guidelines)
      remember(projectId, GUIDELINES, 'file', Buffer.byteLength(guidelines))
    })()
    changed(owner, projectId)
    return this.get(owner, projectId)
  },
  binding(owner: string, threadId: number): WorkspaceBinding | null {
    const row = db().prepare(`SELECT p.*,b.revision AS binding_revision,b.writable FROM workspace_bindings b
      JOIN workspace_projects p ON p.id=b.project_id JOIN codex_chat_threads t ON t.id=b.thread_id
      WHERE b.thread_id=? AND (CASE WHEN t.account_id IS NULL THEN 'bootstrap' ELSE 'account:'||t.account_id END)=?`)
      .get(threadId, owner) as (ProjectRow & { binding_revision: string; writable: number }) | undefined
    return row ? { project: project(row), bindingRevision: row.binding_revision, write: row.writable === 1 } : null
  },
  bind(owner: string, threadId: number, projectId: string | null, write: boolean) {
    const thread = db().prepare("SELECT id FROM codex_chat_threads WHERE id=? AND kind='direct' AND (CASE WHEN account_id IS NULL THEN 'bootstrap' ELSE 'account:'||account_id END)=?").get(threadId, owner)
    if (!thread) throw new WorkspaceError('내 1:1 채팅에만 프로젝트를 연결할 수 있어.', 404)
    if (projectId) {
      requireProject(owner, projectId)
      db().prepare(`INSERT INTO workspace_bindings(thread_id,project_id,revision,writable) VALUES(?,?,?,?)
        ON CONFLICT(thread_id) DO UPDATE SET project_id=excluded.project_id,revision=excluded.revision,writable=excluded.writable`).run(threadId, projectId, id(), write ? 1 : 0)
    } else db().prepare('DELETE FROM workspace_bindings WHERE thread_id=?').run(threadId)
    return this.binding(owner, threadId)
  },
  /** `revisions`: files carry their revision (the screen's move and delete check against what the person saw). */
  async entries(owner: string, projectId: string, target = '', offset = 0, options: { revisions?: boolean } = {}) {
    requireProject(owner, projectId)
    const folder = await resolved(owner, projectId, target)
    if (!(await fs.promises.stat(folder)).isDirectory()) throw new WorkspaceError('목록 대상은 폴더여야 해.')
    const page = () => db().prepare('SELECT id,target,kind,size FROM workspace_entries WHERE project_id=? AND parent=? ORDER BY kind DESC,target LIMIT 101 OFFSET ?')
      .all(projectId, workspaceTarget(target, true), offset) as WorkspaceEntry[]
    // Rows whose file the disk lost (a half-finished delete or move) drop out of the index when their folder is shown.
    const check = async (entries: WorkspaceEntry[]) => {
      const gone: string[] = []
      await Promise.all(entries.slice(0, 100).map(async entry => {
        try {
          const info = await fs.promises.lstat(path.join(folder, path.basename(entry.target)), { bigint: true })
          if (options.revisions && entry.kind === 'file' && info.isFile()) entry.revision = revision(info)
        } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') gone.push(entry.target) }
      }))
      return gone
    }
    let entries = page()
    const gone = await check(entries)
    if (gone.length) {
      const drop = db().prepare(`DELETE FROM workspace_entries WHERE project_id=? AND (target=? OR ${UNDER})`)
      db().transaction(() => { for (const lost of gone) drop.run(projectId, lost, ...under(lost)) })()
      entries = page()
      await check(entries)
    }
    return { entries: entries.slice(0, 100), nextOffset: entries.length > 100 ? offset + 100 : null }
  },
  /** Every folder of a project (move dialog), at most 2,000. */
  folders(owner: string, projectId: string) {
    requireProject(owner, projectId)
    return (db().prepare("SELECT target FROM workspace_entries WHERE project_id=? AND kind='folder' ORDER BY target LIMIT 2000").all(projectId) as Array<{ target: string }>).map(row => row.target)
  },
  async read(owner: string, projectId: string, targets: Array<{ target: string; offset?: number; limit?: number; revision?: string }>, signal?: AbortSignal) {
    requireProject(owner, projectId)
    if (!targets.length || targets.length > 32) throw new WorkspaceError('한 번에 1~32개 파일을 읽을 수 있어.')
    let budget = WORKSPACE_READ_BUDGET
    const files: WorkspaceText[] = []
    for (const input of targets) {
      signal?.throwIfAborted()
      const target = workspaceTarget(input.target)
      textTarget(target)
      const file = await resolved(owner, projectId, target)
      const handle = await fs.promises.open(file, 'r')
      try {
        const stat = await handle.stat({ bigint: true })
        if (!stat.isFile() || stat.nlink > 1n) throw new WorkspaceError('일반 파일만 읽을 수 있어.')
        const rev = revision(stat)
        if (input.revision !== undefined && rev !== input.revision) throw new WorkspaceError('파일이 변경됐어. 처음부터 다시 읽어줘.', 409)
        const size = Number(stat.size)
        const offset = input.offset ?? 0
        const limit = Math.min(input.limit ?? 131072, budget)
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > size || !Number.isSafeInteger(limit) || limit < 4 || limit > WORKSPACE_READ_BUDGET) throw new WorkspaceError('잘못된 읽기 범위야.')
        const buffer = Buffer.alloc(Math.min(size - offset, limit + 3))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
        let start = 0
        while (start < bytesRead && (buffer[start] & 0xc0) === 0x80) start++
        let end = Math.min(bytesRead, limit)
        while (end > start && end < bytesRead && (buffer[end] & 0xc0) === 0x80) end--
        const data = buffer.subarray(start, end)
        if (data.includes(0)) throw new WorkspaceError('바이너리 파일은 텍스트로 읽을 수 없어.')
        let text: string
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(data) } catch { throw new WorkspaceError('UTF-8 파일만 읽을 수 있어.') }
        if (revision(await handle.stat({ bigint: true })) !== rev) throw new WorkspaceError('읽는 동안 파일이 변경됐어.', 409)
        files.push({ target, text, revision: rev, size, offset: offset + start, nextOffset: offset + end < size ? offset + end : null })
        budget -= end
        if (budget < 4) break
      } finally { await handle.close() }
    }
    return { files, remaining: targets.slice(files.length), truncated: files.length < targets.length }
  },
  async search(owner: string, projectId: string, query: string, offset = 0, signal?: AbortSignal) {
    requireProject(owner, projectId)
    const term = query.trim().toLowerCase()
    if (!term || term.length > 500) throw new WorkspaceError('검색어는 1~500자로 입력해줘.')
    const candidates = db().prepare('SELECT id,target,kind,size FROM workspace_entries WHERE project_id=? ORDER BY target LIMIT 101 OFFSET ?').all(projectId, offset) as WorkspaceEntry[]
    const hits: Array<WorkspaceEntry & { excerpt?: string; revision?: string }> = []
    let partialFiles = 0
    let skippedFiles = 0
    // Bound file I/O while preserving SQL order and the existing page cursor. Drain each
    // batch even on failure/cancellation so no background reads outlive the request.
    for (let start = 0; start < Math.min(candidates.length, 100); start += 4) {
      const batch = await Promise.allSettled(candidates.slice(start, Math.min(start + 4, 100)).map(async entry => {
        signal?.throwIfAborted()
        if (entry.target.toLowerCase().includes(term)) return { hit: entry, partial: false }
        if (entry.kind !== 'file' || !TEXT_EXTENSIONS.has(path.extname(entry.target).toLowerCase())) return { partial: false }
        let file: WorkspaceText
        // One unreadable file (not UTF-8, a hard link, lost from disk) is skipped, not the whole page.
        try { ({ files: [file] } = await this.read(owner, projectId, [{ target: entry.target, limit: 131072 }], signal)) } catch (error) {
          if (error instanceof WorkspaceError) return { partial: false, skipped: true }
          throw error
        }
        const at = file.text.toLowerCase().indexOf(term)
        return {
          partial: file.nextOffset !== null,
          hit: at < 0 ? undefined : { ...entry, revision: file.revision, excerpt: file.text.slice(Math.max(0, at - 100), at + term.length + 200) },
        }
      }))
      for (const item of batch) {
        if (item.status === 'rejected') throw item.reason
        if (item.value.partial) partialFiles++
        if ('skipped' in item.value) skippedFiles++
        if (item.value.hit) hits.push(item.value.hit)
      }
    }
    return { hits, nextOffset: candidates.length > 100 ? offset + 100 : null, partialFiles, ...(skippedFiles ? { skippedFiles } : {}), note: '검색은 관리된 파일의 앞 128KB를 확인해. 긴 파일은 workspace_read로 읽어줘.' }
  },
  changes(owner: string, projectId: string) {
    requireProject(owner, projectId)
    const rows = db().prepare('SELECT request_id AS requestId,status,result,created_at AS createdAt FROM workspace_operations WHERE project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30').all(projectId) as Array<{ requestId: string; status: string; result: string; createdAt: string }>
    return rows.map(row => {
      const result = JSON.parse(row.result) as WorkspaceBatchResult
      return { ...row, completed: result.results.length, result: JSON.stringify({ ...result, results: result.results.slice(0, 10) }) }
    })
  },
  /**
   * `guidelines`: the screen may write AI_GUIDELINES.md. Chats and plugins may not: the file becomes the
   * "selected by the user" instructions of every connected chat, so text they read must not rewrite it.
   */
  async apply(owner: string, projectId: string, requestId: string, operations: WorkspaceOperation[], checkAccess: () => void = () => {}, signal?: AbortSignal, options: { guidelines?: boolean; beforeWrite?: () => Promise<void>; inputIdentity?: unknown } = {}): Promise<WorkspaceBatchResult> {
    requireProject(owner, projectId)
    if (!/^[\w-]{8,100}$/.test(requestId) || !operations.length || operations.length > 100 || Buffer.byteLength(JSON.stringify(operations)) > MAX_TEXT) throw new WorkspaceError('한 번에 1~100개, 총 8MB까지 처리할 수 있어.')
    const fingerprint = hash(JSON.stringify(options.inputIdentity === undefined ? operations : { operations, identity: options.inputIdentity }))
    const store = db()
    // Cross-process exclusion. Never expire a same-host lock merely because an operation is slow.
    const active = store.prepare("SELECT request_id,process_id,hostname,result,created_at FROM workspace_operations WHERE project_id=? AND status='running'").get(projectId) as { request_id: string; process_id: number; hostname: string; result: string; created_at: string } | undefined
    if (active) {
      let dead = false
      if (active.hostname !== hostname) dead = Date.now() - Date.parse(`${active.created_at.replace(' ', 'T')}Z`) > FOREIGN_LOCK_MS
      else {
        dead = active.process_id === process.pid && !activeOperations.has(`${projectId}:${active.request_id}`)
        if (!dead) {
          try { process.kill(active.process_id, 0) } catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH' }
        }
      }
      if (dead) {
        const interrupted = { ...JSON.parse(active.result), status: 'interrupted', error: '프로세스가 중단됐어. 기록 뒤의 변경 여부는 파일을 다시 읽어 확인해줘.' }
        store.prepare("UPDATE workspace_operations SET status='interrupted',result=? WHERE project_id=? AND request_id=? AND status='running'").run(JSON.stringify(interrupted), projectId, active.request_id)
      }
    }
    const previous = store.prepare('SELECT input_hash,status,result FROM workspace_operations WHERE project_id=? AND request_id=?').get(projectId, requestId) as { input_hash: string; status: string; result: string } | undefined
    if (previous) {
      if (previous.input_hash !== fingerprint) throw new WorkspaceError('같은 요청 ID에 다른 작업을 넣을 수 없어.', 409)
      if (previous.status === 'running') throw new WorkspaceError('이 요청은 실행 중이거나 중단 확인이 필요해. 변경 내역을 확인해줘.', 409)
      return JSON.parse(previous.result) as WorkspaceBatchResult
    }
    const result: WorkspaceBatchResult = { requestId, status: 'completed', results: [] }
    try { store.prepare("INSERT INTO workspace_operations(project_id,request_id,input_hash,status,process_id,hostname,result) VALUES(?,?,?,'running',?,?,?)").run(projectId, requestId, fingerprint, process.pid, hostname, JSON.stringify({ ...result, status: 'running' })) }
    catch { throw new WorkspaceError('프로젝트에 다른 변경 작업이 진행 중이야.', 409) }
    const activeKey = `${projectId}:${requestId}`
    activeOperations.add(activeKey)
    try {
      checkAccess()
      signal?.throwIfAborted()
      await options.beforeWrite?.()
      for (const operation of operations) {
        signal?.throwIfAborted()
        checkAccess()
        const target = workspaceTarget(operation.target)
        const file = await resolved(owner, projectId, target, operation.kind === 'mkdir' || operation.kind === 'write')
        if (operation.kind === 'mkdir') {
          await fs.promises.mkdir(file, { mode: 0o700 })
          remember(projectId, target, 'folder', 0)
          result.results.push({ target })
        } else if (operation.kind === 'delete') {
          // Screen-only (the person confirmed it); assistant and plugin schemas have no delete.
          if (target.toLowerCase() === GUIDELINES.toLowerCase()) throw new WorkspaceError('프로젝트 지침 파일은 지울 수 없어.')
          if (await targetRevision(owner, projectId, target) !== operation.expectedRevision) throw new WorkspaceError('지울 파일이나 폴더 내용이 변경됐어.', 409)
          const isFolder = (await fs.promises.stat(file)).isDirectory()
          checkAccess()
          signal?.throwIfAborted()
          // A failed recursive delete still leaves the index matching what the disk kept: drop the rows first,
          // the next listing re-checks nothing that is gone.
          try { await fs.promises.rm(file, { recursive: isFolder }) } finally {
            const lost = (await Promise.all([target, ...(isFolder ? (store.prepare(`SELECT target FROM workspace_entries WHERE project_id=? AND ${UNDER}`).all(projectId, ...under(target)) as Array<{ target: string }>).map(row => row.target) : [])]
              .map(async item => fs.promises.lstat(path.join(root(owner, projectId), ...item.split('/'))).then(() => null, () => item)))).filter((item): item is string => item !== null)
            const drop = store.prepare('DELETE FROM workspace_entries WHERE project_id=? AND target=?')
            store.transaction(() => { for (const item of lost) drop.run(projectId, item) })()
          }
          result.results.push({ target, deleted: true })
        } else if (operation.kind === 'move') {
          if (target.toLowerCase() === GUIDELINES.toLowerCase() || operation.destination.toLowerCase() === GUIDELINES.toLowerCase()) throw new WorkspaceError('프로젝트 지침 파일은 이름을 바꿀 수 없어.')
          if (await targetRevision(owner, projectId, target) !== operation.expectedRevision) throw new WorkspaceError('이동할 파일이나 폴더 내용이 변경됐어.', 409)
          const isFolder = (await fs.promises.stat(file)).isDirectory()
          const destination = workspaceTarget(operation.destination)
          if (destination.toLowerCase().startsWith(`${target.toLowerCase()}/`)) throw new WorkspaceError('폴더를 자기 안으로 이동할 수 없어.')
          // Only the letter case changes: the destination is the same entry, so the registered-case and
          // "already exists" checks below would refuse it. Rename through a temporary name instead.
          const caseOnly = destination !== target && destination.toLowerCase() === target.toLowerCase()
          if (caseOnly && parent(destination) !== parent(target)) throw new WorkspaceError('상위 폴더 이름의 대소문자는 그 폴더에서 바꿔줘.')
          const dest = caseOnly ? path.join(path.dirname(file), path.basename(destination)) : await resolved(owner, projectId, destination, true)
          if (!caseOnly && fs.existsSync(dest)) throw new WorkspaceError('이동할 위치에 같은 이름이 있어.', 409)
          checkAccess()
          signal?.throwIfAborted()
          // All project mutations share the DB writer gate. Native writers are not enabled in this phase.
          if (caseOnly) {
            const temporary = path.join(path.dirname(file), `.workspace-${id()}`)
            await fs.promises.rename(file, temporary)
            await fs.promises.rename(temporary, dest)
          } else await fs.promises.rename(file, dest)
          store.transaction(() => {
            if (isFolder) {
              const rows = store.prepare(`SELECT id,target FROM workspace_entries WHERE project_id=? AND ${UNDER}`).all(projectId, ...under(target)) as Array<{ id: string; target: string }>
              const update = store.prepare('UPDATE workspace_entries SET target=?,target_key=?,parent=? WHERE id=?')
              for (const row of rows) { const moved = destination + row.target.slice(target.length); update.run(moved, moved.toLowerCase(), parent(moved), row.id) }
            }
            store.prepare('UPDATE workspace_entries SET target=?,target_key=?,parent=? WHERE project_id=? AND target=?').run(destination, destination.toLowerCase(), parent(destination), projectId, target)
          })()
          result.results.push({ target: destination, revision: await targetRevision(owner, projectId, destination) })
        } else {
          textTarget(target)
          let existing: string | null = null
          try { existing = await fileRevision(file) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
          if (existing !== operation.expectedRevision) throw new WorkspaceError('파일이 변경됐거나 같은 이름이 있어. 최신 리비전으로 다시 요청해줘.', 409)
          let text = operation.kind === 'write' ? operation.text : ''
          if (operation.kind === 'edit') {
            const stat = await fs.promises.stat(file)
            if (stat.size > MAX_TEXT) throw new WorkspaceError('부분 편집은 8MB까지 지원해.')
            const bytes = await fs.promises.readFile(file)
            if (bytes.includes(0)) throw new WorkspaceError('바이너리는 편집할 수 없어.')
            text = applyTextEdits(new TextDecoder('utf-8', { fatal: true }).decode(bytes), operation.edits).text
          }
          if (text.includes('\0')) throw new WorkspaceError('NUL 문자는 텍스트 문서에 저장할 수 없어.')
          const bytes = Buffer.from(text)
          const isGuideline = target.toLowerCase() === GUIDELINES.toLowerCase()
          if (isGuideline && !options.guidelines) throw new WorkspaceError('프로젝트 지침은 파일함 화면에서만 고칠 수 있어.', 403)
          if (bytes.length > MAX_TEXT || (isGuideline && bytes.length > 64000)) throw new WorkspaceError('텍스트는 8MB, 프로젝트 지침은 64KB까지 저장할 수 있어.')
          const staging = path.join(root(owner, projectId), `.workspace-${id()}`)
          try {
            await fs.promises.writeFile(staging, bytes, { flag: 'wx', mode: 0o600 })
            checkAccess()
            signal?.throwIfAborted()
            await resolved(owner, projectId, target, true)
            if (existing !== null && await fileRevision(file) !== existing) throw new WorkspaceError('저장 전에 파일이 변경됐어.', 409)
            if (existing === null) {
              await fs.promises.copyFile(staging, file, fs.constants.COPYFILE_EXCL)
            } else await fs.promises.rename(staging, file)
            remember(projectId, target, 'file', bytes.length)
            if (isGuideline) store.prepare('UPDATE workspace_projects SET guidelines=?,revision=revision+1 WHERE id=?').run(text, projectId)
            result.results.push({ target, revision: await fileRevision(file) })
          } finally { await fs.promises.unlink(staging).catch(() => {}) }
        }
        store.prepare('UPDATE workspace_operations SET result=? WHERE project_id=? AND request_id=?').run(JSON.stringify({ ...result, status: 'running' }), projectId, requestId)
      }
    } catch (error) {
      result.status = 'failed'
      result.error = plainFsError(error)
      if (error instanceof WorkspaceError && error.status === 409) result.conflict = true
      if (!(error instanceof WorkspaceError)) console.warn('[workspace] apply failed:', error)
    }
    try {
      store.prepare('UPDATE workspace_operations SET status=?,result=? WHERE project_id=? AND request_id=?').run(result.status, JSON.stringify(result), projectId, requestId)
      // Keep the newest rows: the history shows 30, retries look a request ID up for a while.
      store.prepare(`DELETE FROM workspace_operations WHERE project_id=? AND status!='running' AND rowid IN (
        SELECT rowid FROM workspace_operations WHERE project_id=? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?)`).run(projectId, projectId, KEPT_OPERATIONS)
      changed(owner, projectId)
      return result
    } finally { activeOperations.delete(activeKey) }
  },
}
