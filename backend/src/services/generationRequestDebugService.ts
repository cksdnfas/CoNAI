import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../config/runtimePaths'

export interface ComfyRequestDebugSnapshot {
  service_type: 'comfyui'
  stage: 'prepared' | 'submitted' | 'failed' | 'completed'
  captured_at: string
  queue_job_id?: number | null
  history_id?: number | null
  workflow_id?: number | null
  workflow_name?: string | null
  server_id?: number | null
  server_name?: string | null
  endpoint?: string | null
  prompt_id?: string | null
  error_message?: string | null
  raw_prompt_data?: Record<string, unknown>
  prepared_prompt_data?: Record<string, unknown>
  resolved_prompt_data?: Record<string, unknown>
  request_body?: Record<string, unknown>
}

function getDebugRootDir() {
  return path.join(runtimePaths.logsDir, 'generation-debug', 'comfyui')
}

function getQueueJobDebugFilePath(queueJobId: number) {
  return path.join(getDebugRootDir(), `queue-job-${queueJobId}.json`)
}

function sanitizePromptDebugValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePromptDebugValue(entry))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const record = value as Record<string, unknown>
  const next: Record<string, unknown> = {}

  for (const [key, entry] of Object.entries(record)) {
    if (key === 'dataUrl' && typeof entry === 'string') {
      next[key] = `[omitted dataUrl, length=${entry.length}]`
      continue
    }

    next[key] = sanitizePromptDebugValue(entry)
  }

  return next
}

export function getComfyRequestDebugRelativePath(queueJobId: number) {
  return path.relative(runtimePaths.logsDir, getQueueJobDebugFilePath(queueJobId)).replace(/\\/g, '/')
}

export async function writeComfyRequestDebugSnapshot(queueJobId: number, snapshot: ComfyRequestDebugSnapshot) {
  const targetPath = getQueueJobDebugFilePath(queueJobId)
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })

  const sanitizedSnapshot = {
    ...snapshot,
    raw_prompt_data: snapshot.raw_prompt_data ? sanitizePromptDebugValue(snapshot.raw_prompt_data) as Record<string, unknown> : undefined,
  }

  await fs.promises.writeFile(targetPath, `${JSON.stringify(sanitizedSnapshot, null, 2)}\n`, 'utf8')

  return {
    absolutePath: targetPath,
    relativePath: getComfyRequestDebugRelativePath(queueJobId),
  }
}

export async function readComfyRequestDebugSnapshot(queueJobId: number) {
  const targetPath = getQueueJobDebugFilePath(queueJobId)
  const content = await fs.promises.readFile(targetPath, 'utf8')
  return JSON.parse(content) as ComfyRequestDebugSnapshot
}
