import type Database from 'better-sqlite3'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChatAgentCallStatus, ChatAgentOnDone, ChatExecutionContext } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { McpRequester } from '../../mcp/context'
import { resolveAutomationRunAs } from '../automationRunAs'
import { FileStoreService, fileOwnerKey } from '../fileStoreService'
import { canUseChatProfile, resolveChatAccess, resolveChatProfileToolGrant } from './codexChatAccess'
import { BoardCallRooms } from '../posts/boardCallRooms'
import { moveThreadFileChanges } from './chatFileChanges'
import { ChatProfileStore } from './chatProfiles'
import { CodexChatStore } from './codexChatStore'
import { onChatReplyFinished, requireActiveChatReply } from './chatReplyRegistry'
import { translateReply } from './chatTranslation'
import { userPersonaForThread } from './chatUserProfiles'
import { ChatWakeBusyError, ensureAutomationRoom, forgetAutomationRoom, isAgentRoom, wakeChatRoom } from './chatRoomWake'
import { automationResults } from './chatAutomationResults'
import { backupFileName } from './chatBackup'

type AgentCall = {
  id: number; account_key: string; caller_thread_id: number; caller_profile_id: number
  agent_profile_id: number; agent_thread_id: number | null; agent_after_message_id: number; agent_name: string; caller_name: string
  instruction: string; on_done: ChatAgentOnDone; status: ChatAgentCallStatus; error: string | null
  result_message_id: number | null; finished_at: string | null; expires_at: string | null; created_at: string
  reaction_state: 'pending' | 'running' | 'done'; reaction_attempts: number; log_file_id: string | null
  publish_failed: number
}

const ensured = new WeakSet<Database.Database>()
function table() {
  const db = getUserSettingsDb()
  if (!ensured.has(db)) {
    db.exec(`CREATE TABLE IF NOT EXISTS chat_agent_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_key TEXT NOT NULL,
      caller_thread_id INTEGER NOT NULL, caller_profile_id INTEGER NOT NULL,
      agent_profile_id INTEGER NOT NULL, agent_thread_id INTEGER, agent_after_message_id INTEGER NOT NULL DEFAULT 0,
      agent_name TEXT NOT NULL, caller_name TEXT NOT NULL, instruction TEXT NOT NULL,
      on_done TEXT NOT NULL CHECK(on_done IN ('notify','react')),
      status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled')),
      error TEXT, result_message_id INTEGER, finished_at TEXT, expires_at TEXT,
      created_at TEXT NOT NULL, reaction_state TEXT NOT NULL DEFAULT 'pending',
      reaction_attempts INTEGER NOT NULL DEFAULT 0, log_file_id TEXT, publish_failed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS chat_agent_calls_caller ON chat_agent_calls(caller_thread_id, status);
    CREATE INDEX IF NOT EXISTS chat_agent_calls_expiry ON chat_agent_calls(expires_at);
    CREATE INDEX IF NOT EXISTS chat_agent_calls_state ON chat_agent_calls(status, reaction_state);`)
    if (!(db.prepare('PRAGMA table_info(chat_agent_calls)').all() as Array<{ name: string }>).some(column => column.name === 'publish_failed')) {
      db.exec('ALTER TABLE chat_agent_calls ADD COLUMN publish_failed INTEGER NOT NULL DEFAULT 0')
    }
    ensured.add(db)
  }
  return db
}
const accountIdOf = (call: AgentCall) => call.account_key === 'bootstrap' ? null : Number(call.account_key)
const roomKey = (id: number) => `agent:${id}`
const running = new Map<number, AbortController>()
const reacting = new Map<number, AbortController>()
let timer: NodeJS.Timeout | null = null
let stopReplyListener: (() => void) | null = null
const processing = new Map<number, { promise: Promise<void>; controller: AbortController }>()
function find(id: number) { return table().prepare('SELECT * FROM chat_agent_calls WHERE id = ?').get(id) as AgentCall | undefined }
function warn(id: number, error: unknown) { console.warn(`[chat-agent] ${id}:`, error instanceof Error ? error.message : error) }

/** The owner of the bound room, never a caller-supplied account or the agent profile's author. */
function delegationRestricted(chat: ChatExecutionContext) {
  return chat.page?.path.startsWith('/public/') === true || BoardCallRooms.runFor(chat.threadId, chat.profileId) !== null || isAgentRoom(chat.threadId)
}

function callerAllowsAgents(requester: McpRequester, chat: ChatExecutionContext) {
  const profile = ChatProfileStore.findToolGrant(chat.profileId)
  if (!profile) return false
  const grant = resolveChatProfileToolGrant(profile, resolveChatAccess(requester.accountId))
  return grant.scopes.length > 0 && (grant.toolAllowlist === null || grant.toolAllowlist.includes('call_agent'))
}

export function usableChatAgents(requester: McpRequester, chat: ChatExecutionContext) {
  if (!CodexChatStore.findThread(chat.threadId, requester.accountId) || delegationRestricted(chat) || !callerAllowsAgents(requester, chat)) return []
  const access = resolveChatAccess(requester.accountId)
  return ChatProfileStore.listAgents()
    .filter(profile => profile.id !== chat.profileId && canUseChatProfile(access, profile))
    .map(({ id, name, agentDescription }) => ({ id, name, agentDescription }))
}

function requireAgent(requester: McpRequester, chat: ChatExecutionContext, profileId: number) {
  if (!CodexChatStore.findThread(chat.threadId, requester.accountId)) throw new Error('호출한 채팅방을 찾을 수 없어.')
  if (delegationRestricted(chat)) throw new Error('Agent delegation is not allowed in agent rooms, board calls or public pages.')
  const profile = ChatProfileStore.find(profileId)
  if (!profile || profile.id === chat.profileId || !profile.isEnabled || !profile.agentEnabled || !canUseChatProfile(resolveChatAccess(requester.accountId), profile)) {
    throw new Error('사용 가능한 에이전트 프로필이 아니야.')
  }
  if (!callerAllowsAgents(requester, chat)) throw new Error('이 프로필의 도구 설정에서는 에이전트를 호출할 수 없어.')
  return profile
}

/** Admission is synchronous. The model receives a running id before any agent model invocation. No call/cost cap. */
export function callChatAgent(requester: McpRequester, chat: ChatExecutionContext, input: {
  agentProfileId: number; instruction: string; mediaHashes?: string[]; onDone?: ChatAgentOnDone
}) {
  requireActiveChatReply(chat)
  const agent = requireAgent(requester, chat, input.agentProfileId)
  const instruction = input.instruction.trim()
  if (!instruction || instruction.length > 20_000) throw new Error('에이전트 지시는 1~20000자로 입력해줘.')
  if (input.onDone !== undefined && input.onDone !== 'notify' && input.onDone !== 'react') throw new Error('on_done must be notify or react.')
  const caller = ChatProfileStore.find(chat.profileId)
  if (!caller) throw new Error('호출한 프로필을 찾을 수 없어.')
  const id = Number(table().prepare(`INSERT INTO chat_agent_calls
    (account_key, caller_thread_id, caller_profile_id, agent_profile_id, agent_name, caller_name, instruction, on_done, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`).run(requester.accountId === null ? 'bootstrap' : String(requester.accountId),
    chat.threadId, chat.profileId, agent.id, agent.name, caller.name, instruction, input.onDone ?? 'notify', new Date().toISOString()).lastInsertRowid)
  const controller = new AbortController()
  running.set(id, controller)
  setImmediate(() => { void execute(id, requester, chat, input.mediaHashes, controller).catch(error => warn(id, error)) })
  return { callId: id, status: 'running' as const }
}

function repliesOf(call: AgentCall) {
  return call.agent_thread_id === null ? [] : CodexChatStore.listMessages(call.agent_thread_id, { after: call.agent_after_message_id }).filter(reply => reply.role === 'assistant')
}

/** Reusable for initial delivery and jobs/file writes arriving after a failed reply was published. */
function moveResultLinks(call: AgentCall, messageId: number) {
  if (call.agent_thread_id === null) return
  const replyId = `agent-result:${call.id}`
  const db = table()
  db.transaction(() => {
    db.prepare('UPDATE chat_generation_links SET thread_id = ?, reply_id = ?, message_id = ?, reaction_target = 0 WHERE thread_id = ?')
      .run(call.caller_thread_id, replyId, messageId, call.agent_thread_id)
    moveThreadFileChanges(call.agent_thread_id!, call.caller_thread_id, replyId)
  })()
}

/** Publishing and the marker commit together: sweeps/restarts never post a second result. */
async function publish(call: AgentCall, signal: AbortSignal) {
  if (call.publish_failed || call.result_message_id !== null || (call.status !== 'completed' && call.status !== 'failed')) return true
  const thread = CodexChatStore.findThread(call.caller_thread_id, accountIdOf(call))
  if (!thread) return true
  const [{ CodexChatService }, { GroupChatService }] = await Promise.all([import('./codexChatService'), import('./groupChatService')])
  const busy = () => thread.kind === 'group' ? GroupChatService.isRunning(thread.id) : CodexChatService.isRunning(thread.id)
  if (busy()) return false
  const replies = repliesOf(call)
  const content = call.status === 'failed' ? `${call.agent_name} 에이전트 작업 실패: ${call.error ?? '작업을 완료하지 못했어.'}` : replies.map(reply => reply.content).filter(Boolean).join('\n\n')
  const profileId = thread.kind === 'group' ? call.caller_profile_id : thread.profile_id ?? call.caller_profile_id
  const profile = ChatProfileStore.find(profileId)
  const replyId = `agent-result:${call.id}`
  const parts = call.status === 'completed' ? replies : [{ content, display_content: null }]
  const displayed = (await Promise.all(parts.map(async reply => reply.display_content?.trim() ? reply.display_content
    : await translateReply(profile, reply.content, signal, userPersonaForThread(thread).name, { threadId: thread.id, replyId }) ?? reply.content)))
    .filter(Boolean).join('\n\n')
  signal.throwIfAborted()
  const db = table()
  const savedId = db.transaction(() => {
    const current = find(call.id)
    // A new caller turn may have started while display translation was in flight. Never insert ahead of it.
    if (!current || current.status !== call.status || current.result_message_id !== null || !CodexChatStore.findThread(call.caller_thread_id, accountIdOf(call)) || busy()) return
    const { calls, messageToolsTruncated: toolsTruncated } = automationResults(replies)
    const messageId = CodexChatStore.addMessage({
      thread_id: call.caller_thread_id, role: 'assistant', speaker_profile_id: call.agent_profile_id,
      content, display_content: displayed && displayed !== content ? displayed : null,
      tool_calls: calls, status: 'completed', error: null,
      routing: { replyId, replyTo: null, recipients: ['room'], agent: {
        callId: call.id, profileId: call.agent_profile_id, name: call.agent_name,
        status: call.status as 'completed' | 'failed', toolsTruncated,
      } },
    }, [], { notify: false })
    // Keep queued generation ownership in the durable result room, not the expiring room. Generic generation
    // reactions must not wake it a second time; on_done controls the one reaction.
    moveResultLinks(call, messageId)
    db.prepare('UPDATE chat_agent_calls SET result_message_id = ? WHERE id = ?').run(messageId, call.id)
    return messageId
  }).immediate()
  if (savedId !== undefined) CodexChatStore.notifyMessageAdded({ id: savedId, threadId: call.caller_thread_id, accountId: accountIdOf(call), role: 'assistant' })
  return savedId !== undefined
}

function finish(id: number, status: 'completed' | 'failed', error: string | null) {
  const now = Date.now()
  table().prepare(`UPDATE chat_agent_calls SET status = ?, error = ?, finished_at = ?, expires_at = ?
    WHERE id = ? AND status = 'running'`).run(status, error?.slice(0, 1000) ?? null, new Date(now).toISOString(), new Date(now + 3_600_000).toISOString(), id)
  const call = find(id)
  if (call) void processCall(call).catch(error => warn(id, error))
}

async function execute(id: number, requester: McpRequester, chat: ChatExecutionContext, mediaHashes: string[] | undefined, controller: AbortController) {
  const signal = controller.signal
  try {
    signal.throwIfAborted()
    const call = find(id)!
    requireAgent(requester, chat, call.agent_profile_id)
    const room = await ensureAutomationRoom(requester, call.agent_profile_id, roomKey(id), `${call.agent_name} · 에이전트 #${id}`)
    table().prepare('UPDATE chat_agent_calls SET agent_thread_id = ?, agent_after_message_id = ? WHERE id = ?')
      .run(room.id, CodexChatStore.latestMessageId(room.id) ?? 0, id)
    // There is no person to watch this room; only the caller's on_done reaction is allowed.
    table().prepare('UPDATE codex_chat_threads SET reaction_enabled = 0 WHERE id = ?').run(room.id)
    signal.throwIfAborted()
    const result = await wakeChatRoom({ requester, threadId: room.id, instruction: call.instruction,
      routing: { source: 'agent', id, name: call.caller_name }, mediaHashes, signal })
    signal.throwIfAborted()
    if (!result.replies.length || result.replies.some(reply => reply.status !== 'completed')) {
      throw new Error(result.replies.find(reply => reply.error)?.error ?? '에이전트가 작업을 완료하지 못했어.')
    }
    // An after-preset still has to enqueue its job before we can transfer its durable references.
    while (table().prepare("SELECT 1 FROM chat_deferred_generations WHERE thread_id = ? AND state IN ('pending','writing') LIMIT 1").get(room.id)) {
      await delay(1000, undefined, { signal })
    }
    signal.throwIfAborted()
    finish(id, 'completed', null)
  } catch (error) {
    if (!signal.aborted) finish(id, 'failed', error instanceof Error ? error.message : String(error))
  } finally {
    running.delete(id)
  }
}

/** Called at the shared deletion boundary, covering both direct and group callers. */
export function cancelAgentCallsForThread(threadId: number) {
  const db = table()
  const calls = db.prepare("SELECT * FROM chat_agent_calls WHERE caller_thread_id = ? AND (status = 'running' OR reaction_state != 'done')").all(threadId) as AgentCall[]
  const now = Date.now()
  for (const call of calls) {
    db.prepare(`UPDATE chat_agent_calls SET status = CASE WHEN status = 'running' THEN 'cancelled' ELSE status END,
      finished_at = COALESCE(finished_at, ?), expires_at = COALESCE(expires_at, ?), reaction_state = 'done'
      WHERE id = ?`).run(new Date(now).toISOString(), new Date(now + 3_600_000).toISOString(), call.id)
    running.get(call.id)?.abort()
    reacting.get(call.id)?.abort()
    processing.get(call.id)?.controller.abort()
  }
}

async function react(call: AgentCall, now = Date.now()) {
  if (call.on_done !== 'react' || call.reaction_state !== 'pending' || call.result_message_id === null || reacting.has(call.id)) return
  const db = table()
  // Check terminal queue state rather than thumbnail placeholders (a partially completed batch may have both).
  const result = CodexChatStore.findMessage(call.caller_thread_id, call.result_message_id)
  const linked = db.prepare('SELECT job_id FROM chat_generation_links WHERE thread_id = ? AND reply_id = ?')
    .all(call.caller_thread_id, `agent-result:${call.id}`) as Array<{ job_id: number }>
  const jobIds = [...new Set([...linked.map(row => row.job_id),
    ...(result?.tool_calls.flatMap(tool => [...tool.jobIds ?? [], ...tool.pendingJobIds ?? []]) ?? [])])]
  const jobsStillRunning = jobIds.length > 0 && !!db.prepare(`SELECT 1 FROM generation_queue_jobs
    WHERE id IN (${jobIds.map(() => '?').join(',')}) AND status NOT IN ('completed','failed','cancelled') LIMIT 1`).get(...jobIds)
  if (jobsStillRunning && now < Date.parse(call.finished_at!) + 30 * 60_000) return
  const runAs = resolveAutomationRunAs(accountIdOf(call), [])
  if (!runAs.ok || !CodexChatStore.findThread(call.caller_thread_id, accountIdOf(call))) {
    db.prepare("UPDATE chat_agent_calls SET reaction_state = 'done' WHERE id = ?").run(call.id)
    return
  }
  const controller = new AbortController()
  reacting.set(call.id, controller)
  try {
    if (!db.prepare("UPDATE chat_agent_calls SET reaction_state = 'running', reaction_attempts = reaction_attempts + 1 WHERE id = ? AND reaction_state = 'pending'").run(call.id).changes) return
    await wakeChatRoom({ requester: runAs.requester, threadId: call.caller_thread_id,
      instruction: `${call.agent_name} 에이전트의 결과가 메시지 #${call.result_message_id}에 도착했어. ${jobsStillRunning ? '30분 대기 한도에 도달했으며 일부 생성 작업은 아직 실행 중이야. 완료됐다고 말하지 마.' : '생성 작업도 끝났어.'} 결과와 도구 산출물을 확인하고 필요한 반응을 해줘.`,
      routing: { source: 'agent_result', id: call.id, name: call.agent_name }, recipients: [call.caller_profile_id], signal: controller.signal })
    db.prepare("UPDATE chat_agent_calls SET reaction_state = 'done' WHERE id = ?").run(call.id)
  } catch (error) {
    db.prepare('UPDATE chat_agent_calls SET reaction_state = ? WHERE id = ?')
      .run(error instanceof ChatWakeBusyError && call.reaction_attempts + 1 < 60 && !controller.signal.aborted ? 'pending' : 'done', call.id)
    if (!(error instanceof ChatWakeBusyError) && !controller.signal.aborted) warn(call.id, error)
  } finally { reacting.delete(call.id) }
}

async function cleanup(call: AgentCall) {
  const accountId = accountIdOf(call)
  if (!call.publish_failed && (call.status === 'completed' || call.status === 'failed') && call.result_message_id === null && CodexChatStore.findThread(call.caller_thread_id, accountId)) return
  if (call.status === 'failed' && !call.log_file_id) {
    const owner = fileOwnerKey(accountId)
    const root = FileStoreService.ensureFolder(owner, null, '에이전트 작업 기록')
    const day = FileStoreService.ensureFolder(owner, root.id, call.finished_at!.slice(0, 10))
    const replies = repliesOf(call)
    const result = call.result_message_id === null ? undefined : CodexChatStore.findMessage(call.caller_thread_id, call.result_message_id)
    const { tools, summaryToolsTruncated: toolsTruncated } = automationResults(result ? [result] : replies)
    const file = FileStoreService.writeText(owner, day.id, backupFileName(call.agent_name, call.id), JSON.stringify({
      call: { id: call.id, accountKey: call.account_key, callerThreadId: call.caller_thread_id, callerProfileId: call.caller_profile_id,
        agentProfileId: call.agent_profile_id, agentThreadId: call.agent_thread_id, agentName: call.agent_name, callerName: call.caller_name,
        onDone: call.on_done, createdAt: call.created_at, finishedAt: call.finished_at, expiresAt: call.expires_at },
      instruction: call.instruction.slice(0, 500), status: call.status, error: call.error,
      agentReply: replies.map(reply => reply.display_content ?? reply.content).join('\n\n').slice(0, 1000),
      // Only typed result metadata: raw output/arguments can contain setup prompts or system text.
      tools: tools.map(({ output: _output, summary: _summary, ...tool }) => tool), toolsTruncated,
    }, null, 2))
    table().prepare('UPDATE chat_agent_calls SET log_file_id = ? WHERE id = ?').run(file.id, call.id)
  }
  if (call.agent_thread_id !== null && CodexChatStore.findThread(call.agent_thread_id, accountId)) {
    const { CodexChatService } = await import('./codexChatService')
    if (call.result_message_id !== null && CodexChatStore.findMessage(call.caller_thread_id, call.result_message_id)) moveResultLinks(call, call.result_message_id)
    await CodexChatService.deleteThread({ accountId, accountType: null }, call.agent_thread_id)
  }
  forgetAutomationRoom(accountId, roomKey(call.id))
  // Queue jobs can outlive the room's one-hour TTL. Keep only the call's pending reaction until they settle;
  // its durable job links and result already live in the caller room.
  if (call.on_done === 'react' && call.reaction_state !== 'done') {
    table().prepare('UPDATE chat_agent_calls SET agent_thread_id = NULL WHERE id = ?').run(call.id)
  } else {
    table().prepare('DELETE FROM chat_agent_calls WHERE id = ?').run(call.id)
  }
}

/** Independent deliveries: a busy/translated caller never holds up another call or the sweep. */
function processCall(row: AgentCall, now = new Date()): Promise<void> {
  const existing = processing.get(row.id)
  if (existing) return existing.promise
  const controller = new AbortController()
  const promise = (async () => {
    try {
      try {
        if (!await publish(row, controller.signal)) return
      } catch (error) {
        if (controller.signal.aborted) return
        if (!row.expires_at || now.getTime() < Date.parse(row.expires_at) + 60 * 60_000) throw error
        const reason = `결과 게시 재시도 기한 만료: ${error instanceof Error ? error.message : String(error)}`
        table().prepare("UPDATE chat_agent_calls SET status = 'failed', publish_failed = 1, error = ?, reaction_state = 'done' WHERE id = ?")
          .run([reason, row.error].filter(Boolean).join('\n').slice(0, 1000), row.id)
        warn(row.id, error)
      }
      const call = find(row.id)
      if (!call) return
      if (call.expires_at && call.expires_at <= now.toISOString()) await cleanup(call)
      const remaining = find(row.id)
      // Publication precedes the wake. wakeChatRoom rechecks busy state and react retries without re-posting.
      if (remaining) await react(remaining, now.getTime())
    } catch (error) { if (!controller.signal.aborted) warn(row.id, error) }
    finally { processing.delete(row.id) }
  })()
  processing.set(row.id, { promise, controller })
  return promise
}

export const ChatAgentRunner = {
  start() {
    if (timer) return
    stopReplyListener = onChatReplyFinished(({ threadId }) => {
      // Reply close can precede the engine's idle marker; yield until its completion stack has unwound.
      setImmediate(() => {
        if (!timer) return
        const calls = table().prepare("SELECT * FROM chat_agent_calls WHERE caller_thread_id = ? AND status IN ('completed','failed') AND result_message_id IS NULL")
          .all(threadId) as AgentCall[]
        for (const call of calls) void processCall(call).catch(error => warn(call.id, error))
      })
    })
    // A started reaction is at-most-once across restart. Unstarted/busy reactions can still be delivered.
    table().prepare("UPDATE chat_agent_calls SET reaction_state = 'done' WHERE reaction_state = 'running'").run()
    const interrupted = table().prepare("SELECT id FROM chat_agent_calls WHERE status = 'running'").all() as Array<{ id: number }>
    for (const { id } of interrupted) {
      try { finish(id, 'failed', '서버 재시작으로 중단') } catch (error) { warn(id, error) }
    }
    void ChatAgentRunner.poll().catch(error => warn(0, error))
    timer = setInterval(() => { void ChatAgentRunner.poll().catch(error => warn(0, error)) }, 60_000)
    timer.unref()
  },
  stop() {
    if (timer) clearInterval(timer)
    timer = null
    stopReplyListener?.()
    stopReplyListener = null
    for (const controller of running.values()) controller.abort()
    for (const controller of reacting.values()) controller.abort()
    for (const entry of processing.values()) entry.controller.abort()
  },
  async poll(now = new Date()) {
    const rows = table().prepare(`SELECT * FROM chat_agent_calls WHERE status != 'running'
      AND (result_message_id IS NULL OR (on_done = 'react' AND reaction_state = 'pending') OR expires_at <= ?) ORDER BY id`).all(now.toISOString()) as AgentCall[]
    await Promise.all(rows.map(row => processCall(row, now)))
  },
}
