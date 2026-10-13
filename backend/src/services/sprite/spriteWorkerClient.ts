import fs from 'fs'
import path from 'path'
import { Worker } from 'worker_threads'
import { SpriteError } from './spriteErrors'
import { retainSpriteWorkspace } from './spriteCache'
import { SPRITE_TASKS, type SpriteTaskName, type SpriteTaskPayload, type SpriteTaskResult, type TaskProgress } from './spriteTasks'

/**
 * Runs sprite tasks on one long-lived worker thread so pixel loops (despill, auto-crop, dedupe, tiling) never stall
 * HTTP handling. When no worker script is available next to this module (the single-file portable bundle) the tasks
 * run inline and yield to the event loop between frames instead.
 */

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onProgress?: (progress: TaskProgress) => void
  detach?: () => void
}

let worker: Worker | null = null
let workerFailures = 0
let nextId = 1
const pending = new Map<number, Pending>()
let taskActive = false
const waitingTasks: Array<{ resolve: (release: () => void) => void; reject: (error: Error) => void; detach: () => void }> = []

function releaseTaskSlot(): void {
  const next = waitingTasks.shift()
  if (next) {
    next.detach()
    next.resolve(releaseTaskSlot)
  } else taskActive = false
}

/** All consumers share one slot, including build follow-ups and image resize. */
async function acquireTaskSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw new SpriteError('작업이 취소되었습니다.')
  if (!taskActive) {
    taskActive = true
    return releaseTaskSlot
  }
  if (waitingTasks.length >= 200) throw new SpriteError('스프라이트 작업이 많습니다. 잠시 뒤 다시 시도하세요.', 503)
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const index = waitingTasks.indexOf(entry)
      if (index >= 0) waitingTasks.splice(index, 1)
      entry.detach()
      reject(new SpriteError('작업이 취소되었습니다.'))
    }
    const entry = { resolve, reject, detach: () => signal?.removeEventListener('abort', onAbort) }
    waitingTasks.push(entry)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function workerScript(): string | null {
  const compiled = path.join(__dirname, 'spriteWorker.js')
  if (fs.existsSync(compiled)) return compiled
  const source = path.join(__dirname, 'spriteWorker.ts')
  // A .ts entry only loads when this process runs under tsx (dev, tests); workers inherit its loader flags.
  if (fs.existsSync(source) && process.execArgv.some((arg) => /tsx/.test(arg))) return source
  return null
}

function failAll(error: Error) {
  for (const entry of pending.values()) {
    entry.detach?.()
    entry.reject(error)
  }
  pending.clear()
}

function updateRef() {
  if (!worker) return
  if (pending.size > 0) worker.ref()
  else worker.unref()
}

function getWorker(): Worker | null {
  if (worker) return worker
  if (workerFailures >= 2) return null
  const script = workerScript()
  if (!script) return null
  const created = new Worker(script)
  created.on('message', (message: { type: string; id: number; progress?: TaskProgress; result?: unknown; error?: { message: string; sprite: boolean; statusCode?: number } }) => {
    const entry = pending.get(message.id)
    if (!entry) return
    if (message.type === 'progress') {
      entry.onProgress?.(message.progress as TaskProgress)
      return
    }
    pending.delete(message.id)
    entry.detach?.()
    updateRef()
    if (message.type === 'result') entry.resolve(message.result)
    else {
      const info = message.error ?? { message: 'Sprite task failed', sprite: false }
      entry.reject(info.sprite ? new SpriteError(info.message, info.statusCode) : new Error(info.message))
    }
  })
  created.on('error', (error) => {
    if (worker !== created) return
    workerFailures += 1
    if (worker === created) worker = null
    failAll(error instanceof Error ? error : new Error(String(error)))
  })
  created.on('exit', (code) => {
    if (worker !== created) return
    if (worker === created) worker = null
    if (pending.size > 0) failAll(new Error(`Sprite worker exited (${code})`))
  })
  worker = created
  created.unref()
  return created
}

export function spriteWorkerMode(): 'worker' | 'inline' {
  return workerScript() && workerFailures < 2 ? 'worker' : 'inline'
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

/** Run one sprite task off the main thread (or inline as a fallback). Cancels through `signal`. */
export async function runSpriteTask<T extends SpriteTaskName>(
  task: T,
  payload: SpriteTaskPayload<T>,
  options: { signal?: AbortSignal; onProgress?: (progress: TaskProgress) => void; inline?: boolean } = {},
): Promise<SpriteTaskResult<T>> {
  const workDir = (payload as { workDir?: string }).workDir
  const releaseWorkspace = retainSpriteWorkspace(workDir)
  try {
    const release = await acquireTaskSlot(options.signal)
    try { return await dispatchSpriteTask(task, payload, options) }
    finally { release() }
  } finally { releaseWorkspace() }
}

function dispatchSpriteTask<T extends SpriteTaskName>(
  task: T,
  payload: SpriteTaskPayload<T>,
  options: { signal?: AbortSignal; onProgress?: (progress: TaskProgress) => void; inline?: boolean } = {},
): Promise<SpriteTaskResult<T>> {
  if (options.signal?.aborted) return Promise.reject(new SpriteError('작업이 취소되었습니다.'))
  const target = options.inline ? null : getWorker()
  if (!target) {
    const controller = new AbortController()
    const forward = () => controller.abort()
    options.signal?.addEventListener('abort', forward, { once: true })
    const run = SPRITE_TASKS[task] as (payload: unknown, ctx: unknown) => Promise<SpriteTaskResult<T>>
    return run(payload, { signal: controller.signal, progress: options.onProgress ?? (() => {}), yieldEvery: yieldToEventLoop })
      .finally(() => options.signal?.removeEventListener('abort', forward))
  }
  const id = nextId++
  return new Promise<SpriteTaskResult<T>>((resolve, reject) => {
    const onAbort = () => target.postMessage({ type: 'cancel', id })
    options.signal?.addEventListener('abort', onAbort, { once: true })
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      onProgress: options.onProgress,
      detach: () => options.signal?.removeEventListener('abort', onAbort),
    })
    updateRef()
    target.postMessage({ type: 'run', id, task, payload })
  })
}

/** Stop the worker (shutdown, tests). Pending tasks fail. */
export async function shutdownSpriteWorker(): Promise<void> {
  const current = worker
  worker = null
  for (const entry of waitingTasks.splice(0)) {
    entry.detach()
    entry.reject(new Error('Sprite worker stopped'))
  }
  failAll(new Error('Sprite worker stopped'))
  if (current) await current.terminate()
}
