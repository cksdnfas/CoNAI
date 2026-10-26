import type Database from 'better-sqlite3'
import type { ChatAutomationRoomKind, ChatRoutineRouting } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { McpRequester } from '../../mcp/context'
import { ChatProfileStore } from './chatProfiles'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'
import { drainJudgeFollowUps } from './chatJudge'

/**
 * Waking a chat from an automation (a chat routine or the 채팅방 깨우기 workflow node): the app sends an instruction
 * into the room as the automation's account, marked so the room shows one thin line instead of a user message, and
 * the character answers as it would to the person — with the tools its profile grants, narrowed by that account.
 * There is no open page, so page tools are not offered.
 *
 * The chat services are loaded on use: the workflow executor reaches this file while they are still loading.
 */
const chatServices = async () => ({ ...(await import('./codexChatService')), ...(await import('./groupChatService')) })

/** The room was still answering; an automation never cuts in, the wake is skipped. */
export class ChatWakeBusyError extends Error {
  readonly status = 409
  constructor() {
    super('채팅방이 아직 답하는 중이라 이번엔 건너뛰었어.')
  }
}

/** What the model reads: the instruction, framed as the app's request rather than the person's words. */
export function wakeInstructionText(routing: ChatRoutineRouting, instruction: string) {
  if (routing.source === 'agent_result') {
    return [`[Agent "${routing.name}" finished your request; its result is above. React if useful.]`, '', instruction.trim()].join('\n')
  }
  if (routing.source === 'agent') {
    return [`[Agent request from "${routing.name}" — sent by the app, not typed by the person]`,
      'Do the work with your own tools, then report the result. Do not ask for review cards; report any decision needing a person in your result.', '', instruction.trim()].join('\n')
  }
  if (routing.source === 'post') {
    return [`[Posts board call on "${routing.name}" — sent by the app, not typed by the person]`, '', instruction.trim()].join('\n')
  }
  const sender = `${routing.source === 'routine' ? 'Routine' : routing.source === 'plugin' ? 'Plugin' : 'Workflow'} "${routing.name}"`
  return [
    `[${sender} — sent by the app on a schedule, not typed by the person]`,
    'Do what it asks yourself, with your own tools. The person may not be watching; do not stop to ask them what you can decide.',
    '',
    instruction.trim(),
  ].join('\n')
}

export type ChatWakeResult = { thread: CodexChatThreadRecord; replies: CodexChatMessageRecord[]; followUpFailed?: boolean; followUpTimedOut?: boolean }

/**
 * Send one wake into a room the requester owns and wait for the answer (in a group room, every reply the wake set
 * off). `signal` stops the answer. Throws ChatWakeBusyError while the room is still answering.
 */
export async function wakeChatRoom(params: {
  requester: McpRequester
  threadId: number
  instruction: string
  routing: ChatRoutineRouting
  /** Group rooms: lowers the room's chain limit for this run. */
  chainLimit?: number | null
  signal?: AbortSignal
  mediaHashes?: string[]
  /** Group rooms: address the profile that delegated this work, rather than every member. */
  recipients?: number[]
  /** Host-only receipt, called after the direct room stores the input, before generation. */
  onDelivered?: (messageId: number) => void
  onPrimaryComplete?: () => void
  /** Only the caller's explicit plugin deadline may preserve the already-completed primary. */
  followUpDeadlineExpired?: () => boolean
}): Promise<ChatWakeResult> {
  const { requester, threadId } = params
  const { CodexChatError, CodexChatService, GroupChatService } = await chatServices()
  const thread = CodexChatStore.findThread(threadId, requester.accountId)
  if (!thread) throw new CodexChatError('실행 계정의 채팅방이 아니거나 없는 채팅방이야.', 404)
  if (!params.instruction.trim()) throw new CodexChatError('보낼 지시를 넣어줘.')
  const isGroup = thread.kind === 'group'
  if (isGroup ? GroupChatService.isRunning(threadId) : CodexChatService.isRunning(threadId)) throw new ChatWakeBusyError()
  if (params.signal?.aborted) throw new CodexChatError('실행이 취소됐어.', 409)

  const lastId = CodexChatStore.latestMessageId(threadId) ?? 0
  const text = wakeInstructionText(params.routing, params.instruction)
  let stopping: Promise<unknown> | undefined
  const stop = () => {
    if (stopping) return
    const active = params.routing.source === 'plugin' && !isGroup ? CodexChatService.captureRunningCompletion(threadId) : Promise.resolve()
    stopping = Promise.all([active, Promise.resolve(isGroup ? GroupChatService.stop(threadId) : CodexChatService.interrupt(requester, threadId)).catch(() => undefined)])
  }
  params.signal?.addEventListener('abort', stop, { once: true })
  let followUpFailed = false
  let draining = false, followUpTimedOut = false
  try {
    if (isGroup) {
      await GroupChatService.sendMessage(requester, threadId, text, () => {}, undefined, undefined, params.mediaHashes, undefined, undefined, { routine: params.routing, chainLimit: params.chainLimit, recipients: params.recipients })
    } else {
      const primary = await CodexChatService.sendMessage(requester, threadId, text, () => {}, undefined, undefined, undefined, params.mediaHashes, undefined, undefined, { routine: params.routing, onDelivered: params.onDelivered })
      if (params.routing.source === 'plugin' && primary?.status === 'completed' && !params.signal?.aborted) {
        params.onPrimaryComplete?.()
        draining = true
        followUpFailed = await drainJudgeFollowUps(threadId, params.signal)
      }
    }
  } catch (error) {
    // Lost the race with a send that started after the check above (either engine's "still answering").
    if (error instanceof Error && (error as { status?: unknown }).status === 409 && /진행 중/.test(error.message)) throw new ChatWakeBusyError()
    if (draining && params.followUpDeadlineExpired?.()) { followUpFailed = true; followUpTimedOut = true }
    else throw error
  } finally {
    params.signal?.removeEventListener('abort', stop)
    if (params.routing.source === 'plugin' && stopping) {
      await stopping
    }
  }
  const replies = CodexChatStore.listMessages(threadId, { after: lastId }).filter((message) => message.role === 'assistant')
  return { thread, replies, ...(followUpFailed ? { followUpFailed } : {}), ...(followUpTimedOut ? { followUpTimedOut } : {}) }
}

/** The text of the replies a wake set off, speaker-labelled in group rooms. */
export function wakeReplyText(result: ChatWakeResult) {
  const names = new Map(ChatProfileStore.listNames().map((profile) => [profile.id, profile.name]))
  return result.replies
    .filter((reply) => reply.status === 'completed' && reply.content.trim())
    .map((reply) => (result.thread.kind === 'group' && reply.speaker_profile_id ? `${names.get(reply.speaker_profile_id) ?? '참가자'}: ${reply.content.trim()}` : reply.content.trim()))
    .join('\n\n')
}

const ensured = new WeakSet<Database.Database>()
/** Rooms an automation made for itself, one per (account, key); created on first use like chat_tasks. */
function roomsTable() {
  const db = getUserSettingsDb()
  if (!ensured.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_automation_rooms (
        account_key TEXT NOT NULL,
        room_key TEXT NOT NULL,
        thread_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (account_key, room_key)
      );
    `)
    ensured.add(db)
  }
  return db
}

const accountKey = (accountId: number | null) => (accountId === null ? 'bootstrap' : String(accountId))

/**
 * The room an automation keeps for one character (`key` names the automation, e.g. `routine:3`): reused while it
 * exists and still holds that character, made again (as a normal chat of the account) when it was deleted.
 */
export async function ensureAutomationRoom(requester: McpRequester, profileId: number, key: string, title: string) {
  const db = roomsTable()
  const existing = findAutomationRoom(requester, profileId, key)
  if (existing) return existing
  const profile = ChatProfileStore.find(profileId)
  const { CodexChatError, CodexChatService } = await chatServices()
  if (!profile) throw new CodexChatError(`캐릭터를 찾을 수 없어: ${profileId}`, 404)
  const thread = CodexChatService.createThread(requester, profileId)
  CodexChatStore.updateListState(thread.id, { title: title.trim() || `${profile.name} 루틴` })
  db.prepare(`INSERT INTO chat_automation_rooms (account_key, room_key, thread_id) VALUES (?, ?, ?)
    ON CONFLICT(account_key, room_key) DO UPDATE SET thread_id = excluded.thread_id`).run(accountKey(requester.accountId), key, thread.id)
  return CodexChatStore.findThread(thread.id, requester.accountId) as CodexChatThreadRecord
}
/** Read-only lookup: a stale queued execution must not recreate a forgotten room. */
export function findAutomationRoom(requester: McpRequester, profileId: number, key: string) {
  const row = roomsTable().prepare('SELECT thread_id FROM chat_automation_rooms WHERE account_key=? AND room_key=?')
    .get(accountKey(requester.accountId), key) as { thread_id: number } | undefined
  const thread = row ? CodexChatStore.findThread(row.thread_id, requester.accountId) : undefined
  return thread?.kind === 'direct' && thread.profile_id === profileId ? thread : undefined
}

/** Forget an automation's room link (the room itself stays, as an ordinary chat). */
export function forgetAutomationRoom(accountId: number | null, key: string) {
  roomsTable().prepare('DELETE FROM chat_automation_rooms WHERE account_key = ? AND room_key = ?').run(accountKey(accountId), key)
}
/** Internal exact-key inventory for an account; public callers must further restrict their namespace. */
export function automationRooms(accountId: number | null) {
  return roomsTable().prepare('SELECT room_key, thread_id FROM chat_automation_rooms WHERE account_key=?')
    .all(accountKey(accountId)) as Array<{ room_key: string; thread_id: number }>
}

/** The account's rooms an automation made for itself, by thread, with what made them (the chat list files them apart). */
export function automationRoomKinds(accountId: number | null): Map<number, ChatAutomationRoomKind> {
  const rows = roomsTable().prepare('SELECT room_key, thread_id FROM chat_automation_rooms WHERE account_key = ?').all(accountKey(accountId)) as Array<{ room_key: string; thread_id: number }>
  const kinds = new Map<number, ChatAutomationRoomKind>()
  for (const row of rows) kinds.set(row.thread_id, row.room_key.startsWith('agent:') ? 'agent' : row.room_key.startsWith('posts:board:') ? 'board' : row.room_key.startsWith('workflow:') ? 'workflow' : row.room_key.startsWith('plugin:') ? 'plugin' : 'routine')
  return kinds
}

/** Also used at the proposal persistence boundary, without trusting model-supplied context flags. */
export function isAgentRoom(threadId: number) {
  return !!roomsTable().prepare("SELECT 1 FROM chat_automation_rooms WHERE thread_id = ? AND room_key LIKE 'agent:%'").get(threadId)
}

/** A chat's notification default when the owner never switched it: plugin and agent rooms stay quiet, every other chat notifies. */
export function chatNotifyDefault(kind: ChatAutomationRoomKind | null | undefined) {
  return kind !== 'plugin' && kind !== 'agent'
}

/** The shell badge counts unread replies of unarchived chats whose notifications are on (chatNotifyDefault unless switched). */
export function chatUnreadCount(accountId: number | null) {
  return (roomsTable().prepare(`
    SELECT COUNT(m.id) AS count FROM codex_chat_threads t
    JOIN codex_chat_messages m ON m.thread_id = t.id AND m.role = 'assistant'
      AND m.id > COALESCE(t.last_read_message_id, 0)
    WHERE t.account_id IS ? AND t.archived = 0
      AND COALESCE(t.notify, CASE WHEN EXISTS (SELECT 1 FROM chat_automation_rooms a
        WHERE a.thread_id = t.id AND a.account_key = ? AND (a.room_key LIKE 'agent:%' OR a.room_key LIKE 'plugin:%')) THEN 0 ELSE 1 END) = 1
  `).get(accountId, accountKey(accountId)) as { count: number }).count
}
