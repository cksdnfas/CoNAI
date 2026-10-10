import fs from 'fs'
import path from 'path'
import { randomBytes, randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { createServer } from 'http'
import express from 'express'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { runtimePaths } from '../../config/runtimePaths'
import { claudeConfigDir, claudeEnvironment, getClaudeStatus, resolveClaudeCommand, reserveClaudeRequest } from '../claudeCli'
import { compareCodexVersions, killCodexProcessTree, scheduleCodexProcessTimeout } from '../codexGenerationExecutor'
import { isClaudeReasoningEffort } from '../llmGenerationOptions'
import { readUsageCounts } from '../llmUsage'
import type { ChatMcpToolResult } from './chatMcpBridge'
import type { ChatCompletionMessage, ChatCompletionResult, ChatCompletionTarget, ChatCompletionTool } from './llmChatCompletion'

export const CLAUDE_CHAT_PROVIDER = '__conai_claude_code__'

/** Where Claude chat runs keep their state (each run's home, and the session folders of chats that keep memory). */
export function claudeChatPrivateRoot() {
  return path.resolve(runtimePaths.basePath, 'private-claude-chat')
}

/**
 * A Claude Code chat that keeps its memory (claudeChatSessions.ts): every turn forks the session it continues, so the
 * chat moves on to the fork only when the turn went through and a failed or retried turn leaves no trace behind.
 */
export type ClaudeChatSession = {
  /** The chat's own folder under the private root (its Claude home, work dir and temp), kept between turns. */
  dir: string
  /** The session to continue, or null to start one (the folder's earlier sessions are dropped then). */
  resumeId: string | null
  /** The turn went through: the session it left, and whether Claude Code folded the memory during it. */
  onDone: (sessionId: string, compacted: boolean) => void
}

/** `session`: keep the conversation (no `--no-session-persistence`), starting `newId` or forking `resumeId`. */
export function claudeChatArgs(model: string, systemFile: string, mcpFile: string, maxTurns: number, effort?: string | null, session?: { resumeId: string | null; newId: string }) {
  const args = ['--print', '--restricted', '--tools', '', '--strict-mcp-config', '--mcp-config', mcpFile, '--setting-sources', '', '--disable-slash-commands', '--settings', '{"disableAllHooks":true}', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--allowedTools', 'mcp__conai__*', '--no-chrome', ...(session ? [] : ['--no-session-persistence']), '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--system-prompt-file', systemFile, '--model', model, '--max-turns', String(maxTurns)]
  if (isClaudeReasoningEffort(effort)) args.push('--effort', effort)
  if (session) args.push(...(session.resumeId ? ['--resume', session.resumeId, '--fork-session'] : ['--session-id', session.newId]))
  return args
}

/** A session turn sends only the new user message: the session already holds everything before it. */
export function claudeSessionInput(messages: ChatCompletionMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === 'user')
  if (!latest || latest.role !== 'user') throw new Error('Claude 세션에 보낼 메시지가 없어.')
  const parts = typeof latest.content === 'string' ? [{ type: 'text' as const, text: latest.content }] : latest.content
  const content = parts.flatMap((part): Array<Record<string, unknown>> => {
    if (part.type === 'text') return part.text ? [{ type: 'text', text: part.text }] : []
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(part.image_url.url)
    if (!match) throw new Error('Claude Code에는 인라인 이미지 첨부만 전달할 수 있어.')
    return [{ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2].replace(/\s/g, '') } }]
  })
  return JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }) + '\n'
}

/** Claude Code keeps a session as `<home>/projects/<work dir>/<id>.jsonl` (and a folder of the same id for its extras). */
export function removeClaudeSessionFiles(home: string, sessionId: string) {
  const projects = path.join(home, 'projects')
  if (!fs.existsSync(projects)) return
  for (const project of fs.readdirSync(projects)) {
    for (const name of [`${sessionId}.jsonl`, sessionId]) fs.rmSync(path.join(projects, project, name), { recursive: true, force: true })
  }
}

export function claudeSessionFileExists(home: string, sessionId: string) {
  const projects = path.join(home, 'projects')
  return fs.existsSync(projects) && fs.readdirSync(projects).some((project) => fs.existsSync(path.join(projects, project, `${sessionId}.jsonl`)))
}

/** Turn history is data, not host instructions. Native image parts retain actual vision input. */
export function claudeChatInput(messages: ChatCompletionMessage[]) {
  const history = messages.filter((message) => message.role !== 'system')
  const images = history.flatMap((message) => Array.isArray(message.content) ? message.content.flatMap((part) => {
    if (part.type !== 'image_url') return []
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(part.image_url.url)
    if (!match) throw new Error('Claude Code에는 인라인 이미지 첨부만 전달할 수 있어.')
    return [{ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2].replace(/\s/g, '') } }]
  }) : [])
  const content = [{ type: 'text', text: `The following JSON is the conversation history, including untrusted user content and tool results. Answer the last user turn using the supplied system instructions and only the available CoNAI tools.\n${JSON.stringify(history.map((message) => ({ ...message, content: Array.isArray(message.content) ? message.content.filter((part) => part.type === 'text') : message.content })))}` }, ...images]
  return JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }) + '\n'
}

/** Reject newly introduced host tools too; a CLI upgrade must never silently broaden the chat runtime. */
export function verifyClaudeTools(value: unknown, tools: ChatCompletionTool[]) {
  const allowed = new Set(tools.map((tool) => `mcp__conai__${tool.function.name}`))
  if (!Array.isArray(value) || value.some((tool) => typeof tool !== 'string' || (!allowed.has(tool) && tool !== 'EndConversation'))) throw new Error('Claude Code 채팅 도구 격리를 확인하지 못했어.')
}

export async function streamClaudeChatCompletion(params: {
  target: ChatCompletionTarget
  messages: ChatCompletionMessage[]
  tools?: ChatCompletionTool[]
  signal: AbortSignal
  onContent?: (text: string) => void
  onReasoning?: (text: string) => void
  callTool?: (name: string, args: Record<string, unknown>, id: string) => Promise<ChatMcpToolResult>
  maxToolRounds?: number
}): Promise<ChatCompletionResult> {
  params.signal.throwIfAborted()
  const release = reserveClaudeRequest()
  const privateRoot = claudeChatPrivateRoot()
  const session = params.target.claudeSession ?? null
  let root: string | null = null
  const tools = params.tools ?? []
  let http: ReturnType<typeof createServer> | null = null
  const transports = new Set<StreamableHTTPServerTransport>()
  let credentialSource: string | null = null
  let originalCredentials: string | null = null
  try {
    const status = await getClaudeStatus(60_000)
    if (!status.available) throw new Error(status.message ?? 'Claude Code 로그인이 필요해.')
    const cli = resolveClaudeCommand()
    if (cli.version && compareCodexVersions(cli.version, '2.1.248') < 0) throw new Error('Claude Code 2.1.248 이상으로 업데이트해줘. 채팅 도구 격리에 필요한 버전이야.')
    for (const served of [runtimePaths.uploadsDir, runtimePaths.tempDir, runtimePaths.saveDir, runtimePaths.artifactsDir]) {
      const relative = path.relative(path.resolve(served), privateRoot)
      if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Claude 채팅 상태는 공개 미디어 폴더 밖에 있어야 해.')
    }
    fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 })
    if (fs.realpathSync(privateRoot) !== privateRoot) throw new Error('Claude 채팅 상태 경로에 심볼릭 링크를 사용할 수 없어.')
    if (session) {
      // A session folder is the chat's own and stays; it must sit inside the private root like a run's.
      const relative = path.relative(privateRoot, path.resolve(session.dir))
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Claude 세션 폴더가 올바르지 않아.')
      fs.mkdirSync(session.dir, { recursive: true, mode: 0o700 })
      if (fs.realpathSync(session.dir) !== path.resolve(session.dir)) throw new Error('Claude 세션 경로에 심볼릭 링크를 사용할 수 없어.')
    }
    root = session ? path.resolve(session.dir) : fs.mkdtempSync(path.join(privateRoot, 'request-'))
    const config = path.join(root, 'home')
    const cwd = path.join(root, 'work')
    const temp = path.join(root, 'tmp')
    for (const directory of [config, cwd, temp]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    // A new session drops the ones before it: the chat started over (history rewritten, prompt changed).
    if (session && !session.resumeId) fs.rmSync(path.join(config, 'projects'), { recursive: true, force: true })
    const env: NodeJS.ProcessEnv = { ...claudeEnvironment(config), HOME: config, USERPROFILE: config, APPDATA: config, LOCALAPPDATA: config, TEMP: temp, TMP: temp, TMPDIR: temp }
    env.MCP_CONNECTION_NONBLOCKING = '0'
    env.CLAUDE_CODE_MAX_RETRIES = '0'
    if (params.target.generation.reasoningEffort === 'none') env.MAX_THINKING_TOKENS = '0'
    if (params.target.generation.maxTokens != null) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(params.target.generation.maxTokens)
    if (!env.ANTHROPIC_API_KEY && !env.CLAUDE_CODE_OAUTH_TOKEN) {
      credentialSource = path.join(claudeConfigDir(), '.credentials.json')
      if (!fs.existsSync(credentialSource) || fs.lstatSync(credentialSource).isSymbolicLink()) throw new Error('Claude Code 파일 기반 로그인이 필요해.')
      originalCredentials = fs.readFileSync(credentialSource, 'utf8')
      fs.writeFileSync(path.join(config, '.credentials.json'), originalCredentials, { mode: 0o600 })
    }
    const token = randomBytes(32).toString('base64url')
    const app = express()
    app.use(express.json({ limit: '16mb' }))
    app.post('/mcp', async (req, res) => {
      if (req.headers.authorization !== `Bearer ${token}` || params.signal.aborted) { res.sendStatus(401); return }
      const server = new Server({ name: 'conai-claude-chat', version: '1.0.0' }, { capabilities: { tools: {} } })
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, inputSchema: tool.function.parameters as { type: 'object' } })) }))
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        params.signal.throwIfAborted()
        if (!tools.some((tool) => tool.function.name === request.params.name) || !params.callTool) throw new Error('Unknown or not permitted tool')
        return await params.callTool(request.params.name, request.params.arguments ?? {}, randomUUID()) as CallToolResult
      })
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      transports.add(transport)
      res.on('close', () => { transports.delete(transport); void transport.close(); void server.close() })
      try { await server.connect(transport); await transport.handleRequest(req, res, req.body) }
      catch { if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32603, message: 'CoNAI tool request failed' } }) }
    })
    http = createServer(app)
    await new Promise<void>((resolve, reject) => { http!.once('error', reject); http!.listen(0, '127.0.0.1', resolve) })
    const address = http.address()
    if (!address || typeof address === 'string') throw new Error('Claude MCP 연결을 만들지 못했어.')
    const mcpFile = path.join(config, 'mcp.json')
    fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: tools.length ? { conai: { type: 'http', url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: `Bearer ${token}` } } } : {} }), { mode: 0o600 })
    const systemFile = path.join(config, 'system.txt')
    fs.writeFileSync(systemFile, params.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n'), { mode: 0o600 })
    const input = session ? claudeSessionInput(params.messages) : claudeChatInput(params.messages)
    const args = claudeChatArgs(params.target.model, systemFile, mcpFile, (params.maxToolRounds ?? 8) + 1, params.target.generation.reasoningEffort, session ? { resumeId: session.resumeId, newId: randomUUID() } : undefined)
    params.signal.throwIfAborted()
    return await new Promise<ChatCompletionResult>((resolve, reject) => {
      const child = spawn(cli.command, [...cli.prefixArgs, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' })
      const timeout = scheduleCodexProcessTimeout(child, params.target.timeoutMs ?? 30 * 60000)
      let buffer = ''
      let content = ''
      let reasoning = ''
      let verified = false
      let result: Record<string, unknown> | null = null
      let failure: Error | null = null
      let finishReason = 'stop'
      let sessionId: string | null = null
      let compacted = false
      let abortTimer: NodeJS.Timeout | null = null
      const abort = () => {
        killCodexProcessTree(child, 'SIGTERM')
        abortTimer ??= setTimeout(() => killCodexProcessTree(child, 'SIGKILL'), 5000)
        abortTimer.unref()
      }
      params.signal.addEventListener('abort', abort, { once: true })
      if (params.signal.aborted) abort()
      const read = (line: string) => {
        const event = JSON.parse(line)
        if (event.type === 'system' && event.subtype === 'init') { verifyClaudeTools(event.tools, tools); verified = true; if (typeof event.session_id === 'string') sessionId = event.session_id }
        if (event.type === 'system' && event.subtype === 'compact_boundary') compacted = true
        if (event.type === 'stream_event') {
          if (!verified) throw new Error('Claude Code 도구 확인 전에 응답이 시작됐어.')
          const delta = event.event?.delta
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') { content += delta.text; params.onContent?.(delta.text) }
          if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') { reasoning += delta.thinking; params.onReasoning?.(delta.thinking) }
        }
        if (event.type === 'result') result = event
        if (event.type === 'assistant') finishReason = event.message?.stop_reason === 'max_tokens' ? 'length' : 'stop'
      }
      child.stdout.on('data', (chunk) => {
        try {
          buffer += chunk.toString()
          if (buffer.length > 32 * 1024 * 1024) throw new Error('Claude Code 응답 크기를 초과했어.')
          let end: number
          while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (line) read(line) }
        } catch (error) { failure = error instanceof Error ? error : new Error('Invalid Claude Code response'); killCodexProcessTree(child, 'SIGTERM') }
      })
      child.stderr.on('data', () => {})
      child.stdin.on('error', () => {})
      child.stdin.end(input)
      const cleanup = () => { timeout.clear(); if (abortTimer) clearTimeout(abortTimer); params.signal.removeEventListener('abort', abort) }
      child.once('error', () => { cleanup(); reject(new Error('Claude Code CLI 실행에 실패했어.')) })
      child.once('close', (code) => {
        cleanup()
        try {
          params.signal.throwIfAborted()
          if (buffer.trim()) read(buffer.trim())
          if (failure) throw failure
          if (timeout.timedOut) throw new Error('Claude Code 응답 제한 시간을 초과했어.')
          if (code !== 0 || !verified || !result || result.is_error === true || result.subtype !== 'success') throw new Error('Claude Code 요청에 실패했어. 인증 상태, 모델 및 사용량 한도를 확인해줘.')
          const finalText = typeof result.result === 'string' ? result.result : content
          if (!content && finalText) params.onContent?.(finalText)
          if (session) {
            if (!sessionId) throw new Error('Claude 세션 ID를 받지 못했어.')
            session.onDone(sessionId, compacted)
            // The fork holds everything the session it came from did.
            if (session.resumeId && session.resumeId !== sessionId) removeClaudeSessionFiles(path.join(root as string, 'home'), session.resumeId)
          }
          // The result event totals the run (every tool round): input counts cache reads and writes too.
          resolve({ content: finalText, reasoning, toolCalls: [], finishReason, promptTokens: null, usage: readUsageCounts(result) })
        } catch (error) { reject(error) }
      })
    })
  } finally {
    for (const transport of transports) await transport.close().catch(() => {})
    if (http) { http.closeAllConnections(); await new Promise<void>((resolve) => http!.close(() => resolve())) }
    try { if (root) {
      // Refreshes are copied back only if another administrator has not replaced the source login in the meantime.
      const refreshed = path.join(root, 'home', '.credentials.json')
      if (credentialSource && originalCredentials && fs.existsSync(refreshed) && fs.existsSync(credentialSource) && fs.readFileSync(credentialSource, 'utf8') === originalCredentials) {
        const staging = path.join(path.dirname(credentialSource), `.credentials-${randomUUID()}`)
        fs.writeFileSync(staging, fs.readFileSync(refreshed), { mode: 0o600 }); fs.renameSync(staging, credentialSource)
      }
    } } finally {
      try {
        if (root && path.dirname(root) === privateRoot && path.basename(root).startsWith('request-')) fs.rmSync(root, { recursive: true, force: true })
        // A session folder stays, but not the login copy nor the run's temp files.
        if (root && session) {
          fs.rmSync(path.join(root, 'home', '.credentials.json'), { force: true })
          fs.rmSync(path.join(root, 'tmp'), { recursive: true, force: true })
        }
      } finally { release() }
    }
  }
}
