import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import type { ChatMessageRouting, ChatPageSnapshot } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'
import { attachedImagesOf, chatContentWithAttachments, inlineTextsForChat, loadAttachedImages, type AttachedImages } from './chatAttachments'
import { contextSource } from './chatContextDiagnostics'
import { pendingGeneratedImages } from './chatGenerationPrompting'
import { ChatGroupStore } from './chatGroupStore'
import { pendingPageReference, pendingProposalOutcomes } from './chatPageContext'
import type { ChatProfile } from './chatProfiles'
import { buildReplyContext } from './chatReplyContext'
import { codexHistoryRecap, codexInputMeta, nextLoreSent, pendingAuthorNote, pendingBlockState, pendingLore, pendingRejectedLore, readLoreSent } from './chatSessionMemory'
import { userPersonaForThread } from './chatUserProfiles'
import { claudeChatPrivateRoot, claudeSessionFileExists, type ClaudeChatSession } from './claudeChatCompletion'
import { pendingGenerationOutcomes } from './codexChatMedia'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { buildGroupCodexInput, buildGroupHeader, groupMissedMessages } from './groupChatContext'
import type { ChatCompletionMessage, ChatContentPart } from './llmChatCompletion'
import { buildPersonaPrompt, fixedContextGuidance, flagDirectiveFor, postHistoryText, referenceBlock, resolveAuthorNote, type ChatContextMeta } from './llmChatContext'

/**
 * Claude Code direct chats keep their memory as a Claude Code session, like a Codex chat keeps its thread: each turn
 * sends only the new message and what the session was not given yet (lore, note, state, results, pictures — tracked
 * as sent keys, see chatSessionMemory), so the provider's prompt cache holds the whole conversation. The session lives
 * in the chat's own folder; the chat stores which one it is on as `claude:<session id>:<system prompt hash>` in the
 * Codex thread column, so every history rewrite that resets a Codex thread starts a new session too. A new session
 * (first turn, rewritten history, changed system prompt, lost files) is told the past once (codexHistoryRecap).
 */

const SESSION_PREFIX = 'claude:'
const SESSION_VALUE = /^claude:([0-9a-f-]{36}):([0-9a-f]{12})$/

export function readClaudeSession(value: string | null | undefined) {
  const match = value ? SESSION_VALUE.exec(value) : null
  return match ? { id: match[1], systemHash: match[2] } : null
}

export function isClaudeSessionValue(value: string | null | undefined) {
  return Boolean(value?.startsWith(SESSION_PREFIX))
}

export function claudeSessionDir(threadId: number) {
  return path.join(claudeChatPrivateRoot(), 'sessions', `thread-${threadId}`)
}

/** A group room member's own session: one per room and profile. */
export function claudeMemberSessionDir(threadId: number, profileId: number) {
  return path.join(claudeSessionDir(threadId), `member-${profileId}`)
}

export function deleteClaudeMemberSession(threadId: number, profileId: number) {
  fs.rmSync(claudeMemberSessionDir(threadId, profileId), { recursive: true, force: true })
}

/** A chat that is deleted or cleared drops its sessions with it (a room's members' sessions too). */
export function deleteClaudeSessions(threadId: number) {
  fs.rmSync(claudeSessionDir(threadId), { recursive: true, force: true })
}

/** The session's fixed part, recorded on its first turn (Claude Code reuses it as is): guidance, then the persona. */
export function claudeSessionSystem(profile: ChatProfile, withTools: boolean, user: ReturnType<typeof userPersonaForThread>) {
  return [fixedContextGuidance(profile, withTools), buildPersonaPrompt(profile, { dialogueAsText: true, user })].filter(Boolean).join('\n\n')
}

const systemHashOf = (system: string) => createHash('sha1').update(system).digest('hex').slice(0, 12)

/** The session a turn continues: the stored one, unless its fixed part changed or its files are gone. */
function resumableSession(value: string | null | undefined, systemHash: string, dir: string) {
  const stored = readClaudeSession(value)
  return stored && stored.systemHash === systemHash && claudeSessionFileExists(path.join(dir, 'home'), stored.id) ? stored.id : null
}

/**
 * One Claude session turn of a direct chat: the request (the fixed system part and the new input), the session it
 * continues, and what it carried. The session moves on (and the sent keys with it) only once the turn went through.
 */
export async function buildClaudeSessionTurn(params: {
  requester: McpRequester
  threadId: number
  profile: ChatProfile
  /** The conversation up to and with the message being answered (the reply being replaced left out). */
  history: CodexChatMessageRecord[]
  page?: ChatPageSnapshot
  withTools: boolean
}): Promise<{ messages: ChatCompletionMessage[]; session: ClaudeChatSession; contextMeta: ChatContextMeta }> {
  const { requester, threadId, profile, history } = params
  const thread = CodexChatStore.findThreadById(threadId) ?? null
  const user = userPersonaForThread(thread)
  const system = claudeSessionSystem(profile, params.withTools, user)
  const systemHash = systemHashOf(system)
  const dir = claudeSessionDir(threadId)
  const resumeId = resumableSession(thread?.codex_thread_id, systemHash, dir)
  const sent = resumeId ? readLoreSent(thread?.codex_lore_sent ?? null) : new Set<string>()

  const latest = [...history].reverse().find((message) => message.role === 'user') ?? null
  const earlier = latest ? history.filter((message) => message.id < latest.id) : history
  const recap = resumeId ? '' : codexHistoryRecap(thread, earlier, profile, user)
  const lore = pendingLore(thread, profile, history, sent, user)
  const note = pendingAuthorNote(thread, profile, sent, user)
  const state = pendingBlockState(thread, profile, history, sent)
  const rejected = pendingRejectedLore(threadId, profile, sent)
  const outcomes = pendingGenerationOutcomes(threadId, earlier, sent)
  const pageReference = pendingPageReference(params.page, requester, sent)
  const cards = pendingProposalOutcomes(threadId, sent)
  const generated = await pendingGeneratedImages(profile, requester, threadId, sent)
  const images = latest ? await loadAttachedImages(profile, requester, [latest]) : null
  const body = latest ? chatContentWithAttachments(latest.content, latest.attachments, latest.mediaAttachments, await inlineTextsForChat(profile, requester.accountId, [latest]), images) : ''
  const directive = [flagDirectiveFor(history, profile, user), postHistoryText(profile, user)].filter(Boolean).join('\n\n')
  const text = [
    recap,
    referenceBlock([lore.index.text, lore.keyed, rejected.text, note.text, state.text, outcomes.text]),
    buildReplyContext(history, latest?.routing),
    pageReference.text,
    cards.text,
    body,
    directive,
    generated.text,
  ].filter(Boolean).join('\n\n')
  const urls = [...(latest ? attachedImagesOf(latest, images) : []), ...generated.urls]
  const keys = [...lore.index.keys, ...lore.keyedKeys, ...rejected.keys, ...note.keys, ...state.keys, ...outcomes.keys, ...pageReference.keys, ...cards.keys, ...generated.keys]
  const content: string | ChatContentPart[] = urls.length ? [{ type: 'text', text }, ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } }))] : text

  const session: ClaudeChatSession = {
    dir,
    resumeId,
    onDone: (sessionId, compacted) => {
      const value = `${SESSION_PREFIX}${sessionId}:${systemHash}`
      CodexChatStore.setCodexThreadId(threadId, value)
      // A folded memory lost what it was given: everything goes in again from the next turn.
      if (compacted) CodexChatStore.markCodexCompacted(value, earlier.at(-1)?.id ?? null)
      else CodexChatStore.setCodexLoreSent(threadId, nextLoreSent(sent, keys))
    },
  }
  const contextMeta = codexInputMeta(profile, latest ? [latest] : [], lore, text, keys, [
    ...contextSource('lore-index', lore.index.keys.length ? lore.selected.index : ''),
    ...contextSource('constant-lore', lore.index.keys.length ? lore.selected.constant : ''),
    ...contextSource('author-note', note.text ? resolveAuthorNote(thread, profile, user).text : ''),
    ...contextSource('state', state.text),
    ...(latest ? contextSource('window', latest.content, latest.id) : []),
    ...contextSource('flags', flagDirectiveFor(history, profile, user), latest?.id),
  ])
  return { messages: [{ role: 'system', content: system }, { role: 'user', content }], session, contextMeta }
}

/**
 * One Claude member's turn in a group room, in that member's own session (one per room and profile), like a Codex
 * member's thread: the room header sits in the fixed part, and each turn sends what the member missed since it last
 * spoke plus what its session was not given yet. A new session (first turn, memory reset, changed prompt or member
 * list) gets the room's recent window instead. The member's sent keys, session and last seen message are kept in its
 * room membership.
 */
export async function buildClaudeGroupSessionTurn(params: {
  requester: McpRequester
  thread: CodexChatThreadRecord
  members: ChatProfile[]
  profile: ChatProfile
  /** The room up to now (the reply being replaced left out). */
  messages: CodexChatMessageRecord[]
  routing?: ChatMessageRouting
  windowLimit: number
  withTools: boolean
  attachmentTexts?: ReadonlyMap<string, string>
  attachedImages?: AttachedImages
}): Promise<{ messages: ChatCompletionMessage[]; session: ClaudeChatSession; contextMeta: ChatContextMeta }> {
  const { requester, thread, members, profile, messages } = params
  const user = userPersonaForThread(thread)
  const system = [claudeSessionSystem(profile, params.withTools, user), buildGroupHeader({ thread, members, self: profile, user })].join('\n\n')
  const systemHash = systemHashOf(system)
  const dir = claudeMemberSessionDir(thread.id, profile.id)
  const member = ChatGroupStore.member(thread.id, profile.id)
  const resumeId = resumableSession(member?.codex_thread_id, systemHash, dir)
  const sent = resumeId ? readLoreSent(member?.codex_lore_sent ?? null) : new Set<string>()
  const lastSeen = resumeId ? member?.last_seen_message_id ?? null : null

  const lore = pendingLore(thread, profile, messages, sent, user)
  const note = pendingAuthorNote(thread, profile, sent, user)
  const state = pendingBlockState(thread, profile, messages, sent, profile.id)
  const rejected = pendingRejectedLore(thread.id, profile, sent)
  const outcomes = pendingGenerationOutcomes(thread.id, messages.filter((message) => message.speaker_profile_id === profile.id), sent)
  const generated = await pendingGeneratedImages(profile, requester, thread.id, sent)
  const flags = flagDirectiveFor(messages, profile, user)
  const text = buildGroupCodexInput({
    thread, members, self: profile, messages, routing: params.routing, lastSeenMessageId: lastSeen, windowLimit: params.windowLimit,
    lore: [lore.index.text, lore.keyed, rejected.text, note.text, state.text, outcomes.text, generated.text].filter(Boolean).join('\n\n'),
    directive: [flags, postHistoryText(profile, user)].filter(Boolean).join('\n\n'),
    attachmentTexts: params.attachmentTexts, attachedImages: params.attachedImages, header: false,
  })
  const { missed, shown } = groupMissedMessages(messages, profile.id, lastSeen, params.windowLimit)
  const urls = [...shown.filter((message) => message.role === 'user').flatMap((message) => attachedImagesOf(message, params.attachedImages)), ...generated.urls]
  const keys = [...lore.index.keys, ...lore.keyedKeys, ...rejected.keys, ...note.keys, ...state.keys, ...outcomes.keys, ...generated.keys]
  const content: string | ChatContentPart[] = urls.length ? [{ type: 'text', text }, ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } }))] : text
  const seen = messages.at(-1)?.id ?? 0

  const session: ClaudeChatSession = {
    dir,
    resumeId,
    // A folded memory lost what it was given: everything goes in again from the next turn.
    onDone: (sessionId, compacted) => ChatGroupStore.setMemberClaudeSession(thread.id, profile.id, `${SESSION_PREFIX}${sessionId}:${systemHash}`, compacted ? null : nextLoreSent(sent, keys), seen),
  }
  const contextMeta = codexInputMeta(profile, shown, lore, text, keys, [
    ...contextSource('lore-index', lore.index.keys.length ? lore.selected.index : ''),
    ...contextSource('constant-lore', lore.index.keys.length ? lore.selected.constant : ''),
    ...contextSource('author-note', note.text ? resolveAuthorNote(thread, profile, user).text : ''),
    ...contextSource('state', state.text),
    ...shown.flatMap((message) => contextSource('window', message.content, message.id)),
    ...contextSource('flags', flags, [...messages].reverse().find((message) => message.role === 'user')?.id),
  ], missed.length - shown.length)
  return { messages: [{ role: 'system', content: system }, { role: 'user', content }], session, contextMeta }
}
