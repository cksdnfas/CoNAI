import { randomBytes } from 'node:crypto'
import AdmZip from 'adm-zip'
import { z } from 'zod'
import type { PluginInstallResult, PluginSource, PluginSourceCheck, PluginSourceProvider, PluginSourceReview } from '@conai/shared'
import { zipEntryBytes, zipEntryKind } from '../../utils/zipEntries'
import { pluginDb, PluginError } from './pluginStore'
import { installPlugin, listPlugins, pluginAssetAllowed, pluginAssetName, pluginIdSchema, PLUGIN_PACKAGE_LIMITS, readInstalledPluginAssets } from './pluginRegistry'
import { packageFileChanges, packagePluginAssets, sdkAssets } from './pluginAuthoring'

/**
 * Plugins installed from public Git repositories over the hosts' HTTPS APIs (no git binary). Reviewing downloads the
 * archive of one resolved commit and builds the package; only an administrator's apply installs it. Update checks
 * resolve the ref to a commit and never download or install.
 */
const ARCHIVE_LIMIT = 32 * 1024 * 1024
const API_LIMIT = 2 * 1024 * 1024
const REVIEW_MS = 10 * 60_000
const REVIEW_LIMIT = 8
const CHECK_CONCURRENCY = 4
const USER_AGENT = 'CoNAI-plugin-installer'
const KNOWN_HOSTS: Record<string, PluginSourceProvider> = { 'github.com': 'github', 'gitlab.com': 'gitlab', 'codeberg.org': 'gitea' }
const SDK_NAMES = new Set(['conai-plugin.js', 'conai-plugin.css'])
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/

/** GET one URL's body. Production uses the public-address-only downloader; tests inject a fake. */
export type PluginSourceFetch = (url: string, options: { accept: string; maxBytes: number; signal?: AbortSignal }) => Promise<Buffer>
const publicFetch: PluginSourceFetch = async (url, options) => {
  const { download } = await import('../codex-chat/chatCardAssets')
  const result = await download(url, undefined, { ...options, userAgent: USER_AGENT })
  // download() also follows http: redirects; a package never comes over plain HTTP.
  if (new URL(result.finalUrl).protocol !== 'https:') throw new Error('HTTPS가 아닌 주소로 이동했어')
  return result.buffer
}

export const pluginSourceInputSchema = z.object({
  url: z.string().max(500), provider: z.enum(['github', 'gitlab', 'gitea']).optional(),
  ref: z.string().max(200).optional(), path: z.string().max(200).optional(),
}).strict()
export const pluginSourceInstallSchema = z.object({ reviewId: z.string().regex(/^[a-f0-9]{32}$/), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
export const pluginSourceCheckSchema = z.object({ pluginId: z.lazy(() => pluginIdSchema).optional() }).strict()

type Repository = { url: string; provider: PluginSourceProvider; host: string; segments: string[] }
type SourceRow = { plugin_id: string; url: string; provider: PluginSourceProvider; ref: string; path: string; commit_sha: string; digest: string; latest_commit: string | null; checked_at: string | null; check_error: string | null }
type Review = { expiresAt: number; bytes: Buffer; digest: string; baseDigest: string | null; enabled: boolean; pluginId: string; source: PluginSourceReview['source'] }
const reviews = new Map<string, Review>()

function parseRepository(url: string, provider?: PluginSourceProvider): Repository {
  let target: URL
  try { target = new URL(url.trim()) } catch { throw new PluginError('저장소 주소를 https://호스트/소유자/저장소 형식으로 입력해줘.') }
  const segments = target.pathname.replace(/\/+$/, '').replace(/\.git$/i, '').split('/').slice(1)
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash || segments.length < 2 || segments.some(part => !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(part))) {
    throw new PluginError('저장소 주소를 https://호스트/소유자/저장소 형식으로 입력해줘.')
  }
  const host = target.host.toLowerCase()
  const known = KNOWN_HOSTS[host]
  if (known && provider && provider !== known) throw new PluginError(`${host} 저장소의 호스트 종류는 ${known}이야.`)
  const resolved = known ?? provider
  if (!resolved) throw new PluginError('이 주소의 호스트 종류(GitLab 또는 Gitea/Forgejo)를 골라줘.')
  if (resolved === 'github' && !known) throw new PluginError('GitHub 저장소는 github.com 주소만 지원해.')
  if (resolved !== 'gitlab' && segments.length !== 2) throw new PluginError('저장소 주소는 https://호스트/소유자/저장소 형식이어야 해.')
  return { url: `https://${host}/${segments.join('/')}`, provider: resolved, host, segments }
}
function checkRef(ref: unknown, message = '브랜치·태그 이름이 올바르지 않아.') {
  if (typeof ref !== 'string' || ref.length > 200 || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(ref) || ref.includes('..') || ref.includes('//') || /[/.]$/.test(ref) || ref.endsWith('.lock')) throw new PluginError(message)
  return ref
}
function folderPath(value: string | undefined) {
  const folder = (value ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!folder) return ''
  try { return pluginAssetName(folder) } catch { throw new PluginError('플러그인 폴더 경로가 올바르지 않아.') }
}
function endpoints(repo: Repository) {
  const [owner, name] = repo.segments.map(encodeURIComponent)
  if (repo.provider === 'github') {
    const base = `https://api.github.com/repos/${owner}/${name}`
    return { info: base, commit: (ref: string) => `${base}/commits/${ref.split('/').map(encodeURIComponent).join('/')}`, archive: (sha: string) => `${base}/zipball/${sha}` }
  }
  if (repo.provider === 'gitlab') {
    const base = `https://${repo.host}/api/v4/projects/${encodeURIComponent(repo.segments.join('/'))}`
    return { info: base, commit: (ref: string) => `${base}/repository/commits/${encodeURIComponent(ref)}`, archive: (sha: string) => `${base}/repository/archive.zip?sha=${sha}` }
  }
  const base = `https://${repo.host}/api/v1/repos/${owner}/${name}`
  return { info: base, commit: (ref: string) => `${base}/git/commits/${encodeURIComponent(ref)}?stat=false&verification=false&files=false`, archive: (sha: string) => `${base}/archive/${sha}.zip` }
}
async function get(fetch: PluginSourceFetch, url: string, accept: string, maxBytes: number, signal?: AbortSignal) {
  try { return await fetch(url, { accept, maxBytes, signal }) }
  catch (error) {
    if (signal?.aborted) throw error
    const message = error instanceof Error ? error.message : String(error)
    const status = Number(/^HTTP (\d{3})$/.exec(message)?.[1])
    if (status === 404 || status === 422) throw new PluginError('저장소나 브랜치·태그를 찾을 수 없어. 공개 저장소 주소와 이름을 확인해줘.', 404)
    if (status === 403 || status === 429) throw new PluginError('저장소 호스트의 요청 한도에 걸렸어. 잠시 뒤에 다시 해줘.', 429)
    if (message === 'too large') throw new PluginError(maxBytes === ARCHIVE_LIMIT ? '저장소 압축 파일이 32MB를 넘어.' : '저장소 호스트의 응답이 너무 커.', 413)
    if (message === 'private address') throw new PluginError('공개 인터넷의 HTTPS 저장소만 쓸 수 있어. 사설·로컬 주소는 지원하지 않아.')
    throw new PluginError(`저장소 호스트에 연결하지 못했어: ${message.slice(0, 200)}`, 502)
  }
}
async function json(fetch: PluginSourceFetch, url: string, signal?: AbortSignal) {
  const body = await get(fetch, url, 'application/json', API_LIMIT, signal)
  try { return JSON.parse(body.toString('utf8')) as Record<string, unknown> | null } catch { throw new PluginError('저장소 호스트의 응답을 읽을 수 없어.', 502) }
}
async function resolveCommit(fetch: PluginSourceFetch, repo: Repository, ref: string, signal?: AbortSignal) {
  const url = endpoints(repo).commit(ref)
  const commit = repo.provider === 'github'
    ? (await get(fetch, url, 'application/vnd.github.sha', API_LIMIT, signal)).toString('utf8').trim()
    : (await json(fetch, url, signal))?.[repo.provider === 'gitlab' ? 'id' : 'sha']
  if (typeof commit !== 'string' || !SHA.test(commit)) throw new PluginError('저장소 호스트가 커밋을 알려주지 않았어.', 502)
  return commit
}

/** The plugin folder of a repository archive as a package, built like scripts/build-plugin.mjs with the host's SDK. */
export function packageRepositoryArchive(archive: Buffer, folder: string) {
  let entries: ReturnType<AdmZip['getEntries']>
  try { entries = new AdmZip(archive).getEntries() } catch { throw new PluginError('저장소 압축 파일을 읽을 수 없어.', 502) }
  const top = entries[0]?.entryName.split('/')[0]
  if (!top || entries.some(entry => !entry.entryName.startsWith(`${top}/`))) throw new PluginError('저장소 압축 파일의 구조가 올바르지 않아.', 502)
  const prefix = `${top}/${folder ? `${folder}/` : ''}`
  const assets = new Map<string, Buffer>()
  const skipped: string[] = []
  let total = 0, files = 0, found = false
  for (const entry of entries) {
    if (!entry.entryName.startsWith(prefix)) continue
    found = true
    const name = entry.entryName.slice(prefix.length).replace(/\/$/, '')
    if (!name) continue
    const parts = name.split('/')
    if (name.includes('\\') || parts.some(part => !part || part === '.' || part === '..')) throw new PluginError(`허용하지 않는 경로가 저장소에 있어: ${name.slice(0, 200)}`)
    const kind = zipEntryKind(entry)
    let allowed = false
    try { allowed = pluginAssetAllowed(name) } catch { /* a name a package can't hold */ }
    // Dot-files and folders, Markdown and other files a package can't hold stay out, like the local build script.
    if (parts.some(part => part.startsWith('.')) || (kind === 'file' && (/\.md$/i.test(name) || !allowed))) {
      if (kind !== 'folder' && skipped.length < 50) skipped.push(name.slice(0, 200))
      continue
    }
    if (!kind) throw new PluginError(`링크·암호화된 파일은 설치할 수 없어: ${name.slice(0, 200)}`)
    if (kind === 'folder' || (parts.length === 1 && SDK_NAMES.has(name.toLowerCase()))) continue
    if (++files > PLUGIN_PACKAGE_LIMITS.entries) throw new PluginError('패키지 파일은 256개까지 담을 수 있어.', 413)
    if (entry.header.size > PLUGIN_PACKAGE_LIMITS.file || (total += entry.header.size) > PLUGIN_PACKAGE_LIMITS.total) throw new PluginError(`패키지 파일 크기 제한을 넘었어: ${name}`, 413)
    const bytes = zipEntryBytes(entry, PLUGIN_PACKAGE_LIMITS.file)
    if (!bytes) throw new PluginError(`저장소 압축 정보가 올바르지 않아: ${name}`, 502)
    assets.set(name, bytes)
  }
  if (!found) throw new PluginError(`저장소에 플러그인 폴더가 없어: ${folder}`, 404)
  if (!assets.has('plugin.json')) throw new PluginError(folder ? `${folder} 폴더에 plugin.json이 없어. 플러그인 폴더를 확인해줘.` : '저장소 루트에 plugin.json이 없어. 플러그인 폴더를 지정해줘.')
  for (const [name, bytes] of sdkAssets()) assets.set(name, bytes)
  try { return { ...packagePluginAssets(assets), assets, skipped } }
  catch (error) {
    if (error instanceof PluginError || error instanceof z.ZodError) throw error
    throw new PluginError('plugin.json 형식이 올바르지 않아.')
  }
}

function toSource(row: SourceRow & { installed: string }): PluginSource {
  return {
    url: row.url, provider: row.provider, ref: row.ref, path: row.path, commit: row.commit_sha, modified: row.installed !== row.digest,
    latestCommit: row.latest_commit, checkedAt: row.checked_at, checkError: row.check_error,
    updateAvailable: row.latest_commit !== null && row.latest_commit !== row.commit_sha,
  }
}
/** Git links of installed plugins (one or all), for administrator responses. */
export function listPluginSources(pluginId?: string) {
  const rows = pluginDb().prepare(`SELECT s.*, p.digest AS installed FROM plugin_sources s JOIN plugins p ON p.id = s.plugin_id ${pluginId ? 'WHERE s.plugin_id = ?' : ''}`).all(...(pluginId ? [pluginId] : [])) as Array<SourceRow & { installed: string }>
  return new Map(rows.map(row => [row.plugin_id, toSource(row)]))
}

/** Download and build the package of the ref's current commit; nothing is installed. */
export async function reviewPluginSource(value: unknown, signal?: AbortSignal, fetch: PluginSourceFetch = publicFetch): Promise<PluginSourceReview> {
  const input = pluginSourceInputSchema.parse(value)
  const repo = parseRepository(input.url, input.provider)
  const folder = folderPath(input.path)
  const ref = input.ref?.trim() ? checkRef(input.ref.trim()) : checkRef((await json(fetch, endpoints(repo).info, signal))?.default_branch, '저장소 호스트가 기본 브랜치를 알려주지 않았어.')
  const commit = await resolveCommit(fetch, repo, ref, signal)
  const archive = await get(fetch, endpoints(repo).archive(commit), 'application/zip', ARCHIVE_LIMIT, signal)
  signal?.throwIfAborted()
  const built = packageRepositoryArchive(archive, folder)
  const pluginId = built.manifest.id
  const installed = pluginDb().prepare('SELECT digest, enabled FROM plugins WHERE id = ?').get(pluginId) as { digest: string; enabled: number } | undefined
  let previous = new Map<string, Buffer>()
  if (installed) try { previous = readInstalledPluginAssets(pluginId).assets } catch { /* an unreadable installation: every file shows as added */ }
  const link = pluginDb().prepare('SELECT url, ref, path FROM plugin_sources WHERE plugin_id = ?').get(pluginId) as { url: string; ref: string; path: string } | undefined
  const now = Date.now()
  for (const [id, review] of reviews) if (review.expiresAt <= now) reviews.delete(id)
  while (reviews.size >= REVIEW_LIMIT) reviews.delete(reviews.keys().next().value!)
  const reviewId = randomBytes(16).toString('hex')
  const source = { url: repo.url, provider: repo.provider, ref, path: folder, commit }
  const review: Review = { expiresAt: now + REVIEW_MS, bytes: built.bytes, digest: built.digest, baseDigest: installed?.digest ?? null, enabled: !!installed?.enabled, pluginId, source }
  reviews.set(reviewId, review)
  return {
    reviewId, expiresAt: review.expiresAt, source, pluginId, name: built.manifest.name, version: built.manifest.version,
    digest: built.digest, baseDigest: review.baseDigest, updated: !!installed, enabled: review.enabled, server: !!built.manifest.server, size: built.bytes.length,
    files: packageFileChanges(built.assets, previous), skipped: built.skipped,
    previousSource: link && (link.url !== source.url || link.ref !== ref || link.path !== folder) ? link : null,
  }
}

/** Install a reviewed package exactly as reviewed and link the plugin to its repository. Safe to retry. */
export async function installPluginSource(value: unknown): Promise<PluginInstallResult> {
  const input = pluginSourceInstallSchema.parse(value)
  const review = reviews.get(input.reviewId)
  if (!review || review.expiresAt <= Date.now()) throw new PluginError('검토가 만료됐어. 저장소를 다시 검토해줘.', 410)
  if (review.digest !== input.digest) throw new PluginError('검토한 패키지와 내용이 달라. 다시 검토해줘.', 409)
  const current = pluginDb().prepare('SELECT digest, enabled FROM plugins WHERE id = ?').get(review.pluginId) as { digest: string; enabled: number } | undefined
  let result: PluginInstallResult
  // A retry after a completed install (including a lost response) only makes sure of the link.
  if (current?.digest === review.digest) result = { plugin: listPlugins(true).find(plugin => plugin.manifest.id === review.pluginId)!, updated: review.baseDigest !== null, reenable: false }
  else {
    if ((current?.digest ?? null) !== review.baseDigest) throw new PluginError('검토 뒤 설치된 플러그인이 바뀌었어. 다시 검토해줘.', 409)
    if (!!current?.enabled !== review.enabled) throw new PluginError('검토 뒤 플러그인의 활성 상태가 바뀌었어. 다시 검토해줘.', 409)
    result = await installPlugin(review.bytes, review.baseDigest)
  }
  const { url, provider, ref, path, commit } = review.source
  // Only while the plugin still holds this build: a removal or another install during the restart leaves no stale link.
  pluginDb().prepare(`INSERT INTO plugin_sources(plugin_id, url, provider, ref, path, commit_sha, digest, latest_commit, checked_at, check_error)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM plugins WHERE id = ? AND digest = ?)
    ON CONFLICT(plugin_id) DO UPDATE SET url = excluded.url, provider = excluded.provider, ref = excluded.ref, path = excluded.path, commit_sha = excluded.commit_sha,
    digest = excluded.digest, latest_commit = excluded.latest_commit, checked_at = excluded.checked_at, check_error = NULL`)
    .run(review.pluginId, url, provider, ref, path, commit, review.digest, commit, new Date().toISOString(), review.pluginId, review.digest)
  return result
}

/** Resolve each linked plugin's ref to its current commit and remember it; never downloads or installs. */
export async function checkPluginSources(value: unknown, signal?: AbortSignal, fetch: PluginSourceFetch = publicFetch): Promise<PluginSourceCheck[]> {
  const { pluginId } = pluginSourceCheckSchema.parse(value ?? {})
  const rows = pluginDb().prepare(`SELECT * FROM plugin_sources ${pluginId ? 'WHERE plugin_id = ?' : ''} ORDER BY plugin_id`).all(...(pluginId ? [pluginId] : [])) as SourceRow[]
  if (pluginId && !rows.length) throw new PluginError('Git 저장소에 연결된 플러그인이 아니야.', 404)
  // A link re-pointed while its check ran keeps its own state.
  const update = pluginDb().prepare('UPDATE plugin_sources SET latest_commit = coalesce(?, latest_commit), checked_at = ?, check_error = ? WHERE plugin_id = ? AND url = ? AND ref = ? AND path = ?')
  let next = 0
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++]
      signal?.throwIfAborted()
      let commit: string | null = null, error: string | null = null
      try { commit = await resolveCommit(fetch, parseRepository(row.url, row.provider), row.ref, signal) }
      catch (caught) {
        if (signal?.aborted) throw caught
        error = (caught instanceof Error ? caught.message : String(caught)).slice(0, 500)
      }
      update.run(commit, new Date().toISOString(), error, row.plugin_id, row.url, row.ref, row.path)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, rows.length) }, worker))
  const sources = listPluginSources(pluginId)
  return listPlugins(true).flatMap(plugin => {
    const source = sources.get(plugin.manifest.id)
    return source ? [{ pluginId: plugin.manifest.id, name: plugin.manifest.name, version: plugin.manifest.version, source }] : []
  })
}

/** Forget the repository; the installed plugin stays. */
export function unlinkPluginSource(pluginId: string) {
  pluginDb().prepare('DELETE FROM plugin_sources WHERE plugin_id = ?').run(pluginIdSchema.parse(pluginId))
}
