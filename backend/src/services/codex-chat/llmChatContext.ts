import { resolveSummaryPrompt, type ChatProfile } from './chatProfiles'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { completeChat, resolveChatCompletionTarget, type ChatCompletionMessage, type ChatCompletionTool } from './llmChatCompletion'

/** Tool output replayed to the model for turns still in the window. */
const REPLAYED_TOOL_OUTPUT_LENGTH = 4000
const SUMMARY_TOOL_NOTE_LENGTH = 300
/** Room kept for the reply when the profile sets no max tokens. */
const DEFAULT_REPLY_RESERVE_TOKENS = 2048

const TOOL_GUIDANCE = [
  'You can act on CoNAI, a local app for managing and generating AI images, only through the provided tools.',
  'For generation, prefer submit_generation_job, then poll get_generation_job until it finishes, and mention the resulting history ids.',
  'NovelAI requests must always use n_samples 1 (two or more samples cost paid Anlas). Submit separate jobs for more images.',
  'Ask for confirmation before bulk or destructive changes such as moving many images between groups.',
].join('\n')

export type LlmChatContextConfig = {
  contextTurns: number
  /** Token budget for the whole request (null: turns only). */
  contextTokens: number | null
  replyReserveTokens: number
  summaryEnabled: boolean
  summaryTriggerTurns: number
  summaryPrompt: string
}

/** The chat's own overrides (turn count, summary on/off), else the profile's settings. */
export function resolveContextConfig(thread: CodexChatThreadRecord, profile: ChatProfile): LlmChatContextConfig {
  return {
    contextTurns: thread.context_turns ?? profile.contextTurns,
    contextTokens: profile.contextTokens,
    replyReserveTokens: profile.maxTokens ?? DEFAULT_REPLY_RESERVE_TOKENS,
    summaryEnabled: thread.summary_enabled !== null ? thread.summary_enabled === 1 : profile.summaryEnabled,
    summaryTriggerTurns: profile.summaryTriggerTurns,
    summaryPrompt: resolveSummaryPrompt(profile),
  }
}

/** Some servers inline reasoning as `<think>…</think>` instead of a separate field. */
export function stripThinking(text: string) {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').replace(/^\s*<think>[\s\S]*$/i, '')
}

/** `{{char}}` / `{{user}}` placeholders, as character cards write them. */
export function fillCharacterPlaceholders(text: string, profile: ChatProfile) {
  return text.replace(/\{\{\s*char\s*\}\}/gi, profile.name).replace(/\{\{\s*user\s*\}\}/gi, '사용자')
}

/** System prompt, character, user persona and example dialogue as one block (both engines use it). */
export function buildPersonaPrompt(profile: ChatProfile) {
  const sections = [
    profile.systemPrompt,
    profile.characterDescription ? `## 캐릭터: ${profile.name}\n${profile.characterDescription}` : '',
    profile.userPersona ? `## 사용자\n${profile.userPersona}` : '',
    profile.exampleDialogue ? `## 대화 예시\n${profile.exampleDialogue}` : '',
  ]
  return fillCharacterPlaceholders(sections.filter(Boolean).join('\n\n'), profile)
}

/** A turn starts at a user message; a greeting before the first user message is a turn of its own. */
export function splitTurns(messages: CodexChatMessageRecord[]) {
  const turns: CodexChatMessageRecord[][] = []
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) {
      turns.push([message])
    } else {
      turns[turns.length - 1].push(message)
    }
  }
  return turns
}

// ---- Token estimate -------------------------------------------------------------------------------------------

/** Server-reported prompt tokens ÷ our estimate, per profile, so the estimate tracks each model's tokenizer. */
const estimateRatios = new Map<number, number>()

/** Rough tokens: ~4 ASCII characters or ~1 other character (Korean, CJK) per token. Errs high. */
function rawTokenEstimate(text: string) {
  let ascii = 0
  let other = 0
  for (const char of text) {
    if (char.charCodeAt(0) < 128) ascii += 1
    else other += 1
  }
  return Math.ceil(ascii / 4 + other)
}

export function estimateTokens(profileId: number, text: string) {
  return Math.ceil(rawTokenEstimate(text) * (estimateRatios.get(profileId) ?? 1))
}

export function estimateMessagesTokens(profileId: number, messages: ChatCompletionMessage[], tools: ChatCompletionTool[] = []) {
  return estimateTokens(profileId, JSON.stringify(messages) + (tools.length > 0 ? JSON.stringify(tools) : ''))
}

/** Feed back the prompt tokens a server reported for a request we estimated (smoothed, clamped to 0.4–2.5×). */
export function recordPromptUsage(profileId: number, rawEstimate: number, promptTokens: number) {
  if (rawEstimate <= 0 || promptTokens <= 0) {
    return
  }
  const measured = Math.min(2.5, Math.max(0.4, promptTokens / rawEstimate))
  const previous = estimateRatios.get(profileId)
  estimateRatios.set(profileId, previous === undefined ? measured : previous * 0.7 + measured * 0.3)
}

export function rawMessagesEstimate(messages: ChatCompletionMessage[], tools: ChatCompletionTool[] = []) {
  return rawTokenEstimate(JSON.stringify(messages) + (tools.length > 0 ? JSON.stringify(tools) : ''))
}

// ---- Window ---------------------------------------------------------------------------------------------------

function toCompletionMessages(message: CodexChatMessageRecord): ChatCompletionMessage[] {
  if (message.role === 'user') {
    return [{ role: 'user', content: message.content }]
  }

  const calls = message.tool_calls.filter((call) => call.id && call.tool)
  const result: ChatCompletionMessage[] = []
  if (calls.length > 0) {
    result.push({
      role: 'assistant',
      content: null,
      tool_calls: calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.tool, arguments: JSON.stringify(call.arguments ?? {}) } })),
    })
    for (const call of calls) {
      result.push({ role: 'tool', tool_call_id: call.id, content: (call.output ?? call.summary ?? '').slice(0, REPLAYED_TOOL_OUTPUT_LENGTH) || '(no output)' })
    }
  }
  if (message.content.trim()) {
    result.push({ role: 'assistant', content: message.content })
  }
  return result
}

/**
 * The turns that fit: at most `contextTurns`, and — with a token budget — only as many recent turns as fit beside the
 * fixed part (system prompt, summary, tool schemas) and the reply reserve. The newest turn is always kept.
 */
function selectWindow(profileId: number, turns: CodexChatMessageRecord[][], config: LlmChatContextConfig, fixedTokens: number) {
  const candidates = turns.slice(-config.contextTurns)
  if (config.contextTokens === null) {
    return candidates
  }
  let remaining = config.contextTokens - config.replyReserveTokens - fixedTokens
  const kept: CodexChatMessageRecord[][] = []
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const cost = estimateMessagesTokens(profileId, candidates[index].flatMap(toCompletionMessages))
    if (kept.length > 0 && cost > remaining) {
      break
    }
    kept.unshift(candidates[index])
    remaining -= cost
  }
  return kept
}

function buildSystemMessages(profile: ChatProfile, thread: CodexChatThreadRecord, config: LlmChatContextConfig, withTools: boolean) {
  const systemPrompt = [buildPersonaPrompt(profile), withTools ? TOOL_GUIDANCE : ''].filter(Boolean).join('\n\n')
  const result: ChatCompletionMessage[] = systemPrompt ? [{ role: 'system', content: systemPrompt }] : []
  if (config.summaryEnabled && thread.summary?.trim()) {
    result.push({ role: 'system', content: `## 지금까지의 대화 요약\n${thread.summary.trim()}` })
  }
  return result
}

function sendableMessages(messages: CodexChatMessageRecord[]) {
  return messages.filter((message) => message.content.trim() || message.tool_calls.length > 0)
}

/**
 * The request for one reply: the profile's system prompt (stable, so servers can reuse the cached prefix), the
 * rolling summary when enabled, then the recent turns that fit — ending with the user message just stored.
 */
export function buildChatMessages(params: {
  profile: ChatProfile
  thread: CodexChatThreadRecord
  messages: CodexChatMessageRecord[]
  config: LlmChatContextConfig
  tools: ChatCompletionTool[]
}): ChatCompletionMessage[] {
  const { profile, thread, config, tools } = params
  const system = buildSystemMessages(profile, thread, config, tools.length > 0)
  const window = selectWindow(profile.id, splitTurns(sendableMessages(params.messages)), config, estimateMessagesTokens(profile.id, system, tools))
  return [...system, ...window.flat().flatMap(toCompletionMessages)]
}

// ---- Summary --------------------------------------------------------------------------------------------------

function transcriptLine(message: CodexChatMessageRecord, profile: ChatProfile) {
  const speaker = message.role === 'user' ? '사용자' : profile.name
  const tools = message.tool_calls.map((call) => `[도구 ${call.tool}: ${(call.summary ?? '').slice(0, SUMMARY_TOOL_NOTE_LENGTH)}]`)
  return [`${speaker}: ${message.content}`, ...tools].join('\n')
}

const summarizing = new Set<number>()

/**
 * Fold turns that left the window (turn count or token budget) into the thread summary. Automatic runs wait until
 * `summaryTriggerTurns` turns have dropped out; `force` folds in everything not yet summarized.
 */
export async function updateThreadSummary(threadId: number, profile: ChatProfile, options: { force?: boolean; signal?: AbortSignal } = {}) {
  if (summarizing.has(threadId)) {
    return null
  }
  const thread = CodexChatStore.findThreadById(threadId)
  if (!thread) {
    return null
  }
  const config = resolveContextConfig(thread, profile)
  if (!options.force && !config.summaryEnabled) {
    return null
  }

  const turns = splitTurns(sendableMessages(CodexChatStore.listMessages(threadId)))
  const windowSize = selectWindow(profile.id, turns, config, estimateMessagesTokens(profile.id, buildSystemMessages(profile, thread, config, profile.mcpEnabled))).length
  const candidates = (options.force ? turns : turns.slice(0, Math.max(0, turns.length - windowSize))).flat()
  const pending = candidates.filter((message) => message.id > (thread.summary_until_message_id ?? 0))
  const pendingTurns = pending.filter((message) => message.role === 'user').length
  if (pending.length === 0 || (!options.force && pendingTurns < config.summaryTriggerTurns)) {
    return null
  }

  summarizing.add(threadId)
  try {
    const target = resolveChatCompletionTarget(profile.summaryProviderName || profile.providerName, {
      model: profile.summaryProviderName ? profile.summaryModel || null : profile.summaryModel || profile.model || null,
      temperature: 0.3,
    })
    const transcript = pending.map((message) => transcriptLine(message, profile)).join('\n\n')
    const summary = stripThinking(await completeChat(target, [
      { role: 'system', content: config.summaryPrompt },
      { role: 'user', content: `## 이전 요약\n${thread.summary?.trim() || '(없음)'}\n\n## 이어진 대화\n${transcript}` },
    ], options.signal ?? AbortSignal.timeout(10 * 60 * 1000))).trim()
    if (!summary) {
      throw new Error('요약 결과가 비어 있어.')
    }
    CodexChatStore.setSummary(threadId, summary, pending[pending.length - 1].id)
    return summary
  } finally {
    summarizing.delete(threadId)
  }
}
