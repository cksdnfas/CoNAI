import { summaryGenerationOptions } from '../llmGenerationOptions'
import { profileGenerationOptions, resolveSummaryPrompt, type ChatProfile } from './chatProfiles'
import { buildEmoticonGuidance } from './chatEmoticons'
import { buildChatStyleGuidance } from './chatStyle'
import { chatContentWithAttachments } from './chatAttachments'
import { buildLorebookText } from './chatLorebook'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { completeChat, resolveChatCompletionTarget, type ChatCompletionMessage, type ChatCompletionTool } from './llmChatCompletion'

/** Tool output replayed to the model for turns still in the window. */
const REPLAYED_TOOL_OUTPUT_LENGTH = 4000
const SUMMARY_TOOL_NOTE_LENGTH = 300
/** Room kept for the reply when the profile sets no max tokens. */
const DEFAULT_REPLY_RESERVE_TOKENS = 2048

const EXAMPLE_NOTE = '바로 뒤에 이어지는 첫 user/assistant 대화들은 말투와 형식을 보여주는 예시일 뿐 실제로 나눈 대화가 아니야. 실제 대화는 그 다음부터야.'

const TOOL_GUIDANCE = [
  'You can act on CoNAI, a local app for managing and generating AI images, only through the provided tools.',
  'To generate, call submit_generation_job right away with the parameters it documents; do not search the library, list workflows or read past history first unless the user asks to reuse existing images or settings.',
  'Then call wait_generation_job with the job id (again while finished is false). The app shows the resulting images by itself, so finish with one short sentence instead of listing ids or links.',
  'NovelAI requests must always use n_samples 1 (two or more samples cost paid Anlas). Submit separate jobs for more images.',
  'Ask for confirmation before bulk or destructive changes such as moving many images between groups.',
  'To set up an emoticon group: list_emoticons for the group, view_images in small batches when available (otherwise judge from file names and tags), then set_emoticon_keywords with a few short keywords per image.',
].join('\n')

/** What the chat window renders, for both engines; conversation stays plain prose unless formatting helps. */
export const REPLY_FORMAT_GUIDANCE = [
  'The chat window renders GitHub-flavoured Markdown: headings, bold/italic, lists, tables, links, blockquotes, inline code and fenced code blocks.',
  'Use formatting only when it helps (code, steps, comparisons); ordinary conversation stays plain prose.',
  'Always put code in a fenced block with a language tag (```python, ```json, ...); the user gets a copy button.',
  'Raw HTML outside a code block is shown as text, not rendered. To show a web page, widget or SVG, write the complete document in a ```html (or ```svg) block: the user can open it in a sandboxed live preview where scripts run but nothing can reach the app, the network session or other pages.',
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

const USER_SPEAKERS = /^(?:\{\{\s*user\s*\}\}|user|사용자|유저|나)\s*[:：]\s?/i
const ASSISTANT_SPEAKERS = /^(?:\{\{\s*char\s*\}\}|char|assistant|ai|캐릭터)\s*[:：]\s?/i

/**
 * Example dialogue as user/assistant turns: each `사용자:` / `{{user}}:` or `{{char}}:` / `<name>:` line starts an
 * utterance and unlabelled lines continue it (`<START>` separators are dropped). Null unless both sides speak.
 */
export function parseExampleDialogue(content: string, profile: ChatProfile): ChatCompletionMessage[] | null {
  const namePattern = new RegExp(`^${profile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]\\s?`)
  const turns: Array<{ role: 'user' | 'assistant'; lines: string[] }> = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (/^\s*<start>\s*$/i.test(line)) continue
    const role = USER_SPEAKERS.test(line) ? 'user' : ASSISTANT_SPEAKERS.test(line) || namePattern.test(line) ? 'assistant' : null
    if (role) {
      const text = line.replace(role === 'user' ? USER_SPEAKERS : ASSISTANT_SPEAKERS.test(line) ? ASSISTANT_SPEAKERS : namePattern, '')
      const last = turns.at(-1)
      if (last?.role === role) last.lines.push(text)
      else turns.push({ role, lines: [text] })
    } else if (turns.length > 0 && line.trim()) {
      turns[turns.length - 1].lines.push(line)
    }
  }
  if (!turns.some((turn) => turn.role === 'user') || !turns.some((turn) => turn.role === 'assistant')) {
    return null
  }
  return turns.map((turn) => ({ role: turn.role, content: fillCharacterPlaceholders(turn.lines.join('\n').trim(), profile) }))
}

/**
 * The system prompt and the enabled text sections (each under its title) as one block. Dialogue sections join it
 * as text only when `dialogueAsText` (Codex) or when their lines carry no speaker labels.
 */
export function buildPersonaPrompt(profile: ChatProfile, options: { dialogueAsText?: boolean } = {}) {
  const blocks = [profile.systemPrompt]
  for (const section of profile.promptSections) {
    if (!section.enabled || !section.content.trim()) continue
    if (section.kind === 'dialogue' && !options.dialogueAsText && parseExampleDialogue(section.content, profile)) continue
    blocks.push(section.title ? `## ${section.title}\n${section.content}` : section.content)
  }
  return fillCharacterPlaceholders(blocks.filter(Boolean).join('\n\n'), profile)
}

/** Example turns from dialogue sections, sent right after the system messages. */
function buildExampleMessages(profile: ChatProfile): ChatCompletionMessage[] {
  return profile.promptSections
    .filter((section) => section.enabled && section.kind === 'dialogue')
    .flatMap((section) => parseExampleDialogue(section.content, profile) ?? [])
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
    return [{ role: 'user', content: chatContentWithAttachments(message.content, message.attachments) }]
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

/**
 * Everything before the real conversation: the system prompt (stable, so servers can reuse the cached prefix), the
 * rolling summary, then example turns. Chat templates often allow system messages only at the start, so the note that
 * the examples are not real lives in the system prompt rather than around them.
 */
export function buildLeadingMessages(profile: ChatProfile, thread: Pick<CodexChatThreadRecord, 'summary'> | null, config: Pick<LlmChatContextConfig, 'summaryEnabled'>, withTools: boolean, messages?: ReadonlyArray<{ content: string }>) {
  const examples = buildExampleMessages(profile)
  const systemPrompt = [
    buildPersonaPrompt(profile),
    examples.length > 0 ? EXAMPLE_NOTE : '',
    withTools ? TOOL_GUIDANCE : '',
    REPLY_FORMAT_GUIDANCE,
    buildChatStyleGuidance(profile.style, profile.name),
    buildEmoticonGuidance(profile.style),
  ].filter(Boolean).join('\n\n')
  const result: ChatCompletionMessage[] = systemPrompt ? [{ role: 'system', content: systemPrompt }] : []
  if (config.summaryEnabled && thread?.summary?.trim()) {
    result.push({ role: 'system', content: `## 지금까지의 대화 요약\n${thread.summary.trim()}` })
  }
  const lore = buildLorebookText(profile, messages, (text) => estimateTokens(profile.id, text), (text) => fillCharacterPlaceholders(text, profile))
  if (lore) result.push({ role: 'system', content: `## 관련 설정\n${lore}` })
  return [...result, ...examples]
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
  const system = buildLeadingMessages(profile, thread, config, tools.length > 0, params.messages)
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

  const messages = CodexChatStore.listMessages(threadId)
  const turns = splitTurns(sendableMessages(messages))
  const windowSize = selectWindow(profile.id, turns, config, estimateMessagesTokens(profile.id, buildLeadingMessages(profile, thread, config, profile.mcpEnabled, messages))).length
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
      generation: summaryGenerationOptions(profileGenerationOptions(profile)),
    })
    const transcript = pending.map((message) => transcriptLine(message, profile)).join('\n\n')
    const summary = stripThinking(await completeChat(target, [
      { role: 'system', content: config.summaryPrompt },
      { role: 'user', content: `## 이전 요약\n${thread.summary?.trim() || '(없음)'}\n\n## 이어진 대화\n${transcript}` },
    ], options.signal ?? AbortSignal.timeout(10 * 60 * 1000))).trim()
    if (!summary) {
      throw new Error('요약 결과가 비어 있어.')
    }
    return CodexChatStore.setSummary(threadId, summary, pending[pending.length - 1].id, thread.context_revision) ? summary : null
  } finally {
    summarizing.delete(threadId)
  }
}
