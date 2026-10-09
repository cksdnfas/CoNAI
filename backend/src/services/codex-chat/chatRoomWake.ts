import type Database from 'better-sqlite3'
import type { ChatRoutineRouting } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { McpRequester } from '../../mcp/context'
import { ChatProfileStore } from './chatProfiles'
import { CodexChatStore, type CodexChatMessageRecord, type CodexChatThreadRecord } from './codexChatStore'

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
  if (routing.source === 'post') {
    return [`[Posts board call on "${routing.name}" — sent by the app, not typed by the person]`, '', instruction.trim()].join('\n')
  }
  const sender = routing.source === 'routine' ? `Routine "${routing.name}"` : `Workflow "${routing.name}"`
  return [
    `[${sender} — sent by the app on a schedule, not typed by the person]`,
    'Do what it asks yourself, with your own tools. The person may not be watching; do not stop to ask them what you can decide.',
    '',
    instruction.trim(),
  ].join('\n')
}

export type ChatWakeResult = { thread: CodexChatThreadRecord; replies: CodexChatMessageRecord[] }

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
}): Promise<ChatWakeResult> {
  const { requester, threadId } = params
  const { CodexChatError, CodexChatService, GroupChatService } = await chatServices()
  const thread = CodexChatStore.findThread(threadId, requester.accountId)
  if (!thread) throw new CodexChatError('실행 계정의 채팅방이 아니거나 없는 채팅방이야.', 404)
  if (!params.instruction.trim()) throw new CodexChatError('보낼 지시를 넣어줘.')
  const isGroup = thread.kind === 'group'
  if (isGroup ? GroupChatService.isRunning(threadId) : CodexChatService.isRunning(threadId)) throw new ChatWakeBusyError()
  if (params.signal?.aborted) throw new CodexChatError('실행이 취소됐어.', 409)

  const lastId = CodexChatStore.listMessages(threadId).at(-1)?.id ?? 0
  const text = wakeInstructionText(params.routing, params.instruction)
  const stop = () => {
    const stopping = isGroup ? GroupChatService.stop(threadId) : CodexChatService.interrupt(requester, threadId)
    void Promise.resolve(stopping).catch(() => undefined)
  }
  params.signal?.addEventListener('abort', stop, { once: true })
  try {
    if (isGroup) {
      await GroupChatService.sendMessage(requester, threadId, text, () => {}, undefined, undefined, undefined, undefined, undefined, { routine: params.routing, chainLimit: params.chainLimit })
    } else {
      await CodexChatService.sendMessage(requester, threadId, text, () => {}, undefined, undefined, undefined, undefined, undefined, undefined, { routine: params.routing })
    }
  } catch (error) {
    // Lost the race with a send that started after the check above (either engine's "still answering").
    if (error instanceof Error && (error as { status?: unknown }).status === 409 && /진행 중/.test(error.message)) throw new ChatWakeBusyError()
    throw error
  } finally {
    params.signal?.removeEventListener('abort', stop)
  }
  const replies = CodexChatStore.listMessages(threadId).filter((message) => message.id > lastId && message.role === 'assistant')
  return { thread, replies }
}

/** The text of the replies a wake set off, speaker-labelled in group rooms. */
export function wakeReplyText(result: ChatWakeResult) {
  const names = new Map(ChatProfileStore.list().map((profile) => [profile.id, profile.name]))
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
  const row = db.prepare('SELECT thread_id FROM chat_automation_rooms WHERE account_key = ? AND room_key = ?').get(accountKey(requester.accountId), key) as { thread_id: number } | undefined
  const existing = row ? CodexChatStore.findThread(row.thread_id, requester.accountId) : null
  if (existing && existing.kind === 'direct' && existing.profile_id === profileId) return existing
  const profile = ChatProfileStore.find(profileId)
  const { CodexChatError, CodexChatService } = await chatServices()
  if (!profile) throw new CodexChatError(`캐릭터를 찾을 수 없어: ${profileId}`, 404)
  const thread = CodexChatService.createThread(requester, profileId)
  CodexChatStore.updateListState(thread.id, { title: title.trim() || `${profile.name} 루틴` })
  db.prepare(`INSERT INTO chat_automation_rooms (account_key, room_key, thread_id) VALUES (?, ?, ?)
    ON CONFLICT(account_key, room_key) DO UPDATE SET thread_id = excluded.thread_id`).run(accountKey(requester.accountId), key, thread.id)
  return CodexChatStore.findThread(thread.id, requester.accountId) as CodexChatThreadRecord
}

/** Forget an automation's room link (the room itself stays, as an ordinary chat). */
export function forgetAutomationRoom(accountId: number | null, key: string) {
  roomsTable().prepare('DELETE FROM chat_automation_rooms WHERE account_key = ? AND room_key = ?').run(accountKey(accountId), key)
}
