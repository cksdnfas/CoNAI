import type { JudgedContext } from './chatJudgeContext'
import { chatWorkspace, workspaceInstructions } from './chatWorkspace'
import { applyChatInstructionHooks } from '../plugins/pluginServerRuntime'
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
import { profileContentLimit } from './chatContentRating'
import type { ChatProfile } from './chatProfiles'
import { buildReplyContext } from './chatReplyContext'
import { codexHistoryRecap, codexInputMeta, nextLoreSent, pendingAgentResults, pendingAuthorNote, pendingBlockState, prepareSessionLore, pendingRejectedLore, readLoreSent } from './chatSessionMemory'
import { userPersonaForThread } from './chatUserProfiles'
import { claudeChatPrivateRoot, claudeSessionFileExists, type ClaudeChatSession } from './claudeChatCompletion'
import { piChatPrivateRoot, piSessionFileExists } from './piChatCompletion'
import { pendingGenerationOutcomes } from './codexChatMedia'
import { CodexChatStore, type ChatHistorySource, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { buildGroupCodexInput, buildGroupHeader, groupMissedMessages, type GroupHistory } from './groupChatContext'
import type { ChatCompletionMessage, ChatContentPart } from './llmChatCompletion'
import { buildPersonaPrompt, fixedContextGuidance, flagDirectiveFor, postHistoryText, referenceBlock, resolveAuthorNote, type ChatContextMeta } from './llmChatContext'

/**
 * Claude Code direct chats keep their memory as a Claude Code session, like a Codex chat keeps its thread: each turn
 * sends only the new message and what the session was not given yet (lore, note, state, results, pictures — tracked
 * as sent keys, see chatSessionMemory), so the provider's prompt cache holds the whole conversation. The session lives
 * in the chat's own folder; the chat stores which one it is on as `claude:<session id>:<system prompt hash>` in the
 * Codex thread column, so every history rewrite that resets a Codex thread starts a new session too. A new session
 * (first turn, rewritten history, changed system prompt, lost files) is told the past once (codexHistoryRecap).
 *
 * API LLM profiles that run through pi (ChatLlmRuntime 'pi', piChatCompletion.ts) keep their chats the same way, as
 * `pi:<session file id>:<system prompt hash>`, in a folder of their own.
 */

/** The agent that keeps a chat's session (sessionRuntimeOf). */
export type SessionRuntime = 'claude' | 'pi'
/** A session a turn continues, with the agent it belongs to. */
export type EngineSession = ClaudeChatSession & { runtime: SessionRuntime }

const SESSION_VALUE: Record<SessionRuntime, RegExp> = {
  claude: /^claude:([0-9a-f-]{36}):([0-9a-f]{12})$/,
  pi: /^pi:([\w.-]{1,160}):([0-9a-f]{12})$/,
}

export function readClaudeSession(value: string | null | undefined, runtime: SessionRuntime = 'claude') {
  const match = value ? SESSION_VALUE[runtime].exec(value) : null
  return match ? { id: match[1], systemHash: match[2] } : null
}

/** A Claude Code or pi session kept in the Codex thread column (not a Codex thread). */
export function isClaudeSessionValue(value: string | null | undefined) {
  return Boolean(value?.startsWith('claude:') || value?.startsWith('pi:'))
}

export function claudeSessionDir(threadId: number, runtime: SessionRuntime = 'claude') {
  return path.join(runtime === 'pi' ? piChatPrivateRoot() : claudeChatPrivateRoot(), 'sessions', `thread-${threadId}`)
}

/** A group room member's own session: one per room and profile. */
export function claudeMemberSessionDir(threadId: number, profileId: number, runtime: SessionRuntime = 'claude') {
  return path.join(claudeSessionDir(threadId, runtime), `member-${profileId}`)
}

export function deleteClaudeMemberSession(threadId: number, profileId: number) {
  for (const runtime of ['claude', 'pi'] as const) fs.rmSync(claudeMemberSessionDir(threadId, profileId, runtime), { recursive: true, force: true })
}

/** A chat that is deleted or cleared drops its sessions with it (a room's members' sessions too), Claude's and pi's. */
export function deleteClaudeSessions(threadId: number) {
  for (const runtime of ['claude', 'pi'] as const) fs.rmSync(claudeSessionDir(threadId, runtime), { recursive: true, force: true })
}

/** The session's fixed part, recorded on its first turn (Claude Code reuses it as is): guidance, then the persona. */
export function claudeSessionSystem(profile: ChatProfile, withTools: boolean, user: ReturnType<typeof userPersonaForThread>) {
  return [fixedContextGuidance(profile, withTools), buildPersonaPrompt(profile, { dialogueAsText: true, user })].filter(Boolean).join('\n\n')
}

const systemHashOf = (system: string) => createHash('sha1').update(system).digest('hex').slice(0, 12)

/** The session a turn continues: the stored one, unless it is another agent's, its fixed part changed or its files are gone. */
function resumableSession(value: string | null | undefined, systemHash: string, dir: string, runtime: SessionRuntime) {
  const stored = readClaudeSession(value, runtime)
  if (!stored || stored.systemHash !== systemHash) return null
  return (runtime === 'pi' ? piSessionFileExists(dir, stored.id) : claudeSessionFileExists(path.join(dir, 'home'), stored.id)) ? stored.id : null
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
  historySource?: ChatHistorySource
  page?: ChatPageSnapshot
  withTools: boolean
  judged?: JudgedContext | null
  runtime?: SessionRuntime
  signal?: AbortSignal
}): Promise<{ messages: ChatCompletionMessage[]; session: EngineSession; contextMeta: ChatContextMeta }> {
  const { requester, threadId, profile, history } = params
  const runtime = params.runtime ?? 'claude'
  const thread = CodexChatStore.findThreadById(threadId) ?? null
  const user = userPersonaForThread(thread)
  const workspace = chatWorkspace(requester, threadId, profile.id)
  // Plugins may rewrite it; a changed system prompt starts a new session (systemHash).
  const system = await applyChatInstructionHooks([claudeSessionSystem(profile, params.withTools, user), workspaceInstructions(workspace)].filter(Boolean).join('\n\n'), { engine: runtime, threadId, group: false, profile: { id: profile.id, name: profile.name } }, requester)
  const systemHash = systemHashOf(system)
  const baseDir = claudeSessionDir(threadId, runtime)
  const dir = workspace ? path.join(baseDir, 'projects', workspace.project.id) : baseDir
  const resumeId = resumableSession(thread?.codex_thread_id, systemHash, dir, runtime)
  const sent = resumeId ? readLoreSent(thread?.codex_lore_sent ?? null) : new Set<string>()

  const latest = [...history].reverse().find((message) => message.role === 'user') ?? null
  const earlier = latest ? history.filter((message) => message.id < latest.id) : history
  const recap = resumeId ? '' : codexHistoryRecap(thread, earlier, profile, user, params.historySource, latest?.id)
  const lore = await prepareSessionLore(thread, profile, history, sent, user, params.judged, params.signal, params.historySource)
  const note = pendingAuthorNote(thread, profile, sent, user)
  const state = pendingBlockState(thread, profile, history, sent, undefined, params.historySource)
  const rejected = pendingRejectedLore(threadId, profile, sent)
  const outcomes = pendingGenerationOutcomes(threadId, earlier, sent, params.historySource ? { source: params.historySource, before: latest?.id } : undefined)
  const pageReference = pendingPageReference(params.page, requester, sent, profileContentLimit(profile))
  const cards = pendingProposalOutcomes(threadId, sent)
  const agentResults = latest ? pendingAgentResults(threadId, latest.id, sent, { recap: !resumeId || Boolean(recap) }) : { text: '', keys: [] }
  const [generated, images, attachmentTexts] = await Promise.all([
    pendingGeneratedImages(profile, requester, threadId, sent),
    latest ? loadAttachedImages(profile, requester, [latest]) : null,
    latest ? inlineTextsForChat(profile, requester.accountId, [latest]) : undefined,
  ])
  const body = latest ? chatContentWithAttachments(latest.content, latest.attachments, latest.mediaAttachments, attachmentTexts, images) : ''
  const directive = [flagDirectiveFor(history, profile, user), postHistoryText(profile, user)].filter(Boolean).join('\n\n')
  const text = [
    recap,
    agentResults.text,
    referenceBlock([lore.index.text, lore.keyed, rejected.text, note.text, state.text, outcomes.text]),
    buildReplyContext(history, latest?.routing, { historySource: params.historySource }),
    pageReference.text,
    cards.text,
    body,
    directive,
    generated.text,
  ].filter(Boolean).join('\n\n')
  const urls = [...(latest ? attachedImagesOf(latest, images) : []), ...generated.urls]
  const keys = [...lore.index.keys, ...lore.keyedKeys, ...rejected.keys, ...note.keys, ...state.keys, ...outcomes.keys, ...pageReference.keys, ...cards.keys, ...generated.keys, ...agentResults.keys]
  const content: string | ChatContentPart[] = urls.length ? [{ type: 'text', text }, ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } }))] : text

  const session: EngineSession = {
    runtime,
    dir,
    resumeId,
    onDone: (sessionId, compacted) => {
      const value = `${runtime}:${sessionId}:${systemHash}`
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
  history?: GroupHistory
  routing?: ChatMessageRouting
  windowLimit: number
  withTools: boolean
  attachmentTexts?: ReadonlyMap<string, string>
  attachedImages?: AttachedImages
  judged?: JudgedContext | null
  runtime?: SessionRuntime
  signal?: AbortSignal
}): Promise<{ messages: ChatCompletionMessage[]; session: EngineSession; contextMeta: ChatContextMeta }> {
  const { requester, thread, members, profile, messages } = params
  const runtime = params.runtime ?? 'claude'
  const user = userPersonaForThread(thread)
  const system = await applyChatInstructionHooks([claudeSessionSystem(profile, params.withTools, user), buildGroupHeader({ thread, members, self: profile, user })].join('\n\n'), { engine: runtime, threadId: thread.id, group: true, profile: { id: profile.id, name: profile.name } }, requester)
  const systemHash = systemHashOf(system)
  const dir = claudeMemberSessionDir(thread.id, profile.id, runtime)
  const member = ChatGroupStore.member(thread.id, profile.id)
  const resumeId = resumableSession(member?.codex_thread_id, systemHash, dir, runtime)
  const sent = resumeId ? readLoreSent(member?.codex_lore_sent ?? null) : new Set<string>()
  const lastSeen = resumeId ? member?.last_seen_message_id ?? null : null

  const lore = await prepareSessionLore(thread, profile, messages, sent, user, params.judged, params.signal, params.history?.source)
  const note = pendingAuthorNote(thread, profile, sent, user)
  const state = pendingBlockState(thread, profile, messages, sent, profile.id, params.history?.source)
  const rejected = pendingRejectedLore(thread.id, profile, sent)
  const outcomes = pendingGenerationOutcomes(thread.id, messages.filter((message) => message.speaker_profile_id === profile.id), sent, params.history ? { source: params.history.source, speakerId: profile.id } : undefined)
  const { missed, shown } = groupMissedMessages(messages, profile.id, lastSeen, params.windowLimit, params.history)
  const [generated, attachmentTexts, attachedImages] = await Promise.all([
    pendingGeneratedImages(profile, requester, thread.id, sent),
    params.attachmentTexts ?? inlineTextsForChat(profile, requester.accountId, shown),
    params.attachedImages === undefined ? loadAttachedImages(profile, requester, shown) : params.attachedImages,
  ])
  const flags = flagDirectiveFor(messages, profile, user)
  const text = buildGroupCodexInput({
    thread, members, self: profile, messages, history: params.history, routing: params.routing, lastSeenMessageId: lastSeen, windowLimit: params.windowLimit,
    lore: [lore.index.text, lore.keyed, rejected.text, note.text, state.text, outcomes.text, generated.text].filter(Boolean).join('\n\n'),
    directive: [flags, postHistoryText(profile, user)].filter(Boolean).join('\n\n'),
    attachmentTexts, attachedImages, header: false,
  })
  const urls = [...shown.filter((message) => message.role === 'user').flatMap((message) => attachedImagesOf(message, attachedImages)), ...generated.urls]
  const keys = [...lore.index.keys, ...lore.keyedKeys, ...rejected.keys, ...note.keys, ...state.keys, ...outcomes.keys, ...generated.keys]
  const content: string | ChatContentPart[] = urls.length ? [{ type: 'text', text }, ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } }))] : text
  const seen = messages.at(-1)?.id ?? 0

  const session: EngineSession = {
    runtime,
    dir,
    resumeId,
    // A folded memory lost what it was given: everything goes in again from the next turn.
    onDone: (sessionId, compacted) => ChatGroupStore.setMemberClaudeSession(thread.id, profile.id, `${runtime}:${sessionId}:${systemHash}`, compacted ? null : nextLoreSent(sent, keys), seen),
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
