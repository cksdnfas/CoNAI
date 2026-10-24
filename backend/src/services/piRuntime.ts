import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import type { AgentCliStatus, AgentCliVersion } from '@conai/shared'
import { runtimePaths } from '../config/runtimePaths'
import { compareCodexVersions } from './codexGenerationExecutor'
import { resolveNpmCommand, runProcess, tail } from './codexCliMaintenance'

/**
 * The pi agent SDK that pi chats run in-process (piChatCompletion.ts): the bundled package is the app's dependency;
 * an update from Settings › LLM installs a newer one into the runtime data, and the newer of the two is loaded.
 */
const PACKAGE = '@earendil-works/pi-coding-agent'
const VERSION = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/
const LATEST_CACHE_MS = 3600000
type PiSdk = typeof import('@earendil-works/pi-coding-agent')
type PiInstall = { dir: string; version: string; managed: boolean }

// tsc turns `import()` into `require()` for CommonJS output, and pi is an ES module only: keep a real dynamic import.
const importModule = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>
let sdk: Promise<PiSdk> | null = null
let loadError: string | null = null
let updating = false
let activeRuns = 0
let latestCache: { version: string | null; message: string | null; checkedAt: number } | null = null

/**
 * App-installed pi updates, kept with the runtime data so an app reinstall or image upgrade keeps them. Each update
 * goes to a folder of its own: Node caches an ES module by its URL, so a package replaced in place would not load anew.
 */
export function piManagedRoot() {
  return path.join(runtimePaths.basePath, 'pi-runtime')
}

function managedInstalls() {
  const root = piManagedRoot()
  let names: string[] = []
  try { names = fs.readdirSync(root) } catch { return [] }
  return names.sort().flatMap((name) => {
    const install = readInstall(path.join(root, name, 'node_modules', PACKAGE), true)
    return install ? [{ ...install, prefix: path.join(root, name) }] : []
  })
}

function readInstall(dir: string, managed: boolean): PiInstall | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return pkg.name === PACKAGE && typeof pkg.version === 'string' ? { dir, version: pkg.version, managed } : null
  } catch { return null }
}

/** The newer of the bundled package and the app-managed update. */
export function resolvePiInstall(): PiInstall | null {
  const bundled = (require.resolve.paths(PACKAGE) ?? []).map((root) => readInstall(path.join(root, PACKAGE), false)).find((install) => install !== null) ?? null
  // Folders sort by install time: the last of equal versions is the latest install.
  const managed = managedInstalls().reduce<PiInstall | null>((best, install) => !best || compareCodexVersions(install.version, best.version) >= 0 ? install : best, null)
  if (!bundled || !managed) return bundled ?? managed
  return compareCodexVersions(managed.version, bundled.version) > 0 ? managed : bundled
}

function entryUrl(install: PiInstall) {
  const pkg = JSON.parse(fs.readFileSync(path.join(install.dir, 'package.json'), 'utf8'))
  const root = pkg.exports?.['.']
  const entry = typeof root === 'string' ? root : root?.import ?? pkg.main
  if (typeof entry !== 'string') throw new Error('pi 패키지의 시작 파일을 찾지 못했어.')
  return pathToFileURL(path.resolve(install.dir, entry)).href
}

export function loadPiSdk(): Promise<PiSdk> {
  if (updating) return Promise.reject(new Error('pi 업데이트가 진행 중이야. 완료 후 다시 시도해줘.'))
  if (!sdk) {
    const promise: Promise<PiSdk> = (async () => {
      const install = resolvePiInstall()
      if (!install) throw new Error('pi 패키지를 찾지 못했어.')
      return await importModule(entryUrl(install)) as PiSdk
    })().then((loaded) => { loadError = null; return loaded }, (error: unknown) => {
      if (sdk === promise) sdk = null
      loadError = `pi 런타임을 불러오지 못했어: ${error instanceof Error ? error.message : String(error)}`
      throw new Error(loadError)
    })
    sdk = promise
  }
  return sdk
}

/** Holds off an update while a pi run uses the loaded package; call the returned function when the run ends. */
export function reservePiRun() {
  if (updating) throw new Error('pi 업데이트가 진행 중이야. 완료 후 다시 시도해줘.')
  activeRuns++
  let released = false
  return () => { if (!released) { released = true; activeRuns-- } }
}

/** `check` loads the SDK (once per process) so a broken install shows; a passive poll only reads the package files. */
export async function getPiStatus(check = false): Promise<AgentCliStatus> {
  const install = resolvePiInstall()
  if (!install) return { installed: false, authenticated: false, available: false, authMethod: null, message: 'pi 패키지를 찾지 못했어. 설치해줘.' }
  if (check && !updating) await loadPiSdk().catch(() => {})
  return { installed: true, authenticated: false, available: !updating && !loadError, authMethod: null, message: loadError }
}

export async function getPiVersion(refresh = false): Promise<AgentCliVersion> {
  const current = resolvePiInstall()?.version ?? null
  if (refresh || !latestCache || Date.now() - latestCache.checkedAt > LATEST_CACHE_MS) {
    const npm = resolveNpmCommand()
    const result = await runProcess(npm.command, [...npm.prefixArgs, 'view', PACKAGE, 'version'], 30000, npm.shell)
    const version = result.code === 0 ? result.stdout.match(VERSION)?.[1] ?? null : null
    latestCache = { version, message: version ? null : '최신 pi 버전을 확인하지 못했어.', checkedAt: Date.now() }
  }
  return {
    current, latest: latestCache.version,
    updateAvailable: Boolean(current && latestCache.version && compareCodexVersions(latestCache.version, current) > 0),
    updating, installTarget: 'prefix', message: latestCache.message,
  }
}

/**
 * `npm install --prefix <runtime>/pi-runtime/<time> pi@latest`; refused while a pi run is going. The next run loads
 * it; earlier app-installed folders are removed once the new one is in place.
 */
export async function updatePi(): Promise<AgentCliVersion> {
  if (updating || activeRuns) throw new Error('진행 중인 pi 채팅이나 업데이트가 끝난 뒤 업데이트해줘.')
  updating = true
  const prefix = path.join(piManagedRoot(), String(Date.now()))
  try {
    fs.mkdirSync(prefix, { recursive: true })
    const npm = resolveNpmCommand()
    const result = await runProcess(npm.command, [...npm.prefixArgs, 'install', '--prefix', prefix, '--no-audit', '--no-fund', `${PACKAGE}@latest`], 600000, npm.shell)
    if (result.code !== 0 || !readInstall(path.join(prefix, 'node_modules', PACKAGE), true)) {
      fs.rmSync(prefix, { recursive: true, force: true })
      throw new Error(result.timedOut ? 'pi 업데이트가 시간 안에 끝나지 않았어.' : tail(`${result.stdout}\n${result.stderr}`) || 'pi 설치/업데이트에 실패했어. 서버의 npm과 네트워크를 확인해줘.')
    }
    // A folder still held open (Windows) stays until a later update; it is never loaded again, the newest one wins.
    for (const install of managedInstalls()) if (install.prefix !== prefix) try { fs.rmSync(install.prefix, { recursive: true, force: true }) } catch { /* left for later */ }
  } finally { updating = false; latestCache = null; sdk = null; loadError = null }
  // Load it now, so a package that does not load shows in the status at once rather than at the next chat.
  await loadPiSdk().catch(() => {})
  return getPiVersion()
}
