import fs from 'fs'
import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import type {
  AiRuntimeInstallState,
  AiRuntimeProbe,
  AiRuntimeStatus,
  AiTorchBackend,
  AiTorchBackendPreference,
  AppSettings,
} from '@conai/shared'
import { settingsService } from '../settingsService'
import { killCodexProcessTree } from '../codexGenerationExecutor'
import { detectGpus } from './gpuDetection'
import {
  aiRuntimePaths,
  getActiveAiEnvironment,
  removeInactiveAiEnvironments,
  setActiveAiEnvironment,
  venvPythonPath,
} from './aiRuntimeStore'
import { recommendTorchBackend, resolveTorchBackend, TORCH_VERSION, TORCHVISION_VERSION } from './torchBackends'
import { ensureUv, isUvSupported } from './uvBinary'
import { aiPythonDir } from './aiPythonDir'

const PYTHON_VERSION = '3.12'
const LOG_LIMIT = 300
const STEP_TIMEOUT_MS = 60 * 60 * 1000
const PROBE_TIMEOUT_MS = 3 * 60 * 1000
const CACHE_POLL_MS = 4000

function idleState(): AiRuntimeInstallState {
  return { status: 'idle', backend: null, step: null, startedAt: null, finishedAt: null, downloadedBytes: 0, log: [], error: null }
}

let install: AiRuntimeInstallState = idleState()
let currentChild: ChildProcess | null = null
let cancelRequested = false
const switchHooks = new Set<() => Promise<void> | void>()

/** Runs right before a new environment becomes active, e.g. to stop Python workers so they respawn from it. */
export function onAiRuntimeSwitch(hook: () => Promise<void> | void) {
  switchHooks.add(hook)
  return () => {
    switchHooks.delete(hook)
  }
}

/** The Python the AI workers spawn: the app-installed environment unless the user picked a custom one. */
export function resolveAiPython(settings: AppSettings = settingsService.loadSettings()): AiRuntimeStatus['resolvedPython'] {
  const custom = settings.aiRuntime.customPythonPath?.trim() || 'python'
  if (settings.aiRuntime.pythonSource !== 'custom') {
    const active = getActiveAiEnvironment()
    if (active) {
      return { command: active.pythonPath, source: 'managed' }
    }
  }
  return { command: custom, source: 'custom' }
}

export async function getAiRuntimeStatus(options?: { refreshGpus?: boolean }): Promise<AiRuntimeStatus> {
  const settings = settingsService.loadSettings()
  const detection = await detectGpus({ refresh: options?.refreshGpus })
  return {
    settings: settings.aiRuntime,
    gpus: detection.gpus,
    detectError: detection.error,
    recommendation: recommendTorchBackend(detection.gpus),
    effectiveBackend: resolveTorchBackend(settings.aiRuntime.torchBackend, detection.gpus),
    active: getActiveAiEnvironment(),
    resolvedPython: resolveAiPython(settings),
    install: { ...install, log: [...install.log] },
    installSupported: isUvSupported(),
  }
}

function log(line: string) {
  const trimmed = line.replace(/\s+$/, '')
  if (!trimmed) {
    return
  }
  install.log.push(trimmed)
  if (install.log.length > LOG_LIMIT) {
    install.log.splice(0, install.log.length - LOG_LIMIT)
  }
}

function uvEnv(): NodeJS.ProcessEnv {
  const { VIRTUAL_ENV: _virtualEnv, CONDA_PREFIX: _condaPrefix, ...inherited } = process.env
  return {
    ...inherited,
    UV_PYTHON_INSTALL_DIR: aiRuntimePaths.pythonDir(),
    UV_CACHE_DIR: aiRuntimePaths.cacheDir(),
    UV_PYTHON_PREFERENCE: 'only-managed',
    UV_LINK_MODE: 'copy',
    UV_NO_PROGRESS: '1',
    NO_COLOR: '1',
    // A user-level uv.toml or VIRTUAL_ENV must not steer where packages go.
    UV_NO_CONFIG: '1',
    PYTHONUTF8: '1',
  }
}

function run(command: string, args: string[], timeoutMs = STEP_TIMEOUT_MS): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    if (cancelRequested) {
      reject(new Error('cancelled'))
      return
    }
    let stdout = ''
    const child = spawn(command, args, {
      cwd: path.dirname(aiRuntimePaths.stateFile()),
      env: uvEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    currentChild = child
    const timer = setTimeout(() => killCodexProcessTree(child, 'SIGKILL'), timeoutMs)
    timer.unref()
    // Chunks split lines anywhere; log whole lines only and flush the rest on close.
    const partial = { stdout: '', stderr: '' }
    const onChunk = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString()
      if (stream === 'stdout') {
        stdout += text
      }
      const lines = (partial[stream] + text).split(/\r?\n|\r/)
      partial[stream] = lines.pop() ?? ''
      lines.forEach(log)
    }
    const flush = () => {
      log(partial.stdout)
      log(partial.stderr)
      partial.stdout = ''
      partial.stderr = ''
    }
    child.stdout?.on('data', (chunk: Buffer) => onChunk('stdout', chunk))
    child.stderr?.on('data', (chunk: Buffer) => onChunk('stderr', chunk))
    child.once('error', (error) => {
      clearTimeout(timer)
      currentChild = null
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      currentChild = null
      flush()
      if (cancelRequested) {
        reject(new Error('cancelled'))
        return
      }
      resolve({ code, stdout })
    })
  })
}

async function runChecked(command: string, args: string[], failure: string) {
  const result = await run(command, args)
  if (result.code !== 0) {
    throw new Error(`${failure} (exit ${result.code ?? 'unknown'})`)
  }
  return result
}

async function directorySize(dir: string): Promise<number> {
  let total = 0
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await directorySize(full)
    } else if (entry.isFile()) {
      try {
        total += (await fs.promises.stat(full)).size
      } catch {
        // file moved while counting
      }
    }
  }
  return total
}

/** Run the probe script with an environment's Python and parse its JSON line. */
export async function probeAiPython(pythonPath: string): Promise<AiRuntimeProbe> {
  const script = path.join(aiPythonDir(), 'ai_runtime_probe.py')
  return new Promise((resolve) => {
    const child = spawn(pythonPath, [script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => killCodexProcessTree(child, 'SIGKILL'), PROBE_TIMEOUT_MS)
    timer.unref()
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    const fail = (error: string): AiRuntimeProbe => ({
      ok: false, python: null, torch: null, torchCuda: null, cudaAvailable: false, devices: [], archList: [],
      gpuSupported: null, gpuComputeOk: null, packages: {}, error,
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      resolve(fail(error.message))
    })
    child.once('close', () => {
      clearTimeout(timer)
      const line = stdout.trim().split(/\r?\n/).pop() ?? ''
      try {
        resolve(JSON.parse(line) as AiRuntimeProbe)
      } catch {
        resolve(fail(stderr.trim().slice(-600) || 'probe printed no result'))
      }
    })
  })
}

/** Why a finished install can't be used, or null. A CUDA build has to see and run on the GPU. */
function probeFailure(backend: AiTorchBackend, probe: AiRuntimeProbe): string | null {
  if (!probe.ok) {
    return probe.error || '검증 실패'
  }
  if (backend !== 'cpu') {
    if (!probe.cudaAvailable) {
      return `torch가 CUDA를 못 찾았어 (torch ${probe.torch ?? '?'}, CUDA ${probe.torchCuda ?? '?'}). 드라이버를 확인해줘.`
    }
    if (!probe.gpuSupported) {
      const caps = probe.devices.map((device) => device.capability).join(', ')
      return `이 빌드에 GPU(${caps})용 코드가 없어. 다른 빌드를 골라줘.`
    }
    if (!probe.gpuComputeOk) {
      return 'GPU 연산 테스트가 실패했어.'
    }
  }
  return null
}

async function runInstall(backend: AiTorchBackend) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const envId = `${backend}-${stamp}`
  const envDir = path.join(aiRuntimePaths.envsDir(), envId)
  let cachePoll: NodeJS.Timeout | null = null
  try {
    fs.mkdirSync(aiRuntimePaths.envsDir(), { recursive: true })

    install.step = 'uv'
    const uv = await ensureUv(log)

    install.step = 'python'
    await runChecked(uv, ['python', 'install', PYTHON_VERSION], 'Python 설치 실패')

    install.step = 'venv'
    await runChecked(uv, ['venv', envDir, '--python', PYTHON_VERSION, '--no-project'], '가상 환경 생성 실패')
    const envPython = venvPythonPath(envDir)

    install.step = 'packages'
    const cacheStart = await directorySize(aiRuntimePaths.cacheDir())
    cachePoll = setInterval(() => {
      void directorySize(aiRuntimePaths.cacheDir()).then((size) => {
        install.downloadedBytes = Math.max(install.downloadedBytes, size - cacheStart)
      })
    }, CACHE_POLL_MS)
    await runChecked(uv, [
      'pip', 'install',
      '--python', envPython,
      '--torch-backend', backend,
      `torch==${TORCH_VERSION}`,
      `torchvision==${TORCHVISION_VERSION}`,
      '-r', path.join(aiPythonDir(), 'requirements-ai.txt'),
    ], '패키지 설치 실패')
    clearInterval(cachePoll)
    cachePoll = null

    install.step = 'verify'
    log('검증 중')
    const probe = await probeAiPython(envPython)
    log(`torch ${probe.torch ?? '?'} · CUDA ${probe.torchCuda ?? '없음'} · GPU ${probe.devices.map((device) => `${device.name} (${device.capability})`).join(', ') || '없음'}`)
    const failure = probeFailure(backend, probe)
    if (failure) {
      throw new Error(failure)
    }

    install.step = 'activate'
    for (const hook of switchHooks) {
      await hook()
    }
    setActiveAiEnvironment({ id: envId, backend, createdAt: new Date().toISOString(), pythonPath: envPython, probe })
    removeInactiveAiEnvironments()
    // Downloaded wheels are several GB for CUDA builds; the environment has its own copy (UV_LINK_MODE=copy).
    await run(uv, ['cache', 'clean']).catch(() => undefined)

    install.status = 'succeeded'
    log('설치 완료')
  } catch (error) {
    install.status = cancelRequested ? 'cancelled' : 'failed'
    install.error = cancelRequested ? null : error instanceof Error ? error.message : String(error)
    if (install.error) {
      log(install.error)
    }
    fs.rmSync(envDir, { recursive: true, force: true })
  } finally {
    if (cachePoll) {
      clearInterval(cachePoll)
    }
    install.finishedAt = new Date().toISOString()
    cancelRequested = false
  }
}

/** Start installing a fresh environment with the given build (default: the saved preference). Returns at once. */
export async function startAiRuntimeInstall(preference?: AiTorchBackendPreference): Promise<AiRuntimeInstallState> {
  if (install.status === 'running') {
    throw new Error('AI 런타임 설치가 이미 진행 중이야.')
  }
  if (!isUvSupported()) {
    throw new Error(`이 플랫폼(${process.platform}/${process.arch})에서는 앱이 환경을 설치할 수 없어. Python 경로를 직접 지정해줘.`)
  }
  const settings = settingsService.loadSettings()
  const { gpus } = await detectGpus({ refresh: true })
  const chosen = preference ?? settings.aiRuntime.torchBackend
  if (chosen === 'auto') {
    const recommendation = recommendTorchBackend(gpus)
    if (recommendation.blocked) {
      throw new Error('GPU 드라이버가 너무 오래돼서 맞는 CUDA 빌드가 없어. 드라이버를 업데이트하거나 CPU를 골라줘.')
    }
  }
  const backend = resolveTorchBackend(chosen, gpus)

  cancelRequested = false
  install = { ...idleState(), status: 'running', backend, startedAt: new Date().toISOString() }
  log(`설치 시작: ${backend} (torch ${TORCH_VERSION})`)
  void runInstall(backend)
  return { ...install, log: [...install.log] }
}

export function cancelAiRuntimeInstall() {
  if (install.status !== 'running') {
    return false
  }
  cancelRequested = true
  if (currentChild) {
    killCodexProcessTree(currentChild, 'SIGKILL')
  }
  return true
}

/** Leftover env folders from a swap that could not delete them (locked at the time). */
export function cleanupAiRuntimeOnBoot() {
  if (install.status !== 'running') {
    removeInactiveAiEnvironments()
  }
}
