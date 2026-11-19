import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'crypto'
import type { AgentSessionEvent, ModelRuntime, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { runtimePaths } from '../../config/runtimePaths'
import { loadPiSdk, reservePiRun } from '../piRuntime'
import { isInsideServedDir, isPathStrictlyInside } from '../../utils/pathResolver'
import type { LlmTokenCounts } from '../llmUsage'
import { buildOpenAiGenerationFields } from '../llmGenerationOptions'
import { LlmRequestError } from '../llmRequestRetry'
import type { ChatMcpToolResult } from './chatMcpBridge'
import type { ClaudeChatSession } from './claudeChatCompletion'
import { cacheMarksRefusedBy, isCacheMarksRefusal, llmConnectError, noteCacheMarksRefused, type ChatCompletionMessage, type ChatCompletionResult, type ChatCompletionTarget, type ChatCompletionTool } from './llmChatCompletion'
import { CATALOG_RUN_TOOL } from '../../mcp/toolCatalog'
import { chatToolRoundLimit, loadChatSettings } from './chatSettings'
import { noteTextToolCalls, recoverTextToolCalls, textToolCallFilter, type TextToolCallTools } from './textToolCalls'
import { createRepetitionWatch, withoutRepetition } from './repetitionGuard'
import { supersededPageViewEdits } from './piPageViewEdits'

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

/**
 * A pi chat's session, kept like a Claude Code one (claudeChatSessions.ts): every turn forks the file it continues.
 * `onCompaction`: pi folded the memory in the middle of the run.
 */
export type PiChatSession = ClaudeChatSession & { onCompaction?: () => void }

/** The provider id the profile's connection is registered under, in a model runtime of its own per run. */
const PI_PROVIDER = 'conai'
const PI_SESSION_ID = /^[\w.-]{1,160}$/
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
 * The compaction budget for a context window: pi folds the memory once the context passes `window - reserve`, and
 * keeps the latest `keepRecent` tokens verbatim. Its defaults (16k / 20k) suit a large hosted model; a small local
 * context gets proportionate ones. A configured output that fits the window is reserved before the next request;
 * this changes the compaction threshold, not the output ceiling sent to the provider.
 */
export function piCompactionSettings(contextWindow: number, maxTokens?: number | null, requestMargin = 0) {
  const outputReserve = typeof maxTokens === 'number' && maxTokens > 0 && maxTokens < contextWindow ? maxTokens : 0
  return {
    enabled: contextWindow > 0,
    reserveTokens: Math.max(Math.min(16_384, Math.max(1, Math.floor(contextWindow * 0.2))), outputReserve) + requestMargin,
    keepRecentTokens: Math.min(20_000, Math.max(1, Math.floor(contextWindow * 0.25))),
  }
}

/** pi's catalog entry for a model: its thinking style, compat flags, image limits and output ceiling. */
type PiCatalogModel = NonNullable<ReturnType<ModelRuntime['getModel']>>

/**
 * Anthropic's own API host over https, where pi speaks Anthropic's native Messages API: its OpenAI compatibility
 * endpoint ignores `cache_control`, so nothing would be cached. The host's origin (the SDK adds `/v1/messages`), or null
 * for any other, and for a Claude subscription key: pi would answer as Claude Code, with its own system text and tool
 * names (pi-ai anthropic-messages `isOAuthToken`).
 */
export function piAnthropicRoot(target: Pick<ChatCompletionTarget, 'endpoint' | 'apiKey'>) {
  const url = new URL(target.endpoint)
  return url.protocol === 'https:' && url.hostname === 'api.anthropic.com' && !target.apiKey?.includes('sk-ant-oat') ? url.origin : null
}

/** The room pi's request fitting keeps free beside the prompt and the output (pi-ai simple-options `CONTEXT_SAFETY_TOKENS`). */
const PI_CONTEXT_SAFETY_TOKENS = 4096

type ModelLimits = { maxTokens: number | null; contextWindow: number | null }
/**
 * Models API lookups by API root, connection and model: one call shared by the runs that need it, kept once answered.
 * An HTTP error is kept for an hour, like refused cache marks, so runs meanwhile go to pi's catalog; a network error is
 * not kept.
 */
const anthropicModelLimitsCache = new Map<string, { limits: Promise<ModelLimits>; until: number }>()
const MODEL_LOOKUP_REFUSED_MS = 60 * 60_000

/** What Anthropic's models API says of a model (`GET /v1/models/{id}`: `max_tokens`, `max_input_tokens`). */
async function requestAnthropicModelLimits(root: string, target: ChatCompletionTarget): Promise<ModelLimits> {
  // The call is shared, so it ends on the connection's own timeout rather than on one run's abort.
  const response = await fetch(`${root}/v1/models/${encodeURIComponent(target.model)}`, {
    headers: { 'x-api-key': target.apiKey ?? '', 'anthropic-version': '2023-06-01' },
    signal: target.timeoutMs != null ? AbortSignal.timeout(target.timeoutMs) : undefined,
  }).catch((error: unknown) => { throw llmConnectError(target, error) })
  if (!response.ok) throw new LlmRequestError(`Anthropic 모델 정보를 가져오지 못했어 (${response.status})`, response.status)
  const model = (await response.json()) as { max_tokens?: unknown; max_input_tokens?: unknown }
  const positive = (value: unknown) => typeof value === 'number' && value > 0 ? value : null
  return { maxTokens: positive(model.max_tokens), contextWindow: positive(model.max_input_tokens) }
}

/** A model's reported limits through the shared lookup; a run stops waiting on it when the run is aborted. */
function anthropicModelLimits(root: string, target: ChatCompletionTarget, signal: AbortSignal): Promise<ModelLimits> {
  const key = `${root}\u0000${target.providerName}\u0000${target.model}`
  let lookup = anthropicModelLimitsCache.get(key)
  if (!lookup || lookup.until <= Date.now()) {
    const started = { limits: requestAnthropicModelLimits(root, target), until: Infinity }
    anthropicModelLimitsCache.set(key, started)
    started.limits.catch((error: unknown) => {
      console.warn(`[pi-chat] ${target.displayName} (${target.model}): Anthropic's models API failed (${error instanceof Error ? error.message : String(error)})`)
      if (error instanceof LlmRequestError && error.status !== undefined) started.until = Date.now() + MODEL_LOOKUP_REFUSED_MS
      else if (anthropicModelLimitsCache.get(key) === started) anthropicModelLimitsCache.delete(key)
    })
    lookup = started
  }
  const { limits } = lookup
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) return abort()
    signal.addEventListener('abort', abort, { once: true })
    limits.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/**
 * A native run's limits: the profile's output limit and the known context window win, else what Anthropic's models API
 * reports for the model, else pi's catalog entry (its windows can be ones only a beta header opens, which pi does not
 * send). An unknown window stays unknown (no compaction, as before); an unknown output limit fails the run, since the
 * native API requires one.
 */
async function piAnthropicLimits(root: string, catalog: PiCatalogModel | undefined, target: ChatCompletionTarget, signal: AbortSignal) {
  const profileMaxTokens = target.generation.maxTokens ?? null
  const profileWindow = target.contextWindow || 0
  const reported = profileMaxTokens !== null && profileWindow ? null : await anthropicModelLimits(root, target, signal).catch((error: unknown) => {
    if (signal.aborted || (profileMaxTokens === null && !catalog?.maxTokens)) throw error
    return null
  })
  const maxTokens = profileMaxTokens ?? reported?.maxTokens ?? (catalog?.maxTokens || null)
  const contextWindow = profileWindow || reported?.contextWindow || catalog?.contextWindow || 0
  if (maxTokens === null) throw new Error(`Anthropic이 ${target.model}의 최대 출력 토큰을 알려 주지 않아. 프로필에서 최대 출력 토큰을 정해줘.`)
  return { root, catalog, maxTokens, contextWindow }
}

type JsonSchema = Record<string, unknown>
const propertiesOf = (schema: JsonSchema) => (schema.properties ?? {}) as Record<string, unknown>
const requiredOf = (schema: JsonSchema) => (schema.required ?? []) as string[]
const unionsOf = (schema: JsonSchema) => [schema.oneOf, schema.anyOf].filter(Array.isArray) as JsonSchema[][]
const sameSchema = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** A shape that takes no property it does not define. */
const closedShape = (shape: JsonSchema) => shape.additionalProperties === false && shape.patternProperties === undefined

/** A union member with what its parent declares beside the union: properties (both definitions where both have one), requirements, and closedness. */
function foldShape(parent: JsonSchema, member: JsonSchema): JsonSchema {
  const properties = { ...propertiesOf(parent) }
  for (const [key, value] of Object.entries(propertiesOf(member))) {
    properties[key] = key in properties && !sameSchema(properties[key], value) ? { allOf: [properties[key], value] } : value
  }
  return {
    ...member,
    properties,
    required: [...new Set([...requiredOf(parent), ...requiredOf(member)])],
    additionalProperties: closedShape(parent) ? false : member.additionalProperties,
  }
}

/** The argument shapes a schema allows: each member of its unions (nested ones too) with what it inherits, or the schema itself. */
const argumentShapes = (schema: JsonSchema): JsonSchema[] => {
  const unions = unionsOf(schema)
  return unions.length ? unions.flat().flatMap((member) => argumentShapes(foldShape(schema, member))) : [schema]
}

/**
 * A CoNAI tool schema as Anthropic's native API takes it: whole (pi's converter would keep only `properties` and
 * `required`), without `$schema`. Anthropic refuses a union at the root, so the argument shapes are merged into one
 * object that takes every call the original takes: every property a shape names (differing definitions as anyOf, and
 * anything where an open shape leaves it free), required what every shape requires, closed only when every shape is,
 * and each union's shapes with their own requirements in the description. CoNAI still validates a call against the
 * full schema.
 */
export function anthropicToolSchema(schema: JsonSchema): JsonSchema {
  const { $schema: _dialect, ...whole } = schema
  const unions = unionsOf(schema)
  if (!unions.length) return whole
  const { oneOf: _oneOf, anyOf: _anyOf, properties: _properties, required: _required, additionalProperties: _additional, patternProperties: _patterns, ...rest } = whole
  const groups = unions.map((members) => members.flatMap((member) => argumentShapes(foldShape(schema, member))))
  const shapes = groups.flat()
  const properties = new Map<string, unknown[]>()
  const accept = (key: string, value: unknown) => {
    const variants = properties.get(key) ?? []
    if (!variants.some((known) => sameSchema(known, value))) properties.set(key, [...variants, value])
  }
  for (const shape of shapes) for (const [key, value] of Object.entries(propertiesOf(shape))) accept(key, value)
  for (const shape of shapes.filter((shape) => !closedShape(shape))) {
    const free = typeof shape.additionalProperties === 'object' && shape.patternProperties === undefined ? shape.additionalProperties : {}
    for (const key of [...properties.keys()]) if (!(key in propertiesOf(shape))) accept(key, free)
  }
  const shapeNote = (shape: JsonSchema, index: number) => {
    const fixed = Object.entries(propertiesOf(shape) as Record<string, { const?: unknown } | undefined>).filter(([, value]) => value?.const !== undefined)
    return `${fixed.map(([key, value]) => `${key}=${JSON.stringify(value?.const)}`).join(', ') || `shape ${index + 1}`}: requires ${requiredOf(shape).join(', ') || 'nothing'}`
  }
  const unionNotes = groups.map((group, index) => `${index ? 'Also match one of' : 'Send one argument shape'}: ${group.map(shapeNote).join('; ')}.`)
  return {
    ...rest,
    type: 'object',
    properties: Object.fromEntries([...properties].map(([key, variants]) => [key, variants.length === 1 ? variants[0] : { anyOf: variants }])),
    required: requiredOf(shapes[0]).filter((key) => shapes.every((shape) => requiredOf(shape).includes(key))),
    ...(shapes.every(closedShape) ? { additionalProperties: false } : {}),
    description: [rest.description, ...unionNotes].filter(Boolean).join('\n'),
  }
}

/** A native request with each CoNAI tool's own schema where pi put its reduced one: the request's tools and tools added mid-conversation. */
function withToolSchemas(payload: unknown, schemas: ReadonlyMap<string, JsonSchema>) {
  const body = payload as { tools?: Array<{ name?: string; input_schema?: unknown }>; messages?: Array<{ content?: unknown }> }
  const restore = (tool: { name?: string; input_schema?: unknown } | undefined) => {
    const schema = tool?.name ? schemas.get(tool.name) : undefined
    if (tool && schema) tool.input_schema = schema
  }
  for (const tool of body.tools ?? []) restore(tool)
  for (const message of body.messages ?? []) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content as Array<{ type?: string; tool?: { definition?: { name?: string; input_schema?: unknown } } }>) {
      if (block.type === 'tool_addition') restore(block.tool?.definition)
    }
  }
  return body
}

/**
 * A native request whose thinking budget Anthropic would refuse (under 1024, or not below `max_tokens`: an output
 * limit under about 2048 once fitted) goes without thinking instead of failing every turn.
 */
function withFittingThinking(payload: unknown) {
  const body = payload as { max_tokens?: unknown; thinking?: { type?: string; budget_tokens?: unknown } }
  const budget = Number(body.thinking?.budget_tokens)
  if (body.thinking?.type === 'enabled' && (!(budget >= 1024) || budget >= Number(body.max_tokens))) body.thinking = { type: 'disabled' }
  return payload
}

/** An OpenAI-compatible request body without its cache marks (the parts and the tool pi marked). */
function withoutCacheMarks(body: string) {
  const json = JSON.parse(body) as { messages?: Array<{ content?: unknown }>; tools?: Array<Record<string, unknown>> }
  for (const message of json.messages ?? []) {
    if (Array.isArray(message.content)) for (const part of message.content as Array<Record<string, unknown>>) delete part.cache_control
  }
  for (const tool of json.tools ?? []) delete tool.cache_control
  return JSON.stringify(json)
}

/**
 * The transport of a run that sends cache marks, recovering as the direct path does (llmChatCompletion): a server that
 * refuses `cache_control` gets the same request again without the marks, then none for the rest of the run, and is
 * spared them for a while. pi only ever sees the answer, so its session holds no trace of the refused attempt.
 */
function cacheMarkFetch(target: ChatCompletionTarget): typeof fetch {
  let marked = true
  return async (input, init) => {
    const unmarked = () => fetch(input, { ...init, body: withoutCacheMarks(String(init?.body)) })
    if (!marked) return unmarked()
    const response = await fetch(input, init)
    if (response.status !== 400) return response
    const errorText = await response.clone().text()
    if (!isCacheMarksRefusal(response.status, errorText)) return response
    console.warn(`[pi-chat] ${target.displayName}: request with cache marks rejected (${errorText.slice(0, 200)}); retrying without`)
    marked = false
    noteCacheMarksRefused(target)
    return unmarked()
  }
}

/**
 * The run's model, as pi registers it, with the profile's options. On Anthropic's own API (`anthropic`) pi's native
 * Messages API marks the system prompt, last tool and last message for caching, and pi's catalog entry for the model
 * decides the thinking payload. Every native request carries an output limit (the native API requires one), the
 * profile's or else the model's own (`requestOptions.maxTokens`), which pi cuts to the room the request's prompt leaves
 * in the context window and fits any thinking budget under. Anywhere else the connection's OpenAI-compatible API with
 * the profile's limit as is (`payloadMaxTokens`; none: the server's default), and Anthropic-style marks when the
 * connection's cache marks are on and its server has not refused them (`cacheMarks`).
 */
export function piModelConfig(target: ChatCompletionTarget, contextWindow: number, vision: boolean, anthropic?: { root: string; catalog?: PiCatalogModel; maxTokens: number }) {
  const effort = target.generation.reasoningEffort
  const reasoning = effort === 'low' || effort === 'medium' || effort === 'high'
  const thinkingLevel = reasoning ? effort : 'off' as const
  const input = vision ? ['text' as const, 'image' as const] : ['text' as const]
  const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  // pi lists a model only when its provider has a key; a local server without one ignores it.
  const apiKey = target.apiKey || 'none'
  if (anthropic) {
    const { catalog } = anthropic
    const temperature = target.generation.temperature
    return {
      thinkingLevel,
      // pi reads no sampling params here and sends temperature only where Anthropic takes it (no thinking, a model that
      // has it), which is 0-1 where profiles go up to 2.
      requestOptions: { maxTokens: anthropic.maxTokens, ...(temperature == null ? {} : { temperature: Math.min(temperature, 1) }) },
      payloadMaxTokens: null,
      cacheMarks: false,
      provider: {
        baseUrl: anthropic.root,
        api: 'anthropic-messages' as const,
        apiKey,
        models: [{
          id: target.model, name: target.model, input, cost, contextWindow, maxTokens: anthropic.maxTokens,
          reasoning: catalog?.reasoning ?? reasoning,
          ...(catalog ? {
            thinkingLevelMap: catalog.thinkingLevelMap,
            inputLimits: catalog.inputLimits,
            // A server-side fallback would let another model answer for the one the profile names.
            compat: catalog.compat && { ...catalog.compat, allowedFallbackModels: undefined },
          } : {}),
        }],
      },
    }
  }
  const sampling = buildOpenAiGenerationFields({ ...target.generation, maxTokens: null }, target.thinkingSwitch)
  const cacheMarks = target.promptCacheMarks && !cacheMarksRefusedBy(target)
  return {
    thinkingLevel,
    requestOptions: null,
    payloadMaxTokens: target.generation.maxTokens ?? null,
    cacheMarks,
    provider: {
      baseUrl: target.endpoint.replace(/\/chat\/completions\/?$/, ''),
      api: 'openai-completions' as const,
      apiKey,
      models: [{
        id: target.model, name: target.model, input, cost,
        reasoning, contextWindow,
        // Anthropic models behind LiteLLM or OpenRouter cache only marked prefixes (ChatCompletionTarget.promptCacheMarks).
        compat: { maxTokensField: 'max_tokens' as const, ...(cacheMarks ? { cacheControlFormat: 'anthropic' as const } : {}) },
        // Pi's runtime model uses zero for unknown limits; the wire request below preserves unset output.
        maxTokens: target.generation.maxTokens ?? 0,
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
 * `final`: the run's last round, whose tools are gone.
 */
export function recoverPiToolCalls(message: PiAssistantMessage, available: TextToolCallTools, held: { text: string; marked: boolean }, final = false) {
  const direct = new Set(available.tools.map((tool) => tool.function.name))
  const routable = (name: string) => !direct.has(name) && available.catalogued.has(name) && direct.has(CATALOG_RUN_TOOL)
  const native = message.content.filter((part): part is PiToolCall => part.type === 'toolCall')
  const text = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
  // A call the output limit cut off carries broken arguments, and the last round runs none: as in a direct reply
  // (llmChatService), no call is made of the markup, which still stays out of the reply and out of pi's session.
  const stripOnly = final || message.stopReason === 'length'
  const written = native.length === 0 ? recoverTextToolCalls(text, held, available, stripOnly, message.stopReason === 'length') : null
  if (written) {
    const firstText = message.content.findIndex((part) => part.type === 'text')
    const content = message.content.flatMap<PiAssistantMessage['content'][number]>((part, index) => part.type !== 'text' ? [part] : index === firstText && written.text ? [{ ...part, text: written.text }] : [])
    if (stripOnly) return { message: { ...message, content }, tail: written.tail }
    const calls: PiToolCall[] = written.calls.map((call) => ({ type: 'toolCall', id: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments) }))
    return { message: { ...message, content: [...content, ...calls], stopReason: message.stopReason === 'stop' ? 'toolUse' as const : message.stopReason }, tail: written.tail }
  }
  if (final || !native.some((call) => routable(call.name))) return null
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
  if (usage.cacheWrite) total.cacheWriteInputTokens = (total.cacheWriteInputTokens ?? 0) + usage.cacheWrite
  total.outputTokens += usage.output ?? 0
}

/** One provider request of a pi run, as it ended: its own counts (null when the provider reported none) and duration. */
export type PiRequestUsage = { tokens: LlmTokenCounts | null; latencyMs: number | null; ok: boolean; compaction: boolean }

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
  /** Each provider request in order as it ends, compaction summaries and requests before a failure included. */
  onRequest?: (request: PiRequestUsage) => void
  /** `nested`: a codemode script's call; the model reads its result only as the script prints it. */
  callTool?: (name: string, args: Record<string, unknown>, id: string, nested?: boolean) => Promise<ChatMcpToolResult>
  catalogued?: ReadonlySet<string>
  maxToolRounds?: number
  stopLoops?: boolean
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
  const modelRuntime = await pi.ModelRuntime.create({ authPath: path.join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const anthropicRoot = piAnthropicRoot(params.target)
  const anthropic = anthropicRoot ? await piAnthropicLimits(anthropicRoot, modelRuntime.getModel('anthropic', params.target.model), params.target, params.signal) : undefined
  const contextWindow = anthropic?.contextWindow ?? params.target.contextWindow ?? 0
  const { thinkingLevel, provider, requestOptions, payloadMaxTokens, cacheMarks } = piModelConfig(params.target, contextWindow, Boolean(params.target.piVision), anthropic)
  const toolSchemas = new Map<string, JsonSchema>(anthropic ? tools.map((tool) => [tool.function.name, anthropicToolSchema((tool.function.parameters ?? { type: 'object', properties: {} }) as JsonSchema)]) : [])

  const input = piPromptInput(params.messages)
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
  // A resumed session's superseded screens keep only their residual (supersededPageViewEdits): only as a turn starts (a
  // provider's prompt cache rewrites what follows an edited message), kept in the fork, so every request, restart and
  // compaction reads the same content, and a failed turn takes its edits with it.
  if (file) {
    try {
      for (const edit of supersededPageViewEdits(sessionManager.buildSessionProjection().entries, input.text)) {
        sessionManager.appendContextEdit(edit.targetId, { content: edit.content } as Parameters<typeof sessionManager.appendContextEdit>[1])
      }
    } catch (error) {
      fs.rmSync(file, { force: true })
      throw error
    }
  }
  modelRuntime.registerProvider(PI_PROVIDER, provider)
  const model = modelRuntime.getModel(PI_PROVIDER, params.target.model)
  if (!model) throw new Error('pi에 모델을 등록하지 못했어.')
  const system = params.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
  const settingsManager = pi.SettingsManager.inMemory({
    // Natively pi cuts each request's output to the room the prompt leaves less its own margin; compaction keeps that margin too.
    compaction: params.research ? { enabled: false } : piCompactionSettings(contextWindow, params.target.generation.maxTokens, anthropic ? PI_CONTEXT_SAFETY_TOKENS : 0),
    httpIdleTimeoutMs: params.target.timeoutMs ?? 0,
    retry: { enabled: !params.research, maxRetries: params.research ? 0 : 2, ...(params.target.timeoutMs != null ? { provider: { timeoutMs: params.target.timeoutMs } } : {}) },
    enableInstallTelemetry: false,
    cacheWarming: 'off',
    defaultTools: [],
    images: { blockImages: !params.target.piVision },
  })
  let content = ''
  let looping = false
  let streamedText = ''
  const textWatch = params.stopLoops ? createRepetitionWatch() : null
  const reasoningWatch = params.stopLoops ? createRepetitionWatch() : null
  let separate = false
  // Tool calls written as text are recovered while the model has tools (they go once the budget is used up); after
  // that, their markup is still kept out of the reply.
  let recovering = tools.length > 0
  // Each assistant message's text starts a paragraph of its own (a round's note, then the answer).
  const emitText = (text: string) => {
    if (!text || looping) return
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
        if (event.message.role !== 'assistant' || looping) return
        const held = textFilter.end()
        const recovered = recoverPiToolCalls(event.message, { tools, catalogued: params.catalogued ?? new Set() }, held, !recovering)
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
      if (looping) throw new Error('pi 응답 반복으로 도구 실행이 중단됐어.')
      if (!params.callTool) throw new Error('Unknown or not permitted tool')
      if (round > toolRounds) return { content: [{ type: 'text' as const, text: TOOL_BUDGET_NOTE }], details: {}, isError: true }
      const slash = toolCallId.lastIndexOf('/')
      const nested = codemode && slash > 0
      if (nested) {
        const script = toolCallId.slice(0, slash)
        const count = (scriptCalls.get(script) ?? 0) + 1
        scriptCalls.set(script, count)
        if (count > toolRounds) return { content: [{ type: 'text' as const, text: codemodeBudgetNote(toolRounds) }], details: {}, isError: true }
      }
      return piToolResult(await params.callTool(tool.function.name, (args ?? {}) as Record<string, unknown>, toolCallId, nested))
    },
  }))

  const { session: agent } = await pi.createAgentSession({
    cwd, agentDir, model, thinkingLevel, modelRuntime, resourceLoader, settingsManager, sessionManager,
    customTools, tools: [...customTools.map((tool) => tool.name), ...(codemode ? [CODEMODE_TOOL] : [])],
  })
  // Every request, summaries included (they set a cap of their own), asks for the run's output limit (piModelConfig):
  // natively pi cuts it to the room the prompt leaves; on an OpenAI-compatible server pi's adapter would invent a cap
  // and subtract a fixed context margin, so the profile's limit goes as is and the provider validates the context.
  const stream = agent.agent.streamFunction
  const marksFetch = cacheMarks ? cacheMarkFetch(params.target) : null
  const usage: LlmTokenCounts = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
  let reportedUsage = false
  let compacting = false
  const noteRequest = (message: { usage?: Parameters<typeof addUsage>[1]; stopReason: string; durationMs?: number }) => {
    const counts = message.usage
    // pi initializes absent provider usage to zero; keep our fallback estimate available in that case.
    const reported = Boolean(counts) && [counts?.input, counts?.output, counts?.cacheRead, counts?.cacheWrite].some((value) => (value ?? 0) > 0)
    // A budget stop aborts between turns, and pi's next request then ends aborted without being sent.
    if (budgetStopped && message.stopReason === 'aborted' && !reported) return
    const own: LlmTokenCounts ={ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
    if (reported) {
      reportedUsage = true
      addUsage(own, counts)
      addUsage(usage, counts)
    }
    // The request the loop guard hung up on answered, as a direct request cut the same way does.
    const ok = message.stopReason !== 'error' && (message.stopReason !== 'aborted' || looping)
    params.onRequest?.({ tokens: reported ? own : null, latencyMs: message.durationMs ?? null, ok, compaction: compacting })
  }
  const send: typeof stream = (requestModel, context, options) => stream(requestModel, context, requestOptions ? {
    ...options,
    ...requestOptions,
    onPayload: async (payload, model) => withFittingThinking(withToolSchemas(await options?.onPayload?.(payload, model) ?? payload, toolSchemas)),
  } : {
    ...options,
    ...(marksFetch ? { fetch: marksFetch } : {}),
    onPayload: async (payload, model) => {
      const body = (await options?.onPayload?.(payload, model) ?? payload) as Record<string, unknown>
      delete body.max_tokens
      delete body.max_completion_tokens
      if (payloadMaxTokens != null) body.max_tokens = payloadMaxTokens
      return body
    },
  })
  // Every provider request pi makes passes here, its compaction summaries too (synthetic failure messages do not):
  // the final message resolves before pi goes on, so each request is counted once, in order.
  agent.agent.streamFunction = async (requestModel, context, options) => {
    const response = await send(requestModel, context, options)
    // A stream that rejects fails its request, which reports the failure itself: there is nothing to count.
    void response.result().then(noteRequest, () => {})
    return response
  }
  // This run's model answers, in order (a compaction rebuilds the session's messages, so they are collected here).
  const produced: Array<Extract<AgentSessionEvent, { type: 'message_end' }>['message'] & { role: 'assistant' }> = []
  let reasoning = ''
  let compacted = false
  let budgetStopped = false
  const abort = () => { void agent.abort() }
  params.signal.addEventListener('abort', abort, { once: true })
  const unsubscribe = agent.subscribe((event: AgentSessionEvent) => {
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
    if (event.type === 'message_update' && !looping) {
      const update = event.assistantMessageEvent
      if (update.type === 'text_delta' && update.delta) {
        textFilter.push(update.delta)
        if (textWatch) {
          streamedText += update.delta
          looping = textWatch.looping(streamedText)
        }
      }
      if (update.type === 'thinking_delta' && update.delta) {
        reasoning += update.delta
        params.onReasoning?.(update.delta)
        looping = reasoningWatch?.looping(reasoning) ?? false
      }
      if (looping) void agent.abort()
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') produced.push(event.message)
    if (event.type === 'compaction_start') compacting = true
    if (event.type === 'compaction_end') {
      compacting = false
      if (event.result && !event.aborted) {
        compacted = true
        session.onCompaction?.()
      }
    }
  })
  let succeeded = false
  try {
    verifyPiTools(agent.getActiveToolNames(), tools, codemode ? [CODEMODE_TOOL] : [])
    params.signal.throwIfAborted()
    try {
      await agent.prompt(input.text, { expandPromptTemplates: false, ...(input.images.length ? { images: input.images } : {}) })
    } catch (error) {
      if (!looping) throw error
    }
    params.signal.throwIfAborted()
    if (looping) {
      const kept = withoutRepetition(content)
      // A stopped loop never advances the saved session; finally removes only this run's fork.
      return { content: kept, reasoning: withoutRepetition(reasoning), toolCalls: [], finishReason: 'repetition', promptTokens: null, usage: reportedUsage ? usage : null, loopCut: content.length - kept.length }
    }
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
