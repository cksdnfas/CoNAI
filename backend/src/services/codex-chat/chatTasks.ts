import type Database from 'better-sqlite3'
import { CHAT_TASK_DEFAULT_BUDGET, CHAT_TASK_LIMITS, type ChatExecutionContext, type ChatRoutineRouting, type ChatTask, type ChatTaskAssignee, type ChatTaskBudget, type ChatTaskRouting, type ChatTaskStatus, type ChatTaskStep, type ChatTaskSummary, type ChatTaskWait } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { McpRequester } from '../../mcp/context'
import { AuthAccount } from '../../models/AuthAccount'
import { hasConfiguredAuth } from '../auth/sessionAccess'
import { publishRuntimeEvent, subscribeToRuntimeEvents } from '../runtime-events/runtimeEventBus'
import { onChatReplyFinished } from './chatReplyRegistry'
import { onProposalResolved } from './chatProposals'
import { lastChatPageForThread } from './chatPageBridge'
import { onChatUserSend } from './chatSendEvents'
import { CodexChatStore } from './codexChatStore'
import { ChatProfileStore } from './chatProfiles'
import { ChatGroupStore } from './chatGroupStore'
import { withLlmUsageContext } from '../llmUsage'

/** Extra options of a send that the person did not type: a task continuation or an automation's wake is marked so it shows as one thin line. */
/** `choice`: the request body's answer to the chat's question card, unchecked (see readChoiceAnswer). */
export type ChatSendOptions = { task?: ChatTaskRouting; routine?: ChatRoutineRouting; choice?: unknown }

type TaskRow = { id: number; thread_id: number; goal: string; steps: string; status: ChatTaskStatus; wait: ChatTaskWait | null; reason: string | null; budget: string; used: string; progress: string | null; stalled: number; active_since: string | null; created_at: string; updated_at: string }

const ensured = new WeakSet<Database.Database>()
/** Created on first use like chat_proposals; the statements are idempotent. */
function table() {
  const db = getUserSettingsDb()
  if (!ensured.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        goal TEXT NOT NULL,
        steps TEXT NOT NULL,
        status TEXT NOT NULL,
        wait TEXT,
        reason TEXT,
        budget TEXT NOT NULL,
        used TEXT NOT NULL,
        progress TEXT,
        stalled INTEGER NOT NULL DEFAULT 0,
        active_since TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_chat_tasks_thread ON chat_tasks (thread_id, id);
    `)
    // Tables made before the active-time limit gain its column.
    if (!(db.prepare('PRAGMA table_info(chat_tasks)').all() as Array<{ name: string }>).some((column) => column.name === 'active_since')) db.exec('ALTER TABLE chat_tasks ADD COLUMN active_since TEXT')
    ensured.add(db)
  }
  return db
}

const LIVE: ChatTaskStatus[] = ['awaiting_plan', 'running', 'waiting', 'paused']
const parse = <T>(value: string | null, fallback: T): T => { try { return value ? JSON.parse(value) as T : fallback } catch { return fallback } }
function toTask(row: TaskRow): ChatTask {
  return { id: row.id, threadId: row.thread_id, goal: row.goal, steps: parse<ChatTaskStep[]>(row.steps, []), status: row.status, wait: row.wait, reason: row.reason, budget: parse(row.budget, CHAT_TASK_DEFAULT_BUDGET), used: parse(row.used, { continuations: 0, images: 0 }), createdAt: row.created_at, updatedAt: row.updated_at }
}
const clip = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

function announce(task: ChatTask | null) {
  if (!task) return
  const thread = CodexChatStore.findThreadById(task.threadId)
  publishRuntimeEvent({ name: 'chat.task.updated', topic: 'generation-queue', visibility: 'owner', accountId: thread?.account_id ?? null, payload: { threadId: task.threadId, taskId: task.id, status: task.status } })
}

export const ChatTaskStore = {
  create(threadId: number, goal: string, steps: Array<{ title: string; approval?: boolean; assignee?: ChatTaskAssignee }>, budget?: Partial<ChatTaskBudget>): ChatTask {
    const cleanGoal = clip(goal, CHAT_TASK_LIMITS.goal)
    const cleanSteps = steps.slice(0, CHAT_TASK_LIMITS.steps).map((step) => ({ title: clip(step.title, CHAT_TASK_LIMITS.stepTitle), status: 'todo' as const, ...(step.approval ? { approval: true } : {}), ...(step.assignee !== undefined ? { assignee: step.assignee } : {}) })).filter((step) => step.title)
    if (!cleanGoal || !cleanSteps.length) throw new Error('목표와 단계가 필요해.')
    const limit = (value: unknown, max: number, fallback: number) => Number.isSafeInteger(value) && (value as number) > 0 ? Math.min(value as number, max) : fallback
    if (budget?.tokens !== undefined && (!Number.isSafeInteger(budget.tokens) || budget.tokens <= 0 || budget.tokens > CHAT_TASK_LIMITS.tokens)) throw new Error('토큰 예산은 작업 최대 한도 이내의 양의 정수여야 해.')
    const cleanBudget = { continuations: limit(budget?.continuations, CHAT_TASK_LIMITS.continuations, CHAT_TASK_DEFAULT_BUDGET.continuations), images: limit(budget?.images, CHAT_TASK_LIMITS.images, CHAT_TASK_DEFAULT_BUDGET.images), ...(budget?.tokens === undefined ? {} : { tokens: budget.tokens }) }
    const id = Number(table().prepare('INSERT INTO chat_tasks (thread_id, goal, steps, status, budget, used) VALUES (?, ?, ?, ?, ?, ?)').run(threadId, cleanGoal, JSON.stringify(cleanSteps), 'awaiting_plan', JSON.stringify(cleanBudget), JSON.stringify({ continuations: 0, images: 0 })).lastInsertRowid)
    const task = ChatTaskStore.find(id)!
    announce(task)
    return task
  },
  find(id: number): ChatTask | null {
    const row = table().prepare('SELECT * FROM chat_tasks WHERE id = ?').get(id) as TaskRow | undefined
    return row ? toTask(row) : null
  },
  /** The chat's task that is not finished yet, if any. */
  live(threadId: number): ChatTask | null {
    const row = table().prepare(`SELECT * FROM chat_tasks WHERE thread_id = ? AND status IN (${LIVE.map(() => '?').join(', ')}) ORDER BY id DESC LIMIT 1`).get(threadId, ...LIVE) as TaskRow | undefined
    return row ? toTask(row) : null
  },
  /** The unfinished task of each listed chat, for the progress ring in chat lists (plans not approved yet are left out). */
  summaries(threadIds: number[]): Map<number, ChatTaskSummary> {
    const result = new Map<number, ChatTaskSummary>()
    if (!threadIds.length) return result
    const rows = table().prepare(`SELECT * FROM chat_tasks WHERE status IN ('running', 'waiting', 'paused') AND thread_id IN (${threadIds.map(() => '?').join(', ')}) ORDER BY id`).all(...threadIds) as TaskRow[]
    for (const task of rows.map(toTask)) {
      const current = task.steps.find((step) => step.status === 'doing') ?? task.steps.find((step) => step.status === 'todo')
      result.set(task.threadId, { status: task.status, wait: task.wait, done: task.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length, total: task.steps.length, step: current?.title ?? null })
    }
    return result
  },
  /** The newest task of the chat, finished or not (for the progress card). */
  latest(threadId: number): ChatTask | null {
    const row = table().prepare('SELECT * FROM chat_tasks WHERE thread_id = ? ORDER BY id DESC LIMIT 1').get(threadId) as TaskRow | undefined
    return row ? toTask(row) : null
  },
  update(id: number, patch: Partial<Pick<ChatTask, 'steps' | 'status' | 'wait' | 'reason' | 'used' | 'budget'>>): ChatTask | null {
    const current = ChatTaskStore.find(id)
    if (!current) return null
    const next = { ...current, ...patch }
    // A request can finish while a runner is awaiting a reply. Never overwrite its newly recorded tokens.
    if (current.used.tokens !== undefined) next.used = { ...next.used, tokens: Math.max(current.used.tokens, next.used.tokens ?? 0) }
    table().prepare("UPDATE chat_tasks SET steps = ?, status = ?, wait = ?, reason = ?, used = ?, budget = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(next.steps), next.status, next.status === 'waiting' ? next.wait : null, next.reason, JSON.stringify(next.used), JSON.stringify(next.budget), id)
    const task = ChatTaskStore.find(id)
    announce(task)
    return task
  },
  /** Remembers the step state at a continuation; returns how many continuations in a row changed nothing. */
  markProgress(id: number): number {
    const row = table().prepare('SELECT steps, progress, stalled FROM chat_tasks WHERE id = ?').get(id) as Pick<TaskRow, 'steps' | 'progress' | 'stalled'> | undefined
    if (!row) return 0
    const stalled = row.progress === row.steps ? row.stalled + 1 : 0
    table().prepare('UPDATE chat_tasks SET progress = ?, stalled = ? WHERE id = ?').run(row.steps, stalled, id)
    return stalled
  },
  /** The task (re)starts running now: the active-time limit counts from here. */
  markActive(id: number) {
    table().prepare("UPDATE chat_tasks SET active_since = datetime('now'), stalled = 0 WHERE id = ?").run(id)
  },
  /** How long the task has been running since it was approved or last resumed. */
  activeMs(id: number) {
    const row = table().prepare('SELECT active_since, created_at FROM chat_tasks WHERE id = ?').get(id) as Pick<TaskRow, 'active_since' | 'created_at'> | undefined
    const since = row?.active_since ?? row?.created_at
    return since ? Date.now() - Date.parse(`${since.replace(' ', 'T')}Z`) : 0
  },
  deleteForThread(threadId: number) {
    return table().prepare('DELETE FROM chat_tasks WHERE thread_id = ?').run(threadId).changes
  },
}

/** Images the chat's generation tools queued in this chat since the task began. */
function imagesUsed(task: ChatTask) {
  const row = getUserSettingsDb().prepare("SELECT COUNT(*) AS count FROM chat_generation_links l JOIN generation_queue_jobs j ON j.id = l.job_id WHERE l.thread_id = ? AND j.created_date >= ?").get(task.threadId, task.createdAt) as { count: number } | undefined
  return row?.count ?? 0
}

function requesterOf(accountId: number | null): McpRequester | null {
  if (accountId === null) return hasConfiguredAuth() ? null : { accountId: null, accountType: 'admin' }
  const account = AuthAccount.findById(accountId)
  return account?.status === 'active' ? { accountId, accountType: account.account_type } : null
}

type Member = { id: number; name: string }

function stepsText(task: ChatTask, members: Member[] = []) {
  const mark = { todo: ' ', doing: '>', done: 'x', skipped: '-' }
  const who = (step: ChatTaskStep) => step.assignee === undefined ? '' : ` @${step.assignee === 'all' ? 'all' : members.find((member) => member.id === step.assignee)?.name ?? '?'}`
  return task.steps.map((step, index) => `${index + 1}. [${mark[step.status]}] ${step.title}${who(step)}${step.approval ? ' (승인 필요)' : ''}${step.note ? ` — ${step.note}` : ''}`).join('\n')
}

/**
 * A group room's turn: the member woken for the current step. An `all` step wakes each member once in room order (the
 * last one closes the step); once everyone had theirs and it is still open, or when no step is left open, the
 * representative wraps up. A member who left or was switched off hands its step to the representative.
 */
type GroupTurn = { member: Member; mode: 'own' | 'all' | 'wrap'; last: boolean; heard?: number[] }
function groupTurn(task: ChatTask, current: number, members: Member[], representative: Member): GroupTurn {
  const step = current >= 0 ? task.steps[current] : null
  if (!step) return { member: representative, mode: 'wrap', last: true }
  if (step.assignee === 'all') {
    const heard = (step.heard ?? []).filter((id) => members.some((member) => member.id === id))
    const next = members.find((member) => !heard.includes(member.id))
    if (!next) return { member: representative, mode: 'wrap', last: true }
    return { member: next, mode: 'all', last: members.every((member) => member.id === next.id || heard.includes(member.id)), heard: [...heard, next.id] }
  }
  return { member: members.find((member) => member.id === step.assignee) ?? representative, mode: 'own', last: true }
}

function groupTurnText(turn: GroupTurn, step: number | null) {
  const name = turn.member.name
  if (turn.mode === 'own') return `This turn is ${name}'s: step ${step} is yours. Call another member with @name only when you need their input.`
  if (turn.mode === 'all') {
    return `Step ${step} is for every member, one turn each in room order; this turn is ${name}'s. Give your own part and leave the others' parts to them.${turn.last ? ` You are the last: once the parts are in, mark step ${step} done with task_update.` : ' Do not mark the step done.'}`
  }
  return step === null
    ? `This turn is ${name}'s: every step is closed; check the result and call task_finish.`
    : `This turn is ${name}'s: every member has had their turn on step ${step}. Wrap it up and mark it done with task_update.`
}

/** The request that moves a task on. The person sees only the thin line built from `routing`. */
function continuationText(task: ChatTask, event: string, room?: { members: Member[]; turn: GroupTurn; step: number | null }) {
  return [
    '[Task continuation — sent by the app, not typed by the person]',
    `Goal: ${task.goal}`,
    `Steps:\n${stepsText(task, room?.members)}`,
    `What just happened: ${event}`,
    `Budget used: continuations ${task.used.continuations}/${task.budget.continuations}, images ${task.used.images}/${task.budget.images}${task.budget.tokens === undefined ? '' : `, tokens ${task.used.tokens ?? 0}/${task.budget.tokens} (checked between turns)`}`,
    ...(room ? [groupTurnText(room.turn, room.step)] : []),
    room
      ? 'Do your part of the plan now. Mark progress with task_update. When the next step needs the person (a card to approve, a choice) or a running generation to finish, make that happen, call task_wait and end your reply. When every step is done call task_finish. Do not ask the person things the room can do or decide within the approved plan.'
      : 'Carry on with the next step yourself. Mark progress with task_update. When the next step needs the person (a card to approve, a choice) or a running generation to finish, make that happen, call task_wait and end your reply. When every step is done call task_finish. Do not ask the person things you can do or decide within the approved plan.',
  ].join('\n\n')
}

const STALL_LIMIT = 3
/** A task runs at most this long after its approval or last resume before it stops for the person. */
const ACTIVE_LIMIT_MS = 3 * 60 * 60_000
const timers = new Map<number, NodeJS.Timeout>()
const running = new Set<number>()

export const ChatTaskRunner = {
  started: false,
  start() {
    if (ChatTaskRunner.started) return
    ChatTaskRunner.started = true
    // A task cannot be half way through a turn after a restart: stop and let the person resume it.
    table().prepare("UPDATE chat_tasks SET status = 'paused', reason = '서버가 다시 시작돼서 멈췄어.', wait = NULL WHERE status IN ('running')").run()
    // In a room every member's reply ends this way; the continuation waits until the whole room is quiet.
    onChatReplyFinished((context: ChatExecutionContext) => {
      const task = ChatTaskStore.live(context.threadId)
      if (task?.status === 'running') ChatTaskRunner.schedule(task.threadId, '이전 답변이 끝났어.')
    })
    onProposalResolved((threadId, proposal) => {
      const task = ChatTaskStore.live(threadId)
      if (!task) return
      if (proposal.kind === 'task_plan') {
        if (proposal.taskId === task.id && proposal.dismissed && task.status === 'awaiting_plan') ChatTaskStore.update(task.id, { status: 'cancelled', reason: '플랜을 무시했어.' })
        return
      }
      if (task.status === 'waiting' && task.wait === 'approval') {
        ChatTaskStore.update(task.id, { status: 'running', reason: null })
        ChatTaskRunner.schedule(threadId, `카드 #${proposal.id}을(를) 사용자가 ${proposal.dismissed ? '무시했어' : '저장했어'}.`)
      }
    })
    // The person's own message answers a task waiting for them, and a message sent with the page connected brings a
    // task waiting for the page back; the end of that reply then moves the task on.
    onChatUserSend((threadId, withPage) => {
      const task = ChatTaskStore.live(threadId)
      if (task?.status !== 'waiting' || !(task.wait === 'user' || (task.wait === 'page' && withPage))) return
      ChatTaskStore.update(task.id, { status: 'running', reason: null })
    })
    subscribeToRuntimeEvents((record) => {
      if (record.name !== 'queue.job.status') return
      const status = (record.payload as { status?: string })?.status
      if (!['completed', 'failed', 'cancelled'].includes(status ?? '')) return
      // A waiting task resumes once the generations it may be waiting on are done: those its chat started, and the
      // account's started since the task last became active (asset batches and the like). Older or unrelated work of
      // the account (a long workflow left running) does not hold it.
      const rows = table().prepare("SELECT t.id, t.thread_id, c.account_id, COALESCE(t.active_since, t.created_at) AS since FROM chat_tasks t JOIN codex_chat_threads c ON c.id = t.thread_id WHERE t.status = 'waiting' AND t.wait = 'job'").all() as Array<{ id: number; thread_id: number; account_id: number | null; since: string }>
      for (const row of rows) {
        const busy = getUserSettingsDb().prepare(`SELECT COUNT(*) AS count FROM generation_queue_jobs j
          WHERE j.status NOT IN ('completed', 'failed', 'cancelled')
            AND (j.id IN (SELECT job_id FROM chat_generation_links WHERE thread_id = ?) OR (j.requested_by_account_id IS ? AND j.created_date >= ?))`).get(row.thread_id, row.account_id, row.since) as { count: number }
        if (busy.count > 0) continue
        ChatTaskStore.update(row.id, { status: 'running', reason: null })
        ChatTaskRunner.schedule(row.thread_id, '기다리던 생성 작업이 모두 끝났어.')
      }
    })
  },

  /** Plan approved: the task starts. */
  approve(taskId: number) {
    const task = ChatTaskStore.find(taskId)
    if (!task || task.status !== 'awaiting_plan') throw new Error('승인할 작업이 아니야.')
    ChatTaskStore.update(taskId, { status: 'running', reason: null })
    ChatTaskStore.markActive(taskId)
    ChatTaskRunner.schedule(task.threadId, '사용자가 플랜을 승인했어. 첫 단계부터 시작해.', 300)
  },

  pause(threadId: number, reason = '사용자가 멈췄어.') {
    const task = ChatTaskStore.live(threadId)
    if (!task || task.status === 'awaiting_plan') throw new Error('멈출 작업이 없어.')
    clearTimeout(timers.get(threadId))
    timers.delete(threadId)
    return ChatTaskStore.update(task.id, { status: 'paused', reason })
  },

  resume(threadId: number, extension?: unknown) {
    const task = ChatTaskStore.live(threadId)
    if (!task || (task.status !== 'paused' && task.status !== 'waiting')) throw new Error('이어갈 작업이 없어.')
    const used = { ...task.used, images: imagesUsed(task) }
    let budget = task.budget
    if (extension !== undefined) {
      const approved = extension as { taskId?: unknown; budget?: Partial<ChatTaskBudget> } | null
      if (!approved || approved.taskId !== task.id) throw new Error('작업이 바뀌었어. 현재 작업의 예산을 다시 확인해줘.')
      const proposed = approved.budget
      for (const key of ['continuations', 'images'] as const) {
        const value = proposed?.[key]
        if (!Number.isSafeInteger(value) || value! < task.budget[key] || value! > CHAT_TASK_LIMITS[key]) throw new Error('예산은 기존 한도 이상, 작업 최대 한도 이내의 정수여야 해.')
      }
      budget = { continuations: proposed!.continuations!, images: proposed!.images! }
      const tokens = proposed?.tokens ?? task.budget.tokens
      if (tokens !== undefined) {
        if (!Number.isSafeInteger(tokens) || tokens <= 0 || tokens < (task.budget.tokens ?? 0) || tokens > CHAT_TASK_LIMITS.tokens) throw new Error('토큰 예산은 기존 한도 이상, 작업 최대 한도 이내의 양의 정수여야 해.')
        budget.tokens = tokens
      }
    }
    if (used.continuations >= budget.continuations || used.images >= budget.images || (budget.tokens !== undefined && (used.tokens ?? 0) >= budget.tokens)) {
      const reason = '작업 예산을 다 썼어. 예산을 늘려 승인한 뒤 이어가거나 작업을 중단해줘.'
      ChatTaskStore.update(task.id, { status: 'paused', used, reason })
      throw new Error(reason)
    }
    const resumed = ChatTaskStore.update(task.id, { status: 'running', reason: null, used, budget })
    ChatTaskStore.markActive(task.id)
    ChatTaskRunner.schedule(threadId, '사용자가 작업을 이어가라고 했어.', 300)
    return resumed
  },

  cancel(threadId: number) {
    const task = ChatTaskStore.live(threadId)
    if (!task) throw new Error('중단할 작업이 없어.')
    clearTimeout(timers.get(threadId))
    timers.delete(threadId)
    return ChatTaskStore.update(task.id, { status: 'cancelled', reason: '사용자가 중단했어.' })
  },

  /**
   * The next continuation, a moment after `event`: both engines release a chat's turn before they announce its end,
   * so it need not wait long for the reply that ended; one that still finds a reply running tries again later.
   */
  schedule(threadId: number, event: string, delayMs = 200) {
    clearTimeout(timers.get(threadId))
    const timer = setTimeout(() => { timers.delete(threadId); void ChatTaskRunner.continue(threadId, event) }, delayMs)
    timer.unref?.()
    timers.set(threadId, timer)
  },

  async continue(threadId: number, event: string) {
    if (running.has(threadId)) return
    let task = ChatTaskStore.live(threadId)
    if (!task || task.status !== 'running') return
    // A reply still running (the person's own, or one that just ended and has not let go yet) goes first: try again
    // in a moment, before anything counts against the budget or the stall limit. Its end schedules a turn too.
    const { CodexChatService } = await import('./codexChatService')
    const { GroupChatService } = await import('./groupChatService')
    if (CodexChatService.isRunning(threadId) || GroupChatService.isRunning(threadId)) {
      if (!timers.has(threadId)) ChatTaskRunner.schedule(threadId, event, 1500)
      return
    }
    const thread = CodexChatStore.findThreadById(threadId)
    const group = thread?.kind === 'group'
    const members: Member[] = group ? ChatGroupStore.members(threadId).flatMap((member) => { const found = ChatProfileStore.find(member.profile_id); return found?.isEnabled ? [found] : [] }) : []
    const profile = group ? null : thread?.profile_id ? ChatProfileStore.find(thread.profile_id) : null
    const requester = thread ? requesterOf(thread.account_id) : null
    if (!thread || !requester || (group ? members.length === 0 : thread.kind !== 'direct' || !profile?.isEnabled)) {
      ChatTaskStore.update(task.id, { status: 'failed', reason: '채팅이나 프로필, 계정을 쓸 수 없어서 멈췄어.' })
      return
    }
    const used = { ...task.used, images: imagesUsed(task) }
    if (used.continuations >= task.budget.continuations) { ChatTaskStore.update(task.id, { status: 'paused', used, reason: '이어가기 예산을 다 썼어. 예산을 늘려 승인한 뒤 이어가거나 작업을 중단해줘.' }); return }
    if (used.images >= task.budget.images) { ChatTaskStore.update(task.id, { status: 'paused', used, reason: '이미지 예산을 다 썼어. 예산을 늘려 승인한 뒤 이어가거나 작업을 중단해줘.' }); return }
    if (task.budget.tokens !== undefined && (used.tokens ?? 0) >= task.budget.tokens) { ChatTaskStore.update(task.id, { status: 'paused', used, reason: '토큰 예산을 다 썼어. 예산을 늘려 승인한 뒤 이어가거나 작업을 중단해줘.' }); return }
    if (ChatTaskStore.activeMs(task.id) > ACTIVE_LIMIT_MS) { ChatTaskStore.update(task.id, { status: 'paused', used, reason: '작업 시간이 길어져서 멈췄어. 이어가려면 재개해줘.' }); return }
    if (ChatTaskStore.markProgress(task.id) >= STALL_LIMIT) { ChatTaskStore.update(task.id, { status: 'paused', used, reason: '몇 번 이어가도 진전이 없어서 멈췄어.' }); return }
    const current = task.steps.findIndex((step) => step.status === 'doing' || step.status === 'todo')
    const turn = group ? groupTurn(task, current, members, members.find((member) => member.id === thread.profile_id) ?? members[0]) : null
    // The text shows the steps as they stand; the member woken for an `all` step is remembered with the turn.
    const text = continuationText(task, event, turn ? { members, turn, step: current >= 0 ? current + 1 : null } : undefined)
    task = ChatTaskStore.update(task.id, {
      used: { ...used, continuations: used.continuations + 1 },
      ...(turn?.heard ? { steps: task.steps.map((step, index) => index === current ? { ...step, heard: turn.heard } : step) } : {}),
    })!
    const routing: ChatTaskRouting = { id: task.id, step: current >= 0 ? current + 1 : null, total: task.steps.length, title: current >= 0 ? task.steps[current].title : null, event: clip(event, 160), ...(turn ? { assignee: turn.member.id } : {}) }
    running.add(threadId)
    try {
      await withLlmUsageContext({ taskId: task.id, threadId }, () => turn
        ? GroupChatService.sendMessage(requester, threadId, text, () => {}, undefined, undefined, undefined, undefined, undefined, { task: routing, recipients: [turn.member.id] })
        : CodexChatService.sendMessage(requester, threadId, text, () => {}, undefined, undefined, undefined, undefined, undefined, profile?.pageAssist ? lastChatPageForThread(requester, threadId) : undefined, { task: routing }))
    } catch (error) {
      // A reply already running finishes first and its end schedules the next continuation; in case it ended just
      // before, this one is given back and tried again a little later.
      const message = error instanceof Error ? error.message : String(error)
      if (/진행 중/.test(message)) {
        const back = turn?.heard ? task.steps.map((step, index) => index === current ? { ...step, heard: turn.heard!.slice(0, -1) } : step) : task.steps
        ChatTaskStore.update(task.id, { used: { ...task.used, continuations: Math.max(0, task.used.continuations - 1) }, steps: back })
        if (!timers.has(threadId)) ChatTaskRunner.schedule(threadId, event, 1500)
      } else ChatTaskStore.update(task.id, { status: 'paused', reason: `이어가지 못했어: ${clip(message, 200)}` })
    } finally {
      running.delete(threadId)
    }
  },
}
