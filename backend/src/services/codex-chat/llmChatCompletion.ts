import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { acquireLlmRequestSlot } from '../llmRequestScheduler'
import { buildOpenAiGenerationFields, readLlmConnectionConfig, type LlmGenerationOptions, type LlmThinkingSwitch } from '../llmGenerationOptions'
import { normalizeOptionalString } from '../../utils/valueNormalization'
import { LlmRequestError } from '../llmRequestRetry'

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
}

function readPromptTokens(json: unknown) {
  const value = (json as { usage?: { prompt_tokens?: unknown } } | null)?.usage?.prompt_tokens
  return typeof value === 'number' && value > 0 ? value : null
}

/** No reply bytes for this long means the server is stuck; a long answer that keeps streaming is fine. */
const STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000

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
  const { provider, config, apiBase, apiKey } = resolveConnection(providerName)
  const connectionConfig = readLlmConnectionConfig(config)
  const model = normalizeOptionalString(overrides.model) ?? connectionConfig.defaultModel
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
    promptCacheMarks: connectionConfig.promptCacheMarks,
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

/** Model ids the connection lists at `GET {base}/models`, plus its default model. */
export async function listChatCompletionModels(providerName: string) {
  const { config, apiBase, apiKey } = resolveConnection(providerName)
  return { models: await fetchOpenAiCompatibleModels(apiBase, apiKey), defaultModel: readLlmConnectionConfig(config).defaultModel }
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
  const system = messages.findIndex((message) => message.role === 'system')
  if (system >= 0) wanted.add(system)
  const reference = messages.findIndex((message) => message.role === 'user' && textOf(message.content).startsWith(REFERENCE_BLOCK_START))
  if (reference > 0) wanted.add(markableAtOrBefore(messages, reference - 1))
  const lastUser = messages.map((message) => message.role).lastIndexOf('user')
  if (lastUser > 0) wanted.add(markableAtOrBefore(messages, lastUser - 1))
  wanted.delete(-1)
  return messages.map((message, index) => {
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
export function buildBody(target: ChatCompletionTarget, messages: ChatCompletionMessage[], tools: ChatCompletionTool[], stream: boolean, streamUsage = stream) {
  const body: Record<string, unknown> = { ...buildOpenAiGenerationFields(target.generation, target.thinkingSwitch), model: target.model, messages: target.promptCacheMarks ? markCacheBreakpoints(messages) : messages, stream }
  if (stream && streamUsage) {
    const options = body.stream_options
    body.stream_options = { ...(options && typeof options === 'object' && !Array.isArray(options) ? options : {}), include_usage: true }
  }
  if (tools.length > 0) {
    body.tools = tools
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
  }
}

/**
 * One chat-completions request, streamed. Content and reasoning deltas are reported as they arrive; tool calls are
 * assembled from their deltas and returned once the model stops.
 */
export async function streamChatCompletion(params: {
  target: ChatCompletionTarget
  messages: ChatCompletionMessage[]
  tools?: ChatCompletionTool[]
  signal: AbortSignal
  onContent?: (text: string) => void
  onReasoning?: (text: string) => void
  /** Actual transport body, including cache/usage fallbacks; no headers. */
  onRequestBody?: (body: Record<string, unknown>, target: ChatCompletionTarget) => void
}): Promise<ChatCompletionResult> {
  const release = await acquireLlmRequestSlot(params.target.providerName, params.target.maxConcurrentRequests ?? 1, params.signal)
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
    let streamUsage = true
    const request = (target: ChatCompletionTarget) => {
      const body = buildBody(target, params.messages, params.tools ?? [], true, streamUsage)
      params.onRequestBody?.(body, target)
      return fetch(target.endpoint, {
        method: 'POST',
        headers: buildHeaders(target),
        body: JSON.stringify(body),
        signal,
      }).catch((error: unknown) => {
        if (signal.aborted) throw error
        // Node's fetch only says "fetch failed"; the cause (ECONNREFUSED, ENOTFOUND…) is what the user can act on.
        const cause = (error as { cause?: { code?: string; message?: string } })?.cause
        throw new LlmRequestError(`LLM 서버에 연결하지 못했어: ${params.target.endpoint} (${cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : String(error))})`, undefined, { cause: error })
      })
    }
    let target = params.target
    let response: Response
    for (;;) {
      signal.throwIfAborted()
      response = await request(target)
      if (response.ok) break
      const errorText = await response.text().catch(() => '')
      signal.throwIfAborted()
      // A server that does not know cache_control rejects the whole request; the marks are an optimization, so retry without them.
      if (response.status === 400 && target.promptCacheMarks) {
        console.warn(`[llm-chat] ${params.target.displayName}: request with cache marks rejected (${errorText.slice(0, 200)}); retrying without`)
        target = { ...target, promptCacheMarks: false }
        touch()
        continue
      }
      // Likewise the usage chunk: a server that names stream_options in its refusal gets the request without it.
      if (response.status === 400 && streamUsage && errorText.includes('stream_options')) {
        streamUsage = false
        touch()
        continue
      }
      throw new LlmRequestError(`LLM 요청 실패 (${response.status}): ${errorText.slice(0, 500) || response.statusText}`, response.status)
    }
    if (!response.body || !(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const result = readJsonCompletion(await response.json())
      signal.throwIfAborted()
      if (result.content) params.onContent?.(result.content)
      if (result.reasoning) params.onReasoning?.(result.reasoning)
      return result
    }

    let content = ''
    let reasoning = ''
    let finishReason: string | null = null
    let promptTokens: number | null = null
    const drafts = new Map<number, ToolCallDraft>()
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''

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
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '')
        const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
        handleEvent(data)
        boundary = buffer.search(/\r?\n\r?\n/)
      }
    }
    if (buffer.trim()) {
      handleEvent(buffer.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'))
    }

    return { content, reasoning, toolCalls: finalizeToolCalls(drafts), finishReason, promptTokens }
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

/** One non-streamed completion (summaries). */
export async function completeChat(target: ChatCompletionTarget, messages: ChatCompletionMessage[], signal: AbortSignal) {
  const result = await streamChatCompletion({ target, messages, signal })
  return result.content.trim()
}
