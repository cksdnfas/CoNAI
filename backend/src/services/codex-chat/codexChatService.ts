import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { PORTS, isCodexReasoningEffort, type CodexReasoningEffort } from '@conai/shared'
import { runtimePaths } from '../../config/runtimePaths'
import type { McpRequester } from '../../mcp/context'
import { onBeforeCodexCliUpdate, isCodexCliUpdating } from '../codexCliMaintenance'
import { resolveCodexCommand } from '../codexGenerationExecutor'
import { getCodexModelSuggestions } from '../codexGenerationOptions'
import { CodexAppServerClient, type CodexAppServerNotification } from './codexAppServerClient'
import { isCodexChatAdmin, issueCodexChatMcpToken, revokeCodexChatMcpToken } from './codexChatAccess'
import { loadCodexChatSettings, onCodexChatSettingsChange } from './codexChatSettings'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatToolCall } from './codexChatStore'

const SESSION_IDLE_MS = 15 * 60 * 1000
const THREAD_REQUEST_TIMEOUT_MS = 2 * 60 * 1000
const CLI_PROBE_TIMEOUT_MS = 20 * 1000
const TOOL_SUMMARY_LENGTH = 600
const MAX_REFERENCES_PER_CALL = 24
const MCP_SERVER_NAME = 'conai'
const MCP_TOKEN_ENV = 'CONAI_CHAT_MCP_TOKEN'

/** Everything that could run code, touch files, browse or spawn agents. `shell_tool` is required (fail-closed). */
const DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'in_app_browser',
  'multi_agent',
  'multi_agent_v2',
  'apps',
  'plugins',
  'image_generation',
  'view_image',
  'hooks',
  'goals',
  'sleep_tool',
  'tool_suggest',
  'skill_search',
  'workspace_dependencies',
  'worktrees',
  'memories',
  'realtime_conversation',
]

const DEVELOPER_INSTRUCTIONS = [
  'You are the assistant built into CoNAI, a local app for managing and generating AI images.',
  `You act only through the "${MCP_SERVER_NAME}" MCP tools: searching images and prompts, reading metadata, generating with NovelAI/ComfyUI/Codex, running workflows and organizing groups.`,
  'You cannot run shell commands, read or edit files, or browse the web. Do not try.',
  'Reply in the language the user writes in. For Korean, use casual 반말. Keep replies short.',
  'For generation, prefer submit_generation_job, then poll get_generation_job until it finishes, and mention the resulting history ids.',
  'NovelAI requests must always use n_samples 1 (two or more samples cost paid Anlas). Submit separate jobs for more images.',
  'Ask for confirmation before bulk or destructive changes such as moving many images between groups.',
].join('\n')

export type CodexChatStreamEvent =
  | { type: 'user'; message: CodexChatMessageRecord }
  | { type: 'delta'; text: string }
  | { type: 'tool'; call: CodexChatToolCall }
  | { type: 'done'; message: CodexChatMessageRecord }
  | { type: 'error'; message: string }

type TurnState = {
  chatThreadId: number
  codexThreadId: string
  turnId: string | null
  agentMessages: Map<string, string>
  /** Items the model marked as interim commentary; the stored reply keeps only the final answer. */
  commentaryItems: Set<string>
  toolCalls: Map<string, CodexChatToolCall>
  listeners: Set<(event: CodexChatStreamEvent) => void>
  lastError: string | null
  finished: Promise<CodexChatMessageRecord>
  resolveFinished: (message: CodexChatMessageRecord) => void
}

type Session = {
  key: string
  requester: McpRequester
  client: CodexAppServerClient
  token: string
  model: string | null
  reasoningEffort: CodexReasoningEffort | null
  loadedThreads: Set<string>
  activeTurns: Map<string, TurnState>
  idleTimer: NodeJS.Timeout | null
}

export class CodexChatError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

const sessions = new Map<string, Session>()
const startingSessions = new Map<string, Promise<Session>>()

function sessionKey(requester: McpRequester) {
  return requester.accountId === null ? 'bootstrap' : `account:${requester.accountId}`
}

function chatWorkDir() {
  const dir = path.join(runtimePaths.tempDir, 'codex-chat')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function runCodexCli(args: string[]) {
  const resolved = resolveCodexCommand()
  return new Promise<string>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(resolved.command, [...resolved.prefixArgs, ...args], {
      cwd: chatWorkDir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`codex ${args.join(' ')} timed out`))
    }, CLI_PROBE_TIMEOUT_MS)
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(stderr.trim() || `codex ${args.join(' ')} exited with ${code}`))
      }
    })
  })
}

/** Feature flags this CLI knows (disabling an unknown one is a startup error) and MCP servers from the user's config. */
async function probeCodexCli() {
  const [featuresOutput, mcpOutput] = await Promise.all([
    runCodexCli(['features', 'list']),
    runCodexCli(['mcp', 'list', '--json']).catch(() => '[]'),
  ])
  const knownFeatures = new Set(featuresOutput.split('\n').map((line) => line.trim().split(/\s+/)[0]).filter(Boolean))
  let mcpServers: string[] = []
  try {
    const parsed = JSON.parse(mcpOutput) as Array<{ name?: unknown }>
    mcpServers = parsed.map((entry) => (typeof entry.name === 'string' ? entry.name : '')).filter((name) => name && name !== MCP_SERVER_NAME)
  } catch {
    mcpServers = []
  }
  return { knownFeatures, mcpServers }
}

function buildAppServerArgs(knownFeatures: Set<string>, mcpServers: string[]) {
  if (!knownFeatures.has('shell_tool')) {
    throw new CodexChatError('이 Codex CLI 버전에서는 셸 도구를 끌 수 없어서 채팅을 시작하지 않았어.', 503)
  }

  const port = process.env.PORT || String(PORTS.BACKEND_DEFAULT)
  return [
    ...DISABLED_FEATURES.filter((feature) => knownFeatures.has(feature)).flatMap((feature) => ['--disable', feature]),
    '-c', 'web_search="disabled"',
    '-c', 'notify=[]',
    '-c', 'project_doc_fallback_filenames=[]',
    '-c', `mcp_servers.${MCP_SERVER_NAME}.url="http://127.0.0.1:${port}/mcp"`,
    '-c', `mcp_servers.${MCP_SERVER_NAME}.bearer_token_env_var="${MCP_TOKEN_ENV}"`,
    '-c', `mcp_servers.${MCP_SERVER_NAME}.default_tools_approval_mode="approve"`,
    // The server's own Codex config may list other MCP servers (local tools, REPLs); chat only gets CoNAI.
    ...mcpServers.filter((name) => /^[A-Za-z0-9_-]+$/.test(name)).flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]),
  ]
}

function threadOverrides(session: Session) {
  return {
    model: session.model,
    ...(session.reasoningEffort ? { config: { model_reasoning_effort: session.reasoningEffort } } : {}),
    cwd: chatWorkDir(),
    approvalPolicy: 'never',
    sandbox: 'read-only',
    developerInstructions: DEVELOPER_INSTRUCTIONS,
  }
}

function clearIdleTimer(session: Session) {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer)
    session.idleTimer = null
  }
}

function scheduleIdleClose(session: Session) {
  clearIdleTimer(session)
  if (session.activeTurns.size > 0) {
    return
  }
  session.idleTimer = setTimeout(() => closeSession(session, 'idle'), SESSION_IDLE_MS)
  session.idleTimer.unref()
}

function closeSession(session: Session, reason: string) {
  if (sessions.get(session.key) === session) {
    sessions.delete(session.key)
  }
  clearIdleTimer(session)
  revokeCodexChatMcpToken(session.token)
  for (const turn of session.activeTurns.values()) {
    finishTurn(session, turn, 'failed', `Codex 채팅이 종료됐어 (${reason}).`)
  }
  session.client.close()
}

function emit(turn: TurnState, event: CodexChatStreamEvent) {
  for (const listener of turn.listeners) {
    try {
      listener(event)
    } catch {
      // A disconnected HTTP stream must not break the turn.
    }
  }
}

function truncate(value: string) {
  return value.length > TOOL_SUMMARY_LENGTH ? `${value.slice(0, TOOL_SUMMARY_LENGTH)}…` : value
}

/** Pull history ids and composite hashes out of a tool result so the UI can show thumbnails. */
function collectReferences(value: unknown, historyIds: Set<number>, compositeHashes: Set<string>, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferences(item, historyIds, compositeHashes, depth + 1))
    return
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/^history_?ids?$/i.test(key)) {
      for (const id of Array.isArray(entry) ? entry : [entry]) {
        if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0 && historyIds.size < MAX_REFERENCES_PER_CALL) {
          historyIds.add(id)
        }
      }
    } else if (/^composite_?hash(es)?$/i.test(key)) {
      for (const hash of Array.isArray(entry) ? entry : [entry]) {
        if (typeof hash === 'string' && /^[0-9a-f]{16,128}$/i.test(hash) && compositeHashes.size < MAX_REFERENCES_PER_CALL) {
          compositeHashes.add(hash)
        }
      }
    } else {
      collectReferences(entry, historyIds, compositeHashes, depth + 1)
    }
  }
}

function toToolCall(item: Record<string, unknown>): CodexChatToolCall {
  const status = item.status === 'completed' ? 'completed' : item.status === 'failed' ? 'failed' : 'running'
  const result = item.result as { content?: unknown[]; structuredContent?: unknown } | null | undefined
  const error = item.error as { message?: string } | null | undefined
  const historyIds = new Set<number>()
  const compositeHashes = new Set<string>()
  const texts: string[] = []

  for (const content of result?.content ?? []) {
    const text = content && typeof content === 'object' ? (content as { text?: unknown }).text : undefined
    if (typeof text !== 'string') {
      continue
    }
    texts.push(text)
    try {
      collectReferences(JSON.parse(text), historyIds, compositeHashes)
    } catch {
      // Plain-text tool output carries no references.
    }
  }
  if (result?.structuredContent) {
    collectReferences(result.structuredContent, historyIds, compositeHashes)
  }

  return {
    id: String(item.id ?? ''),
    tool: String(item.tool ?? ''),
    status,
    arguments: item.arguments ?? null,
    summary: error?.message ? truncate(error.message) : texts.length > 0 ? truncate(texts.join('\n')) : null,
    historyIds: [...historyIds],
    compositeHashes: [...compositeHashes],
  }
}

function finishTurn(session: Session, turn: TurnState, status: CodexChatMessageRecord['status'], error: string | null) {
  if (session.activeTurns.get(turn.codexThreadId) !== turn) {
    return
  }
  session.activeTurns.delete(turn.codexThreadId)

  const finalTexts = [...turn.agentMessages.entries()].filter(([itemId]) => !turn.commentaryItems.has(itemId)).map(([, text]) => text)
  const content = (finalTexts.length > 0 ? finalTexts : [...turn.agentMessages.values()])
    .map((text) => text.trim())
    .filter(Boolean)
    .join('\n\n')
  const toolCalls = [...turn.toolCalls.values()].map((call) => (call.status === 'running' ? { ...call, status: 'failed' as const } : call))
  const messageId = CodexChatStore.addMessage({
    thread_id: turn.chatThreadId,
    role: 'assistant',
    content,
    tool_calls: toolCalls,
    status,
    error,
  })
  const message = CodexChatStore.listMessages(turn.chatThreadId).find((entry) => entry.id === messageId) as CodexChatMessageRecord
  emit(turn, { type: 'done', message })
  turn.listeners.clear()
  turn.resolveFinished(message)
  scheduleIdleClose(session)
}

function handleNotification(session: Session, notification: CodexAppServerNotification) {
  const { method, params } = notification
  const threadId = typeof params.threadId === 'string' ? params.threadId : null
  const turn = threadId ? session.activeTurns.get(threadId) : undefined
  if (!turn) {
    return
  }

  if (method === 'item/agentMessage/delta') {
    const itemId = String(params.itemId ?? '')
    const delta = typeof params.delta === 'string' ? params.delta : ''
    turn.agentMessages.set(itemId, `${turn.agentMessages.get(itemId) ?? ''}${delta}`)
    emit(turn, { type: 'delta', text: delta })
    return
  }

  if (method === 'item/started' || method === 'item/completed') {
    const item = (params.item ?? {}) as Record<string, unknown>
    if (item.type === 'mcpToolCall') {
      const call = toToolCall(item)
      turn.toolCalls.set(call.id, call)
      emit(turn, { type: 'tool', call })
    } else if (item.type === 'agentMessage') {
      const itemId = String(item.id ?? '')
      if (item.phase === 'commentary') {
        turn.commentaryItems.add(itemId)
      }
      if (method === 'item/completed' && typeof item.text === 'string') {
        // The completed item is authoritative; deltas can be dropped when a stream reconnects.
        turn.agentMessages.set(itemId, item.text)
      }
    }
    return
  }

  if (method === 'error') {
    const error = params.error as { message?: string } | undefined
    turn.lastError = error?.message ?? turn.lastError
    return
  }

  if (method === 'turn/completed') {
    const completed = (params.turn ?? {}) as { status?: string; error?: { message?: string } | null }
    const status = completed.status === 'interrupted' ? 'interrupted' : completed.status === 'failed' ? 'failed' : 'completed'
    finishTurn(session, turn, status, status === 'failed' ? completed.error?.message ?? turn.lastError ?? 'Codex turn failed' : null)
  }
}

async function startSession(requester: McpRequester): Promise<Session> {
  const { knownFeatures, mcpServers } = await probeCodexCli()
  const args = buildAppServerArgs(knownFeatures, mcpServers)
  const token = issueCodexChatMcpToken(requester)
  let client: CodexAppServerClient | undefined
  let model: string | null = null
  let reasoningEffort: CodexReasoningEffort | null = null
  try {
    client = await CodexAppServerClient.start({
      args,
      cwd: chatWorkDir(),
      env: { ...process.env, NO_COLOR: '1', [MCP_TOKEN_ENV]: token },
    })
    const [{ config }, catalog] = await Promise.all([
      client.request<{ config: { model?: string | null; model_reasoning_effort?: unknown } }>('config/read', { includeLayers: false }),
      getCodexModelSuggestions(),
    ])
    const settings = loadCodexChatSettings()
    assertChatAvailable(requester)
    model = settings.model || config.model || null
    const selectedModel = model ? catalog.models.find((entry) => entry.id === model) : catalog.models.find((entry) => entry.isDefault)
    const supported = selectedModel?.supportedReasoningEfforts
    if (settings.reasoningEffort && supported && !supported.includes(settings.reasoningEffort)) {
      throw new CodexChatError('선택한 모델에서 지원하지 않는 추론 강도야. 채팅 설정에서 바꿔줘.')
    }
    const configuredEffort = isCodexReasoningEffort(config.model_reasoning_effort) ? config.model_reasoning_effort : null
    // Resolve "default" again for each session so resuming a thread cannot retain a previous explicit effort.
    reasoningEffort = settings.reasoningEffort
      || (configuredEffort && (!supported || supported.includes(configuredEffort)) ? configuredEffort : null)
      || selectedModel?.defaultReasoningEffort
      || null
  } catch (error) {
    client?.close()
    revokeCodexChatMcpToken(token)
    throw error
  }

  const session: Session = {
    key: sessionKey(requester),
    requester,
    client,
    token,
    model,
    reasoningEffort,
    loadedThreads: new Set(),
    activeTurns: new Map(),
    idleTimer: null,
  }
  client.on('notification', (notification: CodexAppServerNotification) => handleNotification(session, notification))
  client.on('exit', (reason: string) => closeSession(session, reason))
  sessions.set(session.key, session)
  return session
}

async function ensureSession(requester: McpRequester) {
  const key = sessionKey(requester)
  const existing = sessions.get(key)
  if (existing?.client.isAlive) {
    clearIdleTimer(existing)
    return existing
  }

  let starting = startingSessions.get(key)
  if (!starting) {
    starting = startSession(requester).finally(() => startingSessions.delete(key))
    startingSessions.set(key, starting)
  }
  return starting
}

function assertChatAvailable(requester: McpRequester) {
  if (!loadCodexChatSettings().enabled) {
    throw new CodexChatError('Codex 채팅이 꺼져 있어.', 403)
  }
  if (!isCodexChatAdmin(requester.accountId)) {
    throw new CodexChatError('Codex 채팅은 관리자만 쓸 수 있어.', 403)
  }
  if (isCodexCliUpdating()) {
    throw new CodexChatError('Codex CLI 업데이트 중이야. 끝난 뒤 다시 보내줘.', 409)
  }
}

function requireThread(requester: McpRequester, threadId: number) {
  const thread = CodexChatStore.findThread(threadId, requester.accountId)
  if (!thread) {
    throw new CodexChatError('채팅을 찾을 수 없어.', 404)
  }
  return thread
}

/** Load the Codex thread into this process: start a new one, or resume from its rollout (a fresh one if that is gone). */
async function ensureCodexThread(session: Session, chatThreadId: number, codexThreadId: string | null) {
  if (codexThreadId && session.loadedThreads.has(codexThreadId)) {
    return codexThreadId
  }

  if (codexThreadId) {
    try {
      await session.client.request('thread/resume', { threadId: codexThreadId, ...threadOverrides(session) }, THREAD_REQUEST_TIMEOUT_MS)
      session.loadedThreads.add(codexThreadId)
      return codexThreadId
    } catch {
      // Rollout missing (CODEX_HOME reset, other account): continue in a new Codex thread.
    }
  }

  const started = await session.client.request<{ thread: { id: string } }>('thread/start', {
    ...threadOverrides(session),
    serviceName: 'conai',
  }, THREAD_REQUEST_TIMEOUT_MS)
  CodexChatStore.setCodexThreadId(chatThreadId, started.thread.id)
  session.loadedThreads.add(started.thread.id)
  return started.thread.id
}

function findActiveTurn(chatThreadId: number) {
  for (const session of sessions.values()) {
    for (const turn of session.activeTurns.values()) {
      if (turn.chatThreadId === chatThreadId) {
        return { session, turn }
      }
    }
  }
  return null
}

export const CodexChatService = {
  listThreads(requester: McpRequester) {
    return CodexChatStore.listThreads(requester.accountId)
  },

  createThread(requester: McpRequester) {
    assertChatAvailable(requester)
    const id = CodexChatStore.createThread(requester.accountId, '')
    return requireThread(requester, id)
  },

  getThread(requester: McpRequester, threadId: number) {
    const thread = requireThread(requester, threadId)
    const active = findActiveTurn(threadId)
    return {
      thread,
      messages: CodexChatStore.listMessages(threadId),
      running: active
        ? {
            text: [...active.turn.agentMessages.values()].join('\n\n'),
            toolCalls: [...active.turn.toolCalls.values()],
          }
        : null,
    }
  },

  async deleteThread(requester: McpRequester, threadId: number) {
    requireThread(requester, threadId)
    const active = findActiveTurn(threadId)
    if (active) {
      await CodexChatService.interrupt(requester, threadId).catch(() => undefined)
      finishTurn(active.session, active.turn, 'interrupted', null)
    }
    CodexChatStore.deleteThread(threadId)
  },

  /**
   * Send one user message and stream the turn to `listener`. Resolves with the stored assistant message.
   * The turn keeps running (and is stored) when the listener goes away, e.g. the browser closes the stream.
   */
  async sendMessage(requester: McpRequester, threadId: number, text: string, listener: (event: CodexChatStreamEvent) => void) {
    assertChatAvailable(requester)
    const thread = requireThread(requester, threadId)
    const trimmed = text.trim()
    if (!trimmed) {
      throw new CodexChatError('메시지를 입력해줘.')
    }
    if (findActiveTurn(threadId)) {
      throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    }

    const session = await ensureSession(requester)
    const codexThreadId = await ensureCodexThread(session, threadId, thread.codex_thread_id)

    let resolveFinished: (message: CodexChatMessageRecord) => void = () => {}
    const finished = new Promise<CodexChatMessageRecord>((resolve) => {
      resolveFinished = resolve
    })
    const turn: TurnState = {
      chatThreadId: threadId,
      codexThreadId,
      turnId: null,
      agentMessages: new Map(),
      commentaryItems: new Set(),
      toolCalls: new Map(),
      listeners: new Set([listener]),
      lastError: null,
      finished,
      resolveFinished,
    }
    session.activeTurns.set(codexThreadId, turn)
    clearIdleTimer(session)

    const userMessageId = CodexChatStore.addMessage({ thread_id: threadId, role: 'user', content: trimmed, tool_calls: [], status: 'completed', error: null })
    if (!thread.title) {
      CodexChatStore.renameThread(threadId, trimmed.replace(/\s+/g, ' '))
    }
    const userMessage = CodexChatStore.listMessages(threadId).find((entry) => entry.id === userMessageId) as CodexChatMessageRecord
    emit(turn, { type: 'user', message: userMessage })

    try {
      const response = await session.client.request<{ turn: { id: string } }>('turn/start', {
        threadId: codexThreadId,
        model: session.model,
        effort: session.reasoningEffort,
        input: [{ type: 'text', text: trimmed, text_elements: [] }],
      }, THREAD_REQUEST_TIMEOUT_MS)
      turn.turnId = response.turn.id
    } catch (error) {
      finishTurn(session, turn, 'failed', error instanceof Error ? error.message : 'Codex turn failed to start')
    }

    return turn.finished
  },

  async interrupt(requester: McpRequester, threadId: number) {
    requireThread(requester, threadId)
    const active = findActiveTurn(threadId)
    if (!active?.turn.turnId) {
      return
    }
    await active.session.client.request('turn/interrupt', { threadId: active.turn.codexThreadId, turnId: active.turn.turnId })
  },

  /** Close every chat process; resolves when they have exited (bounded so a stuck process cannot block updates). */
  async stopAllSessions(reason: string) {
    const exits = [...sessions.values()].map((session) => {
      closeSession(session, reason)
      return session.client.whenExited
    })
    await Promise.race([Promise.all(exits), new Promise((resolve) => setTimeout(resolve, 8000))])
  },
}

// Settings (including reasoning effort) apply to the next session; a CLI update must not replace binaries under a running process.
onCodexChatSettingsChange(() => void CodexChatService.stopAllSessions('설정 변경'))
onBeforeCodexCliUpdate(() => CodexChatService.stopAllSessions('CLI 업데이트'))
