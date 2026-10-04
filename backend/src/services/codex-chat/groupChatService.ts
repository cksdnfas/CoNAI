import type { McpRequester } from '../../mcp/context'
import { validateChatAttachments } from './chatAttachments'
import { GROUP_LIMITS, GROUP_MEMBER_MAX, ChatGroupStore, groupLimitsOf } from './chatGroupStore'
import { ChatProfileStore, type ChatProfile } from './chatProfiles'
import { loadChatSettings } from './chatSettings'
import { resolveChatAccess } from './codexChatAccess'
import { CodexChatError, CodexChatService, deleteCodexRollout, runCodexGroupReply, type CodexChatStreamEvent } from './codexChatService'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord, type CodexChatToolCall } from './codexChatStore'
import { buildGroupCodexInput, buildGroupLlmMessages, parseMentions, resolveMemberName, trimForeignSpeakerLines } from './groupChatContext'
import { registerGroupWake } from './groupWakeRegistry'
import { CHAT_ROOM_TOOLS } from '../../mcp/context'
import { sendableMessages } from './llmChatContext'
import { generateLlmGroupReply, type GroupReplyResult } from './llmChatService'

const STOP_WAIT_MS = 8000
const TITLE_MAX_LENGTH = 60

/** A group room working through its reply queue: one member answers at a time. */
type GroupRun = {
  threadId: number
  /** Set by stop(): no further member is woken. */
  stopped: boolean
  current: { profileId: number; controller: AbortController } | null
  queue: number[]
  /** Members the current speaker called with the room_call_member tool; they join the queue after its reply. */
  called: number[]
  text: string
  toolCalls: Map<string, CodexChatToolCall>
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
  if (!access.llm && !access.codex) throw new CodexChatError('채팅 권한이 없어.', 403)
  return access
}

function requireGroup(requester: McpRequester, threadId: number) {
  const thread = CodexChatStore.findThread(threadId, requester.accountId)
  if (!thread) throw new CodexChatError('채팅을 찾을 수 없어.', 404)
  if (thread.kind !== 'group') throw new CodexChatError('그룹 방이 아니야.', 409)
  return thread
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
    if (!profile.isEnabled || !(profile.engine === 'codex' ? access.codex : access.llm)) throw new CodexChatError(`${profile.name} 프로필은 지금 쓸 수 없어.`, 409)
  }
  const all = [...existing, ...profiles]
  if (all.length > GROUP_MEMBER_MAX) throw new CodexChatError(`참가자는 ${GROUP_MEMBER_MAX}명까지야.`)
  const names = all.map((profile) => profile.name.trim().toLowerCase())
  if (new Set(names).size !== names.length) throw new CodexChatError('같은 이름의 프로필은 한 방에 함께 넣을 수 없어.')
}

function findMessage(threadId: number, messageId: number) {
  return CodexChatStore.listMessages(threadId).find((entry) => entry.id === messageId) as CodexChatMessageRecord
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
async function replyAs(run: GroupRun, requester: McpRequester, profile: ChatProfile, replacingMessageId?: number): Promise<CodexChatMessageRecord> {
  const thread = CodexChatStore.findThreadById(run.threadId) as CodexChatThreadRecord
  const members = memberProfiles(run.threadId)
  const limits = groupLimitsOf(thread)
  const controller = new AbortController()
  run.current = { profileId: profile.id, controller }
  run.text = ''
  run.toolCalls = new Map()
  if (run.stopped) controller.abort()

  const forward = (event: CodexChatStreamEvent) => {
    // The room announces each stored reply itself, once it carries its speaker.
    if (event.type === 'done') return
    if (event.type === 'delta') run.text += event.text
    if (event.type === 'tool') run.toolCalls.set(event.call.id, event.call)
    emit(run, event)
  }
  const others = members.filter((member) => member.id !== profile.id).map((member) => member.name)
  const persist = (raw: GroupReplyResult) => {
    // Keep the reply as written when cutting other speakers' lines would leave nothing; an empty reply is a failure
    // the user can see (and regenerate), not a blank message.
    const reply = !raw.content.trim() && raw.tool_calls.length === 0 && raw.status === 'completed'
      ? { ...raw, status: 'failed' as const, error: '빈 답변이 왔어. 다시 생성해봐.' }
      : raw
    const content = trimForeignSpeakerLines(reply.content, profile.name, others) || reply.content.trim()
    if (replacingMessageId) {
      // A connection failure must not replace a usable answer with an empty failed alternative.
      if (reply.status === 'completed' || content || reply.tool_calls.length) {
        CodexChatStore.addAlternative(run.threadId, replacingMessageId, { ...reply, content, created_at: new Date().toISOString() })
      } else if (reply.error) {
        emit(run, { type: 'error', message: reply.error })
      }
      return findMessage(run.threadId, replacingMessageId)
    }
    const id = CodexChatStore.addMessage({ thread_id: run.threadId, role: 'assistant', ...reply, content, speaker_profile_id: profile.id })
    return findMessage(run.threadId, id)
  }
  const messages = CodexChatStore.listMessages(run.threadId).filter((message) => message.id !== replacingMessageId)

  let message: CodexChatMessageRecord
  try {
    if (profile.engine === 'codex') {
      message = await runCodexGroupReply({
        requester,
        threadId: run.threadId,
        profile,
        messages,
        buildInput: (lore) => buildGroupCodexInput({ thread, members, self: profile, messages, lastSeenMessageId: ChatGroupStore.member(run.threadId, profile.id)?.last_seen_message_id ?? null, windowLimit: limits.window, lore }),
        signal: controller.signal,
        emit: forward,
        persist,
      })
    } else {
      message = persist(await generateLlmGroupReply({
        requester,
        threadId: run.threadId,
        profile,
        // The CoNAI tool guidance is for the profile's own tools, not the room tools every member gets.
        buildMessages: (tools) => buildGroupLlmMessages({ profile, thread, members, messages, windowLimit: limits.window, withTools: tools.some((tool) => !CHAT_ROOM_TOOLS.has(tool.function.name)) }),
        roomTools: sendableMessages(messages).length > limits.window ? 'all' : 'call',
        signal: controller.signal,
        emit: forward,
      }))
    }
  } catch (error) {
    // Could not start at all (permission, Codex process): keep the reason on a failed reply of that member.
    message = persist({ content: '', tool_calls: [], status: controller.signal.aborted ? 'interrupted' : 'failed', error: controller.signal.aborted ? null : error instanceof Error ? error.message : String(error) })
  } finally {
    run.current = null
  }
  if (message.status !== 'failed') ChatGroupStore.setLastSeen(run.threadId, profile.id, message.id)
  return message
}

/**
 * Work through the queue: each member answers in turn, and a reply's own `@mentions` wake more members — at most
 * `chain` bot-to-bot wakes per user message, so bots cannot keep each other talking.
 */
async function processQueue(run: GroupRun, requester: McpRequester, options: { chain: boolean }) {
  let wakes = 0
  while (run.queue.length > 0 && !run.stopped) {
    const profileId = run.queue.shift() as number
    const members = memberProfiles(run.threadId)
    const profile = members.find((member) => member.id === profileId)
    if (!profile) continue
    if (!profile.isEnabled) {
      emit(run, { type: 'notice', message: `${profile.name} 프로필이 꺼져 있어서 건너뛰었어.` })
      continue
    }
    emit(run, { type: 'speaker', profileId, queue: [...run.queue] })
    run.called = []
    const message = await replyAs(run, requester, profile)
    emit(run, { type: 'done', message })
    if (!options.chain || message.status !== 'completed') continue
    const chainLimit = groupLimitsOf(CodexChatStore.findThreadById(run.threadId) as CodexChatThreadRecord).chain
    for (const next of [...run.called, ...parseMentions(message.content, members, profile.id)]) {
      if (wakes >= chainLimit) break
      if (run.queue.includes(next)) continue
      run.queue.push(next)
      wakes += 1
    }
    if (run.queue.length > 0) emit(run, { type: 'queue', queue: [...run.queue] })
  }
}

/** Reserve the room for one run (after stopping any run in progress), run it, and release the room. */
async function startRun(threadId: number, listener: (event: CodexChatStreamEvent) => void, work: (run: GroupRun) => Promise<void>) {
  if (runs.has(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
  let resolveFinished: () => void = () => {}
  const run: GroupRun = {
    threadId, stopped: false, current: null, queue: [], called: [], text: '', toolCalls: new Map(),
    listeners: new Set([listener]), finished: new Promise((resolve) => { resolveFinished = resolve }),
  }
  runs.set(threadId, run)
  // room_call_member: the member answering now asks for others by name.
  const unregister = registerGroupWake(threadId, (names) => {
    const caller = run.current?.profileId
    if (caller === undefined) return { error: 'Nobody is answering in this room right now.' }
    const members = memberProfiles(threadId)
    const woken: string[] = []
    const unknown: string[] = []
    for (const name of names) {
      const id = resolveMemberName(name, members)
      if (id === null || id === caller) { unknown.push(name); continue }
      if (!run.called.includes(id)) run.called.push(id)
      woken.push(members.find((member) => member.id === id)?.name ?? name)
    }
    return { woken, unknown, members: members.filter((member) => member.id !== caller).map((member) => member.name) }
  })
  try {
    await work(run)
  } finally {
    unregister()
    runs.delete(threadId)
    run.listeners.clear()
    resolveFinished()
  }
}

export const GroupChatService = {
  isRunning(threadId: number) {
    return runs.has(threadId)
  },

  /** A group room; the representative comes first and answers messages that address no one. */
  create(requester: McpRequester, input: { profileIds: unknown; representativeId: unknown; title?: unknown }) {
    const ids = Array.isArray(input.profileIds) ? [...new Set(input.profileIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))] : []
    const representativeId = Number(input.representativeId)
    if (ids.length < 2) throw new CodexChatError('참가자를 두 명 이상 골라줘.')
    if (!ids.includes(representativeId)) throw new CodexChatError('대표자는 참가자 중에서 골라줘.')
    const profiles = ids.map((id) => ChatProfileStore.find(id))
    if (profiles.some((profile) => !profile)) throw new CodexChatError('없는 프로필이 있어.', 404)
    const ordered = [representativeId, ...ids.filter((id) => id !== representativeId)].map((id) => profiles.find((profile) => profile?.id === id) as ChatProfile)
    assertJoinable(requester, ordered)
    const title = (typeof input.title === 'string' ? input.title.trim() : '') || ordered.map((profile) => profile.name).join(', ')
    const threadId = ChatGroupStore.create(requester.accountId, title.slice(0, TITLE_MAX_LENGTH), ordered.map((profile) => profile.id), representativeId)
    return requireGroup(requester, threadId)
  },

  /** The transcript plus the room: members, representative, limits, and the reply in progress with its queue. */
  getThread(requester: McpRequester, threadId: number) {
    const thread = requireGroup(requester, threadId)
    const detail = CodexChatService.getThread(requester, threadId)
    const run = runs.get(threadId)
    const limits = groupLimitsOf(thread)
    return {
      ...detail,
      running: run ? { text: run.text, toolCalls: [...run.toolCalls.values()], speakerProfileId: run.current?.profileId ?? null, queue: [...run.queue] } : null,
      group: {
        memberIds: ChatGroupStore.members(threadId).map((member) => member.profile_id),
        representativeId: thread.profile_id,
        chainLimit: limits.chain,
        windowLimit: limits.window,
        limits: GROUP_LIMITS,
      },
    }
  },

  /**
   * A user message: stops whatever the room is still saying (the user cut in), then the addressed members answer
   * in turn — or the representative when no one is addressed.
   */
  async sendMessage(requester: McpRequester, threadId: number, text: string, listener: (event: CodexChatStreamEvent) => void, fileIds?: unknown) {
    const thread = requireGroup(requester, threadId)
    assertGroupChatAvailable(requester)
    const attachments = validateChatAttachments(requester, fileIds)
    const trimmed = text.trim()
    if (!trimmed && attachments.length === 0) throw new CodexChatError('메시지를 입력해줘.')
    await GroupChatService.stop(threadId)

    await startRun(threadId, listener, async (run) => {
      const userMessageId = CodexChatStore.addMessage({ thread_id: threadId, role: 'user', content: trimmed, tool_calls: [], status: 'completed', error: null }, attachments.map((file) => file.id))
      emit(run, { type: 'user', message: findMessage(threadId, userMessageId) })
      const mentioned = parseMentions(trimmed, memberProfiles(threadId))
      run.queue = mentioned.length > 0 ? mentioned : thread.profile_id ? [thread.profile_id] : []
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
    if (runs.has(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    const messages = CodexChatStore.listMessages(threadId)
    const message = messages.find((entry) => entry.id === messageId)
    if (!message) throw new CodexChatError('메시지를 찾을 수 없어.', 404)

    if (content === undefined) {
      const speaker = message.speaker_profile_id ? ChatProfileStore.find(message.speaker_profile_id) : null
      if (message.role !== 'assistant' || messages[messages.length - 1].id !== messageId) throw new CodexChatError('마지막 답변만 다시 생성할 수 있어.', 409)
      if (!speaker || !memberProfiles(threadId).some((member) => member.id === speaker.id)) throw new CodexChatError('이 답변을 쓴 참가자가 방에 없어.', 409)
      if (speaker.engine !== 'llm') throw new CodexChatError('Codex 참가자의 답변은 다시 생성할 수 없어.', 409)
      await startRun(threadId, listener, async (run) => {
        CodexChatStore.prepareRegeneration(threadId, messageId)
        emit(run, { type: 'rewind', mode: 'regenerate', message })
        emit(run, { type: 'speaker', profileId: speaker.id, queue: [] })
        emit(run, { type: 'done', message: await replyAs(run, requester, speaker, messageId) })
      })
      return
    }

    if (message.role !== 'user') throw new CodexChatError('내 메시지만 수정할 수 있어.', 409)
    const trimmed = content.trim()
    if (!trimmed && !message.attachments?.length) throw new CodexChatError('메시지를 입력해줘.')
    await startRun(threadId, listener, async (run) => {
      CodexChatStore.editUserMessage(threadId, messageId, trimmed)
      resetCodexMemory(requester, threadId)
      emit(run, { type: 'rewind', mode: 'edit', message: { ...message, content: trimmed } })
      const mentioned = parseMentions(trimmed, memberProfiles(threadId))
      run.queue = mentioned.length > 0 ? mentioned : thread.profile_id ? [thread.profile_id] : []
      await processQueue(run, requester, { chain: true })
    })
  },

  /** Stop the member answering now and drop the queue; waits (bounded) until the cut reply is stored. */
  async stop(threadId: number) {
    const run = runs.get(threadId)
    if (!run) return
    run.stopped = true
    run.queue = []
    run.current?.controller.abort()
    await Promise.race([run.finished, new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS))])
  },

  clearThread(requester: McpRequester, threadId: number) {
    requireGroup(requester, threadId)
    if (runs.has(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    CodexChatStore.clearThread(threadId, '')
    resetCodexMemory(requester, threadId)
    return GroupChatService.getThread(requester, threadId)
  },

  async deleteThread(requester: McpRequester, threadId: number) {
    requireGroup(requester, threadId)
    await GroupChatService.stop(threadId)
    const codexThreadIds = ChatGroupStore.members(threadId).map((member) => member.codex_thread_id)
    CodexChatStore.deleteThread(threadId)
    for (const codexThreadId of codexThreadIds) deleteCodexRollout(requester, codexThreadId)
  },

  addMembers(requester: McpRequester, threadId: number, profileIds: unknown) {
    requireGroup(requester, threadId)
    if (runs.has(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    const current = memberProfiles(threadId)
    const ids = Array.isArray(profileIds) ? [...new Set(profileIds.map(Number))].filter((id) => Number.isSafeInteger(id) && id > 0 && !current.some((member) => member.id === id)) : []
    if (ids.length === 0) throw new CodexChatError('초대할 프로필을 골라줘.')
    const profiles = ids.map((id) => ChatProfileStore.find(id))
    if (profiles.some((profile) => !profile)) throw new CodexChatError('없는 프로필이 있어.', 404)
    assertJoinable(requester, profiles as ChatProfile[], current)
    ChatGroupStore.addMembers(threadId, ids)
    return GroupChatService.getThread(requester, threadId)
  },

  removeMember(requester: McpRequester, threadId: number, profileId: number) {
    requireGroup(requester, threadId)
    if (runs.has(threadId)) throw new CodexChatError('이전 답변이 아직 진행 중이야.', 409)
    const members = ChatGroupStore.members(threadId)
    if (!members.some((member) => member.profile_id === profileId)) throw new CodexChatError('방에 없는 참가자야.', 404)
    if (members.length <= 1) throw new CodexChatError('마지막 참가자는 내보낼 수 없어.', 409)
    deleteCodexRollout(requester, ChatGroupStore.removeMember(threadId, profileId))
    return GroupChatService.getThread(requester, threadId)
  },

  /** Representative, title and the per-room limits (null restores a default). */
  updateRoom(requester: McpRequester, threadId: number, patch: { representativeId?: unknown; title?: unknown; chainLimit?: unknown; windowLimit?: unknown }) {
    requireGroup(requester, threadId)
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
