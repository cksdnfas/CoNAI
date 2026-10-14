import fs from 'fs'
import path from 'path'
import { createHash, randomBytes } from 'crypto'
import AdmZip from 'adm-zip'
import { z } from 'zod'
import { normalizeChatPageSchema, normalizeChatPageActions, validateChatPageArguments, type ChatPageSnapshot, type PluginManifest, type InstalledPlugin } from '@conai/shared'
import { runtimePaths } from '../../config/runtimePaths'
import { WINDOWS_RESERVED_NAME } from '../../utils/pathResolver'
import { pluginChanged, pluginDb, PluginError } from './pluginStore'
import { removePluginData } from './pluginData'
import { pluginAppToolScope, pluginAppToolCapability } from './pluginAppPolicy'
import { RuntimeJobRunner } from '../runtimeJobs/runtimeJobRunner'
import { zipEntryBytes, zipEntryKind } from '../../utils/zipEntries'

export { PluginError }
export const pluginIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/)
const reserved = new Set(['page', 'page-settings', 'files', 'workspace', 'library', 'settings', 'profile', 'resource', 'chat', 'audio', 'sprite', 'upload', 'posts', 'wallpaper', 'metadata', 'prompt', 'preset', 'wildcard', 'group', 'media', 'nai', 'comfy', 'workflow'])
const actionSchema = z.object({
  id: z.string().max(110), label: z.string().min(1).max(160), description: z.string().max(1000),
  effect: z.literal('draft'), tier: z.enum(['view', 'draft']), schema: z.unknown(),
}).strict()
const manifestSchema = z.object({
  apiVersion: z.literal(1), id: pluginIdSchema, name: z.string().min(1).max(100),
  version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/), description: z.string().max(1000),
  capabilities: z.array(z.enum(['files.read', 'files.write', 'files.media', 'workspace.read', 'workspace.write', 'workspace.media', 'media.process', 'server'])).max(8),
  server: z.object({ entry: z.string().min(1).max(200) }).strict().optional(),
  appTools: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)).max(128).optional(),
  serverActions: z.array(z.object({ id: z.string().max(100), label: z.string().min(1).max(160), description: z.string().max(1000), schema: z.unknown(), tool: z.string().max(64), arguments: z.record(z.string(), z.unknown()).optional() }).strict()).max(64).optional(),
  pages: z.array(z.object({
    id: pluginIdSchema, title: z.string().min(1).max(160), entry: z.string().min(1).max(200),
    accepts: z.array(z.string().regex(/^\.[a-z0-9]{1,16}$/)).max(40), actions: z.array(actionSchema).max(26), serverActions: z.array(z.string().max(100)).max(26).optional(),
  }).strict()).min(1).max(12),
}).strict()
export const PLUGIN_ZIP_LIMIT = 8 * 1024 * 1024
const MAX_FILE = 4 * 1024 * 1024
const MAX_TOTAL = 16 * 1024 * 1024
const allowedAssets = new Set(['.html', '.js', '.mjs', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.otf', '.wasm', '.md', '.txt', '.csv', '.mp3', '.wav', '.ogg'])
export const pluginPackagesRoot = path.join(runtimePaths.basePath, 'plugins', 'packages')
type Row = { id: string; version: string; manifest: string; digest: string; enabled: number; installed_at: string; enabled_by: number | null }

export function pluginAssetName(value: string): string {
  if (value.length > 200 || !value || value.split('/').some((part) => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part) || part.endsWith('.') || WINDOWS_RESERVED_NAME.test(part))) throw new PluginError('패키지 경로가 올바르지 않아.')
  return value
}
/**
 * `stored`: a manifest already installed. An app update may retire or reclassify an app tool it lists; the tools no
 * longer granted (and the server actions using them) drop out instead of making the package unreadable.
 */
export function parsePluginManifest(value: unknown, stored = false): PluginManifest {
  const raw = manifestSchema.parse(value)
  // A server module is trusted code; the capability says so where the person enabling it reads the list.
  const trusted = raw.capabilities.includes('server')
  if (trusted !== !!raw.server) throw new PluginError('server 권한과 server.entry는 함께 선언해줘.')
  if (raw.server && (!/\.m?js$/.test(pluginAssetName(raw.server.entry)))) throw new PluginError('서버 모듈은 .mjs나 .js 파일이어야 해.')
  const declared = [...new Set(raw.appTools ?? [])]
  // Project tools also need the matching capability: an app tool must not reach past what the package asks for.
  const granted = (name: string) => {
    if (trusted) return !!pluginAppToolScope(name, true)
    const capability = pluginAppToolCapability(name)
    return !!pluginAppToolScope(name) && (capability === null || raw.capabilities.includes(capability))
  }
  const appTools = stored ? declared.filter(granted) : declared
  if (!stored && appTools.some(name => !granted(name))) throw new PluginError('지원하지 않는 앱 도구가 선언됐거나 필요한 capabilities가 빠졌어.')
  const retired = new Set((raw.serverActions ?? []).filter(action => !appTools.includes(action.tool)).map(action => action.id))
  if (stored && retired.size) raw.pages = raw.pages.map(page => ({ ...page, serverActions: page.serverActions?.filter(id => !retired.has(id)) }))
  const actionIds = new Set<string>()
  const serverActions = (raw.serverActions ?? []).filter(action => !stored || !retired.has(action.id)).map(action => {
    if (!action.id.startsWith(`${raw.id}.`) || !/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]{0,47}$/.test(action.id) || actionIds.has(action.id) || !appTools.includes(action.tool)) throw new PluginError('서버 작업 ID나 앱 도구 선언을 확인해줘.')
    actionIds.add(action.id)
    const schema = normalizeChatPageSchema(action.schema)
    if (schema.type !== 'object' || JSON.stringify(action.arguments ?? {}).length > 32000) throw new PluginError('서버 작업 입력 형식을 확인해줘.')
    return { ...action, schema, arguments: action.arguments as import('@conai/shared').PluginServerAction['arguments'] }
  })
  if (reserved.has(raw.id) || new Set(raw.pages.map((page) => page.id)).size !== raw.pages.length || new Set(raw.capabilities).size !== raw.capabilities.length) throw new PluginError('중복되거나 예약된 플러그인 ID야.')
  return { ...raw, appTools, serverActions, pages: raw.pages.map((page) => {
    pluginAssetName(page.entry)
    if (!page.entry.endsWith('.html')) throw new PluginError('페이지 진입 파일은 HTML이어야 해.')
    const ids = new Set<string>()
    const referenced = new Set(page.serverActions ?? [])
    if (referenced.size !== (page.serverActions ?? []).length || [...referenced].some(id => !actionIds.has(id))) throw new PluginError('페이지의 서버 작업 참조를 확인해줘.')
    const actions = [...page.actions.filter(action => !referenced.has(action.id)), ...serverActions.filter(action => referenced.has(action.id)).map(action => ({ id: action.id, label: action.label, description: action.description, schema: action.schema, effect: 'draft' as const, tier: pluginAppToolScope(action.tool, trusted) === 'read' ? 'view' as const : 'draft' as const }))]
    if (actions.length > 26) throw new PluginError('페이지 작업은 26개까지 등록할 수 있어.')
    return { ...page, actions: actions.map((action) => {
      if (!action.id.startsWith(`${raw.id}.`) || !/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]{0,47}$/.test(action.id) || ids.has(action.id)) throw new PluginError('페이지 작업 ID가 올바르지 않아.')
      ids.add(action.id)
      const schema = normalizeChatPageSchema(action.schema)
      if (schema.type !== 'object') throw new PluginError('작업 입력은 객체여야 해.')
      return { ...action, schema }
    }) }
  }) }
}
// Parsed manifests by package digest: asset requests and every tool call read them, the app tool policy only
// changes with a restart, and a digest never changes under the same install.
const definitions = new Map<string, PluginManifest>()
function definitionOf(row: Row) {
  const key = `${row.id}:${row.digest}`
  let definition = definitions.get(key)
  if (!definition) {
    if (definitions.size >= 200) definitions.clear()
    definition = parsePluginManifest(JSON.parse(row.manifest), true)
    definitions.set(key, definition)
  }
  return definition
}
function pluginRow(id: string) {
  pluginIdSchema.parse(id)
  const row = pluginDb().prepare('SELECT * FROM plugins WHERE id = ?').get(id) as Row | undefined
  if (!row) throw new PluginError('플러그인이 없거나 비활성화됐어.', 404)
  return row
}
export function getPlugin(id: string, enabled = true) {
  const row = pluginRow(id)
  if (enabled && !row.enabled) throw new PluginError('플러그인이 없거나 비활성화됐어.', 404)
  return { ...row, definition: definitionOf(row) }
}
export function listPlugins(includeDisabled = false): InstalledPlugin[] {
  const rows = pluginDb().prepare(`SELECT * FROM plugins ${includeDisabled ? '' : 'WHERE enabled = 1'} ORDER BY id LIMIT 100`).all() as Row[]
  return rows.flatMap((row): InstalledPlugin[] => {
    try { return [{ manifest: definitionOf(row), enabled: !!row.enabled, installedAt: row.installed_at }] } catch {
      // One unreadable package must not hide the others; management still lists it so it can be removed.
      if (!includeDisabled) return []
      return [{ manifest: { apiVersion: 1, id: row.id, name: row.id, version: row.version, description: '설치 정보를 읽을 수 없어. 제거한 뒤 다시 설치해줘.', capabilities: [], appTools: [], serverActions: [], pages: [] }, enabled: false, installedAt: row.installed_at }]
    }
  })
}
/** Turning a package off (or removing it) closes its windows and drops what it left waiting: review cards, unapproved app requests, running jobs. */
export async function setPluginEnabled(id: string, enabled: boolean, accountId?: number | null) {
  pluginRow(id)
  if (enabled) getPlugin(id, false)
  const db = pluginDb()
  const running = enabled ? [] : db.prepare("SELECT job_id FROM plugin_app_requests WHERE plugin_id = ? AND status IN ('starting','running') AND job_id IS NOT NULL").all(id) as Array<{ job_id: string }>
  db.transaction(() => {
    db.prepare('UPDATE plugins SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
    if (enabled && accountId !== undefined) db.prepare('UPDATE plugins SET enabled_by = ? WHERE id = ?').run(accountId, id)
    db.prepare('DELETE FROM plugin_proposals WHERE instance_id IN (SELECT id FROM plugin_instances WHERE plugin_id = ?)').run(id)
    db.prepare('DELETE FROM plugin_instances WHERE plugin_id = ?').run(id)
    if (!enabled) db.prepare("UPDATE plugin_app_requests SET status = 'cancelled' WHERE plugin_id = ? AND status = 'pending'").run(id)
  })()
  for (const { job_id } of running) RuntimeJobRunner.cancel(job_id)
  await pluginChanged(id)
}
/** `parts` under the data root, never following a link or junction. null when a part is missing and `missing` is 'null'. */
function walkPackagePath(parts: string[], missing: 'null' | 'throw' = 'throw') {
  let current = path.resolve(runtimePaths.basePath)
  for (const part of parts) {
    current = path.join(current, part)
    let stat: fs.Stats
    try { stat = fs.lstatSync(current) }
    catch (error) {
      if (missing === 'null' && (error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new PluginError('패키지 파일을 찾을 수 없어.', 404)
    }
    if (stat.isSymbolicLink()) throw new PluginError('링크된 설치 경로는 사용할 수 없어.', 403)
  }
  return current
}
/** Never follow an administrator accidentally placing a package or root behind a junction. */
export function packageFile(id: string, version: string, asset: string) {
  pluginIdSchema.parse(id)
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw new PluginError('잘못된 패키지 버전이야.')
  const current = walkPackagePath(['plugins', 'packages', id, version, ...pluginAssetName(asset).split('/')])!
  const stat = fs.statSync(current)
  if (!stat.isFile() || stat.nlink > 1 || stat.size > MAX_FILE) throw new PluginError('패키지 파일이 올바르지 않아.')
  return current
}
/** Inspect names and declared sizes before bounded decompression; never extract executable install hooks. */
export function unpackPlugin(zipBytes: Buffer) {
  if (!zipBytes.length || zipBytes.length > PLUGIN_ZIP_LIMIT) throw new PluginError('패키지는 8MB까지 설치할 수 있어.', 413)
  const entries = new AdmZip(zipBytes).getEntries()
  if (!entries.length || entries.length > 256) throw new PluginError('패키지 파일 개수는 1~256개여야 해.')
  const assets = new Map<string, Buffer>()
  const names = new Set<string>()
  let total = 0
  for (const entry of entries) {
    const name = pluginAssetName(entry.entryName.replace(/\/$/, ''))
    const lower = name.toLowerCase()
    const kind = zipEntryKind(entry)
    if (names.has(lower) || !kind) throw new PluginError('중복·암호화·링크 파일은 설치할 수 없어.')
    names.add(lower)
    if (kind === 'folder') continue
    if (!allowedAssets.has(path.extname(name).toLowerCase()) || entry.header.size > MAX_FILE || (total += entry.header.size) > MAX_TOTAL) throw new PluginError('지원하지 않는 파일이거나 압축 해제 크기가 너무 커.')
    const bytes = zipEntryBytes(entry, MAX_FILE)
    if (!bytes) throw new PluginError('패키지 압축 정보가 올바르지 않아.')
    assets.set(name, bytes)
  }
  // A file also used as a folder ("a" and "a/b") can't be written out.
  for (const name of assets.keys()) {
    const parts = name.split('/')
    if (parts.slice(0, -1).some((_, index) => assets.has(parts.slice(0, index + 1).join('/')))) throw new PluginError('파일과 같은 이름의 폴더가 있어.')
  }
  const manifestBytes = assets.get('plugin.json')
  if (!manifestBytes || manifestBytes.length > 128_000) throw new PluginError('루트에 plugin.json이 필요해.')
  const manifest = parsePluginManifest(JSON.parse(manifestBytes.toString('utf8')))
  for (const page of manifest.pages) if (!assets.has(page.entry)) throw new PluginError(`페이지 파일이 없어: ${page.entry}`)
  if (manifest.server && !assets.has(manifest.server.entry)) throw new PluginError(`서버 모듈 파일이 없어: ${manifest.server.entry}`)
  return { manifest, assets }
}
/** What a new version asks for beyond the installed one; enabling it again is the person's call. */
function widens(previous: PluginManifest, next: PluginManifest) {
  return next.capabilities.some(capability => !previous.capabilities.includes(capability))
    || (next.appTools ?? []).some(tool => !(previous.appTools ?? []).includes(tool))
}
/**
 * A new package, or a new version of an installed one (same id): files are swapped in place, the plugin's data folder
 * stays, open windows close and waiting requests are cancelled. A version asking for more than before is turned off.
 */
export async function installPlugin(zipBytes: Buffer): Promise<{ plugin: InstalledPlugin; updated: boolean; reenable: boolean }> {
  let unpacked: ReturnType<typeof unpackPlugin>
  try { unpacked = unpackPlugin(zipBytes) }
  catch (error) {
    if (error instanceof PluginError || error instanceof z.ZodError) throw error
    throw new PluginError('ZIP 패키지 또는 manifest 형식이 올바르지 않아.')
  }
  const { manifest, assets } = unpacked
  const db = pluginDb()
  const digest = createHash('sha256').update(zipBytes).digest('hex')
  const existing = db.prepare('SELECT * FROM plugins WHERE id = ?').get(manifest.id) as Row | undefined
  if (existing?.digest === digest) throw new PluginError('같은 패키지가 이미 설치돼 있어.', 409)
  if (!existing && (db.prepare('SELECT COUNT(*) AS n FROM plugins').get() as { n: number }).n >= 100) throw new PluginError('플러그인은 100개까지 설치할 수 있어.')
  let previous: PluginManifest | null = null
  if (existing) { try { previous = definitionOf(existing) } catch { previous = null } }
  const reenable = !!existing?.enabled && (!previous || widens(previous, manifest))
  // Create/check each ancestor, including the private data root's children.
  let parent = runtimePaths.basePath
  for (const part of ['plugins', 'packages', manifest.id]) {
    parent = path.join(parent, part)
    fs.mkdirSync(parent, { recursive: true })
    if (fs.lstatSync(parent).isSymbolicLink()) throw new PluginError('설치 경로에 링크가 있어.')
  }
  const directory = path.join(parent, manifest.version)
  if (!existing && fs.existsSync(directory)) throw new PluginError('패키지 경로가 이미 있어. 관리자에게 확인해줘.', 409)
  removeStaleStages(parent)
  const stage = path.join(parent, `.install-${randomBytes(12).toString('hex')}`)
  let retired: string | null = null
  let placed = false
  fs.mkdirSync(stage)
  try {
    for (const [name, bytes] of assets) {
      const target = path.join(stage, name)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, bytes, { flag: 'wx' })
    }
    // The same version again (a rebuilt package): the installed folder steps aside until the row points at the new one.
    if (fs.existsSync(directory)) {
      retired = path.join(parent, `.install-retired-${randomBytes(12).toString('hex')}`)
      fs.renameSync(directory, retired)
    }
    fs.renameSync(stage, directory)
    placed = true
    db.transaction(() => {
      if (existing) {
        db.prepare('UPDATE plugins SET version = ?, manifest = ?, digest = ?, enabled = ? WHERE id = ?').run(manifest.version, JSON.stringify(manifest), digest, reenable ? 0 : existing.enabled, manifest.id)
        db.prepare('DELETE FROM plugin_proposals WHERE instance_id IN (SELECT id FROM plugin_instances WHERE plugin_id = ?)').run(manifest.id)
        db.prepare('DELETE FROM plugin_instances WHERE plugin_id = ?').run(manifest.id)
        db.prepare("UPDATE plugin_app_requests SET status = 'cancelled' WHERE plugin_id = ? AND status = 'pending'").run(manifest.id)
      } else db.prepare('INSERT INTO plugins(id, version, manifest, digest) VALUES (?, ?, ?, ?)').run(manifest.id, manifest.version, JSON.stringify(manifest), digest)
    })()
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true })
    if (placed) fs.rmSync(directory, { recursive: true, force: true })
    if (retired) fs.renameSync(retired, directory)
    if (error instanceof PluginError) throw error
    // A raw fs error (an entry the disk refuses) is the package's fault, not a server error.
    console.warn('[plugins] install failed:', error)
    throw new PluginError('패키지 파일을 풀 수 없어. 파일 이름과 폴더 구조를 확인해줘.')
  }
  // The replaced files go once nothing points at them.
  if (retired) fs.rmSync(retired, { recursive: true, force: true })
  if (existing && existing.version !== manifest.version && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(existing.version)) {
    try {
      const old = walkPackagePath(['plugins', 'packages', manifest.id, existing.version], 'null')
      if (old) fs.rmSync(old, { recursive: true, force: true })
    } catch (error) { console.warn('[plugins] old version kept:', error) }
  }
  await pluginChanged(manifest.id)
  return { plugin: listPlugins(true).find((item) => item.manifest.id === manifest.id)!, updated: !!existing, reenable }
}
/** Staging folders a crash left behind (older than an hour, so a concurrent install keeps its own). */
function removeStaleStages(parent: string) {
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('.install-')) continue
    const stage = path.join(parent, entry.name)
    try { if (Date.now() - fs.lstatSync(stage).mtimeMs > 60 * 60_000) fs.rmSync(stage, { recursive: true, force: true }) } catch { /* gone already */ }
  }
}
export async function removePlugin(id: string) {
  // Works from the stored row alone: a manifest this version no longer reads must still be removable.
  const row = pluginRow(id)
  // Stops the server module too, so its database is closed before the data folder goes.
  await setPluginEnabled(id, false)
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(row.version)) throw new PluginError('설치 경로가 올바르지 않아.', 403)
  const directory = walkPackagePath(['plugins', 'packages', id, row.version], 'null')
  if (directory) {
    if (!fs.lstatSync(directory).isDirectory()) throw new PluginError('잘못된 설치 경로는 제거할 수 없어.', 403)
    fs.rmSync(directory, { recursive: true, force: true })
  }
  const db = pluginDb()
  db.transaction(() => {
    db.prepare('DELETE FROM plugins WHERE id = ?').run(id)
    db.prepare("DELETE FROM plugin_app_requests WHERE plugin_id = ? AND status NOT IN ('starting','running')").run(id)
  })()
  await pluginChanged(id)
  removePluginData(id)
  // The package's own folder goes too once no version and no staging is left in it.
  const folder = walkPackagePath(['plugins', 'packages', id], 'null')
  if (folder) {
    removeStaleStages(folder)
    try { if (!fs.readdirSync(folder).length) fs.rmdirSync(folder) } catch { /* kept: something still in it */ }
  }
}

export function requirePluginPage(page: Pick<ChatPageSnapshot, 'path'> & Partial<Pick<ChatPageSnapshot, 'resourceId'>>) {
  const match = /^\/ext\/([a-z][a-z0-9-]{1,47})\/([a-z][a-z0-9-]{1,47})$/.exec(page.path)
  if (!match) throw new PluginError('확장 페이지 경로가 올바르지 않아.', 403)
  const plugin = getPlugin(match[1])
  if (page.resourceId !== undefined && page.resourceId !== plugin.version) throw new PluginError('확장 버전이 바뀌었어.', 409)
  const definition = plugin.definition.pages.find((item) => item.id === match[2])
  if (!definition) throw new PluginError('등록되지 않은 확장 페이지야.', 403)
  return definition
}
export function validatePluginPageSnapshot(page: ChatPageSnapshot) {
  const definition = requirePluginPage(page)
  for (const action of page.actions ?? []) {
    if (action.id === 'page.navigate' || action.id === 'page.refresh') continue
    const registered = definition.actions.find((item) => item.id === action.id)
    if (!registered || JSON.stringify(normalizeChatPageActions(page.path, [registered])[0]) !== JSON.stringify(action)) throw new PluginError('설치된 확장 작업과 화면의 정의가 달라.', 403)
  }
}
export function requirePluginPageAction(page: Pick<ChatPageSnapshot, 'path'> & Partial<Pick<ChatPageSnapshot, 'resourceId'>>, id: string, args?: Record<string, unknown>) {
  const registered = requirePluginPage(page).actions.find((item) => item.id === id)
  if (!registered) throw new PluginError('등록되지 않은 확장 작업이야.', 403)
  if (args) validateChatPageArguments(registered.schema, args)
}
