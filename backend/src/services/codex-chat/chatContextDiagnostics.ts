import { createHash } from 'crypto'
import type { ChatCompletionMessage, ChatCompletionTool } from './llmChatCompletion'
import type { LoreDecision } from './chatLorebook'

/** Names reflect the pieces CoNAI actually sends; merged messages keep one section position. */
export const CHAT_CONTEXT_SECTION_KINDS = [
  'persona', 'system-prompt', 'prompt-section', 'guidance', 'lore-index', 'constant-lore', 'lore', 'summary',
  'example', 'window', 'reference', 'author-note', 'state', 'flags', 'user-persona', 'recall',
  'page', 'continuation', 'last-instruction', 'tool-definition', 'tool-result', 'group-header',
  'summary-instruction', 'translation-instruction',
] as const
export type ChatContextSectionKind = typeof CHAT_CONTEXT_SECTION_KINDS[number]
export const CHAT_CONTEXT_META_LIMITS = { sections: 512, parts: 64, sources: 512, lore: 256, loreSkipped: 256, recall: 12, terms: 6, string: 160 } as const

export type ContextSource = { kind: ChatContextSectionKind; id?: number | string; hash: string }
export type ContextSection = { kind: ChatContextSectionKind; role: string; position: number; estTokens: number; hash: string; parts?: Omit<ContextSection, 'parts'>[] }
export type ChatDiagnosticsFields = {
  version?: 2
  engine?: 'llm' | 'codex'
  opaqueContext?: boolean
  profileId?: number
  sections?: ContextSection[]
  sources?: ContextSource[]
  auxiliarySources?: ContextSource[]
  /** The v1 `lore` title list stays readable by the existing client. */
  loreEntries?: LoreDecision[]
  loreSkipped?: Array<Pick<LoreDecision, 'entryId' | 'bookId' | 'title' | 'reason'>>
  loreUnmatched?: number
  recall?: Array<{ segmentId: number; score: number; terms: string[]; hash: string }>
  window?: { fromId: number | null; sent: number; droppedTurns: number }
  toolRounds?: number
  codexKeys?: string[]
  tokenUsage?: { contextTokens: number | null; inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null }
  truncated?: boolean
}

export function contextHash(text: string) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

export function contextSource(kind: ChatContextSectionKind, text: string, id?: number | string): ContextSource[] {
  return text ? [{ kind, ...(id === undefined ? {} : { id }), hash: contextHash(text) }] : []
}

const messageKinds = new WeakMap<ChatCompletionMessage, ChatContextSectionKind>()
const messageParts = new WeakMap<ChatCompletionMessage, Array<{ kind: ChatContextSectionKind; text: string }>>()
export function markContextParts<T extends ChatCompletionMessage>(message: T, parts: Array<{ kind: ChatContextSectionKind; text: string }>): T {
  messageParts.set(message, parts.filter((part) => part.text))
  return message
}
export function contextPartsOf(message: ChatCompletionMessage) { return messageParts.get(message) ?? [] }
export function markContextMessage<T extends ChatCompletionMessage>(message: T, kind: ChatContextSectionKind): T {
  messageKinds.set(message, kind)
  return message
}

/** Compute from the final messages, including page/continuation and the definitions sent beside them. */
export function contextSections(messages: ChatCompletionMessage[], tools: ChatCompletionTool[], estimate: (text: string) => number): ContextSection[] {
  return [
    ...messages.map((message, position) => {
      const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
      const body = message.role === 'assistant' && message.tool_calls ? `${text}\n${JSON.stringify(message.tool_calls)}` : text
      const kind = messageKinds.get(message) ?? (message.role === 'system' ? 'persona' : message.role === 'tool' ? 'tool-result' : text.includes('[참고 설정]') ? 'reference' : 'window')
      const parts = messageParts.get(message)
      return { kind, role: message.role, position, estTokens: estimate(body), hash: contextHash(body), ...(parts ? { parts: parts.map((part) => ({ kind: part.kind, role: message.role, position, estTokens: estimate(part.text), hash: contextHash(part.text) })) } : {}) }
    }),
    ...tools.map((tool, index) => ({ kind: 'tool-definition' as const, role: 'tool-definition', position: messages.length + index, estTokens: estimate(JSON.stringify(tool)), hash: contextHash(JSON.stringify(tool)) })),
  ]
}

/** Bound stored metadata without ever adding source text. */
export function limitContextMeta<T extends { lore: string[] } & ChatDiagnosticsFields>(meta: T): T {
  let truncated = meta.truncated === true
  const trim = (value: unknown, limit: number = CHAT_CONTEXT_META_LIMITS.sources): unknown => {
    if (typeof value === 'string') {
      if (value.length > CHAT_CONTEXT_META_LIMITS.string) truncated = true
      return value.slice(0, CHAT_CONTEXT_META_LIMITS.string)
    }
    if (Array.isArray(value)) {
      if (value.length > limit) truncated = true
      return value.slice(0, limit).map((item) => trim(item))
    }
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trim(item, key === 'parts' ? CHAT_CONTEXT_META_LIMITS.parts : key === 'terms' || key === 'matched' ? CHAT_CONTEXT_META_LIMITS.terms : CHAT_CONTEXT_META_LIMITS.sources)]))
    return value
  }
  const caps = CHAT_CONTEXT_META_LIMITS
  const limits: Record<string, number> = { sections: caps.sections, sources: caps.sources, auxiliarySources: caps.sources, lore: caps.lore, loreEntries: caps.lore, loreSkipped: caps.loreSkipped, recall: caps.recall, codexKeys: caps.sources }
  const result = Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, trim(value, limits[key])])) as T
  if (truncated) result.truncated = true
  return result
}

export function loreDiagnostics(decisions: LoreDecision[], unmatched: number): Pick<ChatDiagnosticsFields, 'loreEntries' | 'loreSkipped' | 'loreUnmatched'> {
  return {
    loreEntries: decisions.filter((decision) => decision.selected),
    loreSkipped: decisions.filter((decision) => !decision.selected).map(({ entryId, bookId, title, reason }) => ({ entryId, bookId, title, reason })),
    loreUnmatched: unmatched,
  }
}

/** Old records remain v1; use a whitelist so no captured body can travel in a thread response. */
export function legacyContextMeta(meta: Record<string, unknown>) {
  const keys = ['windowFromMessageId', 'sentMessages', 'summaryUntilMessageId', 'recalledSegments', 'lore', 'memories', 'estimatedTokens', 'model', 'promptTokens']
  return Object.fromEntries(keys.filter((key) => key in meta).map((key) => [key, meta[key]]))
}

/** Explicit projection keeps bodies and future text-bearing fields out of every metadata response. */
export function metadataOnly(meta: { lore: string[] } & ChatDiagnosticsFields) {
  const pick = (value: object, keys: string[]) => Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, (value as Record<string, unknown>)[key]]))
  if (meta.version !== 2) return legacyContextMeta(meta)
  return {
    ...legacyContextMeta(meta),
    ...pick(meta, ['version', 'engine', 'opaqueContext', 'profileId', 'loreUnmatched', 'toolRounds', 'codexKeys', 'truncated']),
    sections: meta.sections?.map((section) => ({ ...pick(section, ['kind', 'role', 'position', 'estTokens', 'hash']), ...(section.parts ? { parts: section.parts.map((part) => pick(part, ['kind', 'role', 'position', 'estTokens', 'hash'])) } : {}) })),
    sources: meta.sources?.map((source) => pick(source, ['kind', 'id', 'hash'])),
    auxiliarySources: meta.auxiliarySources?.map((source) => pick(source, ['kind', 'id', 'hash'])),
    loreEntries: meta.loreEntries?.map((entry) => pick(entry, ['key', 'bookId', 'bookKind', 'entryId', 'title', 'selected', 'reason', 'matched', 'hash', 'file', 'remaining'])),
    loreSkipped: meta.loreSkipped?.map((entry) => pick(entry, ['entryId', 'bookId', 'title', 'reason'])),
    recall: meta.recall?.map((recall) => pick(recall, ['segmentId', 'score', 'terms', 'hash'])),
    window: meta.window ? pick(meta.window, ['fromId', 'sent', 'droppedTurns']) : undefined,
    tokenUsage: meta.tokenUsage ? pick(meta.tokenUsage, ['contextTokens', 'inputTokens', 'cachedInputTokens', 'outputTokens']) : undefined,
  }
}
