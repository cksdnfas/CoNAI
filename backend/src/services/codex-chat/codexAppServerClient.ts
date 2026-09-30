import { EventEmitter } from 'events'
import readline from 'readline'
import { spawn, type ChildProcess } from 'child_process'
import { killCodexProcessTree, resolveCodexCommand } from '../codexGenerationExecutor'

const DEFAULT_REQUEST_TIMEOUT_MS = 60 * 1000
const STDERR_TAIL_LENGTH = 2000

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

type JsonRpcMessage = {
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string }
}

export type CodexAppServerNotification = {
  method: string
  params: Record<string, unknown>
}

/**
 * Answers for requests the app-server sends to its client. Chat is MCP-only, so every approval and permission
 * request is declined; MCP tool approvals never reach here because the conai server is configured to auto-approve.
 */
function declineServerRequest(method: string): { result?: unknown; error?: { code: number; message: string } } {
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { result: { decision: 'decline' } }
    case 'applyPatchApproval':
    case 'execCommandApproval':
      return { result: { decision: { denied: { rejection: 'CoNAI chat only allows CoNAI MCP tools.' } } } }
    case 'mcpServer/elicitation/request':
      return { result: { action: 'decline', content: null, _meta: null } }
    default:
      return { error: { code: -32601, message: `CoNAI chat does not handle ${method}` } }
  }
}

/** JSON-RPC client for one `codex app-server` process over stdio (newline-delimited JSON). */
export class CodexAppServerClient extends EventEmitter {
  private readonly child: ChildProcess
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  private stderrTail = ''
  private exited = false
  private resolveExited: () => void = () => {}
  /** Settles once the process is gone (used before replacing CLI files, which Windows locks while running). */
  readonly whenExited: Promise<void> = new Promise((resolve) => {
    this.resolveExited = resolve
  })

  private constructor(child: ChildProcess) {
    super()
    this.child = child

    readline.createInterface({ input: child.stdout! }).on('line', (line) => this.handleLine(line))
    child.stderr?.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString()}`.slice(-STDERR_TAIL_LENGTH)
    })
    child.once('error', (error) => this.handleExit(`Codex app-server failed to start: ${error.message}`))
    child.once('close', (code, signal) => this.handleExit(`Codex app-server exited (${signal ?? code ?? 'unknown'})`))
  }

  static async start(options: { args: string[]; env: NodeJS.ProcessEnv; cwd: string }) {
    const resolved = resolveCodexCommand()
    const child = spawn(resolved.command, [...resolved.prefixArgs, 'app-server', ...options.args], {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options.env,
      windowsHide: true,
      // POSIX에서는 프로세스 그룹째 종료하려고 detached로 띄운다.
      detached: process.platform !== 'win32',
    })
    const client = new CodexAppServerClient(child)
    await client.request('initialize', {
      clientInfo: { name: 'conai', title: 'CoNAI', version: '1.0.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    })
    client.notify('initialized', {})
    return client
  }

  get isAlive() {
    return !this.exited
  }

  get lastStderr() {
    return this.stderrTail.trim()
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.exited) {
      return Promise.reject(new Error('Codex app-server is not running'))
    }

    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server did not answer ${method} within ${timeoutMs / 1000}s`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      this.write({ id, method, params })
    })
  }

  notify(method: string, params: unknown) {
    this.write({ method, params })
  }

  close() {
    if (this.exited) {
      return
    }
    killCodexProcessTree(this.child, 'SIGTERM')
    setTimeout(() => killCodexProcessTree(this.child, 'SIGKILL'), 5000).unref()
  }

  private write(message: JsonRpcMessage) {
    if (this.exited || !this.child.stdin?.writable) {
      return
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleLine(line: string) {
    let message: JsonRpcMessage
    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch {
      return
    }

    if (message.id !== undefined && message.method) {
      this.write({ id: message.id, ...declineServerRequest(message.method) })
      return
    }

    if (message.id !== undefined) {
      const pending = typeof message.id === 'number' ? this.pending.get(message.id) : undefined
      if (!pending) {
        return
      }
      this.pending.delete(message.id as number)
      clearTimeout(pending.timer)
      if (message.error) {
        pending.reject(new Error(message.error.message || `Codex app-server error ${message.error.code ?? ''}`.trim()))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.method) {
      this.emit('notification', {
        method: message.method,
        params: (message.params && typeof message.params === 'object' ? message.params : {}) as Record<string, unknown>,
      } satisfies CodexAppServerNotification)
    }
  }

  private handleExit(reason: string) {
    if (this.exited) {
      return
    }
    this.exited = true
    this.resolveExited()
    const detail = this.lastStderr ? `${reason}: ${this.lastStderr.split('\n').slice(-3).join(' ')}` : reason
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(detail))
      this.pending.delete(id)
    }
    this.emit('exit', detail)
  }
}
