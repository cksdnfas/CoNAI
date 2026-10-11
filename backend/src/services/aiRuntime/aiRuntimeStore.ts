import fs from 'fs'
import path from 'path'
import type { AiRuntimeEnvironment } from '@conai/shared'
import { runtimePaths } from '../../config/runtimePaths'
import { isAiTorchBackend } from './torchBackends'

/**
 * Layout under `<basePath>/ai-runtime` (or AI_RUNTIME_DIR):
 *   uv/       uv executable the app downloaded
 *   python/   CPython builds uv manages
 *   cache/    uv package cache (pruned after each install)
 *   envs/<id> one venv per install; state.json names the active one
 */
export function aiRuntimeRoot() {
  const override = process.env.AI_RUNTIME_DIR?.trim()
  return override ? path.resolve(override) : path.join(runtimePaths.basePath, 'ai-runtime')
}

export const aiRuntimePaths = {
  uvDir: () => path.join(aiRuntimeRoot(), 'uv'),
  pythonDir: () => path.join(aiRuntimeRoot(), 'python'),
  cacheDir: () => path.join(aiRuntimeRoot(), 'cache'),
  envsDir: () => path.join(aiRuntimeRoot(), 'envs'),
  stateFile: () => path.join(aiRuntimeRoot(), 'state.json'),
}

export function venvPythonPath(envDir: string) {
  return process.platform === 'win32' ? path.join(envDir, 'Scripts', 'python.exe') : path.join(envDir, 'bin', 'python')
}

type AiRuntimeState = { active: AiRuntimeEnvironment | null }

function isEnvironment(value: any): value is AiRuntimeEnvironment {
  return Boolean(value && typeof value.id === 'string' && isAiTorchBackend(value.backend) && typeof value.pythonPath === 'string')
}

function readState(): AiRuntimeState {
  try {
    const parsed = JSON.parse(fs.readFileSync(aiRuntimePaths.stateFile(), 'utf-8'))
    return { active: isEnvironment(parsed?.active) ? parsed.active : null }
  } catch {
    return { active: null }
  }
}

/** The installed environment in use, or null when none is installed (or its python vanished). */
export function getActiveAiEnvironment(): AiRuntimeEnvironment | null {
  const active = readState().active
  return active && fs.existsSync(active.pythonPath) ? active : null
}

export function setActiveAiEnvironment(environment: AiRuntimeEnvironment) {
  fs.mkdirSync(aiRuntimeRoot(), { recursive: true })
  const file = aiRuntimePaths.stateFile()
  const temp = `${file}.tmp`
  fs.writeFileSync(temp, JSON.stringify({ active: environment }, null, 2), 'utf-8')
  fs.renameSync(temp, file)
}

/**
 * Delete env folders other than the active one. Folders still locked (a worker running from them on Windows) stay
 * and are retried on the next call.
 */
export function removeInactiveAiEnvironments() {
  const activeId = getActiveAiEnvironment()?.id
  let entries: string[] = []
  try {
    entries = fs.readdirSync(aiRuntimePaths.envsDir())
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry === activeId) {
      continue
    }
    try {
      fs.rmSync(path.join(aiRuntimePaths.envsDir(), entry), { recursive: true, force: true })
    } catch {
      // locked; next install or boot tries again
    }
  }
}
