import { createHash } from 'crypto'
import { REPLY_GUIDANCE } from './chatReplies'
import type { ChatProfile } from './chatProfiles'
import { loadChatSettings } from './chatSettings'
import { OUTCOME_KEY, PAGE_VIEW_KEY } from './chatPageContext'
import { blockStateHash, blockStateText, foldBlockState, parseBlockEdits } from './chatBlockState'
import { authorNoteText, estimateTokens, fillCharacterPlaceholders, resolveAuthorNote, type ChatContextMeta } from './llmChatContext'
import { contextSections, limitContextMeta, loreDiagnostics, type ContextSource } from './chatContextDiagnostics'
import { booksForRequest, hasLoreFiles, loreIndexText, selectRequestLore } from './chatLoreContext'
import { rejectedLoreLine } from './chatLoreProposals'
import { userPersonaPrompt, type ChatUserPersona } from './chatUserProfiles'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from './codexChatStore'

/**
 * What a chat engine that keeps its own memory (a Codex thread, a Claude Code session) is given once: lore, the
 * author's note, the user persona, block state, set-aside lore and the reply rules go in a turn's input when they are
 * new or changed, tracked as sent keys on the chat (cleared when the memory is compacted or reset), and a new memory
 * is told the past once (codexHistoryRecap).
 */

/** Lore keys remembered per chat; more than this only means some lore may be given again. */
const LORE_SENT_MAX_KEYS = 500

export function readLoreSent(value: string | null) {
  try {
    const parsed: unknown = JSON.parse(value || '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

/**
 * The author's note to put in this turn's input: Codex keeps every input in its memory, so the note goes in once and
 * again only when its text changes (or after a compaction clears the sent keys) — tracked like lore, as `note:<hash>`.
 */
export function pendingAuthorNote(thread: Pick<CodexChatThreadRecord, 'author_note' | 'author_note_depth'> | null, profile: ChatProfile, sent: Set<string>, user: ChatUserPersona) {
  const text = authorNoteText(resolveAuthorNote(thread, profile, user))
  if (!text) return { text: '', keys: [] as string[] }
  const key = `note:${createHash('sha1').update(text).digest('hex').slice(0, 10)}`
  return sent.has(key) ? { text: '', keys: [] } : { text, keys: [key] }
}

const RECAP_MESSAGES = 40
const RECAP_CHARS = 16_000

/**
 * What a new Codex thread is told of a chat it did not take part in (a branch, an import, a chat whose Codex memory was
 * reset): its summary and its last messages, once. Empty when there is no conversation yet (a greeting alone).
 */
export function codexHistoryRecap(thread: Pick<CodexChatThreadRecord, 'summary'> | null, earlier: CodexChatMessageRecord[], profile: ChatProfile, user: ChatUserPersona) {
  const messages = earlier.filter((message) => message.content.trim())
  if (!messages.some((message) => message.role === 'user')) return ''
  let transcript = messages.slice(-RECAP_MESSAGES).map((message) => `${message.role === 'user' ? user.name : profile.name}: ${message.content.trim()}`).join('\n\n')
  if (transcript.length > RECAP_CHARS) transcript = `…${transcript.slice(-RECAP_CHARS)}`
  const summary = thread?.summary?.trim()
  return [
    '[이전 기록] 이 대화는 아래에서 이어져. 네 기억에는 없지만 실제로 나눈 대화야. 이어서 자연스럽게 답해.',
    summary ? `## 그 전의 요약\n${summary}` : '',
    `## 최근 대화\n${transcript}`,
    '[/이전 기록]',
  ].filter(Boolean).join('\n\n')
}

const LORE_INDEX_KEY = 'lore-index:'
/** Pinned memories as Codex was given them before they became chat book entries. */
const OLD_MEMORY_KEY = 'memory:'

/**
 * The lore index with the "always on" entries (see loreIndexText), given to Codex the same way as the note: once, and
 * again when it changes (or after a compaction), tracked as `lore-index:<hash>`. Codex may still hold an earlier index,
 * or pinned memories from before they moved into the chat book: this one replaces them.
 */
export function pendingLoreIndex(text: string, sent: Set<string>) {
  const replacing = [...sent].some((key) => key.startsWith(LORE_INDEX_KEY) || key.startsWith(OLD_MEMORY_KEY))
  if (!text && !replacing) return { text: '', keys: [] as string[] }
  const key = `${LORE_INDEX_KEY}${text ? createHash('sha1').update(text).digest('hex').slice(0, 10) : 'none'}`
  if (sent.has(key)) return { text: '', keys: [] as string[] }
  const body = text
    ? (replacing ? `${text}\n(로어북 목차와 상시 항목이 바뀌었어. 이전에 받은 목차·상시 항목·고정 기억 대신 이걸 따라.)` : text)
    : '## 로어북 목차\n(붙은 로어북이 없어. 이전에 받은 목차·상시 항목·고정 기억은 따르지 마.)'
  return { text: body, keys: [key] }
}

/**
 * The sent keys after this turn: an index given now supersedes every earlier one (and old pinned memories); the screen
 * and the card outcomes are "the latest one given", so a newer one replaces the older key.
 */
export function nextLoreSent(sent: Set<string>, keys: string[]) {
  const superseded = keys.some((key) => key.startsWith(LORE_INDEX_KEY))
  const replaces = [PAGE_VIEW_KEY, OUTCOME_KEY].filter((prefix) => keys.some((key) => key.startsWith(prefix)))
  const kept = [...sent].filter((key) => !(superseded && (key.startsWith(LORE_INDEX_KEY) || key.startsWith(OLD_MEMORY_KEY))) && !replaces.some((prefix) => key.startsWith(prefix)))
  return [...kept, ...keys].slice(-LORE_SENT_MAX_KEYS)
}

const REPLY_GUIDE_KEY = 'reply-guide:'
/** The reply-metadata rules: fixed text, so Codex is given it once (and again after a compaction). */
export function pendingReplyGuidance(sent: Set<string>) {
  const key = `${REPLY_GUIDE_KEY}${createHash('sha1').update(REPLY_GUIDANCE).digest('hex').slice(0, 10)}`
  return sent.has(key) ? { text: '', keys: [] as string[] } : { text: REPLY_GUIDANCE, keys: [key] }
}

/**
 * The lore of one Codex turn: the books the chat and the profile attach (a room's: the room's books and the member's
 * own), keyword entries not yet given (files only through read_lore_file, which a Codex session always has), and the
 * index to give if it changed.
 */
export function pendingLore(thread: CodexChatThreadRecord | null, profile: ChatProfile, messages: CodexChatMessageRecord[], sent: Set<string>, user: ChatUserPersona) {
  const books = booksForRequest({ thread, profile })
  const lore = selectRequestLore(profile, books, messages, (value) => estimateTokens(profile.id, value), (value) => fillCharacterPlaceholders(value, profile, user), {
    toolOffered: hasLoreFiles(books),
    inlineFiles: false,
    skip: (key) => sent.has(key),
  })
  return { keyed: lore.keyed, keyedKeys: lore.keyedKeys, index: pendingLoreIndex(loreIndexText(lore), sent), selected: lore }
}

/** Only CoNAI's input is observable; Codex's accumulated/compacted context is opaque. */
export function codexInputMeta(profile: ChatProfile, messages: CodexChatMessageRecord[], lore: ReturnType<typeof pendingLore>, input: string, keys: string[], sources: ContextSource[], droppedTurns = 0): ChatContextMeta {
  const decisions = lore.selected.decisions.map((decision) => decision.reason === 'constant' && !lore.index.keys.length ? { ...decision, selected: false, reason: 'codex-sent' } : decision)
  const meta: ChatContextMeta = {
    model: profile.model || null, windowFromMessageId: messages[0]?.id ?? null, sentMessages: messages.length,
    summaryUntilMessageId: null, recalledSegments: 0, lore: decisions.filter((decision) => decision.selected).map((decision) => decision.title),
    memories: decisions.filter((decision) => decision.selected && decision.reason === 'constant').length, estimatedTokens: estimateTokens(profile.id, input),
  }
  if (!loadChatSettings().diagnostics.enabled) return limitContextMeta(meta)
  return limitContextMeta({ ...meta, version: 2, engine: 'codex', opaqueContext: true, profileId: profile.id,
    sections: contextSections([{ role: 'user', content: input }], [], (text) => estimateTokens(profile.id, text)),
    sources, codexKeys: keys, ...loreDiagnostics(decisions, lore.selected.unmatched),
    recall: [], window: { fromId: meta.windowFromMessageId, sent: messages.length, droppedTurns }, toolRounds: 0,
  })
}

/**
 * Who the user is (the chat's user profile), given to Codex the same way as the note: once, and again when the
 * profile changes or after a compaction. Codex's fixed instructions are frozen at thread start, so it cannot go there.
 */
export function pendingUserPersona(user: ChatUserPersona, sent: Set<string>) {
  const text = userPersonaPrompt(user)
  if (!text) return { text: '', keys: [] as string[] }
  const key = `user:${createHash('sha1').update(text).digest('hex').slice(0, 10)}`
  return sent.has(key) ? { text: '', keys: [] } : { text, keys: [key] }
}

/**
 * The display block state to put in this turn's input: given again only when it changed since it was last given
 * (or after a compaction), tracked as `state:<hash>` beside the lore keys.
 */
export function pendingBlockState(thread: Pick<CodexChatThreadRecord, 'block_edits'> | null, profile: ChatProfile, messages: CodexChatMessageRecord[], sent: Set<string>, speakerId?: number) {
  const folded = foldBlockState(profile, messages, parseBlockEdits(thread?.block_edits), speakerId)
  const text = folded ? blockStateText(profile.style.blocks, folded.state) : ''
  if (!text) return { text: '', keys: [] as string[] }
  const key = `state:${blockStateHash(text)}`
  return sent.has(key) ? { text: '', keys: [] } : { text, keys: [key] }
}

/**
 * The lore titles a person set aside in this chat (see rejectedLoreLine), for a profile that may propose lore: given
 * again only when the list changed (or after a compaction), tracked as `rejected-lore:<hash>`.
 */
export function pendingRejectedLore(threadId: number, profile: ChatProfile, sent: Set<string>) {
  const text = profile.allowLoreProposals ? rejectedLoreLine(threadId) : ''
  if (!text) return { text: '', keys: [] as string[] }
  const key = `rejected-lore:${createHash('sha1').update(text).digest('hex').slice(0, 10)}`
  return sent.has(key) ? { text: '', keys: [] } : { text, keys: [key] }
}
