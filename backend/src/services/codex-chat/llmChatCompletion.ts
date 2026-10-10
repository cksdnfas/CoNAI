import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { acquireLlmRequestSlot } from '../llmRequestScheduler'
import { buildOpenAiGenerationFields, readLlmConnectionConfig, type LlmGenerationOptions, type LlmThinkingSwitch } from '../llmGenerationOptions'
import { normalizeOptionalString } from '../../utils/valueNormalization'
import { LlmRequestError } from '../llmRequestRetry'
import { CLAUDE_CHAT_PROVIDER, streamClaudeChatCompletion, type ClaudeChatSession } from './claudeChatCompletion'
import type { ChatMcpToolResult } from './chatMcpBridge'
import { primaryModelOf } from './modelSlots'
import { createRepetitionWatch, withoutRepetition } from './repetitionGuard'
import { isCallerAbort, rawMessagesEstimate, rawTokenEstimate, readUsageCounts, recordLlmUsage, type LlmTokenCounts, type LlmUsageTag } from '../llmUsage'
import { learnServerContextLimit, MIN_FITTED_REPLY_TOKENS, replyRoomFromRefusal } from './serverContextLimit'
import { contextPartsOf } from './chatContextDiagnostics'
import { setTimeout as delay } from 'node:timers/promises'

export type ChatCompletionToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }

/** OpenAI-style multimodal user content (images only for profiles marked as able to see them). */
export type ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export type ChatCompletionMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ChatContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatCompletionToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type ChatCompletionTool = { type: 'function'; function: { name: string; description?: string; parameters: unknown } }

export type ChatCompletionTarget = {
  providerName: string
  displayName: string
  endpoint: string
  apiKey: string | null
  model: string
  /** Explicit connection limit for the whole request, including any cache-mark fallback and response body. */
  timeoutMs?: number | null
  maxConcurrentRequests?: number
  /** What the request asks for; unset options are not sent. */
  generation: LlmGenerationOptions
  /** Put `cache_control` breakpoints on the stable parts of the request (Anthropic through LiteLLM; off by default). */
  promptCacheMarks: boolean
  transport?: 'claude-code'
  /** Claude Code chats that keep their memory: the session this request continues (see ClaudeChatSession). */
  claudeSession?: ClaudeChatSession
  /** How `reasoningEffort: 'none'` reaches the server (the connection's setting; default `reasoning_effort`). */
  thinkingSwitch?: LlmThinkingSwitch
}

/** How conversation-time reference material (keyword lore, author's note) starts, in both engines' inputs. */
export const REFERENCE_BLOCK_START = '[참고 설정]'

export type ChatCompletionResult = {
  content: string
  reasoning: string
  toolCalls: ChatCompletionToolCall[]
  finishReason: string | null
  /** Prompt tokens the server reported, when it reports usage. */
  promptTokens: number | null
  /** Everything the server reported about this request's tokens, when it reports usage. */
  usage?: LlmTokenCounts | null
  /**
   * finishReason 'repetition': the model was looping, so the stream was stopped and this many characters were cut off
   * the end of the content (they had already gone out through onContent).
   */
  loopCut?: number
}

function readPromptTokens(json: unknown) {
  const value = (json as { usage?: { prompt_tokens?: unknown } } | null)?.usage?.prompt_tokens
  return typeof value === 'number' && value > 0 ? value : null
}

/** No reply bytes for this long means the server is stuck; a long answer that keeps streaming is fine. */
const STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Models whose server refused `tools` (Ollama "does not support tools", llama-server without --jinja), by connection
 * and model, until when: their requests go without tools instead of failing first every time. Expires so a server
 * restarted with tool support gets them back.
 */
const toolsRefused = new Map<string, number>()
const TOOLS_REFUSED_TTL_MS = 10 * 60_000
const toolsKey = (target: ChatCompletionTarget) => `${target.providerName}\u0000${target.model}`
export function toolsRefusedBy(target: ChatCompletionTarget) {
  const until = toolsRefused.get(toolsKey(target))
  if (until !== undefined && until < Date.now()) toolsRefused.delete(toolsKey(target))
  return until !== undefined && until >= Date.now()
}
/**
 * Connections that failed to connect twice in a row (within a minute): for a while every request to them fails at once
 * instead of each waiting out its own connect timeout — the reply, the judge, the translation and the summary would
 * otherwise wait ~10 s apiece on a server that is off. The first request after the pause tries again.
 */
const unreachable = new Map<string, { failures: number; last: number; until: number }>()
const UNREACHABLE_PAUSE_MS = 30_000
const CONNECT_FAILURES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'])
export function assertLlmReachable(target: Pick<ChatCompletionTarget, 'providerName' | 'displayName'>) {
  const state = unreachable.get(target.providerName)
  if (state && state.until > Date.now()) throw new LlmRequestError(`LLM 서버에 연결되지 않아서 잠시 보내지 않아: ${target.displayName} (${Math.ceil((state.until - Date.now()) / 1000)}초 뒤 다시 시도해)`)
}
export function noteLlmConnectFailure(target: Pick<ChatCompletionTarget, 'providerName'>, code: string | undefined) {
  if (!code || !CONNECT_FAILURES.has(code)) return
  const now = Date.now()
  const previous = unreachable.get(target.providerName)
  const failures = previous && now - previous.last < 60_000 ? previous.failures + 1 : 1
  unreachable.set(target.providerName, { failures, last: now, until: failures >= 2 ? now + UNREACHABLE_PAUSE_MS : 0 })
}

/** Servers that refused cache marks, by connection and model (marks are an optimization: remembered, not retried). */
const marksRefused = new Map<string, number>()

/** A 400 that says the server or model cannot take tool definitions (not a broken call or schema of ours). */
export function isToolsRefusal(errorText: string) {
  return /does not support tools|tools? (?:are|is) not supported|not support(?:ed)? (?:for )?tool|--jinja|tool[_ ]?(?:calling|use) (?:is )?not (?:supported|enabled)|unrecognized (?:request )?argument.{0,20}tools|extra_forbidden.{0,40}tools/i.test(errorText)
}

function parseConfig(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return {}
}

/** An enabled LLM connection with its OpenAI-compatible API base, defaults and key. */
function resolveConnection(providerName: string) {
  const provider = ExternalApiProvider.findByName(providerName)
  if (!provider) {
    throw new Error(`LLM 연결을 찾을 수 없어: ${providerName}`)
  }
  if (!provider.is_enabled) {
    throw new Error(`LLM 연결이 꺼져 있어: ${provider.display_name}`)
  }
  if (provider.provider_type !== 'llm_openai_compatible' && provider.provider_type !== 'llm_ollama') {
    throw new Error(`LLM 연결이 아니야: ${provider.display_name}`)
  }
  const baseUrl = normalizeOptionalString(provider.base_url)?.replace(/\/+$/, '')
  if (!baseUrl) {
    throw new Error(`LLM 연결에 주소가 없어: ${provider.display_name}`)
  }

  return {
    provider,
    config: parseConfig(provider.additional_config),
    apiBase: toOpenAiApiBase(provider.provider_type, baseUrl),
    apiKey: ExternalApiProvider.getDecryptedKey(provider.provider_name, true),
  }
}

/** The OpenAI-compatible API base of a connection: Ollama serves it under `/v1`, the rest at the URL itself. */
export function toOpenAiApiBase(providerType: string, baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return providerType === 'llm_ollama' ? `${trimmed.replace(/\/(api|v1)$/, '')}/v1` : trimmed
}

/**
 * Resolve an LLM connection (Settings → LLM connections) to its chat-completions endpoint and defaults.
 * Ollama connections use Ollama's OpenAI-compatible `/v1` API so both types speak one protocol.
 */
export function resolveChatCompletionTarget(providerName: string, overrides: { model?: string | null; generation?: LlmGenerationOptions } = {}): ChatCompletionTarget {
  if (providerName === CLAUDE_CHAT_PROVIDER) return { providerName, displayName: 'Claude Code', endpoint: 'claude-code://local', apiKey: null, model: overrides.model?.trim() || 'sonnet', generation: overrides.generation ?? {}, promptCacheMarks: false, transport: 'claude-code', maxConcurrentRequests: 1 }
  const { provider, config, apiBase, apiKey } = resolveConnection(providerName)
  const connectionConfig = readLlmConnectionConfig(config)
  const model = normalizeOptionalString(overrides.model) ?? primaryModelOf(provider.provider_name)
  if (!model) {
    throw new Error(`LLM 모델이 정해지지 않았어: ${provider.display_name}`)
  }

  return {
    providerName: provider.provider_name,
    displayName: provider.display_name,
    endpoint: `${apiBase}/chat/completions`,
    apiKey,
    model,
    timeoutMs: connectionConfig.timeoutMs,
    maxConcurrentRequests: connectionConfig.maxConcurrentRequests,
    generation: overrides.generation ?? {},
    // Claude models (through OpenRouter, LiteLLM, …) cache only marked prefixes: on unless the connection turns it off.
    // A server that refuses the marks gets the request again without them (streamChatCompletion).
    promptCacheMarks: connectionConfig.promptCacheMarks || (config.prompt_cache_marks !== false && /claude/i.test(model)),
    thinkingSwitch: connectionConfig.thinkingSwitch,
  }
}

/** Whether a request could be sent: the connection exists, is on, is an LLM with an address, and a model applies. */
export function isChatTargetReady(providerName: string, model?: string | null) {
  try {
    resolveChatCompletionTarget(providerName, { model })
    return true
  } catch {
    return false
  }
}

/** Model ids the connection lists at `GET {base}/models`, plus its primary model row. */
export async function listChatCompletionModels(providerName: string) {
  const { provider, apiBase, apiKey } = resolveConnection(providerName)
  return { models: await fetchOpenAiCompatibleModels(apiBase, apiKey), defaultModel: primaryModelOf(provider.provider_name) }
}

/** Model ids an OpenAI-compatible server lists at `{apiBase}/models`; for unsaved or edited connections too. */
export async function fetchOpenAiCompatibleModels(apiBase: string, apiKey: string | null | undefined) {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`
  }
  const response = await fetch(`${apiBase}/models`, { headers, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) {
    throw new Error(`모델 목록을 가져오지 못했어 (${response.status})`)
  }
  const json = await response.json() as { data?: Array<{ id?: unknown }> }
  const ids = (json.data ?? []).map((entry) => (typeof entry.id === 'string' ? entry.id : '')).filter(Boolean)
  return [...new Set(ids)]
}

function buildHeaders(target: ChatCompletionTarget) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }
  if (target.apiKey?.trim()) {
    headers.Authorization = `Bearer ${target.apiKey.trim()}`
  }
  return headers
}

function textOf(content: ChatCompletionMessage['content']) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.find((part): part is Extract<ChatContentPart, { type: 'text' }> => part.type === 'text')?.text ?? ''
  return ''
}

/** The index of the nearest system or user message at or before `index` (Anthropic takes cache marks on those), or -1. */
function markableAtOrBefore(messages: ChatCompletionMessage[], index: number) {
  for (let cursor = Math.min(index, messages.length - 1); cursor >= 0; cursor -= 1) {
    const role = messages[cursor].role
    if (role === 'system' || role === 'user') return cursor
  }
  return -1
}

/**
 * Anthropic caches nothing by itself: a request names up to four breakpoints and the longest already-seen prefix
 * ending at one of them is read from cache. Marked here: the system prompt, the message before the one carrying the
 * reference block (everything up to there survives the block moving), and the message before the latest user message
 * (so the tool-call rounds of one reply reuse each other). Marked content becomes text parts carrying `cache_control`.
 */
export function markCacheBreakpoints(messages: ChatCompletionMessage[]): unknown[] {
  const wanted = new Set<number>()
  // The system message ends with the lore index and the summary, which change now and then: the persona before them
  // gets its own mark, so a new summary does not make the whole character prompt miss.
  const systemIndex = messages.findIndex((message) => message.role === 'system')
  const systemMessage = systemIndex >= 0 ? messages[systemIndex] : null
  const systemText = systemMessage && typeof systemMessage.content === 'string' ? systemMessage.content : ''
  const memoryAt = systemMessage ? Math.min(...contextPartsOf(systemMessage).filter((part) => ['lore-index', 'constant-lore', 'summary'].includes(part.kind) && part.text)
    .map((part) => systemText.indexOf(part.text)).filter((index) => index > 0), Infinity) : Infinity
  const system = messages.findIndex((message) => message.role === 'system')
  if (system >= 0) wanted.add(system)
  const reference = messages.findIndex((message) => message.role === 'user' && textOf(message.content).startsWith(REFERENCE_BLOCK_START))
  if (reference > 0) wanted.add(markableAtOrBefore(messages, reference - 1))
  const lastUser = messages.map((message) => message.role).lastIndexOf('user')
  if (lastUser > 0) wanted.add(markableAtOrBefore(messages, lastUser - 1))
  wanted.delete(-1)
  return messages.map((message, index) => {
    if (index === systemIndex && Number.isFinite(memoryAt)) {
      return { ...message, content: [
        { type: 'text', text: systemText.slice(0, memoryAt), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: systemText.slice(memoryAt), cache_control: { type: 'ephemeral' } },
      ] }
    }
    if (!wanted.has(index) || (message.role !== 'system' && message.role !== 'user')) return message
    const parts: unknown[] = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : [...message.content]
    const last = parts[parts.length - 1] as Record<string, unknown> | undefined
    if (!last || last.type !== 'text') return message
    parts[parts.length - 1] = { ...last, cache_control: { type: 'ephemeral' } }
    return { ...message, content: parts }
  })
}

/**
 * `streamUsage`: a streamed request asks for the usage chunk at the end (`stream_options.include_usage`; OpenAI and
 * llama.cpp send it as a last chunk with empty `choices`), so the prompt token count is known for streamed replies too.
 */
export function buildBody(target: ChatCompletionTarget, messages: ChatCompletionMessage[], tools: ChatCompletionTool[], stream: boolean, streamUsage = stream, toolChoice?: 'none') {
  const body: Record<string, unknown> = { ...buildOpenAiGenerationFields(target.generation, target.thinkingSwitch), model: target.model, messages: target.promptCacheMarks ? markCacheBreakpoints(messages) : messages, stream }
  if (stream && streamUsage) {
    const options = body.stream_options
    body.stream_options = { ...(options && typeof options === 'object' && !Array.isArray(options) ? options : {}), include_usage: true }
  }
  if (tools.length > 0) {
    body.tools = tools
    if (toolChoice) body.tool_choice = toolChoice
  }
  return body
}

type ToolCallDraft = { id: string; name: string; arguments: string }

function readReasoning(delta: Record<string, unknown>) {
  const value = delta.reasoning_content ?? delta.reasoning
  return typeof value === 'string' ? value : ''
}

function finalizeToolCalls(drafts: Map<number, ToolCallDraft>): ChatCompletionToolCall[] {
  return [...drafts.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, draft]) => draft.name)
    .map(([index, draft]) => ({
      id: draft.id || `call_${index}_${Date.now().toString(36)}`,
      type: 'function' as const,
      function: { name: draft.name, arguments: draft.arguments || '{}' },
    }))
}

/** Servers that ignore `stream: true` (or proxies that buffer) answer with one JSON body. */
function readJsonCompletion(json: unknown): ChatCompletionResult {
  const choice = (json as { choices?: Array<Record<string, unknown>> })?.choices?.[0] ?? {}
  const message = (choice.message ?? {}) as Record<string, unknown>
  const drafts = new Map<number, ToolCallDraft>()
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : []
  toolCalls.forEach((call, index) => {
    const fn = (call.function ?? {}) as Record<string, unknown>
    drafts.set(index, { id: String(call.id ?? ''), name: String(fn.name ?? ''), arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}) })
  })
  return {
    content: typeof message.content === 'string' ? message.content : '',
    reasoning: readReasoning(message),
    toolCalls: finalizeToolCalls(drafts),
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    promptTokens: readPromptTokens(json),
    usage: readUsageCounts(json),
  }
}

/** One chat-completions request; `meter.startedAt` is set once it has its request slot. */
async function requestChatCompletion(meter: { startedAt: number }, params: {
  target: ChatCompletionTarget
  messages: ChatCompletionMessage[]
  tools?: ChatCompletionTool[]
  signal: AbortSignal
  onContent?: (text: string) => void
  onReasoning?: (text: string) => void
  /** Actual transport body, including cache/usage fallbacks; no headers. */
  onRequestBody?: (body: Record<string, unknown>, target: ChatCompletionTarget) => void
  /** One-shot background reactions fail without resending compatibility fallbacks. */
  allowCompatibilityFallback?: boolean
  callTool?: (name: string, args: Record<string, unknown>, id: string) => Promise<ChatMcpToolResult>
  /** 'none': the tools stay in the request (and the prompt cache) but the model must answer in text. */
  toolChoice?: 'none'
  maxToolRounds?: number
  /** Hang up on a model that starts looping and cut the loop off (finishReason 'repetition', see repetitionGuard). */
  stopLoops?: boolean
}): Promise<ChatCompletionResult> {
  const release = await acquireLlmRequestSlot(params.target.providerName, params.target.maxConcurrentRequests ?? 1, params.signal)
  meter.startedAt = Date.now()
  const controller = new AbortController()
  const signal = controller.signal
  const abort = () => controller.abort(params.signal.reason)
  if (params.signal.aborted) abort()
  else params.signal.addEventListener('abort', abort, { once: true })
  let idleTimer: NodeJS.Timeout | null = null
  let requestTimer: NodeJS.Timeout | null = null
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(new Error('LLM 응답이 너무 오래 멈춰 있어.')), STREAM_IDLE_TIMEOUT_MS)
  }
  if (params.target.timeoutMs != null) {
    requestTimer = setTimeout(() => controller.abort(new DOMException(`LLM 요청 제한 시간을 초과했어 (${params.target.timeoutMs}ms).`, 'TimeoutError')), params.target.timeoutMs)
  }
  touch()

  try {
    if (params.target.transport === 'claude-code') {
      const claudeTools = params.toolChoice === 'none' ? [] : params.tools ?? []
      params.onRequestBody?.({ model: params.target.model, messages: params.messages, tools: claudeTools, transport: 'claude-code' }, params.target)
      return await streamClaudeChatCompletion({ ...params, tools: claudeTools, signal, onContent: (text) => { touch(); params.onContent?.(text) }, onReasoning: (text) => { touch(); params.onReasoning?.(text) } })
    }
    let streamUsage = true
    let toolChoiceRefused = false
    const request = async (target: ChatCompletionTarget) => {
      assertLlmReachable(target)
      const body = buildBody(target, params.messages, toolsRefusedBy(target) || (toolChoiceRefused && params.toolChoice) ? [] : params.tools ?? [], true, streamUsage, params.toolChoice)
      params.onRequestBody?.(body, target)
      return fetch(target.endpoint, {
        method: 'POST',
        headers: buildHeaders(target),
        body: JSON.stringify(body),
        signal,
      }).then((response) => {
        unreachable.delete(target.providerName)
        return response
      }, (error: unknown) => {
        if (signal.aborted) throw error
        // Node's fetch only says "fetch failed"; the cause (ECONNREFUSED, ENOTFOUND…) is what the user can act on.
        const cause = (error as { cause?: { code?: string; message?: string } })?.cause
        noteLlmConnectFailure(target, cause?.code)
        throw new LlmRequestError(`LLM 서버에 연결하지 못했어: ${params.target.endpoint} (${cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : String(error))})`, undefined, { cause: error })
      })
    }
    let target = (marksRefused.get(toolsKey(params.target)) ?? 0) > Date.now() ? { ...params.target, promptCacheMarks: false } : params.target
    let response: Response
    let rateLimited = false
    let capFitted = false
    for (;;) {
      signal.throwIfAborted()
      response = await request(target)
      if (response.ok) break
      const errorText = await response.text().catch(() => '')
      signal.throwIfAborted()
      // Rate limited (OpenRouter free models and the like): wait as the server asks, once, when that is short.
      if (params.allowCompatibilityFallback !== false && response.status === 429 && !rateLimited) {
        const seconds = Number(response.headers.get('retry-after'))
        const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 2000
        if (wait <= 10_000) {
          rateLimited = true
          await delay(wait, undefined, { signal })
          touch()
          continue
        }
      }
      // A server that does not know cache_control rejects the whole request; the marks are an optimization, so retry without them.
      if (params.allowCompatibilityFallback !== false && response.status === 400 && target.promptCacheMarks) {
        console.warn(`[llm-chat] ${params.target.displayName}: request with cache marks rejected (${errorText.slice(0, 200)}); retrying without`)
        target = { ...target, promptCacheMarks: false }
        marksRefused.set(toolsKey(target), Date.now() + 60 * 60_000)
        touch()
        continue
      }
      // Likewise the usage chunk: a server that names stream_options in its refusal gets the request without it.
      if (params.allowCompatibilityFallback !== false && response.status === 400 && streamUsage && errorText.includes('stream_options')) {
        streamUsage = false
        touch()
        continue
      }
      // A server that does not take tool_choice gets the old last round: no tools at all.
      if (params.allowCompatibilityFallback !== false && response.status === 400 && params.toolChoice && !toolChoiceRefused && errorText.includes('tool_choice')) {
        toolChoiceRefused = true
        touch()
        continue
      }
      // A model that cannot take tools still answers in text: remember it and send the request without them.
      if (params.allowCompatibilityFallback !== false && response.status === 400 && (params.tools?.length ?? 0) > 0 && !toolsRefusedBy(target) && isToolsRefusal(errorText)) {
        console.warn(`[llm-chat] ${params.target.displayName} (${target.model}): tools refused (${errorText.slice(0, 200)}); sending without tools for ${TOOLS_REFUSED_TTL_MS / 60_000} min`)
        toolsRefused.set(toolsKey(target), Date.now() + TOOLS_REFUSED_TTL_MS)
        touch()
        continue
      }
      // A server that names its context size in a refusal sizes the next request (see serverContextLimit).
      if (response.status === 400 && /context/i.test(errorText)) learnServerContextLimit(target, errorText)
      // max_tokens is a ceiling, not a booking: a cap the prompt leaves no room for goes again, once, cut to the room
      // the server names (Strata, vLLM refuse prompt + max_tokens over the context instead of shortening it).
      if (response.status === 400 && !capFitted && /context/i.test(errorText)) {
        const sent = target.generation.maxTokens
        const room = replyRoomFromRefusal(errorText)
        if (typeof sent === 'number' && room !== null && room >= MIN_FITTED_REPLY_TOKENS && room < sent) {
          capFitted = true
          target = { ...target, generation: { ...target.generation, maxTokens: room } }
          touch()
          continue
        }
      }
      throw new LlmRequestError(`LLM 요청 실패 (${response.status}): ${errorText.slice(0, 500) || response.statusText}`, response.status)
    }
    if (!response.body || !(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const read = readJsonCompletion(await response.json())
      signal.throwIfAborted()
      const unlooped = params.stopLoops ? withoutRepetition(read.content) : read.content
      const result = unlooped === read.content ? read : { ...read, content: unlooped, toolCalls: [], finishReason: 'repetition' }
      if (result.content) params.onContent?.(result.content)
      if (result.reasoning) params.onReasoning?.(result.reasoning)
      return result
    }

    let content = ''
    let reasoning = ''
    let finishReason: string | null = null
    let promptTokens: number | null = null
    let usage: LlmTokenCounts | null = null
    const drafts = new Map<number, ToolCallDraft>()
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    const watch = createRepetitionWatch()
    let looping = false

    const handleEvent = (data: string) => {
      if (!data || data === '[DONE]') {
        return
      }
      let json: Record<string, unknown>
      try {
        json = JSON.parse(data)
      } catch {
        return
      }
      promptTokens = readPromptTokens(json) ?? promptTokens
      usage = readUsageCounts(json) ?? usage
      if (json.error) {
        const error = json.error as { message?: string; code?: unknown; status?: unknown }
        const status = Number(error.status ?? error.code)
        throw new LlmRequestError(`LLM 오류: ${error.message ?? JSON.stringify(json.error)}`, Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined)
      }
      const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0]
      if (!choice) {
        return
      }
      const delta = (choice.delta ?? {}) as Record<string, unknown>
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content
        params.onContent?.(delta.content)
        if (params.stopLoops && watch.looping(content)) looping = true
      }
      const reasoningDelta = readReasoning(delta)
      if (reasoningDelta) {
        reasoning += reasoningDelta
        params.onReasoning?.(reasoningDelta)
      }
      for (const call of Array.isArray(delta.tool_calls) ? delta.tool_calls as Array<Record<string, unknown>> : []) {
        const index = typeof call.index === 'number' ? call.index : drafts.size
        const draft = drafts.get(index) ?? { id: '', name: '', arguments: '' }
        const fn = (call.function ?? {}) as Record<string, unknown>
        if (typeof call.id === 'string' && call.id) draft.id = call.id
        if (typeof fn.name === 'string') draft.name += fn.name
        if (typeof fn.arguments === 'string') draft.arguments += fn.arguments
        drafts.set(index, draft)
      }
      if (typeof choice.finish_reason === 'string') {
        finishReason = choice.finish_reason
      }
    }

    for (;;) {
      const { value, done } = await reader.read()
      if (done) {
        break
      }
      touch()
      buffer += value
      let boundary = buffer.search(/\r?\n\r?\n/)
      while (boundary >= 0 && !looping) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '')
        const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        handleEvent(data)
        boundary = buffer.search(/\r?\n\r?\n/)
      }
      // A looping model would write on to the cap: hang up and keep what came before the loop.
      if (looping) {
        await reader.cancel().catch(() => {})
        const kept = withoutRepetition(content)
        return { content: kept, reasoning, toolCalls: [], finishReason: 'repetition', promptTokens, usage, loopCut: content.length - kept.length }
      }
    }
    if (buffer.trim()) {
      handleEvent(buffer.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'))
    }

    return { content, reasoning, toolCalls: finalizeToolCalls(drafts), finishReason, promptTokens, usage }
  } catch (error) {
    signal.throwIfAborted()
    throw error
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    if (requestTimer) clearTimeout(requestTimer)
    params.signal.removeEventListener('abort', abort)
    release()
  }
}

type ChatCompletionParams = Parameters<typeof requestChatCompletion>[1]

/**
 * One chat-completions request, streamed. Content and reasoning deltas are reported as they arrive; tool calls are
 * assembled from their deltas and returned once the model stops. Every request that got to the model goes into the
 * usage ledger under `usage` (what it was for), with estimated counts when the server reports none.
 */
export async function streamChatCompletion(params: ChatCompletionParams & { usage?: LlmUsageTag }): Promise<ChatCompletionResult> {
  const meter = { startedAt: 0 }
  const record = (result: ChatCompletionResult | null) => {
    const estimate = result && !result.usage
    recordLlmUsage({
      ...(params.usage ?? { purpose: 'other' }),
      engine: params.target.transport === 'claude-code' ? 'claude-code' : 'api',
      providerName: params.target.providerName,
      model: params.target.model,
      tokens: !result ? null : result.usage ?? {
        inputTokens: rawMessagesEstimate(params.messages, params.tools ?? []),
        cachedInputTokens: 0,
        outputTokens: rawTokenEstimate(result.content + result.reasoning + result.toolCalls.map((call) => call.function.name + call.function.arguments).join('')),
      },
      estimated: Boolean(estimate),
      latencyMs: Date.now() - meter.startedAt,
      ok: result !== null,
    })
  }
  try {
    const result = await requestChatCompletion(meter, params)
    record(result)
    return result
  } catch (error) {
    if (meter.startedAt && !isCallerAbort(params.signal)) record(null)
    throw error
  }
}

/** One non-streamed completion (summaries). */
export async function completeChat(target: ChatCompletionTarget, messages: ChatCompletionMessage[], signal: AbortSignal, usage?: LlmUsageTag) {
  const result = await streamChatCompletion({ target, messages, signal, usage })
  return result.content.trim()
}
