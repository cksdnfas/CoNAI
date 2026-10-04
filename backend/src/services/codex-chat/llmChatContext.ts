import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { completeChat, resolveChatCompletionTarget, type ChatCompletionMessage } from './llmChatCompletion'
import type { LlmChatProfile } from './llmChatProfiles'
import { loadLlmChatSettings } from './llmChatSettings'

/** Tool output replayed to the model for turns still in the window. */
const REPLAYED_TOOL_OUTPUT_LENGTH = 4000
const SUMMARY_TOOL_NOTE_LENGTH = 300

const TOOL_GUIDANCE = [
  'You can act on CoNAI, a local app for managing and generating AI images, only through the provided tools.',
  'For generation, prefer submit_generation_job, then poll get_generation_job until it finishes, and mention the resulting history ids.',
  'NovelAI requests must always use n_samples 1 (two or more samples cost paid Anlas). Submit separate jobs for more images.',
  'Ask for confirmation before bulk or destructive changes such as moving many images between groups.',
].join('\n')

export type LlmChatContextConfig = {
  contextTurns: number
  summaryEnabled: boolean
  summaryTriggerTurns: number
  summaryPrompt: string
}

/** Thread override → profile default → global LLM chat setting. */
export function resolveContextConfig(thread: CodexChatThreadRecord, profile: LlmChatProfile | null): LlmChatContextConfig {
  const settings = loadLlmChatSettings()
  return {
    contextTurns: thread.context_turns ?? profile?.contextTurns ?? settings.contextTurns,
    summaryEnabled: thread.summary_enabled !== null ? thread.summary_enabled === 1 : profile?.summaryEnabled ?? settings.summaryEnabled,
    summaryTriggerTurns: settings.summaryTriggerTurns,
    summaryPrompt: settings.summaryPrompt,
  }
}

/** Some servers inline reasoning as `<think>…</think>` instead of a separate field. */
export function stripThinking(text: string) {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').replace(/^\s*<think>[\s\S]*$/i, '')
}

/** `{{char}}` / `{{user}}` placeholders, as character cards write them. */
export function fillCharacterPlaceholders(text: string, profile: LlmChatProfile) {
  return text.replace(/\{\{\s*char\s*\}\}/gi, profile.name).replace(/\{\{\s*user\s*\}\}/gi, '사용자')
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

function buildSystemPrompt(profile: LlmChatProfile, withTools: boolean) {
  const sections = [
    profile.systemPrompt,
    profile.characterDescription ? `## 캐릭터: ${profile.name}\n${profile.characterDescription}` : '',
    profile.userPersona ? `## 사용자\n${profile.userPersona}` : '',
    profile.exampleDialogue ? `## 대화 예시\n${profile.exampleDialogue}` : '',
    withTools ? TOOL_GUIDANCE : '',
  ]
  return fillCharacterPlaceholders(sections.filter(Boolean).join('\n\n'), profile)
}

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
 * The request for one reply: the profile's system prompt (stable, so servers can reuse the cached prefix), the
 * rolling summary when enabled, then the last N turns — which end with the user message just stored.
 */
export function buildChatMessages(params: {
  profile: LlmChatProfile
  thread: CodexChatThreadRecord
  messages: CodexChatMessageRecord[]
  config: LlmChatContextConfig
  withTools: boolean
}): ChatCompletionMessage[] {
  const { profile, thread, messages, config } = params
  const systemPrompt = buildSystemPrompt(profile, params.withTools)
  const result: ChatCompletionMessage[] = systemPrompt ? [{ role: 'system', content: systemPrompt }] : []
  if (config.summaryEnabled && thread.summary?.trim()) {
    result.push({ role: 'system', content: `## 지금까지의 대화 요약\n${thread.summary.trim()}` })
  }
  const window = splitTurns(messages.filter((message) => message.content.trim() || message.tool_calls.length > 0)).slice(-config.contextTurns)
  for (const message of window.flat()) {
    result.push(...toCompletionMessages(message))
  }
  return result
}

function transcriptLine(message: CodexChatMessageRecord, profile: LlmChatProfile) {
  const speaker = message.role === 'user' ? '사용자' : profile.name
  const tools = message.tool_calls.map((call) => `[도구 ${call.tool}: ${(call.summary ?? '').slice(0, SUMMARY_TOOL_NOTE_LENGTH)}]`)
  return [`${speaker}: ${message.content}`, ...tools].join('\n')
}

const summarizing = new Set<number>()

/**
 * Fold turns that left the window into the thread summary (previous summary + those turns → new summary).
 * Automatic runs wait until `summaryTriggerTurns` turns have dropped out; `force` folds in everything not yet
 * summarized, including the turns still in the window.
 */
export async function updateThreadSummary(threadId: number, profile: LlmChatProfile, options: { force?: boolean; signal?: AbortSignal } = {}) {
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

  const turns = splitTurns(CodexChatStore.listMessages(threadId))
  const candidates = (options.force ? turns : turns.slice(0, Math.max(0, turns.length - config.contextTurns))).flat()
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

export function isSummarizing(threadId: number) {
  return summarizing.has(threadId)
}
