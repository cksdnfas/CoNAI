import { Worker } from 'worker_threads'
import { CHAT_PAGE_LIMITS, type ChatPageValue, type PluginGenerationActionResult, type PluginServerStatus } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { subscribeToRuntimeEvents } from '../runtime-events/runtimeEventBus'
import type { QueueJobEventPayload } from '../../types/runtimeEvents'
import { AuthAccount } from '../../models/AuthAccount'
import type { McpRequester, McpRequestContext } from '../../mcp/context'
import { getPlugin, listPlugins, packageFile } from './pluginRegistry'
import { onPluginChanged, pluginDb, pluginToken, PluginError } from './pluginStore'
import { pluginDataDir } from './pluginData'
import {
  PLUGIN_SERVER_TOOL_SCOPES, clearPluginServerTools, pluginServerToolName, setPluginServerTool, setPluginServerToolInvoker,
  type PluginServerTool, type PluginServerToolResult, type PluginServerToolScope,
} from './pluginServerTools'
import { callTrustedAppTool, trustedAppToolDefinitions } from './pluginAppBridge'
import { callPluginLlm } from './pluginLlm'
import { callPluginTask, setPluginTaskInvoker } from './pluginTasks'
import { callPluginServerMedia } from './pluginServerMedia'
import type { RuntimeJobContext } from '../runtimeJobs/runtimeJobRunner'

/**
 * Optional server modules (`server.entry`): one worker thread per enabled plugin,
 * started with the app and on enable/update, stopped on disable/remove. The module's `activate(conai)` gets its own
 * SQLite database, hooks, app tool calls and tool registration (plugins/README.md). It is trusted code: the worker can
 * use every Node API, so only administrators install and enable it.
 */

/** Hooks a module may listen to; each one has a call site that waits for it. */
export const PLUGIN_SERVER_HOOKS = ['chat.instructions', 'generation.action', 'generation.queued', 'generation.finished'] as const
export type PluginServerHook = typeof PLUGIN_SERVER_HOOKS[number]
const HOOK_TIMEOUT_MS = 3_000
const ACTION_TIMEOUT_MS = 30_000
const NOTIFY_TIMEOUT_MS = 10_000
const REQUEST_TIMEOUT_MS = 10 * 60_000
const TOOL_TIMEOUT_MS = 10 * 60_000
const RESULT_LIMIT = 512 * 1024
const CRASH_WINDOW_MS = 5 * 60_000
const CRASH_LIMIT = 3

type Invocation = { requester: McpRequester | undefined; baseUrl?: string; workspace?: McpRequestContext['workspace']; signal?: AbortSignal; job?: RuntimeJobContext }
type Waiting = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout; invocation: string; controller: AbortController; cleanup: () => void }
type Server = {
  pluginId: string; digest: string; worker: Worker | null
  state: PluginServerStatus['state']; error: string | null
  tools: Map<string, PluginServerTool>; hooks: Set<string>
  waiting: Map<number, Waiting>; invocations: Map<string, Invocation>; seq: number
  crashes: number[]; stopping: boolean; restartTimer: NodeJS.Timeout | null
}
const servers = new Map<string, Server>()
let started = false
let stopEvents: (() => void) | null = null

// The worker's side: `conai` for the module, and the message loop. Plain CommonJS run with `eval`, so no build step
// has to ship a separate file; it reaches better-sqlite3 through the absolute path the host resolved.
const BOOTSTRAP = `
const { parentPort, workerData } = require('worker_threads');
const { pathToFileURL } = require('url');
const { AsyncLocalStorage } = require('async_hooks');
const path = require('path');
const scope = new AsyncLocalStorage();
const pending = new Map();
const hooks = new Map();
const tools = new Map();
const controllers = new Map();
let seq = 0;
let onRequest = null;
let onJob = null;
let shuttingDown = false;
let db = null;
const send = (message) => parentPort.postMessage(message);
const text = (value) => {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
};
const call = (method, params) => new Promise((resolve, reject) => {
  if (pending.size >= 64) { reject(new Error('Too many pending app calls')); return; }
  const id = ++seq;
  pending.set(id, { resolve, reject });
  const store = scope.getStore();
  send({ type: 'call', id, method, params, invocation: store ? store.invocation : null });
});
const conai = Object.freeze({
  id: workerData.pluginId,
  version: workerData.version,
  dataDir: workerData.dataDir,
  get db() {
    if (!db) {
      const Database = require(workerData.sqlite);
      db = new Database(path.join(workerData.dataDir, 'data.db'));
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
    }
    return db;
  },
  hooks: Object.freeze({
    on(name, handler) {
      if (typeof name !== 'string' || typeof handler !== 'function') throw new TypeError('hooks.on(name, handler)');
      if (!workerData.hooks.includes(name)) throw new TypeError('Unknown hook: ' + name + ' (known: ' + workerData.hooks.join(', ') + ')');
      hooks.set(name, handler);
      send({ type: 'hook', name });
    },
  }),
  tools: Object.freeze({
    call: (name, args) => call('tool', { name, arguments: args || {} }),
    list: () => call('tools', {}),
    register(definition) {
      if (!definition || typeof definition.name !== 'string' || typeof definition.handler !== 'function') throw new TypeError('tools.register({ name, description, inputSchema, scope, handler })');
      tools.set(definition.name, definition);
      send({ type: 'tool', tool: { name: definition.name, description: String(definition.description || ''), inputSchema: definition.inputSchema || { type: 'object', properties: {} }, scope: definition.scope || 'organize' } });
    },
  }),
  onRequest(handler) {
    if (typeof handler !== 'function') throw new TypeError('onRequest(handler)');
    onRequest = handler;
  },
  onJob(handler) {
    if (typeof handler !== 'function') throw new TypeError('onJob(handler)');
    onJob = handler;
  },
  jobs: Object.freeze({
    start: (input) => call('jobs.start', input),
    get: (jobId) => call('jobs.get', { jobId }),
    cancel: (jobId) => call('jobs.cancel', { jobId }),
  }),
  media: Object.freeze({
    resolve: (reference) => call('media.resolve', reference),
    save: (input) => call('media.save', input),
  }),
  llm: Object.freeze({
    profiles: () => call('llm.profiles', {}),
    asset: (input) => call('llm.asset', input),
    start: (input) => call('llm.start', input),
    get: (jobId) => call('llm.get', { jobId }),
    cancel: (jobId) => call('llm.cancel', { jobId }),
  }),
  background: Object.freeze({
    account: () => call('background.account', {}),
  }),
  log: (...values) => send({ type: 'log', level: 'info', text: values.map(text).join(' ') }),
  warn: (...values) => send({ type: 'log', level: 'warn', text: values.map(text).join(' ') }),
});
parentPort.on('message', async (message) => {
  if (message.type === 'shutdown') {
    shuttingDown = true;
    for (const controller of controllers.values()) controller.abort(new Error('Plugin stopped'));
    if (!controllers.size) send({ type: 'stopped' });
    return;
  }
  if (message.type === 'cancel') { controllers.get(message.invocation)?.abort(new Error('Plugin request cancelled')); return; }
  if (message.type === 'result') {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error !== undefined) entry.reject(new Error(message.error));
    else entry.resolve(message.value);
    return;
  }
  if (message.type !== 'invoke') return;
  const controller = new AbortController();
  controllers.set(message.invocation, controller);
  const tool = message.kind === 'tool' ? tools.get(message.name) : null;
  const handler = message.kind === 'job' ? onJob : message.kind === 'hook' ? hooks.get(message.name) : message.kind === 'tool' ? (tool && tool.handler) : onRequest;
  try {
    if (!handler) throw new Error('No ' + message.kind + ' handler' + (message.name ? ': ' + message.name : ''));
    const value = await scope.run({ invocation: message.invocation }, () => handler(message.input, { ...message.context, signal: controller.signal, report: (progress) => call('job.progress', progress) }));
    send({ type: 'reply', id: message.id, value: value === undefined ? null : value });
  } catch (error) {
    send({ type: 'reply', id: message.id, error: text(error) });
  } finally { controllers.delete(message.invocation); if (shuttingDown && !controllers.size) send({ type: 'stopped' }); }
});
(async () => {
  const loaded = await import(pathToFileURL(workerData.entry).href);
  const activate = loaded.activate || loaded.default;
  if (typeof activate === 'function') await activate(conai);
  send({ type: 'ready' });
})().catch((error) => send({ type: 'fatal', error: text(error) }));
`

let sqlitePath: string | null = null
function sqliteModule() {
  return sqlitePath ??= require.resolve('better-sqlite3')
}

/** Who a call the module makes on its own (a timer, its startup) runs as: the administrator who turned it on. */
function backgroundRequester(pluginId: string): McpRequester | undefined {
  const row = pluginDb().prepare('SELECT enabled_by FROM plugins WHERE id = ?').get(pluginId) as { enabled_by: number | null } | undefined
  if (!row) return undefined
  if (row.enabled_by === null) return { accountId: null, accountType: null }
  const account = AuthAccount.findById(row.enabled_by)
  return account && account.status === 'active' ? { accountId: account.id, accountType: account.account_type } : undefined
}

function finish(server: Server, id: number, outcome: { value?: unknown; error?: string }) {
  const waiting = server.waiting.get(id)
  if (!waiting) return
  server.waiting.delete(id)
  clearTimeout(waiting.timer)
  waiting.cleanup()
  if (outcome.error !== undefined) {
    waiting.controller.abort(new Error(outcome.error))
    server.worker?.postMessage({ type: 'cancel', invocation: waiting.invocation })
  }
  server.invocations.delete(waiting.invocation)
  if (outcome.error !== undefined) waiting.reject(new PluginError(outcome.error.split('\n')[0].slice(0, 1000), 502))
  else waiting.resolve(outcome.value)
}

function failAll(server: Server, message: string) {
  for (const id of [...server.waiting.keys()]) finish(server, id, { error: message })
}

async function answerCall(server: Server, message: { id: number; method: string; params: Record<string, unknown>; invocation: string | null }) {
  const reply = (outcome: { value?: unknown; error?: string }) => server.worker?.postMessage({ type: 'result', id: message.id, ...outcome })
  try {
    const invocation = message.invocation ? server.invocations.get(message.invocation) : undefined
    // A delayed handler must never inherit the enabling administrator after its caller's lease ended.
    if (message.invocation && !invocation) throw new PluginError('호출 문맥이 만료됐어. 새 요청에서 다시 호출해줘.', 410)
    const requester = invocation ? invocation.requester : backgroundRequester(server.pluginId)
    if (message.method === 'background.account') {
      // Which account the module's own calls run as, so it can keep per-account data apart from them.
      reply({ value: accountOf(backgroundRequester(server.pluginId)) })
    } else if (message.method.startsWith('llm.')) {
      reply({ value: await callPluginLlm(server.pluginId, requester, message.method.slice(4), message.params) })
    } else if (message.method.startsWith('jobs.')) {
      if (invocation?.job && message.method === 'jobs.start') throw new PluginError('작업 안에서 새 작업을 시작할 수 없어.')
      reply({ value: callPluginTask(server.pluginId, requester, message.method.slice(5), message.params) })
    } else if (message.method.startsWith('media.')) {
      reply({ value: await callPluginServerMedia(server.pluginId, requester, message.method.slice(6), message.params, invocation?.signal) })
    } else if (message.method === 'job.progress') {
      const job = invocation?.job
      if (!job) throw new PluginError('실행 중인 작업에서만 진행률을 보낼 수 있어.')
      const progress = message.params
      job.throwIfCancelled()
      job.report({ total: 100, processed: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
        ...(typeof progress.phase === 'string' ? { phase: progress.phase.slice(0, 80) } : {}),
        ...(typeof progress.message === 'string' ? { message: progress.message.slice(0, 500) } : {}) })
      reply({ value: null })
    } else if (message.method === 'tool') {
      const name = String(message.params.name ?? '')
      const args = message.params.arguments && typeof message.params.arguments === 'object' && !Array.isArray(message.params.arguments) ? message.params.arguments as Record<string, unknown> : {}
      reply({ value: await callTrustedAppTool(requester, name, args, invocation?.baseUrl, invocation?.workspace, invocation?.signal) })
    } else if (message.method === 'tools') {
      const tools = await trustedAppToolDefinitions(requester, invocation?.baseUrl, invocation?.workspace)
      reply({ value: tools.map(tool => ({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema })) })
    } else reply({ error: `Unknown call: ${message.method}` })
  } catch (error) {
    reply({ error: error instanceof Error ? error.message : String(error) })
  }
}

function onMessage(server: Server, message: Record<string, unknown>) {
  switch (message.type) {
    case 'ready':
      server.state = 'ready'; server.error = null
      return
    case 'fatal':
      server.state = 'error'; server.error = String(message.error ?? '').split('\n')[0].slice(0, 500)
      console.warn(`[plugin:${server.pluginId}] server module failed:`, message.error)
      void stopWorker(server)
      return
    case 'hook':
      server.hooks.add(String(message.name))
      return
    case 'tool': {
      const raw = message.tool as { name: string; description: string; inputSchema: unknown; scope: string }
      const name = pluginServerToolName(server.pluginId, raw.name)
      const scope = PLUGIN_SERVER_TOOL_SCOPES.includes(raw.scope as PluginServerToolScope) ? raw.scope as PluginServerToolScope : null
      const schema = raw.inputSchema && typeof raw.inputSchema === 'object' && !Array.isArray(raw.inputSchema) && (raw.inputSchema as { type?: unknown }).type === 'object' ? raw.inputSchema as Record<string, unknown> : null
      if (!name || !scope || !schema) {
        console.warn(`[plugin:${server.pluginId}] tool "${raw.name}" skipped: name a-z0-9_ (p_<plugin>_<tool> at most 64), scope ${PLUGIN_SERVER_TOOL_SCOPES.join('/')}, inputSchema { type: "object" }`)
        return
      }
      const tool: PluginServerTool = { name, pluginId: server.pluginId, localName: raw.name, description: raw.description.slice(0, 2000), inputSchema: schema, scope }
      server.tools.set(name, tool)
      setPluginServerTool(tool)
      return
    }
    case 'log': {
      const line = `[plugin:${server.pluginId}] ${String(message.text ?? '').slice(0, 4000)}`
      if (message.level === 'warn') console.warn(line)
      else console.log(line)
      return
    }
    case 'call':
      void answerCall(server, message as Parameters<typeof answerCall>[1])
      return
    case 'reply':
      finish(server, Number(message.id), message.error !== undefined ? { error: String(message.error) } : { value: message.value })
      return
  }
}

function startWorker(pluginId: string) {
  const plugin = getPlugin(pluginId)
  const entry = plugin.definition.server?.entry
  if (!entry) return
  const server: Server = servers.get(pluginId) ?? {
    pluginId, digest: plugin.digest, worker: null, state: 'starting', error: null, tools: new Map(), hooks: new Set(),
    waiting: new Map(), invocations: new Map(), seq: 0, crashes: [], stopping: false, restartTimer: null,
  }
  servers.set(pluginId, server)
  Object.assign(server, { digest: plugin.digest, state: 'starting', error: null, stopping: false })
  let worker: Worker
  try {
    worker = new Worker(BOOTSTRAP, {
      eval: true,
      name: `plugin:${pluginId}`,
      workerData: { pluginId, version: plugin.version, entry: packageFile(pluginId, plugin.version, entry), dataDir: pluginDataDir(pluginId), sqlite: sqliteModule(), hooks: [...PLUGIN_SERVER_HOOKS] },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    })
  } catch (error) {
    server.state = 'error'; server.error = error instanceof Error ? error.message : String(error)
    return
  }
  server.worker = worker
  worker.on('message', message => onMessage(server, message as Record<string, unknown>))
  worker.on('error', error => {
    server.error = error.message.split('\n')[0].slice(0, 500)
    console.warn(`[plugin:${pluginId}] server module error:`, error)
  })
  worker.on('exit', code => {
    if (server.worker !== worker) return
    server.worker = null
    clearPluginServerTools(pluginId)
    server.tools.clear(); server.hooks.clear()
    failAll(server, '플러그인 서버가 멈췄어.')
    // A crash: try again a few times, then leave it stopped with the reason.
    const now = Date.now()
    server.crashes = [...server.crashes.filter(at => now - at < CRASH_WINDOW_MS), now]
    server.state = 'error'
    server.error ??= `종료 코드 ${code}`
    if (server.crashes.length < CRASH_LIMIT) server.restartTimer = setTimeout(() => { server.restartTimer = null; if (started && !server.stopping) syncPluginServer(pluginId) }, 1_000)
    else server.error = `여러 번 멈춰서 중지했어: ${server.error}`
  })
}

async function stopWorker(server: Server) {
  if (server.restartTimer) { clearTimeout(server.restartTimer); server.restartTimer = null }
  const worker = server.worker
  server.stopping = true
  clearPluginServerTools(server.pluginId)
  server.tools.clear(); server.hooks.clear()
  failAll(server, '플러그인 서버가 멈췄어.')
  if (worker) {
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); worker.off('message', message); worker.off('exit', done); resolve() }
      const message = (value: { type?: string }) => { if (value.type === 'stopped') done() }
      const timer = setTimeout(done, 3000)
      worker.on('message', message); worker.once('exit', done)
      try { worker.postMessage({ type: 'shutdown' }) } catch { done() }
    })
    server.worker = null
    await worker.terminate().catch(() => undefined)
  }
  if (server.state !== 'error') server.state = 'off'
}

/** Brings one plugin's server in line with its row: running when enabled with a module, at the installed digest. */
export function syncPluginServer(pluginId: string) {
  if (!started) return
  let wanted: ReturnType<typeof getPlugin> | null = null
  try { wanted = getPlugin(pluginId) } catch { wanted = null }
  if (wanted && !wanted.definition.server) wanted = null
  const current = servers.get(pluginId)
  const restart = current && (!wanted || current.digest !== wanted.digest || (!current.worker && !current.restartTimer))
  const run = async () => {
    if (current && restart) {
      await stopWorker(current)
      if (!wanted) servers.delete(pluginId)
      else {
        // A new package starts with a clean record; a crash restart keeps counting.
        if (current.digest !== wanted.digest) current.crashes = []
        current.state = 'starting'
      }
    }
    if (wanted && !servers.get(pluginId)?.worker) startWorker(pluginId)
  }
  return run().catch(error => console.warn(`[plugin:${pluginId}] server sync failed:`, error))
}

export function startPluginServers() {
  if (started) return
  started = true
  stopEvents = subscribeToRuntimeEvents(record => {
    if (record.name === 'queue.job.created' || record.name === 'queue.job.status') notifyGenerationHooks(record.name, record.payload as QueueJobEventPayload)
  })
  onPluginChanged(id => syncPluginServer(id))
  for (const plugin of listPlugins()) if (plugin.manifest.server) void syncPluginServer(plugin.manifest.id)
}

export async function closePluginServers() {
  started = false
  stopEvents?.(); stopEvents = null
  await Promise.all([...servers.values()].map(stopWorker))
  servers.clear()
}

export function pluginServerStatus(pluginId: string): PluginServerStatus {
  const server = servers.get(pluginId)
  if (!server) return { state: 'off', error: null, tools: [], hooks: [] }
  return { state: server.state, error: server.error, tools: [...server.tools.values()].map(tool => ({ name: tool.name, description: tool.description })), hooks: [...server.hooks].sort() }
}

function invoke(pluginId: string, kind: 'hook' | 'tool' | 'request' | 'job', name: string, input: unknown, context: Record<string, unknown>, invocation: Invocation, timeoutMs: number, signal?: AbortSignal) {
  const server = servers.get(pluginId)
  const worker = server?.worker
  if (!server || !worker || server.state !== 'ready') return Promise.reject(new PluginError('플러그인 서버가 실행 중이 아니야.', 503))
  if (signal?.aborted) return Promise.reject(signal.reason)
  if (server.waiting.size >= 32) return Promise.reject(new PluginError('실행 중인 플러그인 요청이 너무 많아.', 429))
  const id = ++server.seq
  const token = pluginToken()
  const controller = new AbortController()
  server.invocations.set(token, { ...invocation, signal: controller.signal })
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => finish(server, id, { error: '플러그인 서버가 제때 답하지 않았어.' }), timeoutMs)
    const abort = () => finish(server, id, { error: '플러그인 요청을 취소했어.' })
    server.waiting.set(id, { resolve, reject, timer, invocation: token, controller, cleanup: () => signal?.removeEventListener('abort', abort) })
    signal?.addEventListener('abort', abort, { once: true })
    try { worker.postMessage({ type: 'invoke', id, kind, name, input, context, invocation: token }) } catch (error) {
      finish(server, id, { error: error instanceof Error ? error.message : String(error) })
    }
  })
}

const accountOf = (requester: McpRequester | undefined) => requester ? { id: requester.accountId, type: requester.accountType } : null

setPluginTaskInvoker((pluginId, data, requester, job) => invoke(pluginId, 'job', '', data,
  { account: accountOf(requester), jobId: job.jobId }, { requester, job }, TOOL_TIMEOUT_MS, job.signal))

/** A plugin page's `api.server(body)`: the module's `onRequest({ body, account, page })`. */
export async function requestPluginServer(pluginId: string, body: unknown, requester: McpRequester | undefined, page: Record<string, unknown>, baseUrl?: string, workspace?: McpRequestContext['workspace'], signal?: AbortSignal) {
  const value = await invoke(pluginId, 'request', '', { body, account: accountOf(requester), page }, { account: accountOf(requester) }, { requester, baseUrl, workspace }, REQUEST_TIMEOUT_MS, signal)
  if (Buffer.byteLength(JSON.stringify(value ?? null)) > 2 * 1024 * 1024) throw new PluginError('플러그인 서버 응답이 2MB를 넘었어.', 502)
  return value
}

/** Text, an MCP result as is (`{ content: [...] }`), or any other value as JSON. */
function toolResult(value: unknown): PluginServerToolResult {
  let result: PluginServerToolResult
  if (value && typeof value === 'object' && Array.isArray((value as { content?: unknown }).content)) result = value as PluginServerToolResult
  else result = { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2) }] }
  if (Buffer.byteLength(JSON.stringify(result)) > RESULT_LIMIT) return { isError: true, content: [{ type: 'text', text: '플러그인 도구 결과가 512KB를 넘었어.' }] }
  return result
}
setPluginServerToolInvoker(async (tool, args, requester, signal) => {
  try {
    if (signal?.aborted) throw new PluginError('취소됐어.', 499)
    return toolResult(await invoke(tool.pluginId, 'tool', tool.localName, args, { account: accountOf(requester), tool: tool.name }, { requester }, TOOL_TIMEOUT_MS, signal))
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }
  }
})

export type ChatInstructionsContext = {
  engine: 'llm' | 'claude' | 'pi' | 'codex'; threadId: number | null; group: boolean
  profile: { id: number; name: string }
}
/**
 * `chat.instructions`: every listening module, in plugin id order, gets the finished instructions and may return
 * changed ones (a string). A module that fails or takes over three seconds is skipped for this request.
 */
export async function applyChatInstructionHooks(instructions: string, context: ChatInstructionsContext, requester: McpRequester | undefined) {
  let current = instructions
  for (const server of listeningTo('chat.instructions')) {
    try {
      const value = await invoke(server.pluginId, 'hook', 'chat.instructions', { instructions: current, ...context, account: accountOf(requester) }, { account: accountOf(requester) }, { requester }, HOOK_TIMEOUT_MS)
      if (typeof value === 'string') current = value
    } catch (error) {
      console.warn(`[plugin:${server.pluginId}] chat.instructions skipped:`, error instanceof Error ? error.message : error)
    }
  }
  return current
}
function listeningTo(name: PluginServerHook) {
  return [...servers.values()].filter(server => server.state === 'ready' && server.hooks.has(name)).sort((a, b) => a.pluginId.localeCompare(b.pluginId))
}

function actionValue(value: unknown): ChatPageValue {
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value
  if (typeof value === 'string' && value.length <= CHAT_PAGE_LIMITS.text) return value
  if (Array.isArray(value) && value.length <= 32 && value.every(item => typeof item === 'string' && item.length <= CHAT_PAGE_LIMITS.text)) return [...value]
  throw new PluginError('플러그인이 돌려준 입력값이 올바르지 않아.', 502)
}

/**
 * `generation.action`: a plugin's button next to Generate. The module gets the screen's form fields and may answer
 * `{ message, fill }`; the browser checks `fill` against the same fields before the form changes.
 */
export async function runGenerationActionHook(pluginId: string, input: { action: string; surface: string; fields: Array<{ id: string; label: string; type: string; value: ChatPageValue }> }, requester: McpRequester | undefined): Promise<PluginGenerationActionResult> {
  const server = servers.get(pluginId)
  if (!server || server.state !== 'ready' || !server.hooks.has('generation.action')) throw new PluginError('플러그인 서버가 이 버튼에 답할 준비가 안 됐어.', 503)
  const value = await invoke(pluginId, 'hook', 'generation.action', { ...input, account: accountOf(requester) }, { account: accountOf(requester) }, { requester }, ACTION_TIMEOUT_MS)
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new PluginError('플러그인 답은 { message, fill } 객체여야 해.', 502)
  const { message, fill } = value as { message?: unknown; fill?: unknown }
  const result: PluginGenerationActionResult = {}
  if (typeof message === 'string' && message.trim()) result.message = message.trim().slice(0, 500)
  if (fill !== undefined && fill !== null) {
    if (typeof fill !== 'object' || Array.isArray(fill) || Object.keys(fill).length > CHAT_PAGE_LIMITS.changes) throw new PluginError('플러그인이 돌려준 입력값이 올바르지 않아.', 502)
    result.fill = Object.fromEntries(Object.entries(fill).map(([key, item]) => {
      if (key.length > 100) throw new PluginError('플러그인이 돌려준 입력값이 올바르지 않아.', 502)
      return [key, actionValue(item)]
    }))
  }
  return result
}

const FINISHED = new Set(['completed', 'failed', 'cancelled'])

/**
 * `generation.queued` / `generation.finished`: every listening module hears about each queue job (any service, any
 * caller) without holding it up. A finished job lists its history rows; images may still be post-processing then.
 */
function notifyGenerationHooks(name: 'queue.job.created' | 'queue.job.status', job: QueueJobEventPayload) {
  const hook: PluginServerHook | null = name === 'queue.job.created' ? 'generation.queued'
    : job.previous_status !== job.status && FINISHED.has(job.status) ? 'generation.finished' : null
  if (!hook) return
  const listening = listeningTo(hook)
  if (!listening.length) return
  const account = job.requested_by_account_id ? AuthAccount.findById(job.requested_by_account_id) : null
  const requester = account && account.status === 'active' ? { accountId: account.id, accountType: account.account_type } : undefined
  let history: Array<{ id: number; compositeHash: string | null }> = []
  if (hook === 'generation.finished') {
    try {
      history = (getUserSettingsDb().prepare('SELECT id, composite_hash FROM api_generation_history WHERE queue_job_id = ? ORDER BY id LIMIT 32').all(job.job_id) as Array<{ id: number; composite_hash: string | null }>)
        .map(row => ({ id: row.id, compositeHash: row.composite_hash }))
    } catch { history = [] }
  }
  const input = {
    jobId: job.job_id, service: job.service_type, status: job.status, workflowId: job.workflow_id,
    ...(hook === 'generation.finished' ? { failureCode: job.failure_code, history } : {}),
    account: accountOf(requester),
  }
  for (const server of listening) {
    invoke(server.pluginId, 'hook', hook, input, { account: accountOf(requester) }, { requester }, NOTIFY_TIMEOUT_MS)
      .catch(error => console.warn(`[plugin:${server.pluginId}] ${hook} skipped:`, error instanceof Error ? error.message : error))
  }
}

/** Whether any module listens to the hook, so callers can skip the work around it. */
export function hasPluginServerHook(name: PluginServerHook) {
  for (const server of servers.values()) if (server.state === 'ready' && server.hooks.has(name)) return true
  return false
}
