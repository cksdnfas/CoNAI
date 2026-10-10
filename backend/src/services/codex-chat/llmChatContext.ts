import { summaryGenerationOptions, thinkingIsOff } from '../llmGenerationOptions'
import { loadChatSettings } from './chatSettings'
import { resolveChatAccess } from './codexChatAccess'
import { modelLanguageGuidance, replyTranslationPrompt, userTranslationPrompt } from './chatTranslation'
import { contextContentText, contextHash, contextSections, contextSource, limitContextMeta, loreDiagnostics, markContextMessage, markContextParts, contextPartsOf, type ChatDiagnosticsFields, type ChatContextSectionKind, type ContextSource } from './chatContextDiagnostics'
import { buildReplyContext } from './chatReplyContext'
import { isCodexChatCreationTool, stripEchoedAddresses } from '@conai/shared'
import { messageAddress, REPLY_GUIDANCE } from './chatReplies'
import { CHAT_ROOM_TOOLS, isChatOwnTool } from '../../mcp/context'
import { blockStateText, foldBlockState, parseBlockEdits, stripBlockFences, usableBlockKeys } from './chatBlockState'
import { fillCharacterPlaceholders } from './chatPlaceholders'
import { userPersonaForThread, userPersonaPrompt, type ChatUserPersona } from './chatUserProfiles'
import { resolveProfileModel } from './chatModelRoles'
import { ChatProfileStore, profileGenerationOptions, resolveSummaryPrompt, type ChatProfile } from './chatProfiles'
import { buildEmoticonGuidance } from './chatEmoticons'
import { buildChatStyleGuidance } from './chatStyle'
import { attachedImagesOf, chatContentWithAttachments, type AttachedImages } from './chatAttachments'
import type { LoreHistoryMessage, SelectedLore } from './chatLorebook'
import { booksForRequest, loreIndexText, READ_LORE_FILE_TOOL, selectRequestLore, type AttachedLoreBook, type ChatLore } from './chatLoreContext'
import { rejectedLoreLine, SAVE_LORE_TOOL } from './chatLoreProposals'
import { buildFlagDirective } from './chatFlags'
import { generationPromptOf } from './chatToolReferences'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { ChatSummaryStore, recallText, selectRecall, splitSegments, type ChatSummarySegment } from './chatMemory'
import type { JudgedContext } from './chatJudgeContext'
import { REFERENCE_BLOCK_START, resolveChatCompletionTarget, streamChatCompletion, type ChatCompletionMessage, type ChatCompletionTool, type ChatContentPart } from './llmChatCompletion'
import { inBackground } from '../llmRequestScheduler'
import { rawMessagesEstimate as rawUsageEstimate, rawTokenEstimate } from '../llmUsage'
import { ChatEstimateRatioStore } from './chatEstimateRatios'

/** Tool output replayed to the model for turns still in the window. */
const REPLAYED_TOOL_OUTPUT_LENGTH = 4000
const SUMMARY_TOOL_NOTE_LENGTH = 300
/** Room kept for the reply when the profile sets no max tokens. */
export const DEFAULT_REPLY_RESERVE_TOKENS = 2048

/**
 * The reply's share of a token budget when choosing the window. Max output tokens are a ceiling, not a booking: a cap
 * near the whole context would leave the conversation no room, so the share stops at a quarter of the budget (never
 * below DEFAULT_REPLY_RESERVE_TOKENS) and the request sends the cap cut to what is left (replyCapFor).
 */
export function replyReserveFor(contextTokens: number | null, maxTokens: number | null | undefined) {
  const cap = maxTokens ?? DEFAULT_REPLY_RESERVE_TOKENS
  return contextTokens === null ? cap : Math.min(cap, Math.max(DEFAULT_REPLY_RESERVE_TOKENS, Math.floor(contextTokens / 4)))
}

const EXAMPLE_NOTE = '바로 뒤에 이어지는 첫 user/assistant 대화들은 말투와 형식을 보여주는 예시일 뿐 실제로 나눈 대화가 아니야. 실제 대화는 그 다음부터야.'

/**
 * How to generate: free-form through the queue, or through the profile's generation presets only.
 * Generation runs in the background: the job is linked to the reply at submission and the app attaches the finished
 * image to the message by itself, so the model answers right away instead of blocking on wait_generation_job.
 */
const GENERATION_ASYNC_GUIDANCE = 'Image generation does not require connecting a CoNAI page. Use the generation tools actually provided in this request; never infer missing account permission from page connection state or ask an administrator to grant themselves permissions. Do not wait for the job and do not poll it: the app attaches the finished image to this reply by itself, even after you finish. Write your reply right away in the same turn, without ids or links; you may say the image is on its way, but never describe it as finished or describe what it looks like.'

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
    replyReserveTokens: replyReserveFor(profile.contextTokens, maxTokens),
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
export function buildPersonaPrompt(profile: ChatProfile, options: { dialogueAsText?: boolean; user?: ChatUserPersona | null; onPart?: (kind: ChatContextSectionKind, text: string) => void } = {}) {
  const blocks = [profile.systemPrompt]
  if (profile.systemPrompt) options.onPart?.('system-prompt', fillCharacterPlaceholders(profile.systemPrompt, profile, options.user))
  for (const section of profile.promptSections) {
    if (!section.enabled || !section.content.trim() || section.kind === 'post') continue
    if (section.kind === 'dialogue' && !options.dialogueAsText && parseExampleDialogue(section.content, profile, options.user)) continue
    // The chat's user profile describes the user; an old profile's own user persona gives way to it.
    if (section.id === 'legacy-persona' && options.user?.persona) continue
    const text = section.title ? `## ${section.title}\n${section.content}` : section.content
    blocks.push(text)
    options.onPart?.('prompt-section', fillCharacterPlaceholders(text, profile, options.user))
  }
  blocks.push(userPersonaPrompt(options.user))
  if (userPersonaPrompt(options.user)) options.onPart?.('user-persona', fillCharacterPlaceholders(userPersonaPrompt(options.user), profile, options.user))
  return fillCharacterPlaceholders(blocks.filter(Boolean).join('\n\n'), profile, options.user)
}

/** The profile's after-the-conversation instructions (`post` sections), filled; '' when it has none. */
export function postHistoryText(profile: ChatProfile, user?: ChatUserPersona | null) {
  const text = profile.promptSections.filter((section) => section.enabled && section.kind === 'post' && section.content.trim()).map((section) => section.content.trim()).join('\n\n')
  return text ? fillCharacterPlaceholders(text, profile, user) : ''
}

/** Example turns from dialogue sections, sent right after the system messages. */
function buildExampleMessages(profile: ChatProfile, user?: ChatUserPersona | null): ChatCompletionMessage[] {
  return profile.promptSections
    .filter((section) => section.enabled && section.kind === 'dialogue')
    .flatMap((section) => parseExampleDialogue(section.content, profile, user) ?? [])
    .map((message) => markContextMessage(message, 'example'))
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
const estimateRatios = new Map<number, { ratio: number; modelKey: string }>()

/** Which model a profile's ratio belongs to: a ratio measured on another tokenizer starts over. */
function modelKeyOf(profileId: number) {
  try {
    const profile = ChatProfileStore.find(profileId)
    const chat = profile ? resolveProfileModel(profile, 'chat') : null
    return chat ? `${chat.providerName}\u0000${chat.model}` : ''
  } catch {
    return ''
  }
}

/** The ratio for a profile: this process's, else the stored one measured on the same model (once per profile). */
function ratioOf(profileId: number) {
  const cached = estimateRatios.get(profileId)
  if (cached) return cached.ratio
  const modelKey = modelKeyOf(profileId)
  const stored = modelKey ? ChatEstimateRatioStore.load(profileId, modelKey) : null
  estimateRatios.set(profileId, { ratio: stored ?? 1, modelKey })
  return stored ?? 1
}

export function estimateTokens(profileId: number, text: string) {
  return Math.ceil(rawTokenEstimate(text) * ratioOf(profileId))
}

export function estimateMessagesTokens(profileId: number, messages: ChatCompletionMessage[], tools: ChatCompletionTool[] = []) {
  return Math.ceil(rawMessagesEstimate(messages, tools) * ratioOf(profileId))
}

/**
 * Feed back the prompt tokens a server reported for a request we estimated (smoothed, clamped to 0.4–2.5×), and keep
 * it for the next start. A profile now on another model starts from this measurement.
 */
export function recordPromptUsage(profileId: number, rawEstimate: number, promptTokens: number) {
  if (rawEstimate <= 0 || promptTokens <= 0) {
    return
  }
  const measured = Math.min(2.5, Math.max(0.4, promptTokens / rawEstimate))
  const modelKey = modelKeyOf(profileId)
  const previous = estimateRatios.get(profileId)
  const ratio = previous && previous.modelKey === modelKey && previous.ratio !== 1 ? previous.ratio * 0.7 + measured * 0.3 : measured
  estimateRatios.set(profileId, { ratio, modelKey })
  if (modelKey) ChatEstimateRatioStore.save(profileId, modelKey, ratio)
}

export function rawMessagesEstimate(messages: ChatCompletionMessage[], tools: ChatCompletionTool[] = []) {
  return rawUsageEstimate(messages, tools)
}

// ---- Window ---------------------------------------------------------------------------------------------------

const NO_BLOCKS: ReadonlySet<string> = new Set()

/** `blockKeys`: display blocks whose fences are left out of replies (their values travel with the state instead). */
/** `toolOutputLength`: how much of each tool result is replayed (older replies of a long chat get their summary only). */
/** `images`: the attached images the request shows (see loadAttachedImages); a user message carrying some sends them as image parts. */
export function toCompletionMessages(message: CodexChatMessageRecord, blockKeys: ReadonlySet<string> = NO_BLOCKS, inlineTexts?: ReadonlyMap<string, string>, toolOutputLength = REPLAYED_TOOL_OUTPUT_LENGTH, images?: AttachedImages): ChatCompletionMessage[] {
  if (message.role === 'user') {
    const text = `[${messageAddress(message)}; from=user]\n${chatContentWithAttachments(message.content, message.attachments, message.mediaAttachments, inlineTexts, images)}`
    const shown = attachedImagesOf(message, images)
    return [{ role: 'user', content: shown.length ? [{ type: 'text', text }, ...shown.map((url) => ({ type: 'image_url' as const, image_url: { url } }))] : text }]
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
      const replayed = toolOutputLength < REPLAYED_TOOL_OUTPUT_LENGTH ? call.summary ?? call.output ?? '' : call.output ?? call.summary ?? ''
      result.push({ role: 'tool', tool_call_id: call.id, content: replayed.slice(0, toolOutputLength) || '(no output)' })
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
function selectWindow(profile: Pick<ChatProfile, 'id' | 'style'>, turns: CodexChatMessageRecord[][], config: LlmChatContextConfig, fixedTokens: number, maxTurns = config.contextTurns, inlineTexts?: ReadonlyMap<string, string>, images?: AttachedImages) {
  const blockKeys = usableBlockKeys(profile.style.blocks)
  const candidates = maxTurns > 0 ? turns.slice(-maxTurns) : []
  if (config.contextTokens === null) {
    return candidates
  }
  let remaining = config.contextTokens - config.replyReserveTokens - fixedTokens
  const kept: CodexChatMessageRecord[][] = []
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const cost = estimateMessagesTokens(profile.id, candidates[index].flatMap((message) => toCompletionMessages(message, blockKeys, inlineTexts, undefined, images)))
    if (kept.length > 0 && cost > remaining) {
      break
    }
    kept.unshift(candidates[index])
    remaining -= cost
  }
  return kept
}

/**
 * The lore of one request: the books attached to the chat and the profile (see booksForRequest; a profile preview has
 * no chat and gets the global books only), unless the caller resolved `books` already. Without messages only the
 * "always on" entries are chosen. `toolOffered`: read_lore_file is among the request's tools.
 */
export function selectChatLore(profile: ChatProfile, messages?: ReadonlyArray<LoreHistoryMessage>, user?: ChatUserPersona | null, options: { thread?: Pick<CodexChatThreadRecord, 'id' | 'account_id'> | null; books?: AttachedLoreBook[]; toolOffered?: boolean; history?: ReadonlyArray<LoreHistoryMessage>; speakerProfileId?: number; judged?: ReadonlySet<string> } = {}): ChatLore {
  const books = options.books ?? booksForRequest({ thread: options.thread ?? null, profile })
  return selectRequestLore(profile, books, messages, (text) => estimateTokens(profile.id, text), (text) => fillCharacterPlaceholders(text, profile, user), {
    toolOffered: options.toolOffered ?? false,
    judged: options.judged,
    ...(profile.engine !== 'codex' && messages !== undefined ? { timing: { messages: options.history ?? messages, speakerProfileId: options.speakerProfileId } } : {}),
  })
}

/** Whether read_lore_file is among these tools. */
export function offersLoreFileTool(tools: ReadonlyArray<ChatCompletionTool>) {
  return tools.some((tool) => tool.function.name === READ_LORE_FILE_TOOL)
}

/**
 * The lore titles a person set aside in this chat, as one line for the reference block — only when save_lore is
 * among the request's tools ('' otherwise). Kept out of the system prompt: it changes with the conversation.
 */
export function rejectedLoreFor(threadId: number | null | undefined, tools: ReadonlyArray<ChatCompletionTool>) {
  return tools.some((tool) => tool.function.name === SAVE_LORE_TOOL) ? rejectedLoreLine(threadId) : ''
}

/**
 * Request layout, front to back, so that what a server has already seen stays byte-identical for as long as possible
 * (OpenAI caches a repeated prefix by itself; llama.cpp, LM Studio, vLLM and Ollama reuse their KV cache the same way):
 *
 *   1. system prompt — persona, guidance: fixed until the profile is saved
 *   2. lore index, "always on" lore entries and the rolling summary — the tail of the same system message (chat
 *      templates allow a system message only at the start); change only when a book changes or turns are folded in
 *   3. example dialogue — fixed
 *   4. older turns
 *   5. keyword lore (`[참고 설정]`) merged into the user message `loreDepth` turns before the end — the part that
 *      changes with the conversation, so only the turns after it are re-read when it changes
 *   6. the latest user message, with the chat flags appended
 *
 * Anything that varies between requests (lore matches, future time macros or state) belongs in 5 or 6, never in 1–3.
 */

/**
 * Everything before the real conversation: one system message — the system prompt first (stable, so servers can reuse
 * the cached prefix), then the lore index with the "always on" entries and the rolling summary — then example turns. Chat templates often allow
 * system messages only at the start, so the note that the examples are not real lives in the system prompt rather
 * than around them. `lore` defaults to the profile's global books with no chat (a preview).
 */
export function buildLeadingMessages(profile: ChatProfile, thread: Pick<CodexChatThreadRecord, 'summary'> | null, config: Pick<LlmChatContextConfig, 'summaryEnabled'>, withTools: boolean, lore: Pick<ChatLore, 'index' | 'constant'> = selectChatLore(profile), user: ChatUserPersona | null = null) {
  const examples = buildExampleMessages(profile, user)
  const personaParts: Array<{ kind: ChatContextSectionKind; text: string }> = []
  const systemPrompt = [
    buildPersonaPrompt(profile, { user, onPart: (kind, text) => personaParts.push({ kind, text }) }),
    examples.length > 0 ? EXAMPLE_NOTE : '',
    withTools ? toolGuidance(profile.generationPresetIds.length > 0) : '',
    REPLY_FORMAT_GUIDANCE,
    REPLY_GUIDANCE,
    buildChatStyleGuidance(profile.style, profile.name),
    buildEmoticonGuidance(profile.style),
    modelLanguageGuidance(profile),
  ].filter(Boolean).join('\n\n')
  // The lore index, the "always on" entries and the summary follow the persona in the same system message: many chat
  // templates (Qwen's among them) reject a system message that is not the first one. Behind the persona, so the
  // prefix a server cached stays the same until they change.
  const memory = [
    loreIndexText(lore),
    config.summaryEnabled && thread?.summary?.trim() ? `## 지금까지의 대화 요약\n${thread.summary.trim()}` : '',
  ].filter(Boolean).join('\n\n')
  const system = [systemPrompt, memory].filter(Boolean).join('\n\n')
  const result: ChatCompletionMessage[] = system ? [markContextParts({ role: 'system', content: system }, [
    ...personaParts,
    { kind: 'guidance', text: [examples.length > 0 ? EXAMPLE_NOTE : '', fixedContextGuidance(profile, withTools)].filter(Boolean).join('\n\n') },
    { kind: 'lore-index', text: lore.index },
    { kind: 'constant-lore', text: lore.constant ? `## 상시 항목\n${lore.constant}` : '' },
    { kind: 'summary', text: config.summaryEnabled && thread?.summary?.trim() ? `## 지금까지의 대화 요약\n${thread.summary.trim()}` : '' },
  ])] : []
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
 * The `[참고 설정]` blocks a request merges into its conversation: keyword lore (with recalled summaries, `recall`,
 * and the set-aside lore titles, `rejected`) at the profile's lore depth and the author's note (with the display block
 * state, `stateText`) at its own — one block when both share a depth.
 */
export function depthBlocks(lore: Pick<SelectedLore, 'keyed'>, loreDepth: number, note: AuthorNote, stateText = '', recall = '', rejected = ''): Array<{ depth: number; block: string }> {
  const loreText = [lore.keyed, recall, rejected].filter(Boolean).join('\n\n')
  const noteText = [authorNoteText(note), stateText].filter(Boolean).join('\n\n')
  if (loreText && noteText && note.depth !== loreDepth) {
    return [{ depth: loreDepth, block: referenceBlock([loreText]) }, { depth: note.depth, block: referenceBlock([noteText]) }]
  }
  const block = referenceBlock([loreText, noteText])
  return block ? [{ depth: loreText ? loreDepth : note.depth, block }] : []
}

/** `insertAtDepth` for every block; each only prefixes one user message, so the others' positions are unaffected. */
export function insertDepthBlocks(messages: ChatCompletionMessage[], blocks: Array<{ depth: number; block: string }>) {
  return blocks.reduce((result, { depth, block }) => insertAtDepth(result, depth, block), messages)
}

export function estimateDepthBlocks(profileId: number, blocks: Array<{ block: string }>) {
  return blocks.reduce((total, { block }) => total + estimateTokens(profileId, block), 0)
}

export function prefixUserContent(content: string | ChatContentPart[], block: string): string | ChatContentPart[] {
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
  return messages.map((message, index) => (index === target && message.role === 'user' ? markContextParts({ ...message, content: prefixUserContent(message.content, block) }, [
    { kind: 'reference', text: block },
    ...(contextPartsOf(message).length ? contextPartsOf(message) : [{ kind: 'window' as const, text: contextContentText(message.content) }]),
  ]) : message))
}

// ---- Window ---------------------------------------------------------------------------------------------------

/**
 * The latest `fit` of `items`: the window the chat's setting gives (context turns, a room's window), counted back from
 * the newest item every request, so it always holds as many as the setting says (and fit). The newest item is always
 * sent, even when less than one fits.
 */
export function latestWindow<T>(items: T[], fit: number): T[] {
  if (items.length === 0) return []
  return items.slice(-Math.max(1, Math.floor(fit)))
}

/** Replies older than the last FULL_TOOL_OUTPUT_TURNS turns replay each tool result as its short summary. */
const FULL_TOOL_OUTPUT_TURNS = 4
const SHORT_TOOL_OUTPUT_LENGTH = 300

/** The message id before which the window's tool results are replayed short (0: none). */
function shortToolOutputsBefore(window: CodexChatMessageRecord[][]) {
  return window.length > FULL_TOOL_OUTPUT_TURNS ? window[window.length - FULL_TOOL_OUTPUT_TURNS][0].id : 0
}

/** The chat flags of the message being answered (the latest user message) as one block; '' when none were on. */
export function flagDirectiveFor(messages: CodexChatMessageRecord[], profile: ChatProfile, user?: ChatUserPersona | null) {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  return buildFlagDirective(latestUser?.flags ?? [], (text) => fillCharacterPlaceholders(text, profile, user))
}

/** Add `directive` after the last user turn (merged into it, so turns keep alternating). */
export function appendUserDirective(messages: ChatCompletionMessage[], directive: string, kind: 'last-instruction' | 'judge' = 'last-instruction'): ChatCompletionMessage[] {
  if (!directive) return messages
  const last = messages[messages.length - 1]
  if (last?.role === 'user' && typeof last.content === 'string') return [...messages.slice(0, -1), markContextParts({ ...last, content: `${last.content}\n\n${directive}` }, [
    ...(contextPartsOf(last).length ? contextPartsOf(last) : [{ kind: 'window' as const, text: last.content }]), { kind, text: directive },
  ])]
  // A user turn with attached images: the directive goes in as one more text part after them.
  if (last?.role === 'user' && Array.isArray(last.content)) {
    const text = last.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n\n')
    return [...messages.slice(0, -1), markContextParts({ ...last, content: [...last.content, { type: 'text', text: `\n\n${directive}` }] }, [
      ...(contextPartsOf(last).length ? contextPartsOf(last) : [{ kind: 'window' as const, text }]), { kind, text: directive },
    ])]
  }
  return [...messages, markContextMessage({ role: 'user', content: directive }, kind)]
}

export function sendableMessages(messages: CodexChatMessageRecord[]) {
  return messages.filter((message) => message.content.trim() || message.attachments?.length || message.mediaAttachments?.length || message.tool_calls.length > 0)
}

/** Recent messages that decide what is recalled: the latest exchange. */
const RECALL_QUERY_MESSAGES = 2
const RECALL_MAX_TOKENS = 800

/**
 * Summaries already folded into the plot that the latest exchange is about, as the block text ('' for none). Up to
 * RECALL_MAX_TOKENS, and a twelfth of the token budget when there is one.
 */
export function recallFor(profile: ChatProfile, segments: ChatSummarySegment[], messages: CodexChatMessageRecord[], config: Pick<LlmChatContextConfig, 'contextTokens'>) {
  return recallText(recalledSegments(profile, segments, messages, config))
}

/**
 * The segments `recallFor` puts in, themselves. `keep`: the episodes the judge kept (see chatJudgeContext); only
 * those come back, ranked as usual (one word in common is enough: the judge read them).
 */
export function recalledSegments(profile: ChatProfile, segments: ChatSummarySegment[], messages: CodexChatMessageRecord[], config: Pick<LlmChatContextConfig, 'contextTokens'>, keep?: ReadonlySet<number> | null) {
  const { folded } = splitSegments(segments)
  if (folded.length === 0) return []
  const query = sendableMessages(messages).slice(-RECALL_QUERY_MESSAGES).map((message) => message.content).join('\n')
  const budget = config.contextTokens ? Math.min(RECALL_MAX_TOKENS, Math.floor(config.contextTokens / 12)) : RECALL_MAX_TOKENS
  if (keep) return selectRecall(folded.filter((segment) => keep.has(segment.id)), query, budget, (text) => estimateTokens(profile.id, text), 3, 1)
  return selectRecall(folded, query, budget, (text) => estimateTokens(profile.id, text))
}

/**
 * What one reply's request carried, kept on the reply: the stretch of conversation sent as it was, how far the
 * summary reached, how many summaries came back by recall, the lore entries chosen, how many of them are "always on"
 * (`memories`, where pinned memories went), and the size estimate (the server's own count is added once it answers).
 */
export type ChatContextMeta = {
  windowFromMessageId: number | null
  sentMessages: number
  summaryUntilMessageId: number | null
  recalledSegments: number
  lore: string[]
  memories: number
  estimatedTokens: number
  model?: string | null
  promptTokens?: number | null
} & ChatDiagnosticsFields

/** Source references carry hashes only; read-time diagnostics resolves each permitted current source separately. */
export function promptContextSources(profile: ChatProfile, user: ChatUserPersona, withTools: boolean): ContextSource[] {
  const render = (text: string) => fillCharacterPlaceholders(text, profile, user)
  return [
    ...contextSource('system-prompt', render(profile.systemPrompt)),
    ...profile.promptSections.flatMap((section) => {
      if (!section.enabled || !section.content.trim() || (section.id === 'legacy-persona' && user.persona)) return []
      return contextSource(section.kind === 'dialogue' ? 'example' : section.kind === 'post' ? 'last-instruction' : 'prompt-section', render(section.kind === 'post' ? section.content.trim() : section.content), section.id)
    }),
    ...contextSource('user-persona', userPersonaPrompt(user)),
    ...contextSource('guidance', fixedContextGuidance(profile, withTools)),
  ]
}

export function fixedContextGuidance(profile: ChatProfile, withTools: boolean) {
  return [withTools ? toolGuidance(profile.generationPresetIds.length > 0) : '', REPLY_FORMAT_GUIDANCE, REPLY_GUIDANCE, buildChatStyleGuidance(profile.style, profile.name), buildEmoticonGuidance(profile.style), modelLanguageGuidance(profile)].filter(Boolean).join('\n\n')
}

/** Helper instructions are referenced separately; they are not part of the primary reply's sections. */
export function auxiliaryInstructionText(profile: ChatProfile, user: ChatUserPersona, id: string) {
  const custom = profile.summaryPrompt?.trim() ?? ''
  switch (id) {
    case 'summary-segment': return custom ? `${custom}\n\n${SEGMENT_PROMPT_SUFFIX}` : SEGMENT_PROMPT
    case 'summary-plot': return `${custom || resolveSummaryPrompt({ ...profile, summaryPrompt: '' })}\n\n${PLOT_PROMPT_SUFFIX}`
    case 'translation-user': return userTranslationPrompt(profile)
    case 'translation-reply': return replyTranslationPrompt(profile, user.name)
    default: return ''
  }
}

export function buildContextMeta(profile: ChatProfile, thread: CodexChatThreadRecord, messages: CodexChatMessageRecord[], sent: CodexChatMessageRecord[], summaryEnabled: boolean, lore: ChatLore, recalled: ReturnType<typeof recalledSegments>, tools: ChatCompletionTool[], request: ChatCompletionMessage[]): ChatContextMeta {
  const meta: ChatContextMeta = {
    windowFromMessageId: sent[0]?.id ?? null, sentMessages: sent.length,
    summaryUntilMessageId: summaryEnabled && thread.summary ? thread.summary_until_message_id : null,
    recalledSegments: recalled.length, lore: lore.labels, memories: lore.constantCount,
    estimatedTokens: estimateMessagesTokens(profile.id, request, tools),
  }
  if (!loadChatSettings().diagnostics.enabled) return limitContextMeta({
    ...meta, loreEntries: lore.decisions.filter((entry) => entry.selected),
  })
  const user = userPersonaForThread(thread)
  const summary = summaryEnabled ? thread.summary?.trim() ?? '' : ''
  return limitContextMeta({
    ...meta, version: 2, engine: 'llm', profileId: profile.id,
    sections: contextSections(request, tools, (text) => estimateTokens(profile.id, text)),
    auxiliarySources: [
      ...(summaryEnabled ? ['summary-segment', 'summary-plot'].flatMap((id) => contextSource('summary-instruction', auxiliaryInstructionText(profile, user, id), id)) : []),
      ...(resolveProfileModel(profile, 'translation') ? ['translation-user', 'translation-reply'].flatMap((id) => contextSource('translation-instruction', auxiliaryInstructionText(profile, user, id), id)) : []),
    ],
    sources: [
      ...promptContextSources(profile, user, tools.some((tool) => !isChatOwnTool(tool.function.name))),
      ...contextSource('lore-index', lore.index), ...contextSource('constant-lore', lore.constant),
      ...contextSource('summary', summary),
      ...contextSource('author-note', resolveAuthorNote(thread, profile, user).text),
      ...contextSource('state', threadBlockStateText(profile, thread, messages, thread.kind === 'group' ? profile.id : undefined)),
      ...contextSource('flags', flagDirectiveFor(messages, profile, user), [...messages].reverse().find((message) => message.role === 'user')?.id),
      ...sent.flatMap((message) => contextSource('window', message.content, message.id)),
      ...tools.flatMap((tool) => contextSource('tool-definition', JSON.stringify(tool), tool.function.name)),
    ],
    ...loreDiagnostics(lore.decisions, lore.unmatched),
    recall: recalled.map((segment) => ({ segmentId: segment.id, score: segment.score, terms: segment.terms, hash: contextHash(segment.content.trim()) })),
    window: { fromId: sent[0]?.id ?? null, sent: sent.length, droppedTurns: splitTurns(sendableMessages(unsummarizedMessages(messages, thread, { summaryEnabled }))).filter((turn) => !turn.some((message) => sent.some((entry) => entry.id === message.id))).length },
    toolRounds: 0,
  })
}

/**
 * Shared by summary planning, the actual request and the profile preview. `segments`: the thread's summary segments,
 * read by the caller (recall comes from them; none without). `books`: the lore books, when the caller resolved them.
 */
function buildRequestContext(profile: ChatProfile, thread: CodexChatThreadRecord | null, messages: CodexChatMessageRecord[], config: Pick<LlmChatContextConfig, 'summaryEnabled'> & Partial<Pick<LlmChatContextConfig, 'contextTokens'>>, tools: ChatCompletionTool[], segments: ChatSummarySegment[] = [], books?: AttachedLoreBook[], judged?: JudgedContext | null) {
  const user = userPersonaForThread(thread)
  const lore = selectChatLore(profile, messages, user, { thread, books, toolOffered: offersLoreFileTool(tools), judged: judged?.loreKeys })
  const system = buildLeadingMessages(profile, thread, config, tools.some((tool) => !isChatOwnTool(tool.function.name)), lore, user)
  const recalled = config.summaryEnabled ? recalledSegments(profile, segments, messages, { contextTokens: config.contextTokens ?? null }, judged?.recallKeep) : []
  const recall = recallText(recalled)
  const blocks = depthBlocks(lore, profile.loreDepth, resolveAuthorNote(thread, profile, user), threadBlockStateText(profile, thread ?? { block_edits: null }, messages), recall, rejectedLoreFor(thread?.id, tools))
  const directive = [flagDirectiveFor(messages, profile, user), postHistoryText(profile, user)].filter(Boolean).join('\n\n')
  const fixedTokens = estimateMessagesTokens(profile.id, system, tools) + estimateDepthBlocks(profile.id, blocks) + estimateTokens(profile.id, directive)
  return { system, blocks, directive, fixedTokens, lore, recalled }
}

export function buildChatPromptPreview(profile: ChatProfile, tools: ChatCompletionTool[]) {
  const { system, blocks } = buildRequestContext(profile, null, [], { summaryEnabled: false }, tools)
  return [...system, ...insertDepthBlocks([], blocks)]
}

/**
 * Final guard also covers tool rounds and a latest message too large to fit by itself. The reply only needs a short
 * answer's room here (the cap is cut to what is left, see replyCapFor), not the whole max output tokens.
 */
export function assertChatContextFits(profile: ChatProfile, messages: ChatCompletionMessage[], tools: ChatCompletionTool[], maxTokens: number | null | undefined) {
  if (profile.contextTokens === null) return
  const needed = estimateMessagesTokens(profile.id, messages, tools) + Math.min(maxTokens ?? DEFAULT_REPLY_RESERVE_TOKENS, DEFAULT_REPLY_RESERVE_TOKENS)
  if (needed > profile.contextTokens) {
    throw new Error(`컨텍스트 한도를 넘었어 (예상 ${needed} / ${profile.contextTokens} 토큰). 메시지·도구 결과를 줄이거나 컨텍스트 길이를 늘려줘.`)
  }
}

/** Kept between the estimate and the server's own count when cutting a cap to the room left. */
const REPLY_CAP_MARGIN = 0.03

/**
 * The max_tokens a request sends: the cap, cut to what the context has left beside the prompt (with a margin for the
 * estimate), so a cap larger than the room never gets the request refused. Unchanged without a context length.
 */
export function replyCapFor(profile: ChatProfile, messages: ChatCompletionMessage[], tools: ChatCompletionTool[], maxTokens: number | null | undefined) {
  if (maxTokens == null || profile.contextTokens === null) return maxTokens
  const prompt = estimateMessagesTokens(profile.id, messages, tools)
  const room = profile.contextTokens - Math.ceil(prompt * (1 + REPLY_CAP_MARGIN))
  return Math.max(1, Math.min(maxTokens, room))
}

/** Tool output lengths tried, in order, when a request with tool results does not fit (see fitChatContext). */
const FIT_TOOL_OUTPUT_LENGTHS = [REPLAYED_TOOL_OUTPUT_LENGTH, 1000]

/** A tool result cut to `length` characters, saying how much of it the model sees. */
export function cutToolOutput(content: string, length: number) {
  return `${content.slice(0, length)}\n…(잘림: 이 결과의 ${length}자까지만 보임)`
}

/**
 * `messages` when they fit (assertChatContextFits); otherwise a copy with the tool results cut shorter, tried at
 * FIT_TOOL_OUTPUT_LENGTHS — a large tool result (a long file, a history dump) is what usually tips a tool round over
 * the limit. Throws the overflow error of the shortest cut tried (its estimate) when even that does not fit.
 */
export function fitChatContext(profile: ChatProfile, messages: ChatCompletionMessage[], tools: ChatCompletionTool[], maxTokens: number | null | undefined): ChatCompletionMessage[] {
  try {
    assertChatContextFits(profile, messages, tools, maxTokens)
    return messages
  } catch (error) {
    let last = error
    for (const length of FIT_TOOL_OUTPUT_LENGTHS) {
      const cut = messages.map((message) => (message.role === 'tool' && message.content.length > length ? { ...message, content: cutToolOutput(message.content, length) } : message))
      if (cut.every((message, index) => message === messages[index])) continue
      try {
        assertChatContextFits(profile, cut, tools, maxTokens)
        return cut
      } catch (cutError) {
        // Try a shorter cut; report the shortest one's estimate.
        last = cutError
      }
    }
    throw last
  }
}

/** With the summary on, only the messages after it go out verbatim; the summary stands in for the rest. */
export function unsummarizedMessages(messages: CodexChatMessageRecord[], thread: Pick<CodexChatThreadRecord, 'summary_until_message_id'>, config: Pick<LlmChatContextConfig, 'summaryEnabled'>) {
  const until = config.summaryEnabled ? thread.summary_until_message_id ?? 0 : 0
  return until > 0 ? messages.filter((message) => message.id > until) : messages
}

/**
 * The request for one reply, laid out as described above `buildLeadingMessages`: the leading messages, the recent
 * unsummarized turns that fit (the latest ones, see `latestWindow`) with the keyword lore merged in `loreDepth`
 * turns before the end, ending with the user message just stored plus its flags. Turns are only dropped here when
 * the summary could not keep up (off, failed or interrupted).
 */
export function buildChatMessages(params: {
  profile: ChatProfile
  thread: CodexChatThreadRecord
  messages: CodexChatMessageRecord[]
  config: LlmChatContextConfig
  tools: ChatCompletionTool[]
  /** The thread's summary segments, for recall. */
  segments?: ChatSummarySegment[]
  /** A chat that cannot read files itself: text attachments' contents, by file id (see loadInlineAttachmentTexts). */
  attachmentTexts?: ReadonlyMap<string, string>
  /** The attached images the request shows (see loadAttachedImages). */
  attachedImages?: AttachedImages
  /** Told what the request carries (see ChatContextMeta). */
  onMeta?: (meta: ChatContextMeta) => void
  /** Tokens the caller adds after the request (a continuation), kept free when the window is chosen. */
  extraTokens?: number
  /** The lore books, already resolved (default: booksForRequest for this chat and profile). */
  books?: AttachedLoreBook[]
  /** Lore entries and past episodes the judge chose for this reply (see chatJudgeContext). */
  judged?: JudgedContext | null
}): ChatCompletionMessage[] {
  const { profile, thread, config, tools } = params
  const { system, blocks, directive, fixedTokens, lore, recalled } = buildRequestContext(profile, thread, params.messages, config, tools, params.segments, params.books, params.judged)
  const routing = [...params.messages].reverse().find((message) => message.role === 'user')?.routing
  const maxChars = Math.max(256, Math.min(6000, Math.floor((config.contextTokens ?? 24000) / 4)))
  const replyContext = buildReplyContext(params.messages, routing, { maxChars })
  const turns = splitTurns(sendableMessages(unsummarizedMessages(params.messages, thread, config)))
  const fit = selectWindow(profile, turns, config, fixedTokens + estimateTokens(profile.id, replyContext) + 40 + (params.extraTokens ?? 0), config.contextTurns, params.attachmentTexts, params.attachedImages).length
  const window = latestWindow(turns, fit)
  const blockKeys = usableBlockKeys(profile.style.blocks)
  const shortBefore = shortToolOutputsBefore(window)
  const conversation = insertDepthBlocks(window.flat().flatMap((message) => toCompletionMessages(message, blockKeys, params.attachmentTexts, message.id < shortBefore ? SHORT_TOOL_OUTPUT_LENGTH : undefined, params.attachedImages)), blocks)
  const reference = buildReplyContext(params.messages, routing, { maxChars, visibleIds: new Set(window.flat().map((message) => message.id)) })
  // A direct chat has no room tools, so the request names no room id.
  const request = appendUserDirective([...system, ...conversation], [reference, directive].filter(Boolean).join('\n\n'))
  const sent = window.flat()
  if (params.onMeta) {
    const meta = buildContextMeta(profile, thread, params.messages, sent, config.summaryEnabled, lore, recalled, tools, request)
    meta.estimatedTokens += params.extraTokens ?? 0
    params.onMeta(meta)
  }
  return request
}

// ---- Summary --------------------------------------------------------------------------------------------------

/** How a message reads in a summary transcript: `speaker: text`, then the tools it used. */
export type TranscriptLineOf = (message: CodexChatMessageRecord) => string

/** Lore file text a reply quoted (`[자료 …]` … `[/자료]`, see loreFileResultText): reference data, not conversation. */
const QUOTED_LORE_FILE = /\[자료 [^\]\n]*\][\s\S]*?\[\/자료\]\n?/g
/** An address label anywhere in a line (stripEchoedAddresses takes the ones at a line start). */
const INLINE_ADDRESS = /\[(?:[^[\]\n]*?;\s*)?message_id=\d+(?:[^[\]\n]|\[[^[\]\n]*\])*\]/g

/** Message text as a summary should read it: no address labels and no quoted lore files. */
export function summaryTranscriptText(text: string) {
  return stripEchoedAddresses(text).replace(QUOTED_LORE_FILE, '').replace(INLINE_ADDRESS, '').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * `speakerOf` names the speaker (a room has one per message); `blocksOf` gives the speaker's display block keys. The
 * chat's own tools (quoting, room history, lorebook reads and proposals) are bookkeeping, not events, and stay out;
 * CoNAI actions (a generation…) stay as a short note.
 */
function transcriptLine(message: CodexChatMessageRecord, speakerOf: (message: CodexChatMessageRecord) => string, blocksOf: (message: CodexChatMessageRecord) => ReadonlySet<string>) {
  // A generation is remembered by the scene the model asked for: its result JSON names no picture.
  const tools = message.tool_calls.filter((call) => !CHAT_ROOM_TOOLS.has(call.tool)).map((call) => {
    const prompt = isCodexChatCreationTool(call.tool) ? generationPromptOf(call) : null
    return prompt ? `[이미지 생성: ${prompt.slice(0, SUMMARY_TOOL_NOTE_LENGTH)}]` : `[도구 ${call.tool}: ${(call.summary ?? '').slice(0, SUMMARY_TOOL_NOTE_LENGTH)}]`
  })
  // Block fences are state, not conversation: the summary does without them.
  const text = summaryTranscriptText(message.role === 'assistant' ? stripBlockFences(message.content, blocksOf(message)) : chatContentWithAttachments(message.content, message.attachments, message.mediaAttachments))
  // A reply that only used the chat's own tools says nothing worth summarizing.
  if (!text && tools.length === 0) return ''
  return [`${speakerOf(message)}: ${text}`, ...tools].join('\n')
}

/** A direct chat's transcript: the user and the profile speak. */
function directTranscript(profile: ChatProfile, user: ChatUserPersona): TranscriptLineOf {
  const blocks = usableBlockKeys(profile.style.blocks)
  return (message) => transcriptLine(message, (entry) => (entry.role === 'user' ? user.name : profile.name), () => blocks)
}

/** A group room's transcript: the user and each member speak under their own names (a member that left, as such). */
export function groupTranscript(members: ChatProfile[], user: ChatUserPersona): TranscriptLineOf {
  const byId = new Map(members.map((member) => [member.id, member]))
  const memberOf = (message: CodexChatMessageRecord) => (message.speaker_profile_id === null ? undefined : byId.get(message.speaker_profile_id))
  return (message) => transcriptLine(message, (entry) => (entry.role === 'user' ? user.name : memberOf(entry)?.name ?? '(나간 참가자)'), (entry) => usableBlockKeys(memberOf(entry)?.style.blocks ?? []))
}

export const SUMMARY_TIMEOUT_MS = 10 * 60 * 1000
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

/** What the request adds beyond the conversation that planning must count too (see buildChatMessages). */
type RequestExtras = { attachmentTexts?: ReadonlyMap<string, string>; attachedImages?: AttachedImages; extraTokens?: number }

function planFold(profile: ChatProfile, thread: CodexChatThreadRecord, config: LlmChatContextConfig, messages: CodexChatMessageRecord[], turns: CodexChatMessageRecord[][], mode: FoldMode, tools: ChatCompletionTool[], segments: ChatSummarySegment[], extras: RequestExtras = {}) {
  if (mode === 'all' || turns.length === 0) {
    return turns.length
  }
  const ahead = mode === 'ahead'
  const fixedTokens = buildRequestContext(profile, thread, messages, config, tools, segments).fixedTokens + (extras.extraTokens ?? 0)
    + (ahead ? estimateMessagesTokens(profile.id, turns[turns.length - 1].flatMap((message) => toCompletionMessages(message, usableBlockKeys(profile.style.blocks), extras.attachmentTexts, undefined, extras.attachedImages))) : 0)
  const fit = selectWindow(profile, turns, config, fixedTokens, config.contextTurns - (ahead ? 1 : 0), extras.attachmentTexts, extras.attachedImages).length
  return turnsToFold(turns.length, fit, config.summaryTriggerTurns)
}

/** The oldest of `turns` whose transcript stays within one summary call (at least one turn). */
function takeSummaryChunk(profile: ChatProfile, config: LlmChatContextConfig, turns: CodexChatMessageRecord[][], lineOf: TranscriptLineOf) {
  const limit = config.contextTokens ? Math.max(2000, Math.floor(config.contextTokens / 2)) : DEFAULT_SUMMARY_CHUNK_TOKENS
  let used = 0
  let count = 0
  for (const turn of turns) {
    used += estimateTokens(profile.id, turn.map(lineOf).join('\n\n'))
    if (count > 0 && used > limit) {
      break
    }
    count += 1
  }
  return turns.slice(0, count).flat()
}

/** A stretch is summarized on its own: what came before is only there to keep names and threads straight. */
const SEGMENT_PROMPT = [
  "아래 '이어진 대화'만 요약해줘. '앞선 내용'은 흐름을 잡기 위한 참고용이니 다시 쓰지 마.",
  '인물·관계·약속·설정·진행 중인 일·사용자의 선호, 그리고 이미지나 기록 ID처럼 다시 쓸 값은 빠뜨리지 마.',
  '사람·장소·물건 이름은 대화에 나온 그대로 써.',
  '요약만 출력하고 다른 말은 붙이지 마.',
].join('\n')
const SEGMENT_PROMPT_SUFFIX = "이번에는 '이어진 대화'만 요약해. '앞선 내용'은 참고용이니 다시 쓰지 마. 이름은 대화에 나온 그대로 써."

/** Active segments beyond this budget are folded into the plot, all but the newest KEEP_RECENT_SEGMENTS. */
const DEFAULT_SUMMARY_BUDGET_TOKENS = 3000
const KEEP_RECENT_SEGMENTS = 2

function summaryBudget(config: Pick<LlmChatContextConfig, 'contextTokens'>) {
  return config.contextTokens ? Math.max(1000, Math.floor(config.contextTokens * 0.15)) : DEFAULT_SUMMARY_BUDGET_TOKENS
}

/**
 * Output cap of a summary call when reasoning is off: far above a real summary, but a model that falls into repeating
 * itself stops in a minute instead of holding the chat (a request waits for a running summary) until the timeout.
 */
const SUMMARY_MAX_TOKENS = 2048

/** A summary that ran into the output cap. */
class SummaryRunawayError extends Error {}

/**
 * One completion on the profile's summary model (its chat model when it has none), bounded by SUMMARY_TIMEOUT_MS and
 * the output cap. Also used for merge drafts (chatLorebookMerge).
 */
export async function completeSummary(profile: ChatProfile, system: string, content: string, signal?: AbortSignal, maxTokens = SUMMARY_MAX_TOKENS) {
  const resolved = resolveProfileModel(profile, 'summary')
  if (!resolved) throw new Error('요약에 쓸 LLM 연결을 찾을 수 없어.')
  const connection = resolveChatCompletionTarget(resolved.providerName, { model: resolved.model })
  // The summary connection's own way of turning thinking off (llama.cpp with Qwen: enable_thinking).
  const generation = summaryGenerationOptions(profileGenerationOptions(profile), connection.thinkingSwitch)
  // With reasoning left on, thinking shares the cap, so only a request that really runs without it gets one.
  const capped = thinkingIsOff(generation, connection.thinkingSwitch)
  const target = { ...connection, generation: capped ? { ...generation, maxTokens } : generation }
  const timeout = AbortSignal.timeout(SUMMARY_TIMEOUT_MS)
  const result = await streamChatCompletion({
    target,
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    usage: { purpose: 'summary', profileId: profile.id },
  })
  // A summary cut by the cap is a runaway, not a summary: keep nothing, so the next fold tries again.
  if (capped && result.finishReason === 'length') {
    throw new SummaryRunawayError('요약이 끝나지 않고 길어져서 멈췄어. 다음 답변 뒤에 다시 시도할게.')
  }
  const summary = stripThinking(result.content).trim()
  if (!summary) {
    throw new Error('요약 결과가 비어 있어.')
  }
  return summary
}

/**
 * One stretch of conversation as its own segment. The plot and the last segments go along as context when they fit
 * in a quarter of the budget (or of one summary call), so the summary keeps names and open threads straight.
 */
async function summarizeSegment(profile: ChatProfile, config: LlmChatContextConfig, segments: ChatSummarySegment[], messages: CodexChatMessageRecord[], lineOf: TranscriptLineOf, signal?: AbortSignal) {
  const { plot, active } = splitSegments(segments)
  const limit = Math.floor((config.contextTokens ?? DEFAULT_SUMMARY_CHUNK_TOKENS) / 4)
  const context: string[] = []
  let used = 0
  for (const text of [...active.slice(-KEEP_RECENT_SEGMENTS).reverse().map((segment) => segment.content), plot?.content ?? '']) {
    const cost = estimateTokens(profile.id, text)
    if (!text.trim() || used + cost > limit) break
    context.unshift(text.trim())
    used += cost
  }
  const custom = profile.summaryPrompt.trim()
  const transcript = messages.map(lineOf).filter(Boolean).join('\n\n')
  return completeSummary(profile, custom ? `${custom}\n\n${SEGMENT_PROMPT_SUFFIX}` : SEGMENT_PROMPT, `## 앞선 내용\n${context.join('\n\n') || '(없음)'}\n\n## 이어진 대화\n${transcript}`, signal)
}

/** The plot rides along with every request, so it is told to stay one compact story rather than grow with each fold. */
const PLOT_PROMPT_SUFFIX = '결과는 하나의 줄거리로 써. 목록보다 문단으로 쓰고, 오래된 일일수록 짧게 줄여. 이름은 그대로 써.'

/**
 * The plot rewritten to take in `segments` (the oldest active ones), with the profile's summary prompt. Its cap grows
 * with the summary budget: a plot is longer than any one stretch.
 */
function summarizePlot(profile: ChatProfile, config: LlmChatContextConfig, plot: ChatSummarySegment | null, segments: ChatSummarySegment[], signal?: AbortSignal) {
  return completeSummary(profile, `${config.summaryPrompt}\n\n${PLOT_PROMPT_SUFFIX}`, `## 이전 요약\n${plot?.content.trim() || '(없음)'}\n\n## 이어진 대화 (구간 요약)\n${segments.map((segment) => segment.content.trim()).join('\n\n')}`, signal, Math.max(SUMMARY_MAX_TOKENS, summaryBudget(config)))
}

/** The oldest of `segments` that fit one plot call beside the plot itself (at least one), so a long backlog goes in passes. */
function takePlotChunk(profile: ChatProfile, config: LlmChatContextConfig, plot: ChatSummarySegment | null, segments: ChatSummarySegment[]) {
  const limit = (config.contextTokens ? Math.max(2000, Math.floor(config.contextTokens / 2)) : DEFAULT_SUMMARY_CHUNK_TOKENS) - estimateTokens(profile.id, plot?.content ?? '')
  let used = 0
  let count = 0
  for (const segment of segments) {
    used += estimateTokens(profile.id, segment.content)
    if (count > 0 && used > limit) break
    count += 1
  }
  return segments.slice(0, count)
}

/**
 * Fold the oldest unsummarized turns into a new segment, pass by pass, until `mode` is satisfied; whenever the
 * segments after the plot outgrow the summary budget, fold all but the newest of them into the plot (as many as one
 * call takes per pass). Every write is checked against the revision the pass read: a history edit meanwhile ends the
 * run, and the next request starts over from the new history.
 *
 * A failed plot fold is recorded and skipped for the rest of the run, so turns keep being folded into segments; a
 * segment that runs into the output cap is tried once more with half its turns.
 */
/**
 * What one fold pass works with: who summarizes under which settings, and the oldest unsummarized messages to fold
 * next (none: the run is done). A direct chat plans in turns against its window; a room in messages against its
 * window limit.
 */
type FoldPass = {
  profile: ChatProfile
  config: LlmChatContextConfig
  chunk: CodexChatMessageRecord[]
  lineOf: TranscriptLineOf
}
/** Null: nothing to do (the summary is off). May throw when no one can summarize; that is recorded like a failed call. */
type FoldPlanner = (thread: CodexChatThreadRecord, segments: ChatSummarySegment[]) => FoldPass | null

function directPlanner(profile: ChatProfile, mode: FoldMode, options: { messages?: CodexChatMessageRecord[]; tools?: ChatCompletionTool[]; extras?: RequestExtras }): FoldPlanner {
  return (thread, segments) => {
    if (profile.engine === 'claude' && !resolveChatAccess(thread.account_id).claude) throw new Error('Claude Code 요약 모델을 사용할 권한이 없어.')
    const config = resolveContextConfig(thread, profile)
    if (mode !== 'all' && !config.summaryEnabled) return null
    const messages = options.messages ?? CodexChatStore.listMessages(thread.id)
    const turns = splitTurns(sendableMessages(unsummarizedMessages(messages, thread, { summaryEnabled: true })))
    const count = planFold(profile, thread, config, messages, turns, mode, options.tools ?? [], segments, options.extras)
    const lineOf = directTranscript(profile, userPersonaForThread(thread))
    return { profile, config, lineOf, chunk: count === 0 ? [] : takeSummaryChunk(profile, config, turns.slice(0, count), lineOf) }
  }
}

/** Messages folded per pass in a room, at least: a third of its window, so folding happens every few messages. */
function groupFoldBatch(window: number) {
  return Math.max(1, Math.ceil(window / 3))
}

/** The member whose summary model a room uses: the representative when it is an API LLM, else the first such member. */
export function groupSummarizer(thread: Pick<CodexChatThreadRecord, 'profile_id'>, members: ChatProfile[]) {
  return members.find((member) => member.id === thread.profile_id && member.engine !== 'codex') ?? members.find((member) => member.engine !== 'codex') ?? null
}

/**
 * A room's summary is the room's own (`summary_enabled` on the thread; off unless set), written by `groupSummarizer`
 * with the whole transcript under everyone's names. It folds the oldest messages beyond the window limit — the
 * newest `window` stay verbatim — or everything (`all`).
 */
function groupPlanner(members: ChatProfile[], window: number, mode: 'ahead' | 'all'): FoldPlanner {
  return (thread) => {
    if (mode !== 'all' && thread.summary_enabled !== 1) return null
    const profile = groupSummarizer(thread, members)
    if (!profile) throw new Error('요약할 수 있는 LLM 참가자가 없어.')
    if (profile.engine === 'claude' && !resolveChatAccess(thread.account_id).claude) throw new Error('Claude Code 요약 모델을 사용할 권한이 없어.')
    const config = { ...resolveContextConfig(thread, profile), summaryEnabled: true }
    const pending = sendableMessages(unsummarizedMessages(CodexChatStore.listMessages(thread.id), thread, config))
    const count = mode === 'all' ? pending.length : turnsToFold(pending.length, window, groupFoldBatch(window))
    const lineOf = groupTranscript(members, userPersonaForThread(thread))
    return { profile, config, lineOf, chunk: count === 0 ? [] : takeSummaryChunk(profile, config, pending.slice(0, count).map((message) => [message]), lineOf) }
  }
}

async function foldIntoSummary(threadId: number, plan: FoldPlanner, mode: FoldMode, options: { signal?: AbortSignal }) {
  let folded: string | null = null
  let plotFailed = false
  for (let pass = 0; pass < MAX_SUMMARY_PASSES; pass += 1) {
    const thread = CodexChatStore.findThreadById(threadId)
    if (!thread) {
      return folded
    }
    const segments = ChatSummaryStore.list(threadId)
    const pending = plan(thread, segments)
    if (!pending) {
      return folded
    }
    const { profile, config, lineOf } = pending
    const { plot, active } = splitSegments(segments)
    const activeTokens = active.reduce((total, segment) => total + estimateTokens(profile.id, segment.content), 0)
    if (!plotFailed && active.length > KEEP_RECENT_SEGMENTS && activeTokens > summaryBudget(config)) {
      const fold = takePlotChunk(profile, config, plot, active.slice(0, -KEEP_RECENT_SEGMENTS))
      try {
        const content = await summarizePlot(profile, config, plot, fold, options.signal)
        if (!ChatSummaryStore.setPlot(threadId, { from: plot?.from_message_id ?? fold[0].from_message_id, until: fold[fold.length - 1].until_message_id, content }, thread.context_revision)) {
          return folded
        }
        CodexChatStore.setSummaryError(threadId, null)
        folded = content
      } catch (error) {
        // The summarize button folds everything at once: there the failure is the answer.
        if (options.signal?.aborted || mode === 'all') throw error
        plotFailed = true
        CodexChatStore.setSummaryError(threadId, (error instanceof Error ? error.message : String(error)).slice(0, 500))
      }
      continue
    }
    let chunk = pending.chunk
    if (chunk.length === 0) {
      // Nothing is left behind, so an earlier failure no longer matters.
      if (!plotFailed) CodexChatStore.setSummaryError(threadId, null)
      return folded
    }
    let content: string
    try {
      content = await summarizeSegment(profile, config, segments, chunk, lineOf, options.signal)
    } catch (error) {
      const chunkTurns = splitTurns(chunk)
      if (!(error instanceof SummaryRunawayError) || chunkTurns.length < 2) throw error
      chunk = chunkTurns.slice(0, Math.ceil(chunkTurns.length / 2)).flat()
      content = await summarizeSegment(profile, config, segments, chunk, lineOf, options.signal)
    }
    if (!ChatSummaryStore.addSegment(threadId, { from: chunk[0].id, until: chunk[chunk.length - 1].id, content }, thread.context_revision)) {
      return folded
    }
    if (!plotFailed) CodexChatStore.setSummaryError(threadId, null)
    folded = content
  }
  return folded
}

const summaryRuns = new Map<number, Promise<string | null>>()

/** Whether a background summary of the thread is running now (a summary edit meanwhile would be lost under it). */
export function isSummarizing(threadId: number) {
  return summaryRuns.has(threadId)
}

function startFold(threadId: number, plan: FoldPlanner, mode: FoldMode, options: { signal?: AbortSignal } = {}) {
  const run: Promise<string | null> = foldIntoSummary(threadId, plan, mode, options).catch((error: unknown) => {
    // Kept on the thread so the chat can show it; a request that was stopped is not a failure.
    if (!options.signal?.aborted) CodexChatStore.setSummaryError(threadId, (error instanceof Error ? error.message : String(error)).slice(0, 500))
    throw error
  }).finally(() => {
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
  return inBackground(() => startFold(threadId, directPlanner(profile, 'ahead', { tools }), 'ahead'))
}

/**
 * After a room's run: fold the oldest messages beyond the window limit (a batch at a time), so the summary stands in
 * for what the members no longer see. Nothing while the room's summary is off or one is running.
 */
export function summarizeGroupAhead(threadId: number, members: ChatProfile[], window: number) {
  if (summaryRuns.has(threadId)) {
    return Promise.resolve(null)
  }
  return startFold(threadId, groupPlanner(members, window, 'ahead'), 'ahead')
}

/** The room's summarize button: fold everything not summarized yet. Null when nothing is new or a summary is running. */
export function summarizeGroupAll(threadId: number, members: ChatProfile[], window: number) {
  if (summaryRuns.has(threadId)) {
    return Promise.resolve(null)
  }
  return startFold(threadId, groupPlanner(members, window, 'all'), 'all')
}

/**
 * Before a request: wait for a summary still running, then fold whatever would still not fit, so no turn leaves the
 * window unsummarized. If summarizing fails, the request goes on and the oldest turns are dropped instead.
 */
export async function fitThreadSummary(threadId: number, profile: ChatProfile, messages: CodexChatMessageRecord[], signal: AbortSignal, tools: ChatCompletionTool[], extras: RequestExtras = {}) {
  const running = summaryRuns.get(threadId)
  if (running) {
    await untilAborted(running.catch(() => null), signal)
  }
  if (summaryRuns.has(threadId)) {
    return
  }
  try {
    await startFold(threadId, directPlanner(profile, 'overflow', { messages, tools, extras }), 'overflow', { signal })
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
  return startFold(threadId, directPlanner(profile, 'all', {}), 'all')
}
