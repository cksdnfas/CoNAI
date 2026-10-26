import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import type { AgentSessionEvent, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { runtimePaths } from '../../config/runtimePaths'
import { loadPiSdk, reservePiRun } from '../piRuntime'
import { isInsideServedDir, isPathStrictlyInside } from '../../utils/pathResolver'
import type { LlmTokenCounts } from '../llmUsage'
import { buildOpenAiGenerationFields } from '../llmGenerationOptions'
import type { ChatMcpToolResult } from './chatMcpBridge'
import type { ClaudeChatSession } from './claudeChatCompletion'
import type { ChatCompletionMessage, ChatCompletionResult, ChatCompletionTarget, ChatCompletionTool } from './llmChatCompletion'
import { CATALOG_RUN_TOOL } from '../../mcp/toolCatalog'
import { chatToolRoundLimit, loadChatSettings } from './chatSettings'
import { noteTextToolCalls, recoverTextToolCalls, textToolCallFilter, type TextToolCallTools } from './textToolCalls'

/**
 * API LLM chats that run through pi (ChatLlmRuntime 'pi'): the pi agent SDK, embedded in-process, keeps the chat as
 * a session file and drives the model ↔ tool rounds on the profile's own connection and model. Its draw is memory:
 * when the context fills, pi folds the older part into a summary and carries on — between tool rounds of one long
 * reply too — where CoNAI's own path can only shed turns and cut results (fitChatContext).
 *
 * Isolation: no pi settings, credentials, extensions, skills or context files are read (an in-memory settings
 * manager, a resource loader that finds nothing, a private agent dir); its built-in tools (read, bash, edit…) stay
 * off and the run is refused if any tool but CoNAI's is active; install telemetry and cache warming are off.
 * The one exception is pi's `codemode` tool when the chat settings turn it on (ChatSettings.piCodemode): its scripts
 * run in pi's QuickJS sandbox (no files, network or Node), reach only CoNAI's tools through the same execute below,
 * get no `models` API, and make at most as many calls each as the tool round limit (ChatSettings.toolRoundLimit).
 */

/** A pi chat's session, kept like a Claude Code one (claudeChatSessions.ts): every turn forks the file it continues. */
export type PiChatSession = ClaudeChatSession

/** The provider id the profile's connection is registered under, in a model runtime of its own per run. */
const PI_PROVIDER = 'conai'
const PI_SESSION_ID = /^[\w.-]{1,160}$/
/** The window pi folds at when the server does not name its context (a hosted API). */
const DEFAULT_CONTEXT_WINDOW = 32_768
const TOOL_BUDGET_NOTE = 'The tool budget for this reply is used up. Do not call tools; answer now with what you have.'
const CODEMODE_TOOL = 'codemode'
/** One codemode script makes at most as many tool calls as the reply has rounds; past it they fail, so a loop in a script cannot run the tools up. */
const codemodeBudgetNote = (calls: number) => `A codemode script may make at most ${calls} tool calls. Return what you have.`
/** The files codemode writes to the OS temp folder (long output, shown images), named in its result. */
const CODEMODE_OUTPUT_FILE = /pi-codemode-[0-9a-f]{16}\.[a-z]{3,4}/g

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
  if (isInsideServedDir(root)) throw new Error('pi 채팅 상태는 공개 미디어 폴더 밖에 있어야 해.')
  if (!isPathStrictlyInside(root, dir)) throw new Error('pi 세션 폴더가 올바르지 않아.')
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
 * The reply room in a context window: the profile's max output tokens (else a quarter of the window, at most 8192) as a
 * ceiling, cut to half the window so a cap near the window's size still leaves the conversation room. pi folds the
 * session before it would no longer leave this room, and sends it as the request's max_tokens.
 */
export function piReplyRoom(contextWindow: number, maxTokens: number | null | undefined) {
  return Math.max(1, Math.min(maxTokens ?? Math.min(8192, Math.floor(contextWindow / 4)), Math.floor(contextWindow / 2)))
}

/**
 * The compaction budget for a context window: pi folds the memory once the context passes `window - reserve`, and
 * keeps the latest `keepRecent` tokens verbatim. Its defaults (16k / 20k) suit a large hosted model; a small local
 * context gets proportionate ones. The reserve always holds the reply room, so a folded session plus a full reply fits.
 */
export function piCompactionSettings(contextWindow: number, maxTokens?: number | null) {
  return {
    enabled: true,
    reserveTokens: Math.max(Math.min(16_384, Math.max(1024, Math.floor(contextWindow * 0.2))), piReplyRoom(contextWindow, maxTokens)),
    keepRecentTokens: Math.min(20_000, Math.max(1024, Math.floor(contextWindow * 0.25))),
  }
}

/** The run's model, as pi registers it: the connection's OpenAI-compatible API and the profile's options. */
export function piModelConfig(target: ChatCompletionTarget, contextWindow: number, vision: boolean) {
  const effort = target.generation.reasoningEffort
  const reasoning = effort === 'low' || effort === 'medium' || effort === 'high'
  const sampling = buildOpenAiGenerationFields({ ...target.generation, maxTokens: null }, target.thinkingSwitch)
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
        compat: { maxTokensField: 'max_tokens' as const },
        maxTokens: piReplyRoom(contextWindow, target.generation.maxTokens),
        ...(Object.keys(sampling).length ? { samplingParams: sampling } : {}),
      }],
    },
  }
}

type PiAssistantMessage = Extract<AgentSessionEvent, { type: 'message_end' }>['message'] & { role: 'assistant' }
type PiToolCall = Extract<PiAssistantMessage['content'][number], { type: 'toolCall' }>

/**
 * A finished pi answer with the tool calls it wrote as text made real, and native calls to catalogued tools sent
 * through run_tool (pi runs only the tools it was given). `held`: the text the stream kept back (textToolCallFilter);
 * `tail` is what of it to show. Null: nothing to change. pi executes the returned message's calls (message_end).
 */
export function recoverPiToolCalls(message: PiAssistantMessage, available: TextToolCallTools, held: { text: string; marked: boolean }) {
  const direct = new Set(available.tools.map((tool) => tool.function.name))
  const routable = (name: string) => !direct.has(name) && available.catalogued.has(name) && direct.has(CATALOG_RUN_TOOL)
  const native = message.content.filter((part): part is PiToolCall => part.type === 'toolCall')
  const text = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
  const written = native.length === 0 ? recoverTextToolCalls(text, held, available) : null
  if (written) {
    const firstText = message.content.findIndex((part) => part.type === 'text')
    const content = message.content.flatMap<PiAssistantMessage['content'][number]>((part, index) => part.type !== 'text' ? [part] : index === firstText && written.text ? [{ ...part, text: written.text }] : [])
    const calls: PiToolCall[] = written.calls.map((call) => ({ type: 'toolCall', id: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments) }))
    return { message: { ...message, content: [...content, ...calls], stopReason: message.stopReason === 'stop' ? 'toolUse' as const : message.stopReason }, tail: written.tail }
  }
  if (!native.some((call) => routable(call.name))) return null
  const content = message.content.map((part) => part.type === 'toolCall' && routable(part.name) ? { ...part, name: CATALOG_RUN_TOOL, arguments: { tool: part.name, arguments: part.arguments } } : part)
  return { message: { ...message, content }, tail: held.text }
}

/** Every pi tool must be one of CoNAI's (or `extra`, codemode when on): a pi upgrade must never quietly give the chat its own tools. */
export function verifyPiTools(active: readonly string[], tools: ChatCompletionTool[], extra: readonly string[] = []) {
  const allowed = new Set([...tools.map((tool) => tool.function.name), ...extra])
  if (active.some((name) => !allowed.has(name))) throw new Error('pi 채팅 도구 격리를 확인하지 못했어.')
}

const addUsage = (total: LlmTokenCounts, usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined) => {
  if (!usage) return
  total.inputTokens += (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
  total.cachedInputTokens += usage.cacheRead ?? 0
  total.outputTokens += usage.output ?? 0
}

/** A pi update waits until no run uses the loaded package. */
export async function streamPiChatCompletion(params: Parameters<typeof runPiChatCompletion>[0]): Promise<ChatCompletionResult> {
  params.signal.throwIfAborted()
  const release = reservePiRun()
  try { return await runPiChatCompletion(params) } finally { release() }
}

async function runPiChatCompletion(params: {
  target: ChatCompletionTarget
  messages: ChatCompletionMessage[]
  tools?: ChatCompletionTool[]
  signal: AbortSignal
  onContent?: (text: string) => void
  onReasoning?: (text: string) => void
  /** Cumulative provider usage, including compaction and requests completed before a failure. */
  onUsage?: (usage: LlmTokenCounts) => void
  /** Any sign of life (a tool running, a compaction), so a quiet stretch is not taken for a stuck server. */
  onActivity?: () => void
  callTool?: (name: string, args: Record<string, unknown>, id: string) => Promise<ChatMcpToolResult>
  catalogued?: ReadonlySet<string>
  maxToolRounds?: number
  research?: import('./chatResearch').ChatResearchExecution
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
  const toolRounds = params.maxToolRounds ?? chatToolRoundLimit()
  const codemode = tools.length > 0 && loadChatSettings().piCodemode
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
    compaction: params.research ? { enabled: false } : piCompactionSettings(contextWindow, params.target.generation.maxTokens),
    retry: { enabled: !params.research, maxRetries: params.research ? 0 : 2, ...(params.target.timeoutMs != null ? { provider: { timeoutMs: params.target.timeoutMs } } : {}) },
    enableInstallTelemetry: false,
    cacheWarming: 'off',
    defaultTools: [],
    images: { blockImages: !params.target.piVision },
  })
  let content = ''
  let separate = false
  // Tool calls written as text are recovered while the model has tools (they go once the budget is used up).
  let recovering = tools.length > 0
  // Each assistant message's text starts a paragraph of its own (a round's note, then the answer).
  const emitText = (text: string) => {
    if (!text) return
    const delta = separate ? `${content.endsWith('\n') ? '\n' : '\n\n'}${text}` : text
    separate = false
    content += delta
    params.onContent?.(delta)
  }
  const textFilter = textToolCallFilter(emitText)
  // Nothing is discovered (no skills, templates, themes or context files; the private dirs hold no extensions). One
  // inline extension sends CoNAI's system prompt as it is: pi's own sections (its working dir among them) stay out.
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    disabledBuiltinExtensions: ['mcp', 'llama.cpp', 'codemode', 'tool-search'],
    systemPrompt: system,
    extensionFactories: [{ name: 'conai-system-prompt', factory: (api) => {
      api.on('before_agent_start', () => ({ systemPrompt: system }))
      // Runs before the turn's tools: a replaced message is what pi executes and keeps (see recoverPiToolCalls).
      api.on('message_end', (event) => {
        if (event.message.role !== 'assistant') return
        const held = textFilter.end()
        const recovered = recovering ? recoverPiToolCalls(event.message, { tools, catalogued: params.catalogued ?? new Set() }, held) : null
        emitText(recovered ? recovered.tail : held.text)
        if (recovered && held.marked) noteTextToolCalls(params.target)
        return recovered ? { message: recovered.message } : undefined
      })
    } }, ...(codemode ? [{ name: 'conai-codemode', factory: pi.createCodemodeExtension({ models: false, mode: 'on' }) }] : [])],
    extensionsOverride: (base) => {
      if (base.extensions.length !== (codemode ? 2 : 1) || base.errors.length > 0) throw new Error('pi 채팅 확장 격리를 확인하지 못했어.')
      return base
    },
  })
  await resourceLoader.reload()

  let round = 0
  // Calls a codemode script makes reach execute as `<script's call id>/<n>`; counted per script.
  const scriptCalls = new Map<string, number>()
  const customTools: ToolDefinition[] = tools.map((tool) => ({
    name: tool.function.name,
    label: tool.function.name,
    description: tool.function.description ?? '',
    parameters: (tool.function.parameters ?? { type: 'object', properties: {} }) as ToolDefinition['parameters'],
    execute: async (toolCallId, args) => {
      params.signal.throwIfAborted()
      params.onActivity?.()
      if (!params.callTool) throw new Error('Unknown or not permitted tool')
      if (round > toolRounds) return { content: [{ type: 'text' as const, text: TOOL_BUDGET_NOTE }], details: {}, isError: true }
      const slash = toolCallId.lastIndexOf('/')
      if (codemode && slash > 0) {
        const script = toolCallId.slice(0, slash)
        const count = (scriptCalls.get(script) ?? 0) + 1
        scriptCalls.set(script, count)
        if (count > toolRounds) return { content: [{ type: 'text' as const, text: codemodeBudgetNote(toolRounds) }], details: {}, isError: true }
      }
      return piToolResult(await params.callTool(tool.function.name, (args ?? {}) as Record<string, unknown>, toolCallId))
    },
  }))

  const { session: agent } = await pi.createAgentSession({
    cwd, agentDir, model, thinkingLevel, modelRuntime, resourceLoader, settingsManager, sessionManager,
    customTools, tools: [...customTools.map((tool) => tool.name), ...(codemode ? [CODEMODE_TOOL] : [])],
  })
  // This run's model answers, in order (a compaction rebuilds the session's messages, so they are collected here).
  const produced: Array<Extract<AgentSessionEvent, { type: 'message_end' }>['message'] & { role: 'assistant' }> = []
  const usage: LlmTokenCounts = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
  let reportedUsage = false
  const noteUsage = (counts: Parameters<typeof addUsage>[1]) => {
    // pi initializes absent provider usage to zero; keep our fallback estimate available in that case.
    if (!counts || ![counts.input, counts.output, counts.cacheRead, counts.cacheWrite].some((value) => (value ?? 0) > 0)) return
    reportedUsage = true
    addUsage(usage, counts)
    params.onUsage?.({ ...usage })
  }
  let reasoning = ''
  let compacted = false
  let budgetStopped = false
  const abort = () => { void agent.abort() }
  params.signal.addEventListener('abort', abort, { once: true })
  const unsubscribe = agent.subscribe((event: AgentSessionEvent) => {
    params.onActivity?.()
    // Nothing here can read codemode's output files (pi's file tools are off): they go as soon as the script ends.
    if (event.type === 'tool_execution_end' && event.toolName === CODEMODE_TOOL) {
      for (const part of (event.result?.content ?? []) as Array<{ type?: string; text?: unknown }>) {
        if (part.type !== 'text' || typeof part.text !== 'string') continue
        for (const name of part.text.match(CODEMODE_OUTPUT_FILE) ?? []) fs.rmSync(path.join(os.tmpdir(), name), { force: true })
      }
    }
    if (event.type === 'turn_start') {
      if (params.research && round >= params.research.maxTurns) {
        budgetStopped = true
        params.research.result.stopReason = 'turn_limit'
        void agent.abort()
        return
      }
      round += 1
      params.research?.takeTurn()
    }
    // Past the budget the tools go (from the next turn, as pi applies it), so the model has to answer in text.
    if (event.type === 'turn_end' && (params.research
      ? params.research.finalNativeTurn(Boolean(produced.at(-1)?.content.some(part => part.type === 'toolCall')))
      : round >= toolRounds)) {
      agent.setActiveToolsByName([])
      recovering = false
    }
    // A noncompliant provider can still emit tool calls after tools were removed. Stop the native loop too,
    // rather than advertising a turn cap that only compliant model output would respect.
    if (event.type === 'turn_end' && params.research && round >= params.research.maxTurns
      && produced.at(-1)?.content.some(part => part.type === 'toolCall')) {
      budgetStopped = true
      params.research.result.stopReason = 'turn_limit'
      void agent.abort()
    }
    if (event.type === 'message_start' && content && !content.endsWith('\n\n')) separate = true
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent
      if (update.type === 'text_delta' && update.delta) textFilter.push(update.delta)
      if (update.type === 'thinking_delta' && update.delta) {
        reasoning += update.delta
        params.onReasoning?.(update.delta)
      }
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      produced.push(event.message)
      noteUsage(event.message.usage)
    }
    if (event.type === 'compaction_end' && event.result && !event.aborted) {
      compacted = true
      noteUsage(event.result.usage)
    }
  })
  let succeeded = false
  try {
    verifyPiTools(agent.getActiveToolNames(), tools, codemode ? [CODEMODE_TOOL] : [])
    const input = piPromptInput(params.messages)
    params.signal.throwIfAborted()
    await agent.prompt(input.text, { expandPromptTemplates: false, ...(input.images.length ? { images: input.images } : {}) })
    params.signal.throwIfAborted()
    // Pi may append a synthetic aborted/error message while stopping its loop. A host budget stop retains
    // the preceding actual answer/evidence; an external cancellation still throws above.
    const last = budgetStopped ? [...produced].reverse().find(message => message.stopReason !== 'error' && message.stopReason !== 'aborted') : produced.at(-1)
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
    // The prompt pi sent is its whole session, not the request CoNAI estimated: no prompt tokens for calibration.
    return { content, reasoning, toolCalls: [], finishReason: last.stopReason === 'length' ? 'length' : 'stop', promptTokens: null, usage: reportedUsage ? usage : null }
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
