import { summaryGenerationOptions } from '../llmGenerationOptions'
import { buildReplyContext } from './chatReplyContext'
import { messageAddress, REPLY_GUIDANCE } from './chatReplies'
import { CHAT_ROOM_TOOLS } from '../../mcp/context'
import { blockStateText, foldBlockState, parseBlockEdits, stripBlockFences, usableBlockKeys } from './chatBlockState'
import { fillCharacterPlaceholders } from './chatPlaceholders'
import { userPersonaForThread, userPersonaPrompt, type ChatUserPersona } from './chatUserProfiles'
import { profileGenerationOptions, resolveSummaryPrompt, type ChatProfile } from './chatProfiles'
import { buildEmoticonGuidance } from './chatEmoticons'
import { buildChatStyleGuidance } from './chatStyle'
import { chatContentWithAttachments } from './chatAttachments'
import { selectLoreEntries, type SelectedLore } from './chatLorebook'
import { buildFlagDirective } from './chatFlags'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { completeChat, REFERENCE_BLOCK_START, resolveChatCompletionTarget, type ChatCompletionMessage, type ChatCompletionTool, type ChatContentPart } from './llmChatCompletion'

/** Tool output replayed to the model for turns still in the window. */
const REPLAYED_TOOL_OUTPUT_LENGTH = 4000
const SUMMARY_TOOL_NOTE_LENGTH = 300
/** Room kept for the reply when the profile sets no max tokens. */
export const DEFAULT_REPLY_RESERVE_TOKENS = 2048

const EXAMPLE_NOTE = '바로 뒤에 이어지는 첫 user/assistant 대화들은 말투와 형식을 보여주는 예시일 뿐 실제로 나눈 대화가 아니야. 실제 대화는 그 다음부터야.'

/**
 * How to generate: free-form through the queue, or through the profile's generation presets only.
 * Generation runs in the background: the job is linked to the reply at submission and the app attaches the finished
 * image to the message by itself, so the model answers right away instead of blocking on wait_generation_job.
 */
const GENERATION_ASYNC_GUIDANCE = 'Do not wait for the job and do not poll it: the app attaches the finished image to this reply by itself, even after you finish. Write your reply right away in the same turn, without ids or links; you may say the image is on its way, but never describe it as finished or describe what it looks like.'

export const GENERATION_GUIDANCE = {
  freeform: [
    'To generate, call submit_generation_job right away with the parameters it documents; do not search the library, list workflows or read past history first unless the user asks to reuse existing images or settings.',
    GENERATION_ASYNC_GUIDANCE,
    'NovelAI requests must always use n_samples 1 (two or more samples cost paid Anlas). Submit separate jobs for more images.',
  ],
  preset: [
    'To generate, call a generate_image tool right away (one tool per preset; pick by its description) and fill only the fields it asks for: the preset already holds the model, sizes, quality and style tags and the negative prompt, so never repeat those.',
    GENERATION_ASYNC_GUIDANCE,
    'No other generation route or workflow lookup is available to you.',
  ],
}

function toolGuidance(presetMode: boolean) {
  return [
    'You can act on CoNAI, a local app for managing and generating AI images, only through the provided tools.',
    ...GENERATION_GUIDANCE[presetMode ? 'preset' : 'freeform'],
    'Ask for confirmation before bulk or destructive changes such as moving many images between groups.',
    'To set up an emoticon group: list_emoticons for the group, view_images in small batches when available (otherwise judge from file names and tags), then set_emoticon_keywords with a few short keywords per image.',
  ].join('\n')
}

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
  /** Reply length cap sent with each request (null: the server's default), also the reply's share of the token budget. */
  maxTokens: number | null
  summaryEnabled: boolean
  summaryTriggerTurns: number
  summaryPrompt: string
}

/** The chat's own overrides (turn count, reply cap, summary on/off), else the profile's settings. */
export function resolveContextConfig(thread: CodexChatThreadRecord, profile: ChatProfile): LlmChatContextConfig {
  const maxTokens = thread.max_tokens ?? profile.maxTokens
  return {
    contextTurns: thread.context_turns ?? profile.contextTurns,
    contextTokens: profile.contextTokens,
    replyReserveTokens: maxTokens ?? DEFAULT_REPLY_RESERVE_TOKENS,
    maxTokens,
    summaryEnabled: thread.summary_enabled !== null ? thread.summary_enabled === 1 : profile.summaryEnabled,
    summaryTriggerTurns: profile.summaryTriggerTurns,
    summaryPrompt: resolveSummaryPrompt(profile),
  }
}

/** Some servers inline reasoning as `<think>…</think>` instead of a separate field. */
export function stripThinking(text: string) {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').replace(/^\s*<think>[\s\S]*$/i, '')
}

export { fillCharacterPlaceholders }

const USER_SPEAKERS = /^(?:\{\{\s*user\s*\}\}|user|사용자|유저|나)\s*[:：]\s?/i
const ASSISTANT_SPEAKERS = /^(?:\{\{\s*char\s*\}\}|char|assistant|ai|캐릭터)\s*[:：]\s?/i

/**
 * Example dialogue as user/assistant turns: each `사용자:` / `{{user}}:` or `{{char}}:` / `<name>:` line starts an
 * utterance and unlabelled lines continue it (`<START>` separators are dropped). Null unless both sides speak.
 */
export function parseExampleDialogue(content: string, profile: ChatProfile, user?: ChatUserPersona | null): ChatCompletionMessage[] | null {
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
  return turns.map((turn) => ({ role: turn.role, content: fillCharacterPlaceholders(turn.lines.join('\n').trim(), profile, user) }))
}

/**
 * The system prompt and the enabled text sections (each under its title) as one block. Dialogue sections join it
 * as text only when `dialogueAsText` (Codex) or when their lines carry no speaker labels.
 */
export function buildPersonaPrompt(profile: ChatProfile, options: { dialogueAsText?: boolean; user?: ChatUserPersona | null } = {}) {
  const blocks = [profile.systemPrompt]
  for (const section of profile.promptSections) {
    if (!section.enabled || !section.content.trim()) continue
    if (section.kind === 'dialogue' && !options.dialogueAsText && parseExampleDialogue(section.content, profile, options.user)) continue
    // The chat's user profile describes the user; an old profile's own user persona gives way to it.
    if (section.id === 'legacy-persona' && options.user?.persona) continue
    blocks.push(section.title ? `## ${section.title}\n${section.content}` : section.content)
  }
  blocks.push(userPersonaPrompt(options.user))
  return fillCharacterPlaceholders(blocks.filter(Boolean).join('\n\n'), profile, options.user)
}

/** Example turns from dialogue sections, sent right after the system messages. */
function buildExampleMessages(profile: ChatProfile, user?: ChatUserPersona | null): ChatCompletionMessage[] {
  return profile.promptSections
    .filter((section) => section.enabled && section.kind === 'dialogue')
    .flatMap((section) => parseExampleDialogue(section.content, profile, user) ?? [])
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
  return Math.ceil(rawMessagesEstimate(messages, tools) * (estimateRatios.get(profileId) ?? 1))
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
  // App tools supply <=512px previews. Reserve an approximate image allowance instead of
  // counting their base64 transport encoding as text tokens; provider tokenizers differ.
  let imageCount = 0
  const textMessages = messages.map((message) => message.role === 'user' && Array.isArray(message.content)
    ? { ...message, content: message.content.map((part) => {
      if (part.type !== 'image_url') return part
      imageCount += 1
      return { type: 'image_url', image_url: { url: '(image)' } }
    }) }
    : message)
  return rawTokenEstimate(JSON.stringify(textMessages) + (tools.length > 0 ? JSON.stringify(tools) : '')) + imageCount * 2048
}

// ---- Window ---------------------------------------------------------------------------------------------------

const NO_BLOCKS: ReadonlySet<string> = new Set()

/** `blockKeys`: display blocks whose fences are left out of replies (their values travel with the state instead). */
export function toCompletionMessages(message: CodexChatMessageRecord, blockKeys: ReadonlySet<string> = NO_BLOCKS): ChatCompletionMessage[] {
  if (message.role === 'user') {
    return [{ role: 'user', content: `[${messageAddress(message)}; from=user]\n${chatContentWithAttachments(message.content, message.attachments, message.mediaAttachments)}` }]
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
  const text = stripBlockFences(message.content, blockKeys)
  if (text.trim()) {
    result.push({ role: 'assistant', content: `[${messageAddress(message)}; from=${message.speaker_profile_id ?? 'assistant'}]\n${text}` })
  }
  return result
}

/**
 * The turns that fit: at most `maxTurns` (the context turn count), and — with a token budget — only as many recent
 * turns as fit beside the fixed part (system prompt, summary, tool schemas) and the reply reserve. The newest turn is
 * always kept.
 */
function selectWindow(profile: Pick<ChatProfile, 'id' | 'style'>, turns: CodexChatMessageRecord[][], config: LlmChatContextConfig, fixedTokens: number, maxTurns = config.contextTurns) {
  const blockKeys = usableBlockKeys(profile.style.blocks)
  const candidates = maxTurns > 0 ? turns.slice(-maxTurns) : []
  if (config.contextTokens === null) {
    return candidates
  }
  let remaining = config.contextTokens - config.replyReserveTokens - fixedTokens
  const kept: CodexChatMessageRecord[][] = []
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const cost = estimateMessagesTokens(profile.id, candidates[index].flatMap((message) => toCompletionMessages(message, blockKeys)))
    if (kept.length > 0 && cost > remaining) {
      break
    }
    kept.unshift(candidates[index])
    remaining -= cost
  }
  return kept
}

/**
 * The profile's lore for one request. Without messages (a prompt preview) only the "always on" entries are chosen.
 */
export function selectChatLore(profile: ChatProfile, messages?: ReadonlyArray<{ content: string }>, user?: ChatUserPersona | null): SelectedLore {
  return selectLoreEntries(profile, messages, (text) => estimateTokens(profile.id, text), (text) => fillCharacterPlaceholders(text, profile, user))
}

/**
 * Request layout, front to back, so that what a server has already seen stays byte-identical for as long as possible
 * (OpenAI caches a repeated prefix by itself; llama.cpp, LM Studio, vLLM and Ollama reuse their KV cache the same way):
 *
 *   1. system prompt — persona, "always on" lore, guidance: fixed until the profile is saved
 *   2. rolling summary — changes only when turns are folded in
 *   3. example dialogue — fixed
 *   4. older turns
 *   5. keyword lore (`[참고 설정]`) merged into the user message `loreDepth` turns before the end — the part that
 *      changes with the conversation, so only the turns after it are re-read when it changes
 *   6. the latest user message, with the chat flags appended
 *
 * Anything that varies between requests (lore matches, future time macros or state) belongs in 5 or 6, never in 1–3.
 */

/**
 * Everything before the real conversation: the system prompt (stable, so servers can reuse the cached prefix), the
 * rolling summary, then example turns. Chat templates often allow system messages only at the start, so the note that
 * the examples are not real lives in the system prompt rather than around them. `lore` defaults to the constant
 * entries alone (a preview).
 */
export function buildLeadingMessages(profile: ChatProfile, thread: Pick<CodexChatThreadRecord, 'summary'> | null, config: Pick<LlmChatContextConfig, 'summaryEnabled'>, withTools: boolean, lore: Pick<SelectedLore, 'constant'> = selectChatLore(profile), user: ChatUserPersona | null = null) {
  const examples = buildExampleMessages(profile, user)
  const systemPrompt = [
    buildPersonaPrompt(profile, { user }),
    lore.constant ? `## 설정\n${lore.constant}` : '',
    examples.length > 0 ? EXAMPLE_NOTE : '',
    withTools ? toolGuidance(profile.generationPresetIds.length > 0) : '',
    REPLY_FORMAT_GUIDANCE,
    REPLY_GUIDANCE,
    buildChatStyleGuidance(profile.style, profile.name),
    buildEmoticonGuidance(profile.style),
  ].filter(Boolean).join('\n\n')
  const result: ChatCompletionMessage[] = systemPrompt ? [{ role: 'system', content: systemPrompt }] : []
  if (config.summaryEnabled && thread?.summary?.trim()) {
    result.push({ role: 'system', content: `## 지금까지의 대화 요약\n${thread.summary.trim()}` })
  }
  return [...result, ...examples]
}

/** The display block state of a chat as the model reads it ('' without blocks). `speakerId`: a room member's own. */
export function threadBlockStateText(profile: ChatProfile, thread: Pick<CodexChatThreadRecord, 'block_edits'>, messages: ReadonlyArray<Pick<CodexChatMessageRecord, 'id' | 'role' | 'content' | 'speaker_profile_id'>>, speakerId?: number) {
  const folded = foldBlockState(profile, messages, parseBlockEdits(thread.block_edits), speakerId)
  return folded ? blockStateText(profile.style.blocks, folded.state) : ''
}

/** Keyword lore as the block that goes into the conversation (the same marks Codex gets), '' when there is none. */
export function loreBlock(lore: Pick<SelectedLore, 'keyed'>) {
  return lore.keyed ? referenceBlock([lore.keyed]) : ''
}

/** Conversation-time reference material (`[참고 설정]`), the same marks for both engines. */
export function referenceBlock(parts: string[]) {
  const body = parts.map((part) => part.trim()).filter(Boolean).join('\n\n')
  return body ? `${REFERENCE_BLOCK_START}\n${body}\n[/참고 설정]` : ''
}

export type AuthorNote = { text: string; depth: number }

/**
 * The author's note a chat gets — its own, else the profile's default — with `{{char}}`/`{{user}}` filled, and the
 * depth it goes in at (the chat's, else the profile's lore depth). Empty text means none.
 */
export function resolveAuthorNote(thread: Pick<CodexChatThreadRecord, 'author_note' | 'author_note_depth'> | null, profile: ChatProfile, user?: ChatUserPersona | null): AuthorNote {
  const text = thread?.author_note?.trim() || (profile.authorNote ?? '').trim()
  return { text: text ? fillCharacterPlaceholders(text, profile, user) : '', depth: thread?.author_note_depth ?? profile.loreDepth }
}

export function authorNoteText(note: Pick<AuthorNote, 'text'>) {
  return note.text ? `## 작가 노트\n${note.text}` : ''
}

/**
 * The `[참고 설정]` blocks a request merges into its conversation: keyword lore at the profile's lore depth and the
 * author's note (with the display block state, `stateText`) at its own — one block when both share a depth.
 */
export function depthBlocks(lore: Pick<SelectedLore, 'keyed'>, loreDepth: number, note: AuthorNote, stateText = ''): Array<{ depth: number; block: string }> {
  const noteText = [authorNoteText(note), stateText].filter(Boolean).join('\n\n')
  if (lore.keyed && noteText && note.depth !== loreDepth) {
    return [{ depth: loreDepth, block: referenceBlock([lore.keyed]) }, { depth: note.depth, block: referenceBlock([noteText]) }]
  }
  const block = referenceBlock([lore.keyed, noteText])
  return block ? [{ depth: lore.keyed ? loreDepth : note.depth, block }] : []
}

/** `insertAtDepth` for every block; each only prefixes one user message, so the others' positions are unaffected. */
export function insertDepthBlocks(messages: ChatCompletionMessage[], blocks: Array<{ depth: number; block: string }>) {
  return blocks.reduce((result, { depth, block }) => insertAtDepth(result, depth, block), messages)
}

export function estimateDepthBlocks(profileId: number, blocks: Array<{ block: string }>) {
  return blocks.reduce((total, { block }) => total + estimateTokens(profileId, block), 0)
}

function prefixUserContent(content: string | ChatContentPart[], block: string): string | ChatContentPart[] {
  if (typeof content === 'string') return content ? `${block}\n\n${content}` : block
  return [{ type: 'text', text: block }, ...content]
}

/**
 * Put `block` in front of the user message `depth` turns before the end: 0 is the latest user message, 1 the one
 * before, and a depth beyond the conversation lands on its oldest user message. Merged into a user message rather
 * than sent as a system message in the middle, which many chat templates reject. Without any user message the block
 * becomes one.
 */
export function insertAtDepth(messages: ChatCompletionMessage[], depth: number, block: string): ChatCompletionMessage[] {
  if (!block) return messages
  const userIndices = messages.flatMap((message, index) => (message.role === 'user' ? [index] : []))
  if (userIndices.length === 0) return [...messages, { role: 'user', content: block }]
  const target = userIndices[Math.max(0, userIndices.length - 1 - Math.max(0, Math.floor(depth)))]
  return messages.map((message, index) => (index === target && message.role === 'user' ? { ...message, content: prefixUserContent(message.content, block) } : message))
}

// ---- Window start ---------------------------------------------------------------------------------------------

/** Share of what fits that is kept when the window start has to move, so it then holds for several turns. */
export const WINDOW_KEEP_RATIO = 0.75

/** Id of the first item each chat last sent, so the window start only moves when it has to. */
const windowAnchors = new Map<number, number>()

/**
 * The suffix of `items` to send given that at most `fit` of them fit. While everything fits, all of them. Once they
 * do not, the window does not slide by one item per request (which changes the request prefix every time) but jumps
 * forward to `WINDOW_KEEP_RATIO` of what fits and keeps that start — `anchorId` — until that no longer fits either.
 * A remembered start that would send fewer than that share (the limit was raised, items were removed) is dropped.
 */
export function anchoredSuffix<T>(items: T[], fit: number, idOf: (item: T) => number, anchorId: number | undefined): { window: T[]; anchorId: number | undefined } {
  if (items.length === 0) return { window: [], anchorId: undefined }
  const limit = Math.max(1, Math.min(items.length, Math.floor(fit)))
  if (items.length <= limit) return { window: items, anchorId: idOf(items[0]) }
  const floor = Math.max(1, Math.floor(limit * WINDOW_KEEP_RATIO))
  const anchorIndex = anchorId === undefined ? -1 : items.findIndex((item) => idOf(item) === anchorId)
  if (anchorIndex >= 0) {
    const length = items.length - anchorIndex
    if (length <= limit && length >= floor) return { window: items.slice(anchorIndex), anchorId }
  }
  const window = items.slice(-floor)
  return { window, anchorId: idOf(window[0]) }
}

/** `anchoredSuffix` with the start remembered per chat (in memory: a restart only costs one cache miss). */
export function anchoredWindowFor<T>(threadId: number, items: T[], fit: number, idOf: (item: T) => number) {
  const result = anchoredSuffix(items, fit, idOf, windowAnchors.get(threadId))
  if (result.anchorId === undefined) windowAnchors.delete(threadId)
  else windowAnchors.set(threadId, result.anchorId)
  return result.window
}

/** The chat flags of the message being answered (the latest user message) as one block; '' when none were on. */
export function flagDirectiveFor(messages: CodexChatMessageRecord[], profile: ChatProfile, user?: ChatUserPersona | null) {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  return buildFlagDirective(latestUser?.flags ?? [], (text) => fillCharacterPlaceholders(text, profile, user))
}

/** Add `directive` after the last user turn (merged into it, so turns keep alternating). */
export function appendUserDirective(messages: ChatCompletionMessage[], directive: string): ChatCompletionMessage[] {
  if (!directive) return messages
  const last = messages[messages.length - 1]
  if (last?.role === 'user' && typeof last.content === 'string') return [...messages.slice(0, -1), { ...last, content: `${last.content}\n\n${directive}` }]
  return [...messages, { role: 'user', content: directive }]
}

export function sendableMessages(messages: CodexChatMessageRecord[]) {
  return messages.filter((message) => message.content.trim() || message.attachments?.length || message.mediaAttachments?.length || message.tool_calls.length > 0)
}

/** Shared by summary planning, the actual request and the profile preview. */
function buildRequestContext(profile: ChatProfile, thread: CodexChatThreadRecord | null, messages: CodexChatMessageRecord[], config: Pick<LlmChatContextConfig, 'summaryEnabled'>, tools: ChatCompletionTool[]) {
  const user = userPersonaForThread(thread)
  const lore = selectChatLore(profile, messages, user)
  const system = buildLeadingMessages(profile, thread, config, tools.some((tool) => !CHAT_ROOM_TOOLS.has(tool.function.name)), lore, user)
  const blocks = depthBlocks(lore, profile.loreDepth, resolveAuthorNote(thread, profile, user), threadBlockStateText(profile, thread ?? { block_edits: null }, messages))
  const directive = flagDirectiveFor(messages, profile, user)
  const fixedTokens = estimateMessagesTokens(profile.id, system, tools) + estimateDepthBlocks(profile.id, blocks) + estimateTokens(profile.id, directive)
  return { system, blocks, directive, fixedTokens }
}

export function buildChatPromptPreview(profile: ChatProfile, tools: ChatCompletionTool[]) {
  const { system, blocks } = buildRequestContext(profile, null, [], { summaryEnabled: false }, tools)
  return [...system, ...insertDepthBlocks([], blocks)]
}

/** Final guard also covers tool rounds and a latest message too large to fit by itself. */
export function assertChatContextFits(profile: ChatProfile, messages: ChatCompletionMessage[], tools: ChatCompletionTool[], maxTokens: number | null | undefined) {
  if (profile.contextTokens === null) return
  const needed = estimateMessagesTokens(profile.id, messages, tools) + (maxTokens ?? DEFAULT_REPLY_RESERVE_TOKENS)
  if (needed > profile.contextTokens) {
    throw new Error(`컨텍스트 한도를 넘었어 (예상 ${needed} / ${profile.contextTokens} 토큰). 메시지·도구 결과나 최대 출력 토큰을 줄이거나 컨텍스트 길이를 늘려줘.`)
  }
}

/** With the summary on, only the messages after it go out verbatim; the summary stands in for the rest. */
function unsummarizedMessages(messages: CodexChatMessageRecord[], thread: Pick<CodexChatThreadRecord, 'summary_until_message_id'>, config: Pick<LlmChatContextConfig, 'summaryEnabled'>) {
  const until = config.summaryEnabled ? thread.summary_until_message_id ?? 0 : 0
  return until > 0 ? messages.filter((message) => message.id > until) : messages
}

/**
 * The request for one reply, laid out as described above `buildLeadingMessages`: the leading messages, the recent
 * unsummarized turns that fit (start anchored, see `anchoredSuffix`) with the keyword lore merged in `loreDepth`
 * turns before the end, ending with the user message just stored plus its flags. Turns are only dropped here when
 * the summary could not keep up (off, failed or interrupted).
 */
export function buildChatMessages(params: {
  profile: ChatProfile
  thread: CodexChatThreadRecord
  messages: CodexChatMessageRecord[]
  config: LlmChatContextConfig
  tools: ChatCompletionTool[]
}): ChatCompletionMessage[] {
  const { profile, thread, config, tools } = params
  const { system, blocks, directive, fixedTokens } = buildRequestContext(profile, thread, params.messages, config, tools)
  const routing = [...params.messages].reverse().find((message) => message.role === 'user')?.routing
  const maxChars = Math.max(256, Math.min(6000, Math.floor((config.contextTokens ?? 24000) / 4)))
  const replyContext = buildReplyContext(params.messages, routing, { maxChars })
  const turns = splitTurns(sendableMessages(unsummarizedMessages(params.messages, thread, config)))
  const fit = selectWindow(profile, turns, config, fixedTokens + estimateTokens(profile.id, replyContext) + 40).length
  const window = anchoredWindowFor(thread.id, turns, fit, (turn) => turn[0].id)
  const blockKeys = usableBlockKeys(profile.style.blocks)
  const conversation = insertDepthBlocks(window.flat().flatMap((message) => toCompletionMessages(message, blockKeys)), blocks)
  const reference = buildReplyContext(params.messages, routing, { maxChars, visibleIds: new Set(window.flat().map((message) => message.id)) })
  return appendUserDirective([...system, ...conversation], [reference, params.messages.length ? `Current room_id: ${thread.id}.` : '', directive].filter(Boolean).join('\n\n'))
}

// ---- Summary --------------------------------------------------------------------------------------------------

function transcriptLine(message: CodexChatMessageRecord, profile: ChatProfile, user: ChatUserPersona) {
  const speaker = message.role === 'user' ? user.name : profile.name
  const tools = message.tool_calls.map((call) => `[도구 ${call.tool}: ${(call.summary ?? '').slice(0, SUMMARY_TOOL_NOTE_LENGTH)}]`)
  // Block fences are state, not conversation: the summary does without them.
  return [`${speaker}: ${message.role === 'assistant' ? stripBlockFences(message.content, usableBlockKeys(profile.style.blocks)) : chatContentWithAttachments(message.content, message.attachments, message.mediaAttachments)}`, ...tools].join('\n')
}

const SUMMARY_TIMEOUT_MS = 10 * 60 * 1000
/** Transcript per summary call, so a long backlog (summary just turned on, or wiped by an edit) goes in passes. */
const DEFAULT_SUMMARY_CHUNK_TOKENS = 16000
const MAX_SUMMARY_PASSES = 50

/**
 * How many of the oldest unsummarized turns to fold: none while they all fit, otherwise everything that overflows and
 * at least `batch` turns, so folding happens every few turns rather than every turn. The newest turn stays verbatim.
 */
export function turnsToFold(pending: number, fit: number, batch: number) {
  if (fit >= pending) {
    return 0
  }
  return Math.max(0, Math.min(pending - 1, Math.max(pending - fit, batch)))
}

/**
 * `ahead` (after a reply) also leaves room for one more turn like the last, so the next request finds everything in
 * place; `overflow` (before a request) folds only what would not fit; `all` folds everything not yet summarized.
 */
type FoldMode = 'ahead' | 'overflow' | 'all'

function planFold(profile: ChatProfile, thread: CodexChatThreadRecord, config: LlmChatContextConfig, messages: CodexChatMessageRecord[], turns: CodexChatMessageRecord[][], mode: FoldMode, tools: ChatCompletionTool[]) {
  if (mode === 'all' || turns.length === 0) {
    return turns.length
  }
  const ahead = mode === 'ahead'
  const fixedTokens = buildRequestContext(profile, thread, messages, config, tools).fixedTokens
    + (ahead ? estimateMessagesTokens(profile.id, turns[turns.length - 1].flatMap((message) => toCompletionMessages(message, usableBlockKeys(profile.style.blocks)))) : 0)
  const fit = selectWindow(profile, turns, config, fixedTokens, config.contextTurns - (ahead ? 1 : 0)).length
  return turnsToFold(turns.length, fit, config.summaryTriggerTurns)
}

/** The oldest of `turns` whose transcript stays within one summary call (at least one turn). */
function takeSummaryChunk(profile: ChatProfile, config: LlmChatContextConfig, turns: CodexChatMessageRecord[][], user: ChatUserPersona) {
  const limit = config.contextTokens ? Math.max(2000, Math.floor(config.contextTokens / 2)) : DEFAULT_SUMMARY_CHUNK_TOKENS
  let used = 0
  let count = 0
  for (const turn of turns) {
    used += estimateTokens(profile.id, turn.map((message) => transcriptLine(message, profile, user)).join('\n\n'))
    if (count > 0 && used > limit) {
      break
    }
    count += 1
  }
  return turns.slice(0, count).flat()
}

async function summarizeInto(profile: ChatProfile, config: LlmChatContextConfig, previous: string | null, messages: CodexChatMessageRecord[], user: ChatUserPersona, signal?: AbortSignal) {
  const target = resolveChatCompletionTarget(profile.summaryProviderName || profile.providerName, {
    model: profile.summaryProviderName ? profile.summaryModel || null : profile.summaryModel || profile.model || null,
    generation: summaryGenerationOptions(profileGenerationOptions(profile)),
  })
  const transcript = messages.map((message) => transcriptLine(message, profile, user)).join('\n\n')
  const timeout = AbortSignal.timeout(SUMMARY_TIMEOUT_MS)
  const summary = stripThinking(await completeChat(target, [
    { role: 'system', content: config.summaryPrompt },
    { role: 'user', content: `## 이전 요약\n${previous?.trim() || '(없음)'}\n\n## 이어진 대화\n${transcript}` },
  ], signal ? AbortSignal.any([signal, timeout]) : timeout)).trim()
  if (!summary) {
    throw new Error('요약 결과가 비어 있어.')
  }
  return summary
}

/** Fold the oldest unsummarized turns into the thread summary, pass by pass, until `mode` is satisfied. */
async function foldIntoSummary(threadId: number, profile: ChatProfile, mode: FoldMode, options: { messages?: CodexChatMessageRecord[]; signal?: AbortSignal; tools?: ChatCompletionTool[] }) {
  let folded: string | null = null
  for (let pass = 0; pass < MAX_SUMMARY_PASSES; pass += 1) {
    const thread = CodexChatStore.findThreadById(threadId)
    if (!thread) {
      return folded
    }
    const config = resolveContextConfig(thread, profile)
    if (mode !== 'all' && !config.summaryEnabled) {
      return folded
    }
    const messages = options.messages ?? CodexChatStore.listMessages(threadId)
    const turns = splitTurns(sendableMessages(unsummarizedMessages(messages, thread, { summaryEnabled: true })))
    const count = planFold(profile, thread, config, messages, turns, mode, options.tools ?? [])
    if (count === 0) {
      return folded
    }
    const user = userPersonaForThread(thread)
    const chunk = takeSummaryChunk(profile, config, turns.slice(0, count), user)
    const summary = await summarizeInto(profile, config, thread.summary, chunk, user, options.signal)
    // A history edit while summarizing bumps the revision; the next request starts over from the new history.
    if (!CodexChatStore.setSummary(threadId, summary, chunk[chunk.length - 1].id, thread.context_revision)) {
      return folded
    }
    folded = summary
  }
  return folded
}

const summaryRuns = new Map<number, Promise<string | null>>()

function startFold(threadId: number, profile: ChatProfile, mode: FoldMode, options: { messages?: CodexChatMessageRecord[]; signal?: AbortSignal; tools?: ChatCompletionTool[] } = {}) {
  const run: Promise<string | null> = foldIntoSummary(threadId, profile, mode, options).finally(() => {
    if (summaryRuns.get(threadId) === run) {
      summaryRuns.delete(threadId)
    }
  })
  summaryRuns.set(threadId, run)
  return run
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * After a reply: once the unsummarized turns would no longer leave room for the next one (turn count or token
 * budget), fold the oldest `summaryTriggerTurns` of them in the background — before they would fall out of the window.
 */
export function summarizeAhead(threadId: number, profile: ChatProfile, tools: ChatCompletionTool[]) {
  if (summaryRuns.has(threadId)) {
    return Promise.resolve(null)
  }
  return startFold(threadId, profile, 'ahead', { tools })
}

/**
 * Before a request: wait for a summary still running, then fold whatever would still not fit, so no turn leaves the
 * window unsummarized. If summarizing fails, the request goes on and the oldest turns are dropped instead.
 */
export async function fitThreadSummary(threadId: number, profile: ChatProfile, messages: CodexChatMessageRecord[], signal: AbortSignal, tools: ChatCompletionTool[]) {
  const running = summaryRuns.get(threadId)
  if (running) {
    await untilAborted(running.catch(() => null), signal)
  }
  if (summaryRuns.has(threadId)) {
    return
  }
  try {
    await startFold(threadId, profile, 'overflow', { messages, signal, tools })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    console.warn('[llm-chat] summary before reply failed:', error instanceof Error ? error.message : error)
  }
}

/** Fold everything not summarized yet (the summarize button). Null when there is nothing new or a summary is running. */
export function summarizeAll(threadId: number, profile: ChatProfile) {
  if (summaryRuns.has(threadId)) {
    return Promise.resolve(null)
  }
  return startFold(threadId, profile, 'all')
}
