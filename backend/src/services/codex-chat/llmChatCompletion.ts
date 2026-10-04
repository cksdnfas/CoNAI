import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { buildOpenAiGenerationFields, readLlmConnectionConfig, type LlmGenerationOptions } from '../llmGenerationOptions'
import { normalizeOptionalString } from '../../utils/valueNormalization'

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
  /** What the request asks for; unset options are not sent. */
  generation: LlmGenerationOptions
}

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
    apiBase: provider.provider_type === 'llm_ollama' ? `${baseUrl.replace(/\/(api|v1)$/, '')}/v1` : baseUrl,
    apiKey: ExternalApiProvider.getDecryptedKey(provider.provider_name, true),
  }
}

/**
 * Resolve an LLM connection (Settings → LLM connections) to its chat-completions endpoint and defaults.
 * Ollama connections use Ollama's OpenAI-compatible `/v1` API so both types speak one protocol.
 */
export function resolveChatCompletionTarget(providerName: string, overrides: { model?: string | null; generation?: LlmGenerationOptions } = {}): ChatCompletionTarget {
  const { provider, config, apiBase, apiKey } = resolveConnection(providerName)
  const model = normalizeOptionalString(overrides.model) ?? readLlmConnectionConfig(config).defaultModel
  if (!model) {
    throw new Error(`LLM 모델이 정해지지 않았어: ${provider.display_name}`)
  }

  return {
    providerName: provider.provider_name,
    displayName: provider.display_name,
    endpoint: `${apiBase}/chat/completions`,
    apiKey,
    model,
    generation: overrides.generation ?? {},
  }
}

/** Model ids the connection lists at `GET {base}/models`, plus its default model. */
export async function listChatCompletionModels(providerName: string) {
  const { config, apiBase, apiKey } = resolveConnection(providerName)
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
  return { models: [...new Set(ids)], defaultModel: readLlmConnectionConfig(config).defaultModel }
}

function buildHeaders(target: ChatCompletionTarget) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }
  if (target.apiKey?.trim()) {
    headers.Authorization = `Bearer ${target.apiKey.trim()}`
  }
  return headers
}

function buildBody(target: ChatCompletionTarget, messages: ChatCompletionMessage[], tools: ChatCompletionTool[], stream: boolean) {
  const body: Record<string, unknown> = { ...buildOpenAiGenerationFields(target.generation), model: target.model, messages, stream }
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
}): Promise<ChatCompletionResult> {
  const idle = new AbortController()
  let idleTimer: NodeJS.Timeout | null = null
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => idle.abort(new Error('LLM 응답이 너무 오래 멈춰 있어.')), STREAM_IDLE_TIMEOUT_MS)
  }
  const signal = AbortSignal.any([params.signal, idle.signal])
  touch()

  try {
    const response = await fetch(params.target.endpoint, {
      method: 'POST',
      headers: buildHeaders(params.target),
      body: JSON.stringify(buildBody(params.target, params.messages, params.tools ?? [], true)),
      signal,
    }).catch((error: unknown) => {
      if (signal.aborted) throw error
      // Node's fetch only says "fetch failed"; the cause (ECONNREFUSED, ENOTFOUND…) is what the user can act on.
      const cause = (error as { cause?: { code?: string; message?: string } })?.cause
      throw new Error(`LLM 서버에 연결하지 못했어: ${params.target.endpoint} (${cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : String(error))})`)
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`LLM 요청 실패 (${response.status}): ${errorText.slice(0, 500) || response.statusText}`)
    }
    if (!response.body || !(response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      return readJsonCompletion(await response.json())
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
        const error = json.error as { message?: string }
        throw new Error(`LLM 오류: ${error.message ?? JSON.stringify(json.error)}`)
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
    if (idle.signal.aborted && !params.signal.aborted) {
      throw idle.signal.reason instanceof Error ? idle.signal.reason : new Error('LLM 응답이 너무 오래 멈춰 있어.')
    }
    throw error
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }
}

/** One non-streamed completion (summaries). */
export async function completeChat(target: ChatCompletionTarget, messages: ChatCompletionMessage[], signal: AbortSignal) {
  const result = await streamChatCompletion({ target, messages, signal })
  return result.content.trim()
}
