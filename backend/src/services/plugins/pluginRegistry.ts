import fs from 'fs'
import path from 'path'
import { createHash, randomBytes } from 'crypto'
import { inflateRawSync } from 'zlib'
import AdmZip from 'adm-zip'
import { z } from 'zod'
import { normalizeChatPageSchema, normalizeChatPageActions, validateChatPageArguments, type ChatPageSnapshot, type PluginManifest, type InstalledPlugin } from '@conai/shared'
import { runtimePaths } from '../../config/runtimePaths'
import { pluginDb } from './pluginStore'

export class PluginError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
export const pluginIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/)
const reserved = new Set(['page', 'page-settings', 'files', 'workspace', 'library', 'settings', 'profile', 'resource', 'chat', 'audio', 'sprite', 'upload', 'posts', 'wallpaper', 'metadata', 'prompt', 'preset', 'wildcard', 'group', 'media', 'nai', 'comfy', 'workflow'])
const actionSchema = z.object({
  id: z.string().max(110), label: z.string().min(1).max(160), description: z.string().max(1000),
  effect: z.literal('draft'), tier: z.enum(['view', 'draft']), schema: z.unknown(),
}).strict()
const manifestSchema = z.object({
  apiVersion: z.literal(1), id: pluginIdSchema, name: z.string().min(1).max(100),
  version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/), description: z.string().max(1000),
  capabilities: z.array(z.enum(['files.read', 'files.write', 'files.media'])).max(3),
  pages: z.array(z.object({
    id: pluginIdSchema, title: z.string().min(1).max(160), entry: z.string().min(1).max(200),
    accepts: z.array(z.string().regex(/^\.[a-z0-9]{1,16}$/)).max(40), actions: z.array(actionSchema).max(26),
  }).strict()).min(1).max(12),
}).strict()
export const PLUGIN_ZIP_LIMIT = 8 * 1024 * 1024
const MAX_FILE = 4 * 1024 * 1024
const MAX_TOTAL = 16 * 1024 * 1024
const allowedAssets = new Set(['.html', '.js', '.mjs', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2'])
export const pluginPackagesRoot = path.join(runtimePaths.basePath, 'plugins', 'packages')
type Row = { id: string; version: string; manifest: string; digest: string; enabled: number; installed_at: string }

export function pluginAssetName(value: string): string {
  if (value.length > 200 || !value || value.split('/').some((part) => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part) || part.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new PluginError('패키지 경로가 올바르지 않아.')
  return value
}
export function parsePluginManifest(value: unknown): PluginManifest {
  const raw = manifestSchema.parse(value)
  if (reserved.has(raw.id) || new Set(raw.pages.map((page) => page.id)).size !== raw.pages.length || new Set(raw.capabilities).size !== raw.capabilities.length) throw new PluginError('중복되거나 예약된 플러그인 ID야.')
  return { ...raw, pages: raw.pages.map((page) => {
    pluginAssetName(page.entry)
    if (!page.entry.endsWith('.html')) throw new PluginError('페이지 진입 파일은 HTML이어야 해.')
    const ids = new Set<string>()
    return { ...page, actions: page.actions.map((action) => {
      if (!action.id.startsWith(`${raw.id}.`) || !/^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]{0,47}$/.test(action.id) || ids.has(action.id)) throw new PluginError('페이지 작업 ID가 올바르지 않아.')
      ids.add(action.id)
      const schema = normalizeChatPageSchema(action.schema)
      if (schema.type !== 'object') throw new PluginError('작업 입력은 객체여야 해.')
      return { ...action, schema }
    }) }
  }) }
}
export function getPlugin(id: string, enabled = true) {
  pluginIdSchema.parse(id)
  const row = pluginDb().prepare('SELECT * FROM plugins WHERE id = ?').get(id) as Row | undefined
  if (!row || (enabled && !row.enabled)) throw new PluginError('플러그인이 없거나 비활성화됐어.', 404)
  return { ...row, definition: parsePluginManifest(JSON.parse(row.manifest)) }
}
export function listPlugins(includeDisabled = false): InstalledPlugin[] {
  const rows = pluginDb().prepare(`SELECT * FROM plugins ${includeDisabled ? '' : 'WHERE enabled = 1'} ORDER BY id LIMIT 100`).all() as Row[]
  return rows.map((row) => ({ manifest: parsePluginManifest(JSON.parse(row.manifest)), enabled: !!row.enabled, installedAt: row.installed_at }))
}
export function setPluginEnabled(id: string, enabled: boolean) {
  getPlugin(id, false)
  pluginDb().transaction(() => {
    pluginDb().prepare('UPDATE plugins SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
    pluginDb().prepare('DELETE FROM plugin_proposals WHERE instance_id IN (SELECT id FROM plugin_instances WHERE plugin_id = ?)').run(id)
    pluginDb().prepare('DELETE FROM plugin_instances WHERE plugin_id = ?').run(id)
  })()
}
/** Never follow an administrator accidentally placing a package or root behind a junction. */
export function packageFile(id: string, version: string, asset: string) {
  pluginIdSchema.parse(id)
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version)) throw new PluginError('잘못된 패키지 버전이야.')
  let current = runtimePaths.basePath
  for (const part of ['plugins', 'packages', id, version, ...pluginAssetName(asset).split('/')]) {
    current = path.join(current, part)
    let stat: fs.Stats
    try { stat = fs.lstatSync(current) }
    catch { throw new PluginError('패키지 파일을 찾을 수 없어.', 404) }
    if (stat.isSymbolicLink()) throw new PluginError('링크된 패키지는 열 수 없어.', 403)
  }
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
    const type = (entry.attr >>> 16) & 0xf000
    if (names.has(lower) || (type && type !== 0x8000 && type !== 0x4000) || (entry.header.flags & 1)) throw new PluginError('중복·암호화·링크 파일은 설치할 수 없어.')
    names.add(lower)
    if (entry.isDirectory) continue
    if (!allowedAssets.has(path.extname(name).toLowerCase()) || entry.header.size > MAX_FILE || (total += entry.header.size) > MAX_TOTAL) throw new PluginError('지원하지 않는 파일이거나 압축 해제 크기가 너무 커.')
    const compressed = entry.getCompressedData()
    const bytes = entry.header.method === 0 ? compressed : entry.header.method === 8 ? inflateRawSync(compressed, { maxOutputLength: MAX_FILE }) : null
    if (!bytes || bytes.length !== entry.header.size) throw new PluginError('패키지 압축 정보가 올바르지 않아.')
    assets.set(name, bytes)
  }
  const manifestBytes = assets.get('plugin.json')
  if (!manifestBytes || manifestBytes.length > 128_000) throw new PluginError('루트에 plugin.json이 필요해.')
  const manifest = parsePluginManifest(JSON.parse(manifestBytes.toString('utf8')))
  for (const page of manifest.pages) if (!assets.has(page.entry)) throw new PluginError(`페이지 파일이 없어: ${page.entry}`)
  return { manifest, assets }
}
export function installPlugin(zipBytes: Buffer): InstalledPlugin {
  let unpacked: ReturnType<typeof unpackPlugin>
  try { unpacked = unpackPlugin(zipBytes) }
  catch (error) {
    if (error instanceof PluginError || error instanceof z.ZodError) throw error
    throw new PluginError('ZIP 패키지 또는 manifest 형식이 올바르지 않아.')
  }
  const { manifest, assets } = unpacked
  const db = pluginDb()
  if (db.prepare('SELECT 1 FROM plugins WHERE id = ?').get(manifest.id)) throw new PluginError('같은 ID가 설치되어 있어. 제거한 뒤 새 버전을 설치해줘.', 409)
  if ((db.prepare('SELECT COUNT(*) AS n FROM plugins').get() as { n: number }).n >= 100) throw new PluginError('플러그인은 100개까지 설치할 수 있어.')
  const directory = path.join(pluginPackagesRoot, manifest.id, manifest.version)
  // Create/check each ancestor, including the private data root's children.
  let parent = runtimePaths.basePath
  for (const part of ['plugins', 'packages', manifest.id]) {
    parent = path.join(parent, part)
    fs.mkdirSync(parent, { recursive: true })
    if (fs.lstatSync(parent).isSymbolicLink()) throw new PluginError('설치 경로에 링크가 있어.')
  }
  if (fs.existsSync(directory)) throw new PluginError('패키지 경로가 이미 있어. 관리자에게 확인해줘.', 409)
  const stage = path.join(parent, `.install-${randomBytes(12).toString('hex')}`)
  fs.mkdirSync(stage)
  try {
    for (const [name, bytes] of assets) {
      const target = path.join(stage, name)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, bytes, { flag: 'wx' })
    }
    fs.renameSync(stage, directory)
    db.prepare('INSERT INTO plugins(id, version, manifest, digest) VALUES (?, ?, ?, ?)').run(manifest.id, manifest.version, JSON.stringify(manifest), createHash('sha256').update(zipBytes).digest('hex'))
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true })
    if (fs.existsSync(directory) && !db.prepare('SELECT 1 FROM plugins WHERE id = ?').get(manifest.id)) fs.rmSync(directory, { recursive: true, force: true })
    throw error
  }
  return listPlugins(true).find((item) => item.manifest.id === manifest.id)!
}
export function removePlugin(id: string) {
  const plugin = getPlugin(id, false)
  setPluginEnabled(id, false)
  // A damaged/missing manifest must not make a registered package impossible to remove.
  // Validate the directory ancestors independently and never traverse a junction during deletion.
  const directory = path.resolve(pluginPackagesRoot, id, plugin.version)
  const relative = path.relative(path.resolve(runtimePaths.basePath), directory)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new PluginError('설치 경로가 올바르지 않아.', 403)
  let current = path.resolve(runtimePaths.basePath)
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    let stat: fs.Stats
    try { stat = fs.lstatSync(current) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error }
    if (stat.isSymbolicLink() || (current !== directory && !stat.isDirectory())) throw new PluginError('링크되거나 잘못된 설치 경로는 제거할 수 없어.', 403)
  }
  fs.rmSync(directory, { recursive: true, force: true })
  pluginDb().prepare('DELETE FROM plugins WHERE id = ?').run(id)
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
