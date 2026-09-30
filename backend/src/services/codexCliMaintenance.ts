import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { runtimePaths } from '../config/runtimePaths'
import { GenerationQueueModel } from '../models/GenerationQueue'
import {
  compareCodexVersions,
  resolveCodexCommand,
  resolveNewestCodexCliInstallation,
  scheduleCodexProcessTimeout,
} from './codexGenerationExecutor'

const CODEX_NPM_PACKAGE = '@openai/codex'
const LATEST_VERSION_CACHE_MS = 60 * 60 * 1000
const VERSION_PROBE_TIMEOUT_MS = 15 * 1000
const NPM_VIEW_TIMEOUT_MS = 30 * 1000
const NPM_INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const OUTPUT_TAIL_LENGTH = 800
const VERSION_PATTERN = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/

export type CodexCliVersionInfo = {
  current: string | null
  latest: string | null
  updateAvailable: boolean
  updating: boolean
  /** Where the update goes: the app-managed prefix (`CODEX_NPM_PREFIX`) or the npm global install. */
  installTarget: 'prefix' | 'global'
  message: string | null
}

type ProcessResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean }

let latestVersionCache: { version: string | null; message: string | null; checkedAt: number } | null = null
let updating = false
const beforeUpdateHooks = new Set<() => Promise<void> | void>()

/** Run before the CLI files are replaced (Windows keeps running binaries locked), e.g. to stop chat sessions. */
export function onBeforeCodexCliUpdate(hook: () => Promise<void> | void) {
  beforeUpdateHooks.add(hook)
  return () => {
    beforeUpdateHooks.delete(hook)
  }
}

export function isCodexCliUpdating() {
  return updating
}

function tail(output: string) {
  const trimmed = output.trim()
  return trimmed.length > OUTPUT_TAIL_LENGTH ? `…${trimmed.slice(-OUTPUT_TAIL_LENGTH)}` : trimmed
}

/** npm-cli.js next to the running node (Windows: `node_modules/npm`, POSIX: `../lib/node_modules/npm`); falls back to `npm` on PATH. */
function resolveNpmCommand() {
  const nodeDir = path.dirname(process.execPath)
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate))
  return npmCli
    ? { command: process.execPath, prefixArgs: [npmCli], shell: false }
    : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefixArgs: [] as string[], shell: process.platform === 'win32' }
}

function runProcess(command: string, args: string[], timeoutMs: number, shell = false): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(command, args, {
      cwd: runtimePaths.tempDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', npm_config_update_notifier: 'false' },
      windowsHide: true,
      shell,
      detached: process.platform !== 'win32',
    })
    const processTimeout = scheduleCodexProcessTimeout(child, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', (error) => {
      processTimeout.clear()
      resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut: false })
    })
    child.once('close', (code) => {
      processTimeout.clear()
      resolve({ code, stdout, stderr, timedOut: processTimeout.timedOut })
    })
  })
}

async function readCurrentVersion() {
  const installation = resolveNewestCodexCliInstallation()
  if (installation?.version) {
    return installation.version
  }

  // PATH에만 있는 CLI(예: 다른 패키지 관리자 설치)는 실행해서 버전을 읽는다.
  const resolved = resolveCodexCommand()
  const result = await runProcess(resolved.command, [...resolved.prefixArgs, '--version'], VERSION_PROBE_TIMEOUT_MS)
  return result.code === 0 ? `${result.stdout}`.match(VERSION_PATTERN)?.[1] ?? null : null
}

async function readLatestVersion(forceRefresh: boolean) {
  if (!forceRefresh && latestVersionCache && Date.now() - latestVersionCache.checkedAt < LATEST_VERSION_CACHE_MS) {
    return latestVersionCache
  }

  const npm = resolveNpmCommand()
  const result = await runProcess(npm.command, [...npm.prefixArgs, 'view', CODEX_NPM_PACKAGE, 'version'], NPM_VIEW_TIMEOUT_MS, npm.shell)
  const version = result.code === 0 ? result.stdout.match(VERSION_PATTERN)?.[1] ?? null : null
  latestVersionCache = {
    version,
    message: version ? null : tail(`${result.stdout}\n${result.stderr}`) || 'npm view failed',
    checkedAt: Date.now(),
  }
  return latestVersionCache
}

export async function getCodexCliVersionInfo(options?: { refreshLatest?: boolean }): Promise<CodexCliVersionInfo> {
  const [current, latest] = await Promise.all([readCurrentVersion(), readLatestVersion(options?.refreshLatest === true)])
  return {
    current,
    latest: latest.version,
    updateAvailable: Boolean(current && latest.version && compareCodexVersions(latest.version, current) > 0),
    updating,
    installTarget: process.env.CODEX_NPM_PREFIX?.trim() ? 'prefix' : 'global',
    message: latest.message,
  }
}

/**
 * `npm install -g [--prefix CODEX_NPM_PREFIX] @openai/codex@latest`. Codex 생성 작업이 돌고 있으면 거절한다:
 * 실행 중인 CLI 파일을 바꾸면 Windows는 잠금으로 실패하고, POSIX는 작업 도중 버전이 바뀐다.
 */
export async function updateCodexCli(): Promise<CodexCliVersionInfo> {
  if (updating) {
    throw new Error('Codex CLI 업데이트가 이미 진행 중이야.')
  }

  const codexCounts = GenerationQueueModel.getStatusCounts({ serviceType: 'codex' })
  if (codexCounts.dispatching + codexCounts.running > 0) {
    throw new Error('실행 중인 Codex 생성 작업이 끝난 뒤에 업데이트해줘.')
  }

  updating = true
  try {
    for (const hook of beforeUpdateHooks) {
      await hook()
    }

    const prefix = process.env.CODEX_NPM_PREFIX?.trim()
    const npm = resolveNpmCommand()
    const args = [
      ...npm.prefixArgs,
      'install',
      '-g',
      ...(prefix ? ['--prefix', prefix] : []),
      '--no-audit',
      '--no-fund',
      `${CODEX_NPM_PACKAGE}@latest`,
    ]
    const result = await runProcess(npm.command, args, NPM_INSTALL_TIMEOUT_MS, npm.shell)
    if (result.code !== 0) {
      throw new Error(result.timedOut
        ? 'Codex CLI 업데이트가 시간 안에 끝나지 않았어.'
        : tail(`${result.stdout}\n${result.stderr}`) || `npm install exited with code ${result.code ?? 'unknown'}`)
    }
  } finally {
    updating = false
    latestVersionCache = null
  }

  return getCodexCliVersionInfo()
}
