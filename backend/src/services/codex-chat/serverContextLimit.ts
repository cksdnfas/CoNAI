import { rawMessagesEstimate } from '../llmUsage'
import { resolveChatCompletionTarget, type ChatCompletionTarget } from './llmChatCompletion'
import { resolveProfileModel } from './chatModelRoles'
import type { ChatProfile } from './chatProfiles'

/**
 * The context size a local server actually runs with (llama.cpp `/props`, its `/v1/models` meta, LM Studio, OpenRouter),
 * so a profile is not sent more than the server holds: llama.cpp refuses such a request outright, and other servers
 * drop its beginning (the character prompt). Looked up once per connection and model and kept for a while; unknown
 * stays unknown.
 */
const CACHE_MS = 60 * 60_000
const LOOKUP_TIMEOUT_MS = 2500
/**
 * Summary sizing stops growing here: a long chat folds in chunks sized for this context (half of it per call) rather
 * than half of a 256k context in one call. Requests themselves fit the whole context.
 */
export const SUMMARY_CONTEXT_CAP = 65_536

/**
 * A size learned from a refusal lives shorter: behind a proxy (LiteLLM) the lookup cannot see the server, and a server
 * restarted with a larger context must not stay sized to the old one for an hour.
 */
const LEARNED_MS = 10 * 60_000

const known = new Map<string, { tokens: number | null; until: number }>()
const pending = new Map<string, Promise<number | null>>()
const keyOf = (target: Pick<ChatCompletionTarget, 'providerName' | 'model'>) => `${target.providerName}\u0000${target.model}`

/** Synchronous admission/preview: reuse discovery and refusals, never initiate network I/O. */
export function cachedServerContextLimit(target: Pick<ChatCompletionTarget, 'providerName' | 'model'>): number | null {
  const cached = known.get(keyOf(target))
  return cached && Date.now() < cached.until ? cached.tokens : null
}

/** A context size the server named in an error ("… exceeds the available context size (8192 tokens)"). */
export function learnServerContextLimit(target: Pick<ChatCompletionTarget, 'providerName' | 'model'>, errorText: string) {
  const match = /context[^0-9]{0,60}\(?\s*(\d{3,7})\s*(?:tokens)?\)?/i.exec(errorText.replace(/request \(\d+ tokens\)/i, ''))
  const tokens = match ? Number(match[1]) : NaN
  if (Number.isFinite(tokens) && tokens >= 512) known.set(keyOf(target), { tokens, until: Date.now() + LEARNED_MS })
}

/** Below this a cap cut to the room left is no reply at all: the request fails instead. */
export const MIN_FITTED_REPLY_TOKENS = 256

/** Summary output room after a raw-estimate margin; false means it does not fit, null means the limit is unknown. */
export function summaryContextRoom(limit: number | null, messages: Array<{ role: string; content: unknown }>): number | null | false {
  if (limit === null) return null
  const room = limit - Math.ceil(rawMessagesEstimate(messages) * 1.05)
  return room < MIN_FITTED_REPLY_TOKENS ? false : room
}

/**
 * The output room a server named when it refused a prompt + max_tokens larger than its context: Strata says "at most
 * N", or "prompt (P tokens) … context (C)"; vLLM "maximum context length is C tokens … (P in the messages". Null when
 * the refusal does not say.
 */
export function replyRoomFromRefusal(errorText: string): number | null {
  const atMost = /max_tokens[^0-9]{0,20}\(?at most (\d+)/i.exec(errorText)
  if (atMost) return Number(atMost[1])
  const strata = /prompt \((\d+) tokens\)[^]{0,80}?context \((\d+)\)/i.exec(errorText)
  if (strata) return Number(strata[2]) - Number(strata[1])
  const vllm = /maximum context length is (\d+) tokens[^]{0,200}?\((\d+) in the messages/i.exec(errorText)
  if (vllm) return Number(vllm[1]) - Number(vllm[2])
  return null
}

function numberOf(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 512 ? Math.floor(value) : null
}

async function getJson(url: string, target: ChatCompletionTarget) {
  const response = await fetch(url, { headers: target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) })
  if (!response.ok) return null
  return response.json().catch(() => null) as Promise<unknown>
}

async function lookup(target: ChatCompletionTarget): Promise<number | null> {
  const apiBase = target.endpoint.replace(/\/chat\/completions$/, '')
  const root = apiBase.replace(/\/v1$/, '')
  // llama.cpp: the slot's own context (with -np N each slot holds n_ctx / N).
  const props = await getJson(`${root}/props`, target).catch(() => null) as { default_generation_settings?: { n_ctx?: unknown } } | null
  const fromProps = numberOf(props?.default_generation_settings?.n_ctx)
  if (fromProps) return fromProps
  const models = await getJson(`${apiBase}/models`, target).catch(() => null) as { data?: Array<Record<string, unknown>> } | null
  const entry = models?.data?.find((model) => model.id === target.model)
  if (entry) {
    const meta = entry.meta as { n_ctx?: unknown } | undefined
    const fromModels = numberOf(meta?.n_ctx) ?? numberOf(entry.loaded_context_length) ?? numberOf(entry.context_length) ?? numberOf(entry.max_context_length)
    if (fromModels) return fromModels
  }
  // LM Studio's own listing carries the loaded context.
  const studio = await getJson(`${root}/api/v0/models`, target).catch(() => null) as { data?: Array<Record<string, unknown>> } | null
  const loaded = studio?.data?.find((model) => model.id === target.model)
  return numberOf(loaded?.loaded_context_length) ?? null
}

/** The server's context size for a target, looked up at most once per CACHE_MS; null when it does not say. */
export async function serverContextLimit(target: ChatCompletionTarget): Promise<number | null> {
  if (target.transport === 'claude-code') return null
  const key = keyOf(target)
  const cached = known.get(key)
  if (cached && Date.now() < cached.until) return cached.tokens
  const running = pending.get(key)
  if (running) return running
  const request = lookup(target).catch(() => null).then((tokens) => {
    known.set(key, { tokens, until: Date.now() + CACHE_MS })
    pending.delete(key)
    return tokens
  })
  pending.set(key, request)
  return request
}

/**
 * The one context an API LLM profile's requests fit in, direct or through pi: its 최대 컨텍스트 setting and the size
 * its chat model's server runs with, the smaller when both are known; null when neither is. Claude Code and Codex
 * hold their own context, so a value left on such a profile counts for nothing. Never waits on the network: a lookup
 * it starts sizes the requests after it (a refusal naming the size counts at once).
 */
export function profileContextTokens(profile: ChatProfile): number | null {
  if (profile.engine !== 'llm') return null
  let learned: number | null = null
  try {
    const chat = resolveProfileModel(profile, 'chat')
    if (chat) {
      const target = resolveChatCompletionTarget(chat.providerName, { model: chat.model })
      const cached = known.get(keyOf(target))
      if (!cached || Date.now() >= cached.until) void serverContextLimit(target)
      learned = cached && Date.now() < cached.until ? cached.tokens : null
    }
  } catch {
    learned = null
  }
  const declared = profile.contextTokens
  return declared === null ? learned : learned === null ? declared : Math.min(declared, learned)
}

/** The profile as an LLM reply sizes its request: `contextTokens` is what profileContextTokens says. */
export function withServerContextLimit(profile: ChatProfile): ChatProfile {
  const contextTokens = profileContextTokens(profile)
  return contextTokens === profile.contextTokens ? profile : { ...profile, contextTokens }
}
