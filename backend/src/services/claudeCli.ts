import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import type { AgentCliStatus, AgentCliVersion, ClaudeLoginState, ClaudeModelList, ClaudeModelOption } from '@conai/shared'
import { runtimePaths } from '../config/runtimePaths'
import { compareCodexVersions, killCodexProcessTree, scheduleCodexProcessTimeout } from './codexGenerationExecutor'

const PACKAGE = '@anthropic-ai/claude-code'
const VERSION = /\b(\d+\.\d+\.\d+(?:-[\w.]+)?)\b/
let updating = false
let activeRequests = 0
let latestCache: { version: string | null; checkedAt: number } | null = null
let login: { child: ChildProcess; ready: Promise<void> } | null = null
let state: ClaudeLoginState = { status: 'idle', verificationUrl: null, expiresAt: null, message: null }
const MODEL_LIST_TTL_MS = 3600000
let modelCache: { value: ClaudeModelList; expiresAt: number } | null = null
let modelsInFlight: Promise<ClaudeModelList> | null = null

export function claudeConfigDir() {
  return path.resolve(process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), '.claude'))
}

/** Resolve the actual executable. Current npm packages install native binaries, older ones use cli.js. */
export function resolveClaudeCommand() {
  const prefix = process.env.CLAUDE_NPM_PREFIX?.trim()
  const roots = [
    ...(prefix ? [path.join(prefix, 'lib', 'node_modules'), path.join(prefix, 'node_modules')] : []),
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules')
      : path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules'),
  ]
  const installs = roots.flatMap((root) => {
    const dir = path.join(root, '@anthropic-ai', 'claude-code')
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
      const entry = path.resolve(dir, typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.claude)
      if (!fs.existsSync(entry)) return []
      return [{ command: entry.endsWith('.js') ? process.execPath : entry, prefixArgs: entry.endsWith('.js') ? [entry] : [], version: String(pkg.version) }]
    } catch { return [] }
  })
  const newest = installs.sort((a, b) => compareCodexVersions(b.version, a.version))[0]
  if (newest) return newest
  const native = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
  return { command: fs.existsSync(native) ? native : 'claude', prefixArgs: [] as string[], version: null }
}

/** Only explicit Claude credentials and essential OS variables reach the CLI; no host plugins or provider overrides. */
export function claudeEnvironment(configDir = claudeConfigDir(), credentials = true): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]
  if (credentials) {
    for (const key of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) if (process.env[key]?.trim()) env[key] = process.env[key]
  }
  return { ...env, CLAUDE_CONFIG_DIR: configDir, NO_COLOR: '1', DISABLE_UPDATES: '1', DISABLE_AUTOUPDATER: '1' }
}

async function run(command: string, args: string[], timeoutMs: number, shell = false) {
  fs.mkdirSync(runtimePaths.tempDir, { recursive: true })
  return new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: runtimePaths.tempDir, env: claudeEnvironment(), windowsHide: true, shell, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    const timeout = scheduleCodexProcessTimeout(child, timeoutMs)
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-65536) })
    // Authentication output can contain secrets. Never expose stderr or raw login output in API responses.
    child.stderr.on('data', () => {})
    child.once('error', () => { timeout.clear(); reject(new Error('Claude Code CLI를 실행하지 못했어. 설치와 실행 경로를 확인해줘.')) })
    child.once('close', (code) => { timeout.clear(); timeout.timedOut ? reject(new Error('Claude Code 명령이 제한 시간을 초과했어.')) : resolve({ code, stdout }) })
  })
}

export async function getClaudeStatus(): Promise<AgentCliStatus> {
  const cli = resolveClaudeCommand()
  try {
    const result = await run(cli.command, [...cli.prefixArgs, 'auth', 'status', '--json'], 15000)
    let auth: { loggedIn?: unknown; authMethod?: unknown } = {}
    try { auth = JSON.parse(result.stdout) } catch { /* fail closed */ }
    const authenticated = result.code === 0 && auth.loggedIn === true
    return { installed: true, authenticated, available: authenticated && !updating, authMethod: typeof auth.authMethod === 'string' ? auth.authMethod : null, message: authenticated ? null : 'Claude Code 로그인이 필요하거나 인증 상태를 확인하지 못했어.' }
  } catch {
    return { installed: false, authenticated: false, available: false, authMethod: null, message: 'Claude Code 설치 또는 실행 경로를 확인해줘.' }
  }
}

export async function getClaudeVersion(refresh = false): Promise<AgentCliVersion> {
  const cli = resolveClaudeCommand()
  const current = cli.version ?? await run(cli.command, [...cli.prefixArgs, '--version'], 15000).then((r) => r.code === 0 ? r.stdout.match(VERSION)?.[1] ?? null : null).catch(() => null)
  if (refresh || !latestCache || Date.now() - latestCache.checkedAt > 3600000) {
    const npm = npmCommand()
    const latest = await run(npm.command, [...npm.prefixArgs, 'view', PACKAGE, 'version'], 30000, npm.shell).then((r) => r.code === 0 ? r.stdout.match(VERSION)?.[1] ?? null : null).catch(() => null)
    latestCache = { version: latest, checkedAt: Date.now() }
  }
  return { current, latest: latestCache.version, updateAvailable: Boolean(current && latestCache.version && compareCodexVersions(latestCache.version, current) > 0), updating, installTarget: process.env.CLAUDE_NPM_PREFIX?.trim() ? 'prefix' : 'global', message: latestCache.version ? null : '최신 Claude Code 버전을 확인하지 못했어.' }
}

function npmCommand() {
  const dir = path.dirname(process.execPath)
  const entry = [path.join(dir, 'node_modules/npm/bin/npm-cli.js'), path.join(dir, '../lib/node_modules/npm/bin/npm-cli.js')].find((p) => fs.existsSync(p))
  return entry ? { command: process.execPath, prefixArgs: [entry], shell: false } : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefixArgs: [] as string[], shell: process.platform === 'win32' }
}

export function reserveClaudeRequest() {
  if (updating || login) throw new Error('Claude Code 로그인 또는 업데이트가 진행 중이야. 완료 후 다시 시도해줘.')
  activeRequests++
  let released = false
  return () => { if (!released) { released = true; activeRequests-- } }
}

export async function updateClaudeCli() {
  if (updating || activeRequests || login) throw new Error('진행 중인 Claude Code 작업이나 로그인이 끝난 뒤 업데이트해줘.')
  updating = true
  try {
    const npm = npmCommand()
    const prefix = process.env.CLAUDE_NPM_PREFIX?.trim()
    const result = await run(npm.command, [...npm.prefixArgs, 'install', '-g', ...(prefix ? ['--prefix', prefix] : []), '--no-audit', '--no-fund', `${PACKAGE}@latest`], 600000, npm.shell)
    if (result.code !== 0) throw new Error('Claude Code 설치/업데이트에 실패했어. 서버의 npm 설치 권한과 네트워크를 확인해줘.')
  } finally { updating = false; latestCache = null; modelCache = null }
  return getClaudeVersion()
}

/** The CLI's own model list from its `initialize` answer. `default` is left out: a profile always names its model. */
export function claudeModelOptions(raw: unknown): ClaudeModelOption[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { value, displayName, resolvedModel, supportedEffortLevels } = entry as Record<string, unknown>
    if (typeof value !== 'string' || !value.trim() || value === 'default') return []
    return [{
      id: value,
      label: typeof displayName === 'string' && displayName.trim() ? displayName : value,
      resolvedModel: typeof resolvedModel === 'string' && resolvedModel ? resolvedModel : value,
      supportedEffortLevels: Array.isArray(supportedEffortLevels) ? supportedEffortLevels.filter((level): level is string => typeof level === 'string') : [],
    }]
  })
}

/** Starts the CLI in stream-json mode, asks `initialize` and stops it; no prompt is sent, so nothing is billed. */
async function loadClaudeModels(): Promise<ClaudeModelList> {
  let release: () => void
  try { release = reserveClaudeRequest() } catch { return { models: [], source: 'unavailable' } }
  try {
    fs.mkdirSync(runtimePaths.tempDir, { recursive: true })
    const cli = resolveClaudeCommand()
    const args = [...cli.prefixArgs, '--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--setting-sources', '', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}', '--disable-slash-commands', '--no-session-persistence']
    const raw = await new Promise<unknown>((resolve, reject) => {
      const child = spawn(cli.command, args, { cwd: runtimePaths.tempDir, env: claudeEnvironment(), windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'ignore'] })
      const timeout = scheduleCodexProcessTimeout(child, 20000)
      let buffer = ''
      let done = false
      const finish = (error: Error | null, models?: unknown) => {
        if (done) return
        done = true
        timeout.clear()
        killCodexProcessTree(child, 'SIGTERM')
        if (error) reject(error)
        else resolve(models)
      }
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          let message: { type?: unknown; response?: { subtype?: unknown; request_id?: unknown; response?: { models?: unknown } } }
          try { message = JSON.parse(line) } catch { continue }
          if (message.type !== 'control_response' || message.response?.request_id !== 'models') continue
          finish(message.response.subtype === 'success' ? null : new Error('initialize failed'), message.response.response?.models)
          return
        }
        if (buffer.length > 8 * 1024 * 1024) finish(new Error('initialize answer too large'))
      })
      child.stdin.on('error', () => {})
      child.once('error', () => finish(new Error('Claude Code CLI did not start')))
      child.once('close', () => finish(new Error('Claude Code CLI exited before listing models')))
      child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } })}\n`)
    })
    const models = claudeModelOptions(raw)
    return { models, source: models.length ? 'cli' : 'unavailable' }
  } catch {
    return { models: [], source: 'unavailable' }
  } finally { release() }
}

/** Only a live answer is cached, so an install, update or sign-in shows up on the next request. */
export async function getClaudeModels(): Promise<ClaudeModelList> {
  if (modelCache && modelCache.expiresAt > Date.now()) return modelCache.value
  modelsInFlight ??= loadClaudeModels().then((value) => {
    modelCache = value.source === 'cli' ? { value, expiresAt: Date.now() + MODEL_LIST_TTL_MS } : null
    return value
  }).finally(() => { modelsInFlight = null })
  return modelsInFlight
}

export function getClaudeLogin(): ClaudeLoginState { return { ...state } }

export function claudeLoginUrl(output: string) {
  for (const candidate of output.match(/https:\/\/[^\s\x1b<>]+/g) ?? []) {
    try {
      const url = new URL(candidate)
      if (['claude.ai', 'claude.com', 'platform.claude.com', 'console.anthropic.com', 'auth.anthropic.com'].includes(url.hostname) && /oauth|authorize/i.test(url.pathname)) return url.href
    } catch { /* not a URL */ }
  }
  return null
}

export async function startClaudeLogin() {
  if (login) { await login.ready; return getClaudeLogin() }
  if (updating || activeRequests) throw new Error('진행 중인 Claude Code 작업이 끝난 뒤 로그인해줘.')
  fs.mkdirSync(claudeConfigDir(), { recursive: true, mode: 0o700 })
  fs.mkdirSync(runtimePaths.tempDir, { recursive: true })
  const cli = resolveClaudeCommand()
  state = { status: 'starting', verificationUrl: null, expiresAt: null, message: null }
  const child = spawn(cli.command, [...cli.prefixArgs, 'auth', 'login', '--claudeai'], { cwd: runtimePaths.tempDir, env: claudeEnvironment(undefined, false), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' })
  let ready!: () => void
  const session = { child, ready: new Promise<void>((resolve) => { ready = resolve }) }
  login = session
  const timeout = scheduleCodexProcessTimeout(child, 16 * 60000)
  const waitTimer = setTimeout(() => { if (login === session && state.status === 'starting') killCodexProcessTree(child, 'SIGKILL') }, 30000)
  let output = ''
  const read = (chunk: Buffer) => {
    if (login !== session) return
    output = (output + chunk.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')).slice(-32768)
    const url = claudeLoginUrl(output)
    if (url && state.status === 'starting') {
      state = { status: 'pending', verificationUrl: url, expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), message: null }
      clearTimeout(waitTimer); ready()
    }
  }
  child.stdout.on('data', read)
  child.stderr.on('data', read)
  child.stdin.on('error', () => {})
  const finish = (status: ClaudeLoginState['status'], message: string | null) => {
    clearTimeout(waitTimer); timeout.clear()
    if (login === session) { state = { status, message, verificationUrl: null, expiresAt: null }; login = null; modelCache = null }
    ready()
  }
  child.once('error', () => finish('failed', 'Claude Code 로그인을 실행하지 못했어. CLI 설치를 확인해줘.'))
  child.once('close', (code) => finish(code === 0 ? 'succeeded' : 'failed', code === 0 ? null : 'Claude Code 로그인에 실패했거나 시간이 만료됐어. 다시 시도해줘.'))
  await session.ready
  return getClaudeLogin()
}

export function submitClaudeLoginCode(value: unknown) {
  if (!login || state.status !== 'pending') throw new Error('진행 중인 Claude Code 로그인이 없어.')
  if (typeof value !== 'string' || !/^[A-Za-z0-9_#.-]{1,4096}$/.test(value.trim())) throw new Error('인증 페이지에서 받은 코드를 입력해줘.')
  login.child.stdin?.write(`${value.trim()}\n`)
  return getClaudeLogin()
}

export function cancelClaudeLogin() {
  const current = login
  login = null
  if (current) killCodexProcessTree(current.child, 'SIGTERM')
  state = { status: 'cancelled', verificationUrl: null, expiresAt: null, message: null }
  return getClaudeLogin()
}
