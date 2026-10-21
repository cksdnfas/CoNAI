import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import type { PluginDraft, PluginDraftSummary, PluginDraftFile, PluginPackageReview } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'
import { isConfirmedAdminRequester } from '../../middleware/featureAccess'
import { applyTextEdits, TEXT_EXTENSIONS } from '../fileStoreService'
import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus'
import { pluginDb, PluginError } from './pluginStore'
import { getPlugin, installPlugin, parsePluginManifest, pluginAssetAllowed, pluginAssetName, pluginIdSchema, PLUGIN_PACKAGE_LIMITS, readInstalledPluginAssets, unpackPlugin } from './pluginRegistry'

const initialized = new WeakSet<Database.Database>()
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const draftId = z.string().regex(/^[a-f0-9]{32}$/)
const revision = z.number().int().positive()
const requestId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/)
const target = z.string().min(1).max(200)
const changed = (id: string) => publishRuntimeEvent({ name: 'plugin.draft.changed', topic: 'plugins', visibility: 'account', accountId: null, payload: { draftId: id } })
export const pluginDraftCreateSchema = z.object({ requestId, pluginId: z.lazy(() => pluginIdSchema), name: z.string().trim().min(1).max(100).optional(), fromInstalled: z.boolean().default(false) }).strict()
export const pluginDraftReadSchema = z.object({ draftId, target: target.optional(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(128 * 1024).default(32 * 1024), revision: revision.optional() }).strict()
export const pluginDraftChangeSchema = z.object({
  draftId, revision, requestId,
  operations: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('write'), target, text: z.string().max(4 * 1024 * 1024) }).strict(),
    z.object({ kind: z.literal('edit'), target, edits: z.array(z.object({ old_text: z.string().min(1).max(128 * 1024), new_text: z.string().max(128 * 1024), replace_all: z.boolean().optional() }).strict()).min(1).max(50) }).strict(),
    z.object({ kind: z.literal('move'), target, destination: target }).strict(),
    z.object({ kind: z.literal('delete'), target }).strict(),
  ])).min(1).max(32),
}).strict()
export const pluginDraftRevisionSchema = z.object({ draftId, revision }).strict()
export const pluginDraftInstallSchema = pluginDraftRevisionSchema.extend({ digest: z.string().regex(/^[a-f0-9]{64}$/), enabled: z.boolean() }).strict()
export const pluginDraftUploadSchema = pluginDraftRevisionSchema.extend({ requestId, target, replace: z.boolean().default(false) }).strict()
type DraftRow = { id: string; plugin_id: string; name: string; revision: number; base_digest: string | null; created_input: string; last_request: string | null; last_input: string | null; updated_at: string }

export function requirePluginAuthor(requester: McpRequester | undefined): asserts requester is McpRequester {
  if (!requester || !isConfirmedAdminRequester(requester)) throw new PluginError('관리자만 플러그인을 제작하고 내보낼 수 있어.', 403)
}
function db() {
  const store = pluginDb()
  if (!initialized.has(store)) {
    store.exec(`CREATE TABLE IF NOT EXISTS plugin_drafts (
      id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      base_digest TEXT, created_input TEXT NOT NULL, last_request TEXT, last_input TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS plugin_draft_files (
      draft_id TEXT NOT NULL REFERENCES plugin_drafts(id) ON DELETE CASCADE, name TEXT NOT NULL COLLATE NOCASE,
      bytes BLOB NOT NULL, PRIMARY KEY(draft_id,name));`)
    initialized.add(store)
  }
  return store
}
function row(requester: McpRequester, id: string, expectedRevision?: number) {
  requirePluginAuthor(requester)
  const current = db().prepare('SELECT * FROM plugin_drafts WHERE id=?').get(draftId.parse(id)) as DraftRow | undefined
  if (!current) throw new PluginError('플러그인 초안을 찾을 수 없어.', 404)
  if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new PluginError('초안이 변경됐어. 최신 내용을 읽고 다시 요청해줘.', 409)
  return current
}
function summary(current: DraftRow): PluginDraftSummary {
  return { id: current.id, pluginId: current.plugin_id, name: current.name, revision: current.revision, baseDigest: current.base_digest, updatedAt: current.updated_at }
}
function files(id: string) {
  return new Map((db().prepare('SELECT name,bytes FROM plugin_draft_files WHERE draft_id=? ORDER BY name').all(id) as Array<{ name: string; bytes: Buffer }>).map(file => [file.name, file.bytes]))
}
function editable(name: string) { return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase()) }
function checkAssets(assets: Map<string, Buffer>) {
  let total = 0
  const names = new Set<string>()
  for (const [name, bytes] of assets) {
    if (!pluginAssetAllowed(name) || names.has(name.toLowerCase())) throw new PluginError('지원하지 않거나 중복된 패키지 파일 이름이야.')
    names.add(name.toLowerCase())
    if (bytes.length > PLUGIN_PACKAGE_LIMITS.file || (total += bytes.length) > PLUGIN_PACKAGE_LIMITS.total) throw new PluginError('패키지 파일 크기 제한을 넘었어.')
  }
  if (assets.size > PLUGIN_PACKAGE_LIMITS.entries) throw new PluginError('패키지 파일은 256개까지 만들 수 있어.')
  for (const name of names) {
    const parts = name.split('/')
    if (parts.slice(0, -1).some((_, index) => names.has(parts.slice(0, index + 1).join('/')))) throw new PluginError('파일과 폴더 이름이 겹쳐.')
  }
  return total
}
function saveFiles(id: string, assets: Map<string, Buffer>) {
  const size = checkAssets(assets)
  const other = db().prepare('SELECT coalesce(sum(length(bytes)),0) AS size FROM plugin_draft_files WHERE draft_id<>?').get(id) as { size: number }
  if (other.size + size > 128 * 1024 * 1024) throw new PluginError('초안 저장 공간이 128MB를 넘었어. 사용하지 않는 초안을 지워줘.', 409)
  db().prepare('DELETE FROM plugin_draft_files WHERE draft_id=?').run(id)
  const insert = db().prepare('INSERT INTO plugin_draft_files(draft_id,name,bytes) VALUES(?,?,?)')
  for (const [name, bytes] of assets) insert.run(id, name, bytes)
}
/** Fixed timestamps make identical builds have identical digests, including retries after a restart. */
export function packagePluginAssets(assets: Map<string, Buffer>) {
  checkAssets(assets)
  const zip = new AdmZip()
  for (const name of [...assets.keys()].sort()) {
    zip.addFile(name, assets.get(name)!)
    zip.getEntry(name)!.header.time = new Date(2000, 0, 1)
  }
  const bytes = zip.toBuffer()
  const { manifest } = unpackPlugin(bytes)
  return { bytes, manifest, digest: hash(bytes), filename: `${manifest.id}-${manifest.version}.zip` }
}
/** Per-file changes from the installed package (`previous`) to a new one, for draft and Git reviews. */
export function packageFileChanges(next: Map<string, Buffer>, previous: Map<string, Buffer>): PluginPackageReview['files'] {
  return [...new Set([...next.keys(), ...previous.keys()])].sort().map(name => ({ name, size: next.get(name)?.length ?? 0,
    change: !next.has(name) ? 'removed' : !previous.has(name) ? 'added' : next.get(name)!.equals(previous.get(name)!) ? 'unchanged' : 'changed' }))
}
/** The host's SDK copy that every built package carries. */
export function sdkAssets() {
  const candidates = [
    path.join(__dirname, 'plugin-sdk'),
    path.join(__dirname, '../../../../plugin-sdk'),
    path.join(__dirname, '../../../../plugins/sdk'),
    path.join(path.dirname(process.execPath), 'plugin-sdk'),
  ]
  const folder = candidates.find(candidate => fs.existsSync(path.join(candidate, 'conai-plugin.js')) && fs.existsSync(path.join(candidate, 'conai-plugin.css')))
  if (!folder) throw new PluginError('플러그인 SDK가 없어. 호스트를 다시 빌드해줘.', 503)
  return new Map(['conai-plugin.js', 'conai-plugin.css'].map(name => [name, fs.readFileSync(path.join(folder, name))]))
}
export function listPluginDrafts(requester: McpRequester) {
  requirePluginAuthor(requester)
  return (db().prepare('SELECT * FROM plugin_drafts ORDER BY updated_at DESC,id LIMIT 32').all() as DraftRow[]).map(summary)
}
export function getPluginDraft(requester: McpRequester, id: string): PluginDraft {
  const current = row(requester, id)
  const entries = db().prepare('SELECT name,length(bytes) AS size FROM plugin_draft_files WHERE draft_id=? ORDER BY name').all(id) as Array<{ name: string; size: number }>
  return { ...summary(current), files: entries.map(file => ({ ...file, editable: editable(file.name) })) }
}
export function createPluginDraft(requester: McpRequester, value: z.input<typeof pluginDraftCreateSchema>): PluginDraft {
  requirePluginAuthor(requester)
  const input = pluginDraftCreateSchema.parse(value)
  const id = hash(`${requester.accountId ?? 'bootstrap'}:${input.requestId}`).slice(0, 32)
  const fingerprint = hash(JSON.stringify(input))
  const result = db().transaction(() => {
    const existing = db().prepare('SELECT created_input FROM plugin_drafts WHERE id=?').get(id) as { created_input: string } | undefined
    if (existing) {
      if (existing.created_input !== fingerprint) throw new PluginError('같은 요청 ID에 다른 입력을 사용할 수 없어.', 409)
      return getPluginDraft(requester, id)
    }
    if ((db().prepare('SELECT count(*) AS n FROM plugin_drafts').get() as { n: number }).n >= 32) throw new PluginError('초안은 32개까지 보관할 수 있어. 사용하지 않는 초안을 지워줘.', 409)
    let assets: Map<string, Buffer>, baseDigest: string | null = null, name = input.name ?? input.pluginId
    if (input.fromInstalled) {
      const source = readInstalledPluginAssets(input.pluginId)
      assets = source.assets; baseDigest = source.plugin.digest; name = source.plugin.definition.name
    } else {
      if (db().prepare('SELECT id FROM plugins WHERE id=?').get(input.pluginId)) throw new PluginError('이미 설치된 ID야. 기존 플러그인에서 초안을 만들어줘.', 409)
      const manifest = parsePluginManifest({ apiVersion: 1, id: input.pluginId, name, version: '1.0.0', description: '', pages: [{ id: 'main', title: name, entry: 'index.html', accepts: [], actions: [] }] })
      assets = sdkAssets()
      assets.set('plugin.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
      assets.set('index.html', Buffer.from('<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="conai-plugin.css"><link rel="stylesheet" href="style.css"></head><body><main class="conai-page"><h1 id="title"></h1><p>플러그인을 만들 준비가 됐어.</p></main><script type="module" src="app.js"></script></body></html>\n'))
      assets.set('style.css', Buffer.from('/* Layout only. Page spacing and widgets come from conai-plugin.css (class reference: plugins/README.md). */\n'))
      assets.set('app.js', Buffer.from(`import { connectPlugin } from './conai-plugin.js'\nconst api = await connectPlugin({})\ndocument.querySelector('#title').textContent = ${JSON.stringify(name)}\napi.publish({ dirty: false, data: { ready: true } })\n`))
    }
    db().prepare('INSERT INTO plugin_drafts(id,plugin_id,name,base_digest,created_input) VALUES(?,?,?,?,?)').run(id, input.pluginId, name, baseDigest, fingerprint)
    saveFiles(id, assets)
    return getPluginDraft(requester, id)
  })()
  changed(id)
  return result
}
export function readPluginDraft(requester: McpRequester, value: z.input<typeof pluginDraftReadSchema>): PluginDraft | PluginDraftFile {
  const input = pluginDraftReadSchema.parse(value)
  const current = row(requester, input.draftId, input.revision)
  if (!input.target) return getPluginDraft(requester, input.draftId)
  const name = pluginAssetName(input.target)
  if (!editable(name)) throw new PluginError('이 파일은 텍스트 편집을 지원하지 않아.')
  const file = db().prepare('SELECT bytes FROM plugin_draft_files WHERE draft_id=? AND name=?').get(current.id, name) as { bytes: Buffer } | undefined
  if (!file) throw new PluginError('초안 파일을 찾을 수 없어.', 404)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)
  let end = Math.min(text.length, input.offset + input.limit)
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end++
  return { name, revision: current.revision, text: text.slice(input.offset, end), nextOffset: end < text.length ? end : null, size: file.bytes.length }
}
export function changePluginDraft(requester: McpRequester, value: z.input<typeof pluginDraftChangeSchema>): PluginDraft {
  const input = pluginDraftChangeSchema.parse(value)
  if (Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 * 1024) throw new PluginError('한 번에 8MB까지 변경할 수 있어.')
  const fingerprint = hash(JSON.stringify(input))
  const result = db().transaction(() => {
    const current = row(requester, input.draftId)
    if (current.last_request === input.requestId) {
      if (current.last_input !== fingerprint) throw new PluginError('같은 요청 ID에 다른 입력을 사용할 수 없어.', 409)
      return getPluginDraft(requester, current.id)
    }
    row(requester, input.draftId, input.revision)
    const assets = files(current.id)
    for (const op of input.operations) {
      const name = pluginAssetName(op.target)
      if (op.kind === 'write' || op.kind === 'edit') {
        if (!editable(name)) throw new PluginError('텍스트 파일만 작성할 수 있어.')
        const old = assets.get(name)
        if (op.kind === 'edit' && !old) throw new PluginError('수정할 파일이 없어.', 404)
        assets.set(name, Buffer.from(op.kind === 'write' ? op.text : applyTextEdits(new TextDecoder('utf-8', { fatal: true }).decode(old!), op.edits).text))
      } else {
        const old = assets.get(name)
        if (!old) throw new PluginError('파일을 찾을 수 없어.', 404)
        if (op.kind === 'move') {
          const destination = pluginAssetName(op.destination)
          if ([...assets.keys()].some(key => key !== name && key.toLowerCase() === destination.toLowerCase())) throw new PluginError('같은 이름의 파일이 있어.', 409)
          assets.delete(name); assets.set(destination, old)
        } else assets.delete(name)
      }
    }
    saveFiles(current.id, assets)
    db().prepare('UPDATE plugin_drafts SET revision=revision+1,last_request=?,last_input=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(input.requestId, fingerprint, current.id)
    return getPluginDraft(requester, current.id)
  })()
  changed(input.draftId)
  return result
}
export function uploadPluginDraftAsset(requester: McpRequester, value: z.input<typeof pluginDraftUploadSchema>, bytes: Buffer) {
  const input = pluginDraftUploadSchema.parse(value)
  const fingerprint = hash(`${JSON.stringify(input)}:${hash(bytes)}`)
  const result = db().transaction(() => {
    const current = row(requester, input.draftId)
    if (current.last_request === input.requestId) {
      if (current.last_input !== fingerprint) throw new PluginError('같은 요청 ID에 다른 입력을 사용할 수 없어.', 409)
      return getPluginDraft(requester, current.id)
    }
    row(requester, current.id, input.revision)
    const assets = files(current.id)
    const name = pluginAssetName(input.target)
    if (assets.has(name) && !input.replace) throw new PluginError('같은 이름의 파일이 있어. 교체 여부를 확인해줘.', 409)
    assets.set(name, bytes)
    saveFiles(current.id, assets)
    db().prepare('UPDATE plugin_drafts SET revision=revision+1,last_request=?,last_input=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(input.requestId, fingerprint, current.id)
    return getPluginDraft(requester, current.id)
  })()
  changed(input.draftId)
  return result
}
export function deletePluginDraft(requester: McpRequester, id: string, expectedRevision: number) {
  db().transaction(() => {
    row(requester, id, expectedRevision)
    db().prepare('DELETE FROM plugin_draft_files WHERE draft_id=?').run(id)
    db().prepare('DELETE FROM plugin_drafts WHERE id=?').run(id)
  })()
  changed(id)
}
export function buildPluginDraft(requester: McpRequester, id: string, expectedRevision: number) {
  const current = row(requester, id, expectedRevision)
  const assets = files(id)
  const result = packagePluginAssets(assets)
  if (result.manifest.id !== current.plugin_id) throw new PluginError('초안의 플러그인 ID는 바꿀 수 없어. 새 초안을 만들어줘.')
  return { ...result, current, assets }
}
export function reviewPluginDraft(requester: McpRequester, id: string, expectedRevision: number): PluginPackageReview {
  const built = buildPluginDraft(requester, id, expectedRevision)
  const installed = db().prepare('SELECT digest,enabled FROM plugins WHERE id=?').get(built.manifest.id) as { digest: string; enabled: number } | undefined
  if ((installed?.digest ?? null) !== built.current.base_digest && installed?.digest !== built.digest) throw new PluginError('설치된 버전이 변경됐어. 최신 플러그인에서 새 초안을 만들어 변경 내용을 옮겨줘.', 409)
  const previous = installed ? readInstalledPluginAssets(built.manifest.id).assets : new Map<string, Buffer>()
  return {
    draftId: id, revision: expectedRevision, pluginId: built.manifest.id, name: built.manifest.name, version: built.manifest.version,
    digest: built.digest, baseDigest: built.current.base_digest, updated: !!installed, enabled: !!installed?.enabled, server: !!built.manifest.server, size: built.bytes.length,
    files: packageFileChanges(built.assets, previous),
  }
}
/** Only the authenticated host route calls this. AI tools prepare a review, never install executable code. */
export async function installPluginDraft(requester: McpRequester, value: z.input<typeof pluginDraftInstallSchema>) {
  const input = pluginDraftInstallSchema.parse(value)
  const built = buildPluginDraft(requester, input.draftId, input.revision)
  if (built.digest !== input.digest) throw new PluginError('검토한 패키지와 내용이 달라. 다시 검토해줘.', 409)
  const current = db().prepare('SELECT digest,enabled FROM plugins WHERE id=?').get(built.manifest.id) as { digest: string; enabled: number } | undefined
  // Retry a completed installation, including when the client lost its response.
  if (current?.digest !== built.digest) {
    if ((current?.digest ?? null) === built.current.base_digest && !!current?.enabled !== input.enabled) throw new PluginError('검토 뒤 플러그인의 활성 상태가 바뀌었어. 다시 검토해줘.', 409)
    await installPlugin(built.bytes, built.current.base_digest)
  }
  requirePluginAuthor(requester)
  // An edit made while the server module restarted remains an edit; only advance the base installation.
  db().prepare('UPDATE plugin_drafts SET base_digest=? WHERE id=? AND base_digest IS ?').run(built.digest, input.draftId, built.current.base_digest)
  changed(input.draftId)
  return { pluginId: built.manifest.id, version: built.manifest.version, enabled: !!getPlugin(built.manifest.id, false).enabled, digest: built.digest }
}
export function exportInstalledPlugin(requester: McpRequester, id: string) {
  requirePluginAuthor(requester)
  return packagePluginAssets(readInstalledPluginAssets(id).assets)
}
