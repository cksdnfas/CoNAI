import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { AgentSessionEvent, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { runtimePaths } from '../../config/runtimePaths'
import type { LlmTokenCounts } from '../llmUsage'
import type { ChatMcpToolResult } from './chatMcpBridge'
import type { ClaudeChatSession } from './claudeChatCompletion'
import type { ChatCompletionMessage, ChatCompletionResult, ChatCompletionTarget, ChatCompletionTool } from './llmChatCompletion'

/**
 * API LLM chats that run through pi (ChatLlmRuntime 'pi'): the pi agent SDK, embedded in-process, keeps the chat as
 * a session file and drives the model ↔ tool rounds on the profile's own connection and model. Its draw is memory:
 * when the context fills, pi folds the older part into a summary and carries on — between tool rounds of one long
 * reply too — where CoNAI's own path can only shed turns and cut results (fitChatContext).
 *
 * Isolation: no pi settings, credentials, extensions, skills or context files are read (an in-memory settings
 * manager, a resource loader that finds nothing, a private agent dir); its built-in tools (read, bash, edit…) stay
 * off and the run is refused if any tool but CoNAI's is active; install telemetry and cache warming are off.
 */

/** A pi chat's session, kept like a Claude Code one (claudeChatSessions.ts): every turn forks the file it continues. */
export type PiChatSession = ClaudeChatSession

type PiSdk = typeof import('@earendil-works/pi-coding-agent')

/** The provider id the profile's connection is registered under, in a model runtime of its own per run. */
const PI_PROVIDER = 'conai'
const PI_SESSION_ID = /^[\w.-]{1,160}$/
/** The window pi folds at when the server does not name its context (a hosted API). */
const DEFAULT_CONTEXT_WINDOW = 32_768
const TOOL_BUDGET_NOTE = 'The tool budget for this reply is used up. Do not call tools; answer now with what you have.'

// tsc turns `import()` into `require()` for CommonJS output, and pi is an ES module only: keep a real dynamic import.
const importModule = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>
let sdk: Promise<PiSdk> | null = null

export function loadPiSdk(): Promise<PiSdk> {
  sdk ??= (importModule('@earendil-works/pi-coding-agent') as Promise<PiSdk>).catch((error: unknown) => {
    sdk = null
    throw new Error(`pi 런타임을 불러오지 못했어: ${error instanceof Error ? error.message : String(error)}`)
  })
  return sdk
}

/** Where pi chat runs keep their state (each chat's session folder). */
export function piChatPrivateRoot() {
  return path.resolve(runtimePaths.basePath, 'private-pi-chat')
}

/** A session id kept on the chat is the session file's name: `<sessions dir>/<id>.jsonl`. */
export function piSessionFile(dir: string, sessionId: string) {
  return path.join(dir, 'sessions', `${sessionId}.jsonl`)
}

export function piSessionFileExists(dir: string, sessionId: string) {
  return PI_SESSION_ID.test(sessionId) && fs.existsSync(piSessionFile(dir, sessionId))
}

/** The session folder must sit inside the private root, which must sit outside every folder the app serves. */
function preparePrivateDir(dir: string) {
  const root = piChatPrivateRoot()
  for (const served of [runtimePaths.uploadsDir, runtimePaths.tempDir, runtimePaths.saveDir, runtimePaths.artifactsDir]) {
    const relative = path.relative(path.resolve(served), root)
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('pi 채팅 상태는 공개 미디어 폴더 밖에 있어야 해.')
  }
  const relative = path.relative(root, path.resolve(dir))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('pi 세션 폴더가 올바르지 않아.')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  if (fs.realpathSync(root) !== root) throw new Error('pi 채팅 상태 경로에 심볼릭 링크를 사용할 수 없어.')
  for (const sub of ['sessions', 'work', 'agent']) fs.mkdirSync(path.join(dir, sub), { recursive: true, mode: 0o700 })
  if (fs.realpathSync(dir) !== path.resolve(dir)) throw new Error('pi 세션 경로에 심볼릭 링크를 사용할 수 없어.')
}

/** The request's latest user message as pi's prompt: its text, and its inline images. */
export function piPromptInput(messages: ChatCompletionMessage[]) {
  const latest = [...messages].reverse().find((message) => message.role === 'user')
  if (!latest || latest.role !== 'user') throw new Error('pi 세션에 보낼 메시지가 없어.')
  if (typeof latest.content === 'string') return { text: latest.content, images: [] }
  const images = latest.content.flatMap((part) => {
    if (part.type !== 'image_url') return []
    const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(part.image_url.url)
    if (!match) throw new Error('pi에는 인라인 이미지 첨부만 전달할 수 있어.')
    return [{ type: 'image' as const, mimeType: match[1], data: match[2].replace(/\s/g, '') }]
  })
  return { text: latest.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n'), images }
}

/** A CoNAI tool result (MCP content) as pi's: text and images go through, anything else as its JSON. */
export function piToolResult(result: ChatMcpToolResult) {
  const content = (result.content ?? []).map((item) => {
    const part = item as { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown }
    if (part.type === 'text' && typeof part.text === 'string') return { type: 'text' as const, text: part.text }
    if (part.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string') return { type: 'image' as const, data: part.data, mimeType: part.mimeType }
    return { type: 'text' as const, text: JSON.stringify(item) }
  })
  return { content: content.length ? content : [{ type: 'text' as const, text: '(no output)' }], details: {}, ...(result.isError ? { isError: true } : {}) }
}

/**
 * The compaction budget for a context window: pi folds the memory once the context passes `window - reserve`, and
 * keeps the latest `keepRecent` tokens verbatim. Its defaults (16k / 20k) suit a large hosted model; a small local
 * context gets proportionate ones.
 */
export function piCompactionSettings(contextWindow: number) {
  return {
    enabled: true,
    reserveTokens: Math.min(16_384, Math.max(1024, Math.floor(contextWindow * 0.2))),
    keepRecentTokens: Math.min(20_000, Math.max(1024, Math.floor(contextWindow * 0.25))),
  }
}

/** The run's model, as pi registers it: the connection's OpenAI-compatible API and the profile's options. */
export function piModelConfig(target: ChatCompletionTarget, contextWindow: number, vision: boolean) {
  const effort = target.generation.reasoningEffort
  const reasoning = effort === 'low' || effort === 'medium' || effort === 'high'
  const sampling = { ...(target.generation.extraParams ?? {}), ...(target.generation.temperature != null ? { temperature: target.generation.temperature } : {}) }
  return {
    thinkingLevel: reasoning ? effort : 'off' as const,
    provider: {
      baseUrl: target.endpoint.replace(/\/chat\/completions\/?$/, ''),
      api: 'openai-completions' as const,
      // pi lists a model only when its provider has a key; a local server without one ignores it.
      apiKey: target.apiKey || 'none',
      models: [{
        id: target.model, name: target.model,
        input: vision ? ['text' as const, 'image' as const] : ['text' as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        reasoning, contextWindow,
        maxTokens: target.generation.maxTokens ?? Math.min(8192, Math.floor(contextWindow / 4)),
        ...(Object.keys(sampling).length ? { samplingParams: sampling } : {}),
      }],
    },
  }
}

/** Every pi tool must be one of CoNAI's: a pi upgrade must never quietly give the chat its own tools. */
export function verifyPiTools(active: readonly string[], tools: ChatCompletionTool[]) {
  const allowed = new Set(tools.map((tool) => tool.function.name))
  if (active.some((name) => !allowed.has(name))) throw new Error('pi 채팅 도구 격리를 확인하지 못했어.')
}

const addUsage = (total: LlmTokenCounts, usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined) => {
  if (!usage) return
  total.inputTokens += (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
  total.cachedInputTokens += usage.cacheRead ?? 0
  total.outputTokens += usage.output ?? 0
}

export async function streamPiChatCompletion(params: {
  target: ChatCompletionTarget
  messages: ChatCompletionMessage[]
  tools?: ChatCompletionTool[]
  signal: AbortSignal
  onContent?: (text: string) => void
  onReasoning?: (text: string) => void
  /** Any sign of life (a tool running, a compaction), so a quiet stretch is not taken for a stuck server. */
  onActivity?: () => void
  callTool?: (name: string, args: Record<string, unknown>, id: string) => Promise<ChatMcpToolResult>
  maxToolRounds?: number
}): Promise<ChatCompletionResult> {
  params.signal.throwIfAborted()
  const session = params.target.piSession
  if (!session) throw new Error('pi 채팅에는 세션이 필요해.')
  const pi = await loadPiSdk()
  preparePrivateDir(session.dir)
  const dir = path.resolve(session.dir)
  const sessionsDir = path.join(dir, 'sessions')
  const cwd = path.join(dir, 'work')
  const agentDir = path.join(dir, 'agent')
  const tools = params.tools ?? []
  const contextWindow = params.target.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const { thinkingLevel, provider } = piModelConfig(params.target, contextWindow, Boolean(params.target.piVision))

  // A turn continues a copy of the session, so a failed or retried turn leaves the chat on the file it was on.
  let file: string | null = null
  if (session.resumeId) {
    if (!piSessionFileExists(dir, session.resumeId)) throw new Error('이어갈 pi 세션이 없어.')
    file = piSessionFile(dir, `${randomUUID()}`)
    fs.copyFileSync(piSessionFile(dir, session.resumeId), file)
  } else {
    // A new session drops the ones before it: the chat started over (history rewritten, prompt changed).
    for (const name of fs.readdirSync(sessionsDir)) fs.rmSync(path.join(sessionsDir, name), { recursive: true, force: true })
  }
  const sessionManager = file ? pi.SessionManager.open(file, sessionsDir, cwd) : pi.SessionManager.create(cwd, sessionsDir)
  const modelRuntime = await pi.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  modelRuntime.registerProvider(PI_PROVIDER, provider)
  const model = modelRuntime.getModel(PI_PROVIDER, params.target.model)
  if (!model) throw new Error('pi에 모델을 등록하지 못했어.')
  const system = params.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
  const settingsManager = pi.SettingsManager.inMemory({
    compaction: piCompactionSettings(contextWindow),
    retry: { enabled: true, maxRetries: 2, ...(params.target.timeoutMs != null ? { provider: { timeoutMs: params.target.timeoutMs } } : {}) },
    enableInstallTelemetry: false,
    cacheWarming: 'off',
    defaultTools: [],
    images: { blockImages: !params.target.piVision },
  })
  // Nothing is discovered (no skills, templates, themes or context files; the private dirs hold no extensions). One
  // inline extension sends CoNAI's system prompt as it is: pi's own sections (its working dir among them) stay out.
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    disabledBuiltinExtensions: ['mcp', 'llama.cpp', 'codemode', 'tool-search'],
    systemPrompt: system,
    extensionFactories: [{ name: 'conai-system-prompt', factory: (api) => { api.on('before_agent_start', () => ({ systemPrompt: system })) } }],
    extensionsOverride: (base) => {
      if (base.extensions.length !== 1 || base.errors.length > 0) throw new Error('pi 채팅 확장 격리를 확인하지 못했어.')
      return base
    },
  })
  await resourceLoader.reload()

  let round = 0
  const customTools: ToolDefinition[] = tools.map((tool) => ({
    name: tool.function.name,
    label: tool.function.name,
    description: tool.function.description ?? '',
    parameters: (tool.function.parameters ?? { type: 'object', properties: {} }) as ToolDefinition['parameters'],
    execute: async (toolCallId, args) => {
      params.signal.throwIfAborted()
      params.onActivity?.()
      if (!params.callTool) throw new Error('Unknown or not permitted tool')
      if (round > (params.maxToolRounds ?? 8)) return { content: [{ type: 'text' as const, text: TOOL_BUDGET_NOTE }], details: {}, isError: true }
      return piToolResult(await params.callTool(tool.function.name, (args ?? {}) as Record<string, unknown>, toolCallId))
    },
  }))

  const { session: agent } = await pi.createAgentSession({
    cwd, agentDir, model, thinkingLevel, modelRuntime, resourceLoader, settingsManager, sessionManager,
    customTools, tools: customTools.map((tool) => tool.name),
  })
  // This run's model answers, in order (a compaction rebuilds the session's messages, so they are collected here).
  const produced: Array<Extract<AgentSessionEvent, { type: 'message_end' }>['message'] & { role: 'assistant' }> = []
  let content = ''
  let reasoning = ''
  let separate = false
  let compacted = false
  const abort = () => { void agent.abort() }
  params.signal.addEventListener('abort', abort, { once: true })
  const unsubscribe = agent.subscribe((event: AgentSessionEvent) => {
    params.onActivity?.()
    if (event.type === 'turn_start') round += 1
    // Past the budget the tools go (from the next turn, as pi applies it), so the model has to answer in text.
    if (event.type === 'turn_end' && round >= (params.maxToolRounds ?? 8)) agent.setActiveToolsByName([])
    // Each assistant message's text starts a paragraph of its own (a round's note, then the answer).
    if (event.type === 'message_start' && content && !content.endsWith('\n\n')) separate = true
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      if (update.type === 'text_delta' && update.delta) {
        const delta = separate ? `${content.endsWith('\n') ? '\n' : '\n\n'}${update.delta}` : update.delta
        separate = false
        content += delta
        params.onContent?.(delta)
      }
      if (update.type === 'thinking_delta' && update.delta) {
        reasoning += update.delta
        params.onReasoning?.(update.delta)
      }
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') produced.push(event.message)
    if (event.type === 'compaction_end' && event.result && !event.aborted) compacted = true
  })
  let succeeded = false
  try {
    verifyPiTools(agent.getActiveToolNames(), tools)
    const input = piPromptInput(params.messages)
    params.signal.throwIfAborted()
    await agent.prompt(input.text, { expandPromptTemplates: false, ...(input.images.length ? { images: input.images } : {}) })
    params.signal.throwIfAborted()
    const last = produced.at(-1)
    if (!last) throw new Error('pi가 답변을 만들지 못했어.')
    if (last.stopReason === 'error') throw new Error(`pi 요청에 실패했어: ${last.errorMessage ?? '알 수 없는 오류'}`)
    if (last.stopReason === 'aborted') throw new Error('pi 요청이 중단됐어.')
    const finalText = last.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
    if (!content && finalText) { content = finalText; params.onContent?.(finalText) }
    const sessionFile = agent.sessionFile
    if (!sessionFile || !fs.existsSync(sessionFile)) throw new Error('pi 세션 파일을 저장하지 못했어.')
    const sessionId = path.basename(sessionFile, '.jsonl')
    if (!PI_SESSION_ID.test(sessionId) || path.dirname(path.resolve(sessionFile)) !== sessionsDir) throw new Error('pi 세션 파일 위치가 올바르지 않아.')
    session.onDone(sessionId, compacted)
    succeeded = true
    // The fork holds everything the session it came from did.
    if (session.resumeId && session.resumeId !== sessionId) fs.rmSync(piSessionFile(dir, session.resumeId), { force: true })
    const usage: LlmTokenCounts = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
    for (const message of produced) addUsage(usage, message.usage)
    // The prompt pi sent is its whole session, not the request CoNAI estimated: no prompt tokens for calibration.
    return { content, reasoning, toolCalls: [], finishReason: last.stopReason === 'length' ? 'length' : 'stop', promptTokens: null, usage }
  } finally {
    unsubscribe()
    params.signal.removeEventListener('abort', abort)
    const written = agent.sessionFile
    agent.dispose()
    if (!succeeded) {
      if (file) fs.rmSync(file, { force: true })
      else if (written && path.dirname(path.resolve(written)) === sessionsDir) fs.rmSync(written, { force: true })
    }
  }
}
