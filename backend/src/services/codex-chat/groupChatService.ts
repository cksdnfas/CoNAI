import { validateChatMediaAttachments } from './chatMediaAttachments'
import { randomUUID } from 'crypto'
import type { ChatExecutionContext, ChatMessageRouting, ChatRecipient } from '@conai/shared'
import { automaticReplyRouting, messageSender, quoteMessage, requireReplyTarget, userReplyRouting } from './chatReplies'
import { registerChatReply, skipThreadGenerationReactions } from './chatReplyRegistry'
import type { McpRequester } from '../../mcp/context'
import { inlineTextsForChat, validateChatAttachments } from './chatAttachments'
import { ChatFlagStore, parseFlagIds, parsePicks } from './chatFlags'
import { foldGroupBlockState, parseBlockEdits } from './chatBlockState'
import { GROUP_LIMITS, GROUP_MEMBER_MAX, ChatGroupStore, groupLimitsOf } from './chatGroupStore'
import { ChatProfileStore, type ChatProfile } from './chatProfiles'
import { translateReply, translateUserInput, translatorOf } from './chatTranslation'
import { hasTranslation, resolveProfileModel } from './chatModelRoles'
import { stripEchoedAddresses } from '@conai/shared'
import { ChatUserProfileStore, userPersonaForThread, type ChatUserProfile } from './chatUserProfiles'
import { loadChatSettings } from './chatSettings'
import { limitContextMeta, legacyContextMeta } from './chatContextDiagnostics'
import { saveChatRequestCapture } from './chatRequestCaptures'
import { canUseChatProfile, resolveChatAccess } from './codexChatAccess'
import { CodexChatError, CodexChatService, deleteCodexRollout, runCodexGroupReply, type CodexChatStreamEvent } from './codexChatService'
import { CodexChatStore, type ChatBranchPurpose, type CodexChatMessageRecord, type CodexChatThreadRecord, type CodexChatToolCall } from './codexChatStore'
import { withGenerationOutcomes } from './codexChatMedia'
import { buildGroupCodexInput, buildGroupLlmMessages, groupSummaryOn, parseMentions, resolveMemberName, trimForeignSpeakerLines } from './groupChatContext'
import { CHAT_ROOM_TOOLS } from '../../mcp/context'
import { flagDirectiveFor, postHistoryText, groupSummarizer, summarizeGroupAhead, summarizeGroupAll } from './llmChatContext'
import { ChatSummaryStore } from './chatMemory'
import { branchChatThread } from './chatBranch'
import { LlmChatService, generateLlmGroupReply, type GroupReplyResult } from './llmChatService'
import { ExternalApiProvider } from '../../models/ExternalApiProvider'
import { readLlmConnectionConfig } from '../llmGenerationOptions'

const STOP_WAIT_MS = 8000
const TITLE_MAX_LENGTH = 60

/** One member answering now. */
type ActiveReply = {
  controller: AbortController
  text: string
  toolCalls: Map<string, CodexChatToolCall>
  routing: ChatMessageRouting
}

type Delivery = { profileId: number; sourceMessageId: number }

/**
 * A group room working through its reply queue. Members on the same LLM connection answer together up to the
 * connection's concurrent requests (one by default); Codex members answer one at a time.
 */
type GroupRun = {
  threadId: number
  /** Set by stop(): no further member is woken. */
  stopped: boolean
  /** Members answering now, in the order they started. */
  active: Map<number, ActiveReply>
  queue: Delivery[]
  chain: boolean
  chainLimit: number
  chainUsed: number
  reserved: Map<string, number[]>
  listeners: Set<(event: CodexChatStreamEvent) => void>
  finished: Promise<void>
}

const runs = new Map<number, GroupRun>()

function emit(run: GroupRun, event: CodexChatStreamEvent) {
  for (const listener of run.listeners) {
    try {
      listener(event)
    } catch {
      // A closed response must not break the room.
    }
  }
}

function assertGroupChatAvailable(requester: McpRequester) {
  if (!loadChatSettings().enabled) throw new CodexChatError('채팅이 꺼져 있어.', 403)
  const access = resolveChatAccess(requester.accountId)
  if (!access.llm && !access.codex && !access.claude) throw new CodexChatError('채팅 권한이 없어.', 403)
  return access
}

function requireGroup(requester: McpRequester, threadId: number) {
  const thread = CodexChatStore.findThread(threadId, requester.accountId)
  if (!thread) throw new CodexChatError('채팅을 찾을 수 없어.', 404)
  if (thread.kind !== 'group') throw new CodexChatError('그룹 방이 아니야.', 409)
  return thread
}

/** A reply token cap from a request body: null clears it, otherwise a whole number of tokens. */
function replyCapOf(value: unknown) {
  if (value === null) return null
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1 || number > 1_000_000) throw new CodexChatError('최대 출력 토큰은 1~1000000 사이로 정해줘.')
  return number
}

/** Member profiles that still exist, in room order. */
function memberProfiles(threadId: number) {
  return ChatGroupStore.members(threadId).flatMap((member) => {
    const profile = ChatProfileStore.find(member.profile_id)
    return profile ? [profile] : []
  })
}

/** Profiles this account can add to a room: enabled, its engine allowed, names distinct (mentions go by name). */
function assertJoinable(requester: McpRequester, profiles: ChatProfile[], existing: ChatProfile[] = []) {
  const access = assertGroupChatAvailable(requester)
  for (const profile of profiles) {
    if (!profile.isEnabled || !canUseChatProfile(access, profile)) throw new CodexChatError(`${profile.name} 프로필은 지금 쓸 수 없어.`, 409)
  }
  const all = [...existing, ...profiles]
  if (all.length > GROUP_MEMBER_MAX) throw new CodexChatError(`참가자는 ${GROUP_MEMBER_MAX}명까지야.`)
  const names = all.map((profile) => profile.name.trim().toLowerCase())
  if (new Set(names).size !== names.length) throw new CodexChatError('같은 이름의 프로필은 한 방에 함께 넣을 수 없어.')
}

/** The user's name in a room must not read as a member's mention (full name or first-word alias). */
function assertUserNameFree(user: ChatUserProfile | null, members: Pick<ChatProfile, 'id' | 'name'>[]) {
  if (user && resolveMemberName(user.name, members) !== null) throw new CodexChatError(`사용자 프로필 이름 "${user.name}"이 참가자 이름과 겹쳐. 다른 사용자 프로필을 고르거나 이름을 바꿔줘.`, 409)
}

function findMessage(threadId: number, messageId: number) {
  return CodexChatStore.listMessages(threadId).find((entry) => entry.id === messageId) as CodexChatMessageRecord
}

function userRecipients(requester: McpRequester, thread: CodexChatThreadRecord, text: string, routing: ChatMessageRouting) {
  const members = memberProfiles(thread.id)
  const mentioned = parseMentions(text, members)
  const target = routing.replyTo ? requireReplyTarget(thread.id, routing.replyTo.messageId) : null
  const addressed = target?.role === 'assistant' ? [target.speaker_profile_id] : target?.routing?.recipients.filter((id): id is number => typeof id === 'number') ?? []
  const ids = mentioned.length ? mentioned : addressed.length ? addressed : thread.profile_id ? [thread.profile_id] : []
  const access = assertGroupChatAvailable(requester)
  for (const id of ids) {
    const member = members.find((entry) => entry.id === id)
    if (!member?.isEnabled || !canUseChatProfile(access, member)) throw new CodexChatError('답장 받을 참가자가 없거나 지금 응답할 수 없어. 수신자를 다시 지정해줘.', 409)
  }
  return ids as number[]
}

/** Forget every Codex member's memory of the room (its history was rewritten or cleared). */
function resetCodexMemory(requester: McpRequester, threadId: number) {
  for (const codexThreadId of ChatGroupStore.resetCodexMemory(threadId)) deleteCodexRollout(requester, codexThreadId)
}

/**
 * One member's reply. LLM members get the room from their point of view (window of recent messages); Codex members
 * get what they missed since their last reply in their own Codex thread. Stored with its speaker; replaces the
 * message `replacingMessageId` as a new alternative when regenerating.
 */
async function replyAs(run: GroupRun, requester: McpRequester, profile: ChatProfile, sourceMessageId: number, replacingMessageId?: number): Promise<CodexChatMessageRecord> {
  const thread = CodexChatStore.findThreadById(run.threadId) as CodexChatThreadRecord
  const members = memberProfiles(run.threadId)
  const limits = groupLimitsOf(thread)
  const controller = new AbortController()
  const messages = withGenerationOutcomes(CodexChatStore.listMessages(run.threadId).filter((message) => message.id !== replacingMessageId))
  const source = messages.find((message) => message.id === sourceMessageId) ?? null
  const replyId = randomUUID()
  const context: ChatExecutionContext = { threadId: run.threadId, profileId: profile.id, kind: 'group', replyId }
  const active: ActiveReply = { controller, text: '', toolCalls: new Map(), routing: automaticReplyRouting(thread, source, replyId) }
  let explicitlyRouted = false
  run.active.set(profile.id, active)
  if (run.stopped) controller.abort()

  const reserve = (recipients: ChatRecipient[]) => {
    if (run.stopped || controller.signal.aborted) throw new CodexChatError('중단된 답변에서는 참가자를 부를 수 없어.', 409)
    const next = [...new Set(recipients)].filter((id): id is number => typeof id === 'number')
    const access = resolveChatAccess(requester.accountId)
    for (const id of next) {
      const member = memberProfiles(run.threadId).find((entry) => entry.id === id)
      if (id === profile.id) throw new CodexChatError('자기 자신에게는 자동 답장을 보낼 수 없어.')
      if (!member?.isEnabled || !canUseChatProfile(access, member)) throw new CodexChatError('답장 받을 참가자가 없거나 지금 응답할 수 없어.', 409)
    }
    const others = [...run.reserved].reduce((sum, [id, targets]) => sum + (id === replyId ? 0 : targets.length), 0)
    if (next.length && (!run.chain || run.chainUsed + others + next.length > run.chainLimit)) throw new CodexChatError('이어 말하기 한도에 도달해서 참가자를 부르지 못했어. 사용자 차례로 돌아갈게.', 409)
    run.reserved.set(replyId, next)
  }
  const unregister = registerChatReply(context, controller.signal, (input) => {
    const target = input.messageId === undefined ? null : requireReplyTarget(thread.id, input.messageId, messages)
    const recipients = input.recipients ?? (target ? [messageSender(target, thread)] : active.routing.recipients)
    reserve(recipients)
    active.routing = { replyId, replyTo: target ? quoteMessage(thread, target) : active.routing.replyTo, recipients: [...new Set(recipients)] }
    explicitlyRouted = true
    emit(run, { type: 'routing', profileId: profile.id, routing: active.routing })
    return active.routing
  })

  const forward = (event: CodexChatStreamEvent) => {
    // The room announces each stored reply itself, once it carries its speaker.
    if (event.type === 'done') return
    if (event.type === 'delta') active.text += event.text
    if (event.type === 'text') active.text = event.text
    if (event.type === 'tool') active.toolCalls.set(event.call.id, event.call)
    emit(run, event.type === 'delta' || event.type === 'text' || event.type === 'reasoning' || event.type === 'tool' || event.type === 'routing' || event.type === 'translating' ? { ...event, profileId: profile.id } : event)
  }
  const others = [userPersonaForThread(thread).name, ...members.filter((member) => member.id !== profile.id).map((member) => member.name)]
  const persist = async ({ contextMeta, requestCapture, ...raw }: GroupReplyResult) => {
    const saveMeta = (id: number) => {
      if (contextMeta) {
        CodexChatStore.setContextMeta(id, loadChatSettings().diagnostics.enabled ? limitContextMeta(contextMeta) : legacyContextMeta(contextMeta))
        saveChatRequestCapture(id, requestCapture)
      }
    }
    // Keep the reply as written when cutting other speakers' lines would leave nothing; an empty reply is a failure
    // the user can see (and regenerate), not a blank message.
    const reply = !raw.content.trim() && raw.tool_calls.length === 0 && raw.status === 'completed'
      ? { ...raw, status: 'failed' as const, error: '빈 답변이 왔어. 다시 생성해봐.' }
      : raw
    const written = stripEchoedAddresses(reply.content)
    const content = trimForeignSpeakerLines(written, profile.name, others) || written.trim()
    if (reply.status === 'completed' && !explicitlyRouted && run.chain) {
      const mentioned = parseMentions(content, members, profile.id)
      const recipients = mentioned.length ? mentioned : active.routing.recipients.filter((id) => id !== profile.id)
      active.routing = { ...active.routing, recipients }
      try { reserve(recipients) } catch (error) { emit(run, { type: 'notice', message: error instanceof Error ? error.message : String(error) }) }
    }
    if (reply.status !== 'completed') run.reserved.delete(replyId)
    // The member's own translation model gives the reader its reply in Korean.
    let displayContent: string | null = null
    if (reply.status === 'completed' && content && hasTranslation(profile)) {
      emit(run, { type: 'translating', profileId: profile.id })
      displayContent = await translateReply(profile, content, controller.signal, userPersonaForThread(thread).name)
    }
    if (replacingMessageId) {
      // A connection failure must not replace a usable answer with an empty failed alternative.
      if (reply.status === 'completed' || content || reply.tool_calls.length) {
        CodexChatStore.addAlternative(run.threadId, replacingMessageId, { ...reply, content, display_content: displayContent, routing: active.routing, created_at: new Date().toISOString() })
        saveMeta(replacingMessageId)
      } else if (reply.error) {
        emit(run, { type: 'error', message: reply.error })
      }
      return findMessage(run.threadId, replacingMessageId)
    }
    const id = CodexChatStore.addMessage({ thread_id: run.threadId, role: 'assistant', ...reply, content, display_content: displayContent, routing: active.routing, speaker_profile_id: profile.id })
    saveMeta(id)
    // The failed reply carries its reason; the stream says it too, so a reply with nothing to show does not just end.
    if (reply.status === 'failed' && reply.error) emit(run, { type: 'error', message: reply.error })
    return findMessage(run.threadId, id)
  }

  let message: CodexChatMessageRecord
  try {
    // A member that cannot read files itself gets text attachments' contents in the transcript.
    const attachmentTexts = await inlineTextsForChat(profile, requester.accountId, messages)
    if (profile.engine === 'codex') {
      message = await runCodexGroupReply({
        requester,
        threadId: run.threadId,
        profile,
        chatContext: context,
        messages,
        windowLimit: limits.window,
        buildInput: (lore) => buildGroupCodexInput({ thread, members, self: profile, messages, routing: active.routing, lastSeenMessageId: ChatGroupStore.member(run.threadId, profile.id)?.last_seen_message_id ?? null, windowLimit: limits.window, lore, directive: [flagDirectiveFor(messages, profile, userPersonaForThread(thread)), postHistoryText(profile, userPersonaForThread(thread))].filter(Boolean).join('\n\n') , attachmentTexts }),
        signal: controller.signal,
        emit: forward,
        persist,
      })
    } else {
      const maxTokens = ChatGroupStore.member(run.threadId, profile.id)?.max_tokens ?? thread.max_tokens ?? profile.maxTokens
      message = await persist(await generateLlmGroupReply({
        requester,
        threadId: run.threadId,
        profile,
        // The CoNAI tool guidance is for the profile's own tools, not the room tools every member gets.
        chatContext: context,
        buildMessages: (tools, onMeta) => buildGroupLlmMessages({ profile, thread, members, messages, routing: active.routing, windowLimit: limits.window, tools, maxTokens, withTools: tools.some((tool) => !CHAT_ROOM_TOOLS.has(tool.function.name)), segments: groupSummaryOn(thread) ? ChatSummaryStore.list(run.threadId) : undefined , attachmentTexts, onMeta }),
        // The member's own cap, else the room's, else the profile's (a Codex member has no hard cap).
        generation: { maxTokens },
        signal: controller.signal,
        emit: forward,
      }))
    }
  } catch (error) {
    // Could not start at all (permission, Codex process): keep the reason on a failed reply of that member.
    message = await persist({ content: '', tool_calls: [], status: controller.signal.aborted ? 'interrupted' : 'failed', error: controller.signal.aborted ? null : error instanceof Error ? error.message : String(error) })
  } finally {
    unregister()
    run.active.delete(profile.id)
  }
  if (message.status === 'completed') ChatGroupStore.setLastSeen(run.threadId, profile.id, messages.at(-1)?.id ?? 0)
  return message
}

/** Members sharing a key share its slots: one LLM connection, or Codex. */
function concurrencyOf(profile: ChatProfile) {
  if (profile.engine === 'claude') return { key: 'claude', limit: 1 }
  if (profile.engine === 'codex') return { key: 'codex', limit: 1 }
  const providerName = resolveProfileModel(profile, 'chat')?.providerName ?? ''
  const provider = ExternalApiProvider.findByName(providerName)
  return { key: `llm:${providerName}`, limit: readLlmConnectionConfig(provider?.additional_config).maxConcurrentRequests }
}

function emitQueue(run: GroupRun) {
  emit(run, { type: 'queue', speakers: [...run.active.keys()], queue: run.queue.map((item) => item.profileId) })
}

/**
 * Work through the queue: members answer in queue order, together as far as their connection allows, and a reply's
 * own `@mentions` wake more members — at most `chain` bot-to-bot wakes per user message, so bots cannot keep each
 * other talking. A member that starts later sees the replies that ended before it.
 */
async function processQueue(run: GroupRun, requester: McpRequester, options: { chain: boolean }) {
  run.chain = options.chain
  const used = new Map<string, number>()
  const inFlight = new Map<number, Promise<{ profileId: number; key: string; message: CodexChatMessageRecord | null }>>()

  const startReady = () => {
    const members = memberProfiles(run.threadId)
    for (let index = 0; index < run.queue.length && !run.stopped;) {
      const { profileId, sourceMessageId } = run.queue[index]
      const profile = members.find((member) => member.id === profileId)
      if (!profile) { run.queue.splice(index, 1); continue }
      if (!profile.isEnabled) {
        run.queue.splice(index, 1)
        emit(run, { type: 'notice', message: `${profile.name} 프로필이 꺼져 있어서 건너뛰었어.` })
        continue
      }
      const { key, limit } = concurrencyOf(profile)
      // A member already answering answers again after it; a full connection keeps its members waiting in order.
      if (run.active.has(profileId) || inFlight.has(profileId) || (used.get(key) ?? 0) >= limit) { index += 1; continue }
      run.queue.splice(index, 1)
      used.set(key, (used.get(key) ?? 0) + 1)
      const reply = replyAs(run, requester, profile, sourceMessageId)
      emit(run, { type: 'speaker', profileId, speakers: [...run.active.keys()], queue: run.queue.map((item) => item.profileId) })
      const routing = run.active.get(profileId)?.routing
      if (routing) emit(run, { type: 'routing', profileId, routing })
      inFlight.set(profileId, reply.then(
        (message) => ({ profileId, key, message }),
        () => ({ profileId, key, message: null }),
      ))
    }
  }

  startReady()
  while (inFlight.size > 0) {
    const { profileId, key, message } = await Promise.race(inFlight.values())
    inFlight.delete(profileId)
    used.set(key, (used.get(key) ?? 1) - 1)
    if (message) emit(run, { type: 'done', message })
    if (message && options.chain && message.status === 'completed' && !run.stopped) {
      const called = run.reserved.get(message.routing?.replyId ?? '') ?? []
      run.reserved.delete(message.routing?.replyId ?? '')
      for (const next of called) {
        run.queue.push({ profileId: next, sourceMessageId: message.id })
        run.chainUsed += 1
      }
    }
    startReady()
    emitQueue(run)
  }
}

/** Reserve the room for one run (after stopping any run in progress), run it, and release the room. */
async function startRun(threadId: number, listener: (event: CodexChatStreamEvent) => void, work: (run: GroupRun) => Promise<void>) {
  if (GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
  let resolveFinished: () => void = () => {}
  const run: GroupRun = {
    threadId, stopped: false, active: new Map(), queue: [], chain: true,
    chainLimit: groupLimitsOf(CodexChatStore.findThreadById(threadId)!).chain, chainUsed: 0, reserved: new Map(),
    listeners: new Set([listener]), finished: new Promise((resolve) => { resolveFinished = resolve }),
  }
  runs.set(threadId, run)
  try {
    await work(run)
  } finally {
    runs.delete(threadId)
    run.listeners.clear()
    resolveFinished()
    // The room's summary catches up in the background once the members are done (not after a stop: the user cut in).
    if (!run.stopped) {
      const thread = CodexChatStore.findThreadById(threadId)
      if (thread && groupSummaryOn(thread)) {
        summarizeGroupAhead(threadId, memberProfiles(threadId), groupLimitsOf(thread).window).catch((error: unknown) => {
          console.warn('[group-chat] summary update failed:', error instanceof Error ? error.message : error)
        })
      }
    }
  }
}

export const GroupChatService = {
  isRunning(threadId: number) {
    return runs.has(threadId) || LlmChatService.isRunning(threadId)
  },

  /** The room's summarize button: fold everything not summarized yet with the room's summarizer (see groupSummarizer). */
  async summarize(requester: McpRequester, threadId: number) {
    const thread = requireGroup(requester, threadId)
    if (GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    const members = memberProfiles(threadId)
    if (!groupSummarizer(thread, members)) throw new CodexChatError('요약할 수 있는 LLM 참가자가 없어.', 409)
    const summary = await summarizeGroupAll(threadId, members, groupLimitsOf(thread).window)
    if (summary === null) throw new CodexChatError('요약할 새 대화가 없거나 이미 요약 중이야.', 409)
    return summary
  },

  /** A group room; the representative comes first and answers messages that address no one. */
  /** `userProfileId`: the account's user profile in the room; undefined picks the default one (see ChatUserProfileStore.resolveNew), null none. */
  create(requester: McpRequester, input: { profileIds: unknown; representativeId: unknown; title?: unknown; userProfileId?: number | null }) {
    const ids = Array.isArray(input.profileIds) ? [...new Set(input.profileIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))] : []
    const representativeId = Number(input.representativeId)
    if (ids.length < 2) throw new CodexChatError('참가자를 두 명 이상 골라줘.')
    if (!ids.includes(representativeId)) throw new CodexChatError('대표자는 참가자 중에서 골라줘.')
    const profiles = ids.map((id) => ChatProfileStore.find(id))
    if (profiles.some((profile) => !profile)) throw new CodexChatError('없는 프로필이 있어.', 404)
    const ordered = [representativeId, ...ids.filter((id) => id !== representativeId)].map((id) => profiles.find((profile) => profile?.id === id) as ChatProfile)
    assertJoinable(requester, ordered)
    const user = ChatUserProfileStore.requireOwn(requester.accountId, input.userProfileId === undefined ? ChatUserProfileStore.resolveNew(requester.accountId) : input.userProfileId)
    assertUserNameFree(user, ordered)
    const title = (typeof input.title === 'string' ? input.title.trim() : '') || ordered.map((profile) => profile.name).join(', ')
    const threadId = ChatGroupStore.create(requester.accountId, title.slice(0, TITLE_MAX_LENGTH), ordered.map((profile) => profile.id), representativeId)
    if (user) ChatUserProfileStore.setThreadUserProfile(threadId, user.id)
    return requireGroup(requester, threadId)
  },

  /** Change who the user is in the room (null: the plain user); the name must not collide with a member's. */
  setUserProfile(requester: McpRequester, threadId: number, userProfileId: number | null) {
    const thread = requireGroup(requester, threadId)
    const user = ChatUserProfileStore.requireOwn(thread.account_id, userProfileId)
    assertUserNameFree(user, memberProfiles(threadId))
    ChatUserProfileStore.setThreadUserProfile(threadId, user?.id ?? null)
  },

  getRunning(requester: McpRequester, threadId: number) {
    requireGroup(requester, threadId)
    const run = runs.get(threadId)
    if (!run) return null
    const replies = [...run.active].map(([profileId, reply]) => ({ profileId, text: reply.text, toolCalls: [...reply.toolCalls.values()], routing: reply.routing }))
    return { text: replies[0]?.text ?? '', toolCalls: replies[0]?.toolCalls ?? [], speakerProfileId: replies[0]?.profileId ?? null, replies, queue: run.queue.map((item) => item.profileId) }
  },

  /** The transcript plus the room: members, representative, limits, and the reply in progress with its queue. */
  getThread(requester: McpRequester, threadId: number) {
    const thread = requireGroup(requester, threadId)
    const detail = CodexChatService.getThread(requester, threadId)
    const limits = groupLimitsOf(thread)
    const memberProfiles = ChatGroupStore.members(threadId).flatMap((member) => ChatProfileStore.find(member.profile_id) ?? [])
    return {
      ...detail,
      // Each member's display blocks are its own: folded from its replies (and the edits made on them).
      memberBlocks: foldGroupBlockState(memberProfiles, detail.messages, parseBlockEdits(thread.block_edits)),
      // `text`/`toolCalls`/`speakerProfileId` are the first reply's, for readers that show one.
      running: GroupChatService.getRunning(requester, threadId),
      group: {
        memberIds: ChatGroupStore.members(threadId).map((member) => member.profile_id),
        representativeId: thread.profile_id,
        chainLimit: limits.chain,
        windowLimit: limits.window,
        limits: GROUP_LIMITS,
        // Reply token caps: the room's (null: each profile's own) and each member's override of it.
        maxTokens: thread.max_tokens,
        memberMaxTokens: Object.fromEntries(ChatGroupStore.members(threadId).map((member) => [member.profile_id, member.max_tokens])),
      },
    }
  },

  /**
   * A user message: stops whatever the room is still saying (the user cut in), then the addressed members answer
   * (together as far as their connections allow) — or the representative when no one is addressed.
   */
  async sendMessage(requester: McpRequester, threadId: number, text: string, listener: (event: CodexChatStreamEvent) => void, fileIds?: unknown, flagIds?: unknown, mediaHashes?: unknown, picks?: unknown, replyToMessageId?: unknown) {
    const thread = requireGroup(requester, threadId)
    assertGroupChatAvailable(requester)
    const attachments = validateChatAttachments(requester, fileIds)
    const mediaAttachments = validateChatMediaAttachments(requester, mediaHashes, attachments.length)
    const flags = [...ChatFlagStore.resolve(requester, parseFlagIds(flagIds)), ...parsePicks(picks)]
    const trimmed = text.trim()
    if (!trimmed && attachments.length === 0 && mediaAttachments.length === 0) throw new CodexChatError('메시지를 입력해줘.')
    const routing = userReplyRouting(thread, replyToMessageId)
    routing.recipients = userRecipients(requester, thread, trimmed, routing)
    LlmChatService.skipReaction(threadId)
    skipThreadGenerationReactions(threadId)
    // The members read the message in English; the reader keeps their own words.
    const modelText = await translateUserInput(translatorOf(memberProfiles(threadId)), trimmed)
    await GroupChatService.stop(threadId)

    await startRun(threadId, listener, async (run) => {
      if (routing.replyTo) requireReplyTarget(threadId, routing.replyTo.messageId)
      const userMessageId = CodexChatStore.addMessage({ thread_id: threadId, role: 'user', content: modelText ?? trimmed, display_content: modelText ? trimmed : null, tool_calls: [], status: 'completed', error: null, flags, mediaAttachments, routing }, attachments.map((file) => file.id))
      ChatFlagStore.setThreadFlags(threadId, flags.filter((flag) => !flag.pick).map((flag) => flag.id))
      emit(run, { type: 'user', message: findMessage(threadId, userMessageId) })
      run.queue = (routing.recipients as number[]).map((profileId) => ({ profileId, sourceMessageId: userMessageId }))
      await processQueue(run, requester, { chain: true })
    })
  },

  /**
   * Regenerate the last reply (same speaker, API LLM members only; no chain), or edit a user message: what came
   * after it goes, Codex members forget the room, and the edited message is answered again.
   */
  async rewriteMessage(requester: McpRequester, threadId: number, messageId: number, content: string | undefined, listener: (event: CodexChatStreamEvent) => void) {
    const thread = requireGroup(requester, threadId)
    assertGroupChatAvailable(requester)
    if (GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    const messages = CodexChatStore.listMessages(threadId)
    const message = messages.find((entry) => entry.id === messageId)
    if (!message) throw new CodexChatError('메시지를 찾을 수 없어.', 404)

    if (content === undefined) {
      const speaker = message.speaker_profile_id ? ChatProfileStore.find(message.speaker_profile_id) : null
      if (message.role !== 'assistant' || messages[messages.length - 1].id !== messageId) throw new CodexChatError('마지막 답변만 다시 생성할 수 있어.', 409)
      if (!speaker || !memberProfiles(threadId).some((member) => member.id === speaker.id)) throw new CodexChatError('이 답변을 쓴 참가자가 방에 없어.', 409)
      if (speaker.engine === 'codex') throw new CodexChatError('Codex 참가자의 답변은 다시 생성할 수 없어.', 409)
      await startRun(threadId, listener, async (run) => {
        run.chain = false
        CodexChatStore.prepareRegeneration(threadId, messageId)
        emit(run, { type: 'rewind', mode: 'regenerate', message })
        const sourceId = message.routing?.replyTo?.messageId ?? [...messages].reverse().find((entry) => entry.role === 'user')?.id ?? 0
        const reply = replyAs(run, requester, speaker, sourceId, messageId)
        emit(run, { type: 'speaker', profileId: speaker.id, speakers: [speaker.id], queue: [] })
        const routing = run.active.get(speaker.id)?.routing
        if (routing) emit(run, { type: 'routing', profileId: speaker.id, routing })
        emit(run, { type: 'done', message: await reply })
      })
      return
    }

    if (message.role !== 'user') throw new CodexChatError('내 메시지만 수정할 수 있어.', 409)
    const trimmed = content.trim()
    if (!trimmed && !message.attachments?.length && !message.mediaAttachments?.length) throw new CodexChatError('메시지를 입력해줘.')
    const routing = message.routing ?? { replyTo: null, recipients: [] }
    routing.recipients = userRecipients(requester, thread, trimmed, routing)
    const modelText = await translateUserInput(translatorOf(memberProfiles(threadId)), trimmed)
    if (GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    await startRun(threadId, listener, async (run) => {
      CodexChatStore.editUserMessage(threadId, messageId, modelText ?? trimmed, modelText ? trimmed : null)
      CodexChatStore.setMessageRouting(threadId, messageId, routing)
      resetCodexMemory(requester, threadId)
      emit(run, { type: 'rewind', mode: 'edit', message: { ...message, content: modelText ?? trimmed, display_content: modelText ? trimmed : null, routing } })
      run.queue = (routing.recipients as number[]).map((profileId) => ({ profileId, sourceMessageId: messageId }))
      await processQueue(run, requester, { chain: true })
    })
  },

  /** A new room holding this one up to `messageId`, with the same members; this one stays as it is. */
  branchThread(requester: McpRequester, threadId: number, messageId: number, purpose?: ChatBranchPurpose) {
    const thread = requireGroup(requester, threadId)
    const id = branchChatThread(thread, messageId, purpose)
    if (id === null) throw new CodexChatError('메시지를 찾을 수 없어.', 404)
    return requireGroup(requester, id)
  },

  /**
   * A member's reply rewritten by hand (API LLM members only: a Codex member keeps its own memory of what it said).
   * The Codex members of the room forget the old text and get the room's recent past again.
   */
  editReplyText(requester: McpRequester, threadId: number, messageId: number, content: string) {
    requireGroup(requester, threadId)
    if (GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    const message = CodexChatStore.listMessages(threadId).find((entry) => entry.id === messageId)
    if (!message || message.role !== 'assistant') throw new CodexChatError('답변을 찾을 수 없어.', 404)
    const speaker = message.speaker_profile_id ? ChatProfileStore.find(message.speaker_profile_id) : null
    if (!speaker || speaker.engine === 'codex') throw new CodexChatError('Codex 참가자의 답변은 고칠 수 없어.', 409)
    if (!content.trim()) throw new CodexChatError('답변 내용을 입력해줘.')
    CodexChatStore.editAssistantMessage(threadId, messageId, content.trim())
    resetCodexMemory(requester, threadId)
    return GroupChatService.getThread(requester, threadId)
  },

  /** Stop the members answering now and drop the queue; waits (bounded) until the cut replies are stored. */
  async stop(threadId: number) {
    if (LlmChatService.isRunning(threadId)) await LlmChatService.stop(threadId)
    const run = runs.get(threadId)
    if (!run) return
    run.stopped = true
    run.queue = []
    run.reserved.clear()
    for (const reply of run.active.values()) reply.controller.abort()
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([run.finished, new Promise((resolve) => { timer = setTimeout(resolve, STOP_WAIT_MS) })])
    } finally {
      clearTimeout(timer)
    }
  },

  clearThread(requester: McpRequester, threadId: number) {
    requireGroup(requester, threadId)
    if (GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    CodexChatStore.clearThread(threadId, '')
    resetCodexMemory(requester, threadId)
    return GroupChatService.getThread(requester, threadId)
  },

  async deleteThread(requester: McpRequester, threadId: number) {
    requireGroup(requester, threadId)
    await GroupChatService.stop(threadId)
    const codexThreadIds = ChatGroupStore.members(threadId).map((member) => member.codex_thread_id)
    if (GroupChatService.isRunning(threadId)) throw new CodexChatError('답변 중단을 처리 중이야. 잠시 후 다시 삭제해줘.', 409)
    CodexChatStore.deleteThread(threadId)
    for (const codexThreadId of codexThreadIds) deleteCodexRollout(requester, codexThreadId)
  },

  addMembers(requester: McpRequester, threadId: number, profileIds: unknown) {
    requireGroup(requester, threadId)
    if (GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    const current = memberProfiles(threadId)
    const ids = Array.isArray(profileIds) ? [...new Set(profileIds.map(Number))].filter((id) => Number.isSafeInteger(id) && id > 0 && !current.some((member) => member.id === id)) : []
    if (ids.length === 0) throw new CodexChatError('초대할 프로필을 골라줘.')
    const profiles = ids.map((id) => ChatProfileStore.find(id))
    if (profiles.some((profile) => !profile)) throw new CodexChatError('없는 프로필이 있어.', 404)
    assertJoinable(requester, profiles as ChatProfile[], current)
    assertUserNameFree(ChatUserProfileStore.forThread(CodexChatStore.findThreadById(threadId)), [...current, ...(profiles as ChatProfile[])])
    ChatGroupStore.addMembers(threadId, ids)
    return GroupChatService.getThread(requester, threadId)
  },

  removeMember(requester: McpRequester, threadId: number, profileId: number) {
    requireGroup(requester, threadId)
    if (GroupChatService.isRunning(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    const members = ChatGroupStore.members(threadId)
    if (!members.some((member) => member.profile_id === profileId)) throw new CodexChatError('방에 없는 참가자야.', 404)
    if (members.length <= 1) throw new CodexChatError('마지막 참가자는 내보낼 수 없어.', 409)
    deleteCodexRollout(requester, ChatGroupStore.removeMember(threadId, profileId))
    return GroupChatService.getThread(requester, threadId)
  },

  /** One member's reply token cap in this room (null follows the room's cap, then the profile's). */
  updateMember(requester: McpRequester, threadId: number, profileId: number, patch: { maxTokens?: unknown }) {
    requireGroup(requester, threadId)
    if (!ChatGroupStore.member(threadId, profileId)) throw new CodexChatError('이 방의 참가자가 아니야.', 404)
    if (patch.maxTokens !== undefined) {
      ChatGroupStore.setMemberMaxTokens(threadId, profileId, replyCapOf(patch.maxTokens))
    }
    return GroupChatService.getThread(requester, threadId)
  },

  /** Representative, title, the per-room limits and the room's reply token cap (null restores a default). */
  updateRoom(requester: McpRequester, threadId: number, patch: { representativeId?: unknown; title?: unknown; chainLimit?: unknown; windowLimit?: unknown; maxTokens?: unknown }) {
    requireGroup(requester, threadId)
    if (patch.maxTokens !== undefined) {
      CodexChatStore.updateThreadContext(threadId, { maxTokens: replyCapOf(patch.maxTokens) })
    }
    if (patch.representativeId !== undefined) {
      const id = Number(patch.representativeId)
      if (!ChatGroupStore.member(threadId, id)) throw new CodexChatError('대표자는 참가자 중에서 골라줘.')
      ChatGroupStore.setRepresentative(threadId, id)
    }
    if (patch.title !== undefined) {
      const title = typeof patch.title === 'string' ? patch.title.trim() : ''
      if (!title) throw new CodexChatError('방 이름을 입력해줘.')
      CodexChatStore.renameThread(threadId, title)
    }
    const limit = (value: unknown, range: { min: number; max: number }) => {
      if (value === null) return null
      const number = Number(value)
      if (!Number.isSafeInteger(number) || number < range.min || number > range.max) throw new CodexChatError(`${range.min}~${range.max} 사이로 정해줘.`)
      return number
    }
    ChatGroupStore.setLimits(threadId, {
      chain: patch.chainLimit === undefined ? undefined : limit(patch.chainLimit, GROUP_LIMITS.chain),
      window: patch.windowLimit === undefined ? undefined : limit(patch.windowLimit, GROUP_LIMITS.window),
    })
    return GroupChatService.getThread(requester, threadId)
  },
}
