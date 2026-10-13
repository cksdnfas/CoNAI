import fs from 'fs'
import os from 'os'
import path from 'path'
import readline from 'readline'
import { spawn, type ChildProcess } from 'child_process'
import { runtimePaths } from '../../config/runtimePaths'
import { killCodexProcessTree } from '../codexGenerationExecutor'
import { aiPythonDir } from '../aiRuntime/aiPythonDir'
import { resolveAiPython } from '../aiRuntime/aiRuntimeService'

const READY_TIMEOUT_MS = 180_000
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60_000
/** A download event pushes the deadline back by this much (big weights on a slow line). */
const DOWNLOAD_GRACE_MS = 20 * 60_000
const STOP_GRACE_MS = 3_000
const MAX_QUEUED_REQUESTS = 64

export type AiWorkerPriority = 'high' | 'normal' | 'low'
export type AiWorkerModel = 'wd' | 'kaloscope' | 'embedding' | 'pixai' | 'lama'

export type AiWorkerDownload = {
  repo: string
  file: string
  state: 'start' | 'done'
  bytes: number | null
  at: string
}

type Pending = {
  id: string
  payload: Record<string, unknown>
  priority: AiWorkerPriority
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
  deadline: number
  cleanup: () => void
  timedOut: boolean
}

const PRIORITY_ORDER: Record<AiWorkerPriority, number> = { high: 0, normal: 1, low: 2 }

export class AiWorkerError extends Error {
  constructor(message: string, readonly errorType: string) {
    super(message)
  }
}

export type AiWorkerOptions = {
  /** Name in logs. */
  label: string
  /** Extra environment for the process (e.g. CONAI_AI_ROLE). */
  env?: () => NodeJS.ProcessEnv
  /** Minutes a model may stay loaded unused, null = keep. Asked after each use. */
  idleMinutes: (model: AiWorkerModel) => number | null
}

/** Default CPU thread budget: half the logical cores, at most 8, so tagging never starves Node, sharp and ffmpeg. */
export function defaultAiThreads() {
  return Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)))
}

/**
 * Client for one `conai_worker.py` process. One request in flight at a time (the worker is sequential); queued
 * requests go by priority, then arrival. The process starts on first use, restarts after a crash on the next
 * request, and is stopped when no model has been loaded for a while.
 */
export class AiWorkerClient {
  private child: ChildProcess | null = null
  private ready: Promise<void> | null = null
  private queue: Pending[] = []
  private inFlight: Pending | null = null
  private seq = 0
  private loaded = new Map<AiWorkerModel, { device: string | null; lastUsedAt: number }>()
  private idleTimers = new Map<AiWorkerModel, NodeJS.Timeout>()
  /** The download running now (set by a "start" event, cleared when it is done or its request ends). */
  private activeDownload: AiWorkerDownload | null = null
  private startedAt: number | null = null
  private stopping: Promise<void> | null = null

  constructor(private readonly options: AiWorkerOptions) {}

  get running() {
    return this.child !== null && this.child.exitCode === null
  }

  /** The model file being downloaded right now, or null. */
  get download() {
    return this.activeDownload
  }

  loadedModels() {
    return new Map(this.loaded)
  }

  /** Queue a request; resolves with the worker's `result`, rejects with its error. */
  request<T = any>(op: string, payload: Record<string, unknown> = {}, options?: { priority?: AiWorkerPriority; timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.stopping) { reject(new AiWorkerError(`${this.options.label} stopped`, 'WorkerStopped')); return }
      if (options?.signal?.aborted) { reject(options.signal.reason); return }
      if (this.queue.length >= MAX_QUEUED_REQUESTS) {
        // Model unload is a control request: retain the bound while making room for it.
        if (op === 'unload') {
          const displaced = this.queue.pop()!
          displaced.cleanup()
          displaced.reject(new AiWorkerError('AI worker queue is full', 'QueueFull'))
        } else { reject(new AiWorkerError('AI worker queue is full', 'QueueFull')); return }
      }
      const signal = options?.signal
      const pending: Pending = {
        id: `${++this.seq}`,
        payload: { ...payload, op },
        priority: options?.priority ?? 'normal',
        resolve,
        reject,
        timer: null,
        deadline: Date.now() + (options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
        cleanup: () => { if (pending.timer) clearTimeout(pending.timer); signal?.removeEventListener('abort', abort) },
        timedOut: false,
      }
      const abort = () => {
        signal?.removeEventListener('abort', abort)
        const at = this.queue.indexOf(pending)
        if (at >= 0) {
          this.queue.splice(at, 1)
          pending.cleanup()
        }
        // Keep an active request's slot until its reply/exit, even when its caller has left.
        pending.reject(signal?.reason ?? new AiWorkerError('AI worker request cancelled', 'Aborted'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.queue.push(pending)
      this.queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || Number(a.id) - Number(b.id))
      this.armTimeout(pending)
      void this.pump()
    })
  }

  /** Record use of a model (after a request that ran it) and re-arm its idle unload. */
  touch(model: AiWorkerModel, device: string | null) {
    this.loaded.set(model, { device, lastUsedAt: Date.now() })
    this.armIdle(model)
  }

  async unload(models?: AiWorkerModel[]) {
    if (!this.running) {
      this.loaded.clear()
      return
    }
    const names = models ?? [...this.loaded.keys()]
    await this.request('unload', { models: names }, { priority: 'high' }).catch(() => undefined)
    for (const name of names) {
      this.loaded.delete(name)
      this.clearIdle(name)
    }
    if (this.loaded.size === 0 && this.queue.length === 0 && !this.inFlight) {
      // No model left and nothing waiting: the process alone still holds torch (~0.5 GB); let it go.
      await this.stop()
    }
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopping = this.stopProcess().finally(() => { this.stopping = null })
    return this.stopping
  }

  private async stopProcess() {
    for (const name of [...this.idleTimers.keys()]) {
      this.clearIdle(name)
    }
    const child = this.child
    this.failQueued(new AiWorkerError(`${this.options.label} stopped`, 'WorkerStopped'))
    if (!child) {
      this.reset(new AiWorkerError(`${this.options.label} stopped`, 'WorkerStopped'))
      return
    }
    // Ask politely after the current request; queued work is failed so callers don't hang.
    try {
      child.stdin?.write(`${JSON.stringify({ id: 'stop', op: 'shutdown' })}\n`)
    } catch {
      // pipe already closed
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        killCodexProcessTree(child, 'SIGKILL')
        resolve()
      }, STOP_GRACE_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.reset(new AiWorkerError(`${this.options.label} stopped`, 'WorkerStopped'))
  }

  status() {
    return {
      running: this.running,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      models: Object.fromEntries([...this.loaded.entries()].map(([name, value]) => [name, { device: value.device, lastUsedAt: new Date(value.lastUsedAt).toISOString() }])),
      queued: this.queue.length + (this.inFlight ? 1 : 0),
      download: this.activeDownload,
    }
  }

  private armIdle(model: AiWorkerModel) {
    this.clearIdle(model)
    const minutes = this.options.idleMinutes(model)
    if (minutes === null || minutes <= 0) {
      return
    }
    const timer = setTimeout(() => {
      this.idleTimers.delete(model)
      void this.unload([model])
    }, minutes * 60_000)
    timer.unref()
    this.idleTimers.set(model, timer)
  }

  private clearIdle(model: AiWorkerModel) {
    const timer = this.idleTimers.get(model)
    if (timer) {
      clearTimeout(timer)
      this.idleTimers.delete(model)
    }
  }

  private failQueued(error: Error) {
    for (const pending of this.queue.splice(0)) {
      pending.cleanup()
      pending.reject(error)
    }
  }

  private reset(error: Error) {
    if (this.inFlight) {
      this.inFlight.cleanup()
      this.inFlight.reject(error)
      this.inFlight = null
    }
    this.child = null
    this.ready = null
    this.startedAt = null
    this.activeDownload = null
    this.loaded.clear()
    for (const name of [...this.idleTimers.keys()]) {
      this.clearIdle(name)
    }
  }

  private start(): Promise<void> {
    if (this.ready) {
      return this.ready
    }
    const script = path.join(aiPythonDir(), 'conai_worker.py')
    const python = resolveAiPython().command
    let startingChild: ChildProcess | null = null
    this.ready = new Promise<void>((resolve, reject) => {
      if (!fs.existsSync(script)) {
        reject(new AiWorkerError(`Worker script not found: ${script}`, 'ScriptMissing'))
        return
      }
      const child = spawn(python, [script], {
        cwd: path.dirname(script),
        env: {
          ...process.env,
          HF_HOME: runtimePaths.modelsDir,
          HUGGINGFACE_HUB_CACHE: runtimePaths.modelsDir,
          HF_HUB_DISABLE_TELEMETRY: '1',
          PYTHONUNBUFFERED: '1',
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          ...this.options.env?.(),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      startingChild = child
      this.child = child
      let settled = false
      let stderrTail = ''
      const readyTimer = setTimeout(() => {
        if (!settled) {
          settled = true
          killCodexProcessTree(child, 'SIGKILL')
          reject(new AiWorkerError(`${this.options.label} did not start in time. ${stderrTail.trim().slice(-400)}`, 'StartTimeout'))
        }
      }, READY_TIMEOUT_MS)

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-4000)
      })
      readline.createInterface({ input: child.stdout! }).on('line', (line) => {
        if (this.child !== child) return
        let message: any
        try {
          message = JSON.parse(line)
        } catch {
          return
        }
        if (message.event === 'ready') {
          if (!settled) {
            settled = true
            clearTimeout(readyTimer)
            this.startedAt = Date.now()
            console.log(`[${this.options.label}] ready (pid ${message.pid}, torch ${message.torch}, cuda ${message.cudaAvailable}, threads ${message.threads})`)
            resolve()
          }
          return
        }
        if (message.event === 'download') {
          this.activeDownload = message.state === 'start'
            ? { repo: message.repo, file: message.file, state: message.state, bytes: message.bytes ?? null, at: new Date().toISOString() }
            : null
          console.log(`[${this.options.label}] download ${message.state}: ${message.repo}/${message.file}`)
          if (this.inFlight && !this.inFlight.timedOut && message.state === 'start') {
            this.extendDeadline(this.inFlight, DOWNLOAD_GRACE_MS)
          }
          return
        }
        const pending = this.inFlight
        if (!pending || pending.timedOut || message.id !== pending.id) {
          return
        }
        pending.cleanup()
        this.inFlight = null
        // A download the request caused has ended with it (a failed one never sends "done").
        this.activeDownload = null
        if (message.ok) {
          // A cancelled caller cannot touch the model, but a completed embedding still loaded it.
          if (['embed', 'embed_images', 'chunk'].includes(String(pending.payload.op))) this.touch('embedding', message.result?.device ?? 'cpu')
          if (pending.payload.op === 'load' && pending.payload.model === 'embedding') this.touch('embedding', message.result?.models?.embedding?.device ?? 'cpu')
          pending.resolve(message.result)
        } else {
          pending.reject(new AiWorkerError(message.error || 'Worker error', message.errorType || 'WorkerError'))
        }
        void this.pump()
      })
      child.once('error', (error) => {
        if (!settled) {
          settled = true
          clearTimeout(readyTimer)
          reject(new AiWorkerError(`Failed to start Python (${python}): ${error.message}`, 'SpawnError'))
        }
        if (this.child === child) this.reset(error)
      })
      child.once('exit', (code, signal) => {
        clearTimeout(readyTimer)
        if (!settled) {
          settled = true
          reject(new AiWorkerError(`${this.options.label} exited before ready (code ${code ?? signal}). ${stderrTail.trim().slice(-600)}`, 'StartFailed'))
        }
        if (this.child === child) {
          if (code !== 0 && code !== null) {
            console.warn(`[${this.options.label}] exited with code ${code}: ${stderrTail.trim().slice(-400)}`)
          }
          this.reset(new AiWorkerError(`${this.options.label} exited (code ${code ?? signal})`, 'WorkerExited'))
          void this.pump()
        }
      })
    }).catch((error) => {
      if (this.child === startingChild) { this.child = null; this.ready = null }
      throw error
    })
    return this.ready
  }

  private extendDeadline(pending: Pending, extraMs: number) {
    if (pending.timer) clearTimeout(pending.timer)
    pending.deadline = Math.max(pending.deadline, Date.now() + extraMs)
    this.armTimeout(pending)
  }

  private armTimeout(pending: Pending) {
    if (pending.timer) clearTimeout(pending.timer)
    pending.timer = setTimeout(() => {
      const at = this.queue.indexOf(pending)
      if (at >= 0) {
        this.queue.splice(at, 1)
        pending.cleanup()
        pending.reject(new AiWorkerError('AI worker queue wait timed out', 'QueueTimeout'))
        return
      }
      if (this.inFlight !== pending) return
      // The worker can't be interrupted mid-request; restart it so later requests aren't stuck behind this one.
      console.error(`[${this.options.label}] request ${pending.payload.op} timed out; restarting the worker`)
      pending.timedOut = true
      pending.cleanup()
      pending.reject(new AiWorkerError('AI worker request timed out', 'Timeout'))
      // Do not start another request until the timed-out process has exited.
      if (this.child) killCodexProcessTree(this.child, 'SIGKILL')
    }, Math.max(1, pending.deadline - Date.now()))
    pending.timer.unref?.()
  }

  private async pump() {
    if (this.stopping || this.inFlight || this.queue.length === 0) {
      return
    }
    const next = this.queue.shift()!
    this.inFlight = next
    try {
      await this.start()
    } catch (error) {
      next.cleanup()
      next.reject(error instanceof Error ? error : new Error(String(error)))
      // Everything queued would fail the same way.
      if (this.inFlight === next || (!this.inFlight && !this.child)) {
        this.inFlight = null
        this.failQueued(error instanceof Error ? error : new Error(String(error)))
      }
      return
    }
    if (this.inFlight !== next) {
      return
    }
    try {
      this.child!.stdin!.write(`${JSON.stringify({ ...next.payload, id: next.id })}\n`)
    } catch (error) {
      next.cleanup()
      this.inFlight = null
      next.reject(error instanceof Error ? error : new Error(String(error)))
      void this.pump()
    }
  }
}
