import { resolveChatCompletionTarget, type ChatCompletionTarget } from './llmChatCompletion'
import { resolveProfileModel } from './chatModelRoles'
import type { ChatProfile } from './chatProfiles'

/**
 * The context size a local server actually runs with (llama.cpp `/props`, its `/v1/models` meta, LM Studio, OpenRouter),
 * so a profile without its own context length is not sent more than the server holds: llama.cpp refuses such a
 * request outright, and other servers drop its beginning (the character prompt). Looked up once per connection and
 * model and kept for a while; unknown stays unknown.
 */
const CACHE_MS = 60 * 60_000
const LOOKUP_TIMEOUT_MS = 2500
/**
 * Above this the server is not the limit in practice: the window keeps following the turn count, and summary chunks
 * keep their defaults instead of growing to half of a 256k context.
 */
export const SERVER_CONTEXT_CAP = 65_536

/**
 * A size learned from a refusal lives shorter: behind a proxy (LiteLLM) the lookup cannot see the server, and a server
 * restarted with a larger context must not stay sized to the old one for an hour.
 */
const LEARNED_MS = 10 * 60_000

const known = new Map<string, { tokens: number | null; until: number }>()
const pending = new Map<string, Promise<number | null>>()
const keyOf = (target: Pick<ChatCompletionTarget, 'providerName' | 'model'>) => `${target.providerName}\u0000${target.model}`

/** A context size the server named in an error ("… exceeds the available context size (8192 tokens)"). */
export function learnServerContextLimit(target: Pick<ChatCompletionTarget, 'providerName' | 'model'>, errorText: string) {
  const match = /context[^0-9]{0,60}\(?\s*(\d{3,7})\s*(?:tokens)?\)?/i.exec(errorText.replace(/request \(\d+ tokens\)/i, ''))
  const tokens = match ? Number(match[1]) : NaN
  if (Number.isFinite(tokens) && tokens >= 512) known.set(keyOf(target), { tokens, until: Date.now() + LEARNED_MS })
}

/** Below this a cap cut to the room left is no reply at all: the request fails instead. */
export const MIN_FITTED_REPLY_TOKENS = 256

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
 * The profile as an LLM reply sizes its request: without its own context length, a server that says it holds at most
 * SERVER_CONTEXT_CAP tokens counts as that length (as if it were set on the profile). The lookup never holds a reply
 * up: it runs in the background and its answer sizes the replies after it (a refusal naming the size counts at once).
 */
export function withServerContextLimit(profile: ChatProfile): ChatProfile {
  if (profile.contextTokens !== null) return profile
  try {
    const chat = resolveProfileModel(profile, 'chat')
    if (!chat) return profile
    const target = resolveChatCompletionTarget(chat.providerName, { model: chat.model })
    const cached = known.get(keyOf(target))
    if (!cached || Date.now() >= cached.until) void serverContextLimit(target)
    const tokens = cached?.tokens ?? null
    return tokens !== null && tokens <= SERVER_CONTEXT_CAP ? { ...profile, contextTokens: tokens } : profile
  } catch {
    return profile
  }
}
