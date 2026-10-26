import type { PluginLlmInput, PluginLlmJob, PluginProfileRun } from '@conai/shared'
import { CHAT_THREAD_TITLE_MAX_LENGTH } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'
import type { ChatProfile } from '../codex-chat/chatProfiles'
import { CodexChatStore } from '../codex-chat/codexChatStore'
import { ensureAutomationRoom, findAutomationRoom, wakeChatRoom, automationRooms, forgetAutomationRoom } from '../codex-chat/chatRoomWake'
import { resolveProfileModel } from '../codex-chat/chatModelRoles'
import { automationResults } from '../codex-chat/chatAutomationResults'
import { PluginError, sha256 } from './pluginStore'
import { ChatResearchExecution, requireResearchProfile } from '../codex-chat/chatResearch'
import { buildChatProfileReplyMessages } from '../codex-chat/chatProfileReply'
import { beginDirectReply } from '../codex-chat/chatReplies'
import { generateLlmGroupReply } from '../codex-chat/llmChatService'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import fs from 'node:fs'
import path from 'node:path'
import { piChatPrivateRoot } from '../codex-chat/piChatCompletion'
import { pluginLlmFailure } from './pluginLlmErrors'
import { withPluginProfileTools } from './pluginServerTools'
import { acquireLlmRequestSlot, llmRequestSlotBusy } from '../llmRequestScheduler'
export const pluginProfileRoomKey = (pluginId: string, profileId: number, roomKey?: string) =>
  `plugin:${pluginId}:profile:${profileId}${roomKey === undefined ? '' : `:room:${roomKey}`}`
export const pluginProfileLockKey = (accountId: number | null, pluginId: string, profileId: number, roomKey?: string) =>
  `\0plugin-profile:${JSON.stringify([accountId, pluginProfileRoomKey(pluginId, profileId, roomKey)])}`
const roomActivity = new Map<string, number>()
const deletingRooms = new Set<string>()
const creatingRooms = new Map<string, number>()
const namespaceKey = (accountId: number | null, pluginId: string, roomKey?: string) => JSON.stringify([accountId, pluginId, roomKey])
export async function acquirePluginProfileLock(accountId: number | null, pluginId: string, profileId: number, roomKey?: string, signal?: AbortSignal) {
  const namespace = namespaceKey(accountId, pluginId, roomKey)
  if (deletingRooms.has(namespace)) throw new PluginError('프로필 방을 정리 중이야.', 409)
  roomActivity.set(namespace, (roomActivity.get(namespace) ?? 0) + 1)
  const remove = () => {
    const remaining = (roomActivity.get(namespace) ?? 1) - 1
    if (remaining) roomActivity.set(namespace, remaining); else roomActivity.delete(namespace)
  }
  try {
    const release = await acquireLlmRequestSlot(pluginProfileLockKey(accountId, pluginId, profileId, roomKey), 1, signal, { fifo: true })
    let released = false
    return () => { if (!released) { released = true; release(); remove() } }
  } catch (error) { remove(); throw error }
}

export async function ensurePluginProfileRoom(pluginId: string, pluginName: string, requester: McpRequester, profile: ChatProfile, roomKey?: string, roomTitle?: string) {
  const namespace = namespaceKey(requester.accountId, pluginId, roomKey)
  if (deletingRooms.has(namespace)) throw new PluginError('프로필 방을 정리 중이야.', 409)
  const key = pluginProfileRoomKey(pluginId, profile.id, roomKey)
  const existing = findAutomationRoom(requester, profile.id, key)
  if (existing) return existing
  // Only creation is serialized here; a lookup must never wait for the profile's model run.
  creatingRooms.set(namespace, (creatingRooms.get(namespace) ?? 0) + 1)
  let release: (() => void) | undefined
  try {
    release = await acquireLlmRequestSlot(`\0plugin-room-create:${JSON.stringify([requester.accountId, key])}`, 1, undefined, { fifo: true })
    const base = `${pluginName} · ${profile.name}`, available = CHAT_THREAD_TITLE_MAX_LENGTH - (roomTitle?.length ?? 0) - 3
    const title = roomTitle ? available > 0 ? `${base.slice(0, available)} · ${roomTitle}` : roomTitle : base
    return await ensureAutomationRoom(requester, profile.id, key, title)
  } finally {
    release?.()
    const remaining = (creatingRooms.get(namespace) ?? 1) - 1
    if (remaining) creatingRooms.set(namespace, remaining); else creatingRooms.delete(namespace)
  }
}

/** Canonical ordinary profile-room links only; research and other plugins' namespaces never match. */
function pluginProfileRooms(pluginId: string, accountId: number | null) {
  const prefix = `plugin:${pluginId}:profile:`
  return automationRooms(accountId).flatMap(row => {
    if (!row.room_key.startsWith(prefix)) return []
    const match = /^([1-9]\d*)(?::room:(.+))?$/.exec(row.room_key.slice(prefix.length))
    if (!match) return []
    const profileId = Number(match[1]), roomKey = match[2]
    if (!Number.isSafeInteger(profileId) || row.room_key !== pluginProfileRoomKey(pluginId, profileId, roomKey)) return []
    return [{ ...row, profileId, roomKey, lock: pluginProfileLockKey(accountId, pluginId, profileId, roomKey) }]
  })
}

/** Exact plugin/account/key namespace only. Hold all matched room locks before deleting any room. */
export async function forgetPluginProfileRooms(pluginId: string, requester: McpRequester, roomKey: string) {
  const namespace = namespaceKey(requester.accountId, pluginId, roomKey)
  if (roomActivity.has(namespace) || creatingRooms.has(namespace) || deletingRooms.has(namespace)) throw new PluginError('프로필 방이 실행 중이야. 취소가 완료된 뒤 다시 정리해줘.', 409)
  deletingRooms.add(namespace)
  try {
  const { CodexChatService } = await import('../codex-chat/codexChatService')
  const { deleteChatThread } = await import('../codex-chat/chatThreadDeletion')
  const rooms = pluginProfileRooms(pluginId, requester.accountId).filter(room => room.roomKey === roomKey)
  const releases: Array<() => void> = []
  try {
    for (const room of rooms) {
      if (llmRequestSlotBusy(room.lock) || CodexChatService.isRunning(room.thread_id)) throw new PluginError('프로필 방이 실행 중이야. 취소가 완료된 뒤 다시 정리해줘.', 409)
      releases.push(await acquireLlmRequestSlot(room.lock, 1, undefined, { fifo: true }))
    }
    const results: Array<{ threadId: number; status: 'deleted' | 'unlinked' }> = []
    for (const room of rooms) {
      let status: 'deleted' | 'unlinked' = 'unlinked'
      if (CodexChatStore.findThread(room.thread_id, requester.accountId) && !CodexChatStore.hasNonPluginUserMessages(room.thread_id)) {
        const humanInput = new Error('사용자가 쓴 대화는 일반 채팅으로 남겨.')
        try {
          await deleteChatThread(requester, room.thread_id, { beforeDelete: () => {
            if (CodexChatStore.hasNonPluginUserMessages(room.thread_id)) throw humanInput
          } })
          status = 'deleted'
        } catch (error) { if (error !== humanInput) throw error }
      }
      forgetAutomationRoom(requester.accountId, room.room_key)
      results.push({ threadId: room.thread_id, status })
    }
    return { rooms: results }
  } finally { for (const release of releases) release() }
  } finally { deletingRooms.delete(namespace) }
}

/** Discard one run's recorded messages, without removing its room, later turns or already-applied tool effects. */
export async function discardPluginProfileRun(pluginId: string, requester: McpRequester, profileId: number, run: PluginProfileRun, wakeMessageId: number) {
  const { CodexChatService } = await import('../codex-chat/codexChatService')
  const room = pluginProfileRooms(pluginId, requester.accountId).find(room => room.thread_id === run.threadId && room.profileId === profileId)
  const ownsRoom = () => room && findAutomationRoom(requester, profileId, room.room_key)?.id === run.threadId
  if (!room || !ownsRoom()) throw new PluginError('이 플러그인의 프로필 실행 방이 아니거나 연결이 정리됐어.', 404)
  const namespace = namespaceKey(requester.accountId, pluginId, room.roomKey)
  if (deletingRooms.has(namespace) || llmRequestSlotBusy(room.lock) || CodexChatService.isRunning(run.threadId)) {
    throw new PluginError('프로필 방이 실행 중이야. 완료되거나 취소가 끝난 뒤 답변을 버려줘.', 409)
  }
  // The held room lock alone keeps forgetRooms out; other profiles of the same namespace keep running.
  let release: (() => void) | undefined
  try {
    release = await acquireLlmRequestSlot(room.lock, 1, undefined, { fifo: true })
    if (!ownsRoom()) throw new PluginError('프로필 실행 방 연결이 정리됐어.', 404)
    const wake = CodexChatStore.findMessage(run.threadId, wakeMessageId)
    if (wake && (wake.role !== 'user' || wake.routing?.routine?.source !== 'plugin')) throw new PluginError('플러그인이 보낸 입력 메시지가 아니야.', 409)
    return CodexChatService.deleteMessages(requester, run.threadId, [wakeMessageId, ...run.messageIds])
  } finally {
    release?.()
  }
}

/** Read only the replies created by this run; generated media/job references can finish after the model's text. */
export function refreshPluginProfileRun(run: PluginProfileRun, requester: McpRequester): PluginProfileRun {
  if (!CodexChatStore.findThread(run.threadId, requester.accountId)) throw new PluginError('프로필 실행 대화를 찾을 수 없어.', 404)
  if (run.research) requireRequesterPermission(requester, 'posts.view')
  const replies = run.messageIds.flatMap(id => { const reply = CodexChatStore.findMessage(run.threadId, id); return reply ? [reply] : [] })
  const { tools, summaryToolsTruncated: toolsTruncated } = automationResults(replies)
  return { ...run, tools, toolsTruncated }
}

/** Use the same engine, tool catalog, profile grants, reviews and cancellation as a native profile chat. */
export async function runPluginProfile(params: {
  pluginId: string; pluginName: string; requester: McpRequester; profile: ChatProfile; input: PluginLlmInput; signal: AbortSignal
  onDelivered?: (delivery: NonNullable<PluginLlmJob['delivery']>) => void
  onPrimaryComplete?: () => void
  followUpDeadlineExpired?: () => boolean
}): Promise<NonNullable<PluginLlmJob['result']>> {
  const { pluginId, pluginName, requester, profile, input, signal } = params
  const key = pluginProfileRoomKey(pluginId, profile.id, input.roomKey)
    signal.throwIfAborted()
    if (input.research) {
      const runtime = requireResearchProfile(profile)
      requireRequesterPermission(requester, 'posts.view')
      const research = new ChatResearchExecution(input.research, runtime)
      const roomKey = `${key}:research:${sha256(JSON.stringify([input.research.slotId, input.research.activityId, input.requestId]))}`
      const room = await ensureAutomationRoom(requester, profile.id, roomKey, `${pluginName} · ${profile.name} · Research`)
      signal.throwIfAborted()
      const userId = CodexChatStore.addMessage({ thread_id: room.id, role: 'user', content: input.message, display_content: null, tool_calls: [], status: 'completed', error: null })
      const delivery = beginDirectReply(room, profile.id, [], CodexChatStore.findMessage(room.id, userId) ?? null, signal, () => {})
      let piDir: string | undefined
      const validate = () => {
        requireRequesterPermission(requester, 'posts.view')
        research.validateSources(requester, profile.id)
      }
      const controller = new AbortController()
      const runSignal = AbortSignal.any([signal, controller.signal])
      // Native engines own internal provider requests: also stop an in-flight run on source revocation.
      const accessTimer = runtime !== 'direct' ? setInterval(() => {
        try { validate() } catch (error) { controller.abort(error) }
      }, 1000) : undefined
      accessTimer?.unref()
      try {
        // The native headless reply executor owns tool rounds, usage, permissions and provider cancellation.
        // Only the stateless persona builder supplies context: no room history, hooks, memory, lore or files.
        // Direct API already checks immediately before every request, without an extra preflight query.
        if (runtime !== 'direct') validate()
        const messages = buildChatProfileReplyMessages({
          profile, message: input.message, history: input.history ?? null, userName: input.userName ?? null, useLorebooks: false,
        })
        if (runtime === 'pi') {
          const root = piChatPrivateRoot()
          fs.mkdirSync(root, { recursive: true, mode: 0o700 })
          piDir = fs.mkdtempSync(path.join(root, 'research-'))
        }
        const reply = runtime === 'codex' ? await (await import('../codex-chat/codexChatService')).runCodexResearchReply({
          requester, profile, chatContext: delivery.context, research, messages, signal: runSignal,
        }) : await generateLlmGroupReply({
          requester, profile, threadId: room.id, chatContext: delivery.context, signal: runSignal, research, emit: () => {},
          // Unset: the profile's own output cap, as in its chats; a plugin's maxTokens only lowers it.
          generation: input.maxTokens === undefined ? {} : { maxTokens: Math.min(input.maxTokens, profile.maxTokens ?? input.maxTokens) },
          buildMessages: (_tools, _onMeta, _judged, useSession) => {
            if (piDir) {
              useSession({ runtime: 'pi', dir: piDir, resumeId: null, onDone: () => {} })
              // Pi accepts only the latest user input. Keep explicit caller history, without loading any old session.
              return [...messages.filter(message => message.role === 'system'), { role: 'user', content: JSON.stringify(messages.filter(message => message.role !== 'system')) }]
            }
            return messages
          },
        })
        const messageId = CodexChatStore.addMessage({ thread_id: room.id, role: 'assistant', ...reply, display_content: null, routing: delivery.routing })
        runSignal.throwIfAborted()
        if (reply.status !== 'completed') throw pluginLlmFailure(new Error(reply.error ?? reply.status))
        validate()
        const profileRun = refreshPluginProfileRun({ threadId: room.id, messageIds: [messageId], tools: [], toolsTruncated: false, research: research.result }, requester)
        return { text: reply.content, truncated: reply.finish_reason === 'length', model: resolveProfileModel(profile, 'chat')?.model ?? '', engine: profile.engine, profileRun }
      } finally {
        if (accessTimer) clearInterval(accessTimer)
        if (piDir) fs.rmSync(piDir, { recursive: true, force: true })
        delivery.close()
      }
    }
    const room = input.expectedThreadId !== undefined
      ? findAutomationRoom(requester, profile.id, key)
      : await ensurePluginProfileRoom(pluginId, pluginName, requester, profile, input.roomKey, input.roomTitle)
    if (!room || (input.expectedThreadId !== undefined && input.expectedThreadId !== room.id)) throw new PluginError('프로필 방이 새로 만들어졌거나 정리됐어. 새 방을 조회하고 기억 문맥을 다시 준비해줘.', 409)
    signal.throwIfAborted()
    const { CodexChatService } = await import('../codex-chat/codexChatService')
    await CodexChatService.waitUntilIdle(room.id, signal)
    CodexChatStore.updateThreadContext(room.id, { maxTokens: input.maxTokens === undefined ? null : Math.min(input.maxTokens, profile.maxTokens ?? input.maxTokens) })
    const instruction = [input.history ? `<plugin-history>\n${input.history}\n</plugin-history>` : '',
      input.userName ? `Conversation partner: ${input.userName}` : '', input.message].filter(Boolean).join('\n\n')
    const result = await withPluginProfileTools({ threadId: room.id, pluginId, accountId: requester.accountId, profileId: profile.id,
      requestId: input.requestId, tools: input.pluginTools ?? [] }, () => wakeChatRoom({ requester, threadId: room.id, instruction,
      routing: { source: 'plugin', id: null, name: pluginName }, signal, onDelivered: messageId => params.onDelivered?.({ threadId: room.id, messageId }),
      onPrimaryComplete: params.onPrimaryComplete, followUpDeadlineExpired: params.followUpDeadlineExpired }))
    if (!result.followUpTimedOut) signal.throwIfAborted()
    if (result.replies[0]?.status !== 'completed') {
      throw new PluginError(`프로필 실행을 완료하지 못했어. 채팅에서 실행 결과를 확인해줘. (대화 ${room.id})`, 502)
    }
    const completed = result.replies.filter(reply => reply.status === 'completed')
    const raw = completed.map(reply => reply.display_content ?? reply.content).join('\n\n')
    const profileRun = refreshPluginProfileRun({ threadId: room.id, messageIds: result.replies.map(reply => reply.id),
      incompleteMessageIds: result.replies.filter(reply => reply.status !== 'completed').map(reply => reply.id),
      ...(result.followUpFailed ? { followUpFailed: true } : {}), ...(result.followUpTimedOut ? { followUpTimedOut: true } : {}), tools: [], toolsTruncated: false }, requester)
    return { text: raw, truncated: result.replies.some(reply => reply.finish_reason === 'length'), model: resolveProfileModel(profile, 'chat')?.model ?? '', engine: profile.engine, profileRun }
}
