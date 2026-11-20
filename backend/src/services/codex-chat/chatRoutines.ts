import type Database from 'better-sqlite3'
import { CHAT_ROUTINE_LIMITS, type ChatRoutine, type ChatRoutineInput, type ChatRoutineLastResult, type ChatRoutineScheduleType, type ChatRoutineStatus, type ChatRoutineTarget } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus'
import { resolveAutomationRunAs } from '../automationRunAs'
import { AutomationSwitch } from '../automationSwitch'
import { DEFAULT_SCHEDULE_TIMEZONE, followingRunAt, initialRunAt, parseDailyTime, resolveScheduleTimezone } from '../scheduleTiming'
import { ChatProfileStore } from './chatProfiles'
import { ChatWakeBusyError, ensureAutomationRoom, forgetAutomationRoom, wakeChatRoom, wakeFailure } from './chatRoomWake'
import { CodexChatError } from './codexChatService'
import { CodexChatStore } from './codexChatStore'

/**
 * Chat routines: the simple automation (the workflow schedule is the advanced one). A routine wakes one chat on a
 * schedule — its own room for one character, or a room the person picked — as the account that saved it.
 */

type RoutineRow = {
  id: number; name: string; account_id: number | null; target: ChatRoutineTarget; profile_id: number | null; thread_id: number | null
  message: string; schedule_type: ChatRoutineScheduleType; run_at: string | null; interval_minutes: number | null; daily_time: string | null
  timezone: string; chain_limit: number | null; max_run_count: number | null; run_count: number; status: ChatRoutineStatus
  stop_reason: string | null; next_run_at: string | null; last_run_at: string | null; last_result: ChatRoutineLastResult | null
  last_error: string | null; fail_streak: number; created_at: string; updated_at: string
}

const ensured = new WeakSet<Database.Database>()
/** Created on first use like chat_tasks; the statements are idempotent. */
function table() {
  const db = getUserSettingsDb()
  if (!ensured.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_routines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        account_id INTEGER,
        target TEXT NOT NULL,
        profile_id INTEGER,
        thread_id INTEGER,
        message TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        run_at TEXT,
        interval_minutes INTEGER,
        daily_time TEXT,
        timezone TEXT NOT NULL,
        chain_limit INTEGER,
        max_run_count INTEGER,
        run_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        stop_reason TEXT,
        next_run_at TEXT,
        last_run_at TEXT,
        last_result TEXT,
        last_error TEXT,
        fail_streak INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_chat_routines_due ON chat_routines (status, next_run_at);
    `)
    ensured.add(db)
  }
  return db
}

function toRoutine(row: RoutineRow): ChatRoutine {
  return {
    id: row.id, name: row.name, accountId: row.account_id, target: row.target, profileId: row.profile_id, threadId: row.thread_id,
    message: row.message, scheduleType: row.schedule_type, runAt: row.run_at, intervalMinutes: row.interval_minutes, dailyTime: row.daily_time,
    timezone: row.timezone, chainLimit: row.chain_limit, maxRunCount: row.max_run_count, runCount: row.run_count, status: row.status,
    stopReason: row.stop_reason, nextRunAt: row.next_run_at, lastRunAt: row.last_run_at, lastResult: row.last_result, lastError: row.last_error,
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

const roomKey = (id: number) => `routine:${id}`
const clip = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

type RoutinePatch = Partial<Pick<RoutineRow, 'name' | 'account_id' | 'target' | 'profile_id' | 'thread_id' | 'message' | 'schedule_type' | 'run_at' | 'interval_minutes' | 'daily_time' | 'timezone' | 'chain_limit' | 'max_run_count' | 'run_count' | 'status' | 'stop_reason' | 'next_run_at' | 'last_run_at' | 'last_result' | 'last_error' | 'fail_streak'>>

export const ChatRoutineStore = {
  /** One account's routines; `'all'` lists everyone's (administrators). */
  list(accountId: number | null | 'all') {
    const rows = accountId === 'all'
      ? table().prepare('SELECT * FROM chat_routines ORDER BY id').all()
      : table().prepare('SELECT * FROM chat_routines WHERE account_id IS ? ORDER BY id').all(accountId)
    return (rows as RoutineRow[]).map(toRoutine)
  },
  find(id: number) {
    const row = table().prepare('SELECT * FROM chat_routines WHERE id = ?').get(id) as RoutineRow | undefined
    return row ? toRoutine(row) : null
  },
  due(nowIso: string) {
    return (table().prepare("SELECT * FROM chat_routines WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at, id").all(nowIso) as RoutineRow[]).map(toRoutine)
  },
  /** The routines that wake one room (its own room included). */
  forThread(threadId: number) {
    return (table().prepare('SELECT * FROM chat_routines WHERE thread_id = ? ORDER BY id').all(threadId) as RoutineRow[]).map(toRoutine)
  },
  create(values: RoutinePatch & Pick<RoutineRow, 'name' | 'target' | 'message' | 'schedule_type' | 'timezone' | 'status'>) {
    const keys = Object.keys(values) as Array<keyof RoutinePatch>
    const info = table().prepare(`INSERT INTO chat_routines (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((key) => values[key] ?? null))
    return ChatRoutineStore.find(Number(info.lastInsertRowid)) as ChatRoutine
  },
  update(id: number, patch: RoutinePatch) {
    const keys = (Object.keys(patch) as Array<keyof RoutinePatch>).filter((key) => patch[key] !== undefined)
    if (keys.length) {
      table().prepare(`UPDATE chat_routines SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((key) => patch[key] ?? null), id)
      // Routines are administrator-managed (the list route requires admin): 'account' with no account reaches administrators only.
      publishRuntimeEvent({ name: 'chat.routine.changed', topic: 'generation-queue', visibility: 'account', accountId: null, payload: { routineId: id } })
    }
    return ChatRoutineStore.find(id)
  },
  delete(id: number) {
    const routine = ChatRoutineStore.find(id)
    if (!routine) return false
    table().prepare('DELETE FROM chat_routines WHERE id = ?').run(id)
    if (routine.target === 'dedicated') forgetAutomationRoom(routine.accountId, roomKey(id))
    return true
  },
}

function optionalId(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new CodexChatError('잘못된 ID야.')
  return id
}

/**
 * The stored form of a routine the person saved: checked against what `accountId` may reach (the picked room has to
 * be theirs, the character has to exist). Saving a routine makes it run as the account that saved it.
 */
export function normalizeChatRoutineInput(input: Partial<ChatRoutineInput>, accountId: number | null) {
  const name = clip(input.name, CHAT_ROUTINE_LIMITS.name)
  if (!name) throw new CodexChatError('루틴 이름을 넣어줘.')
  const message = String(input.message ?? '').trim()
  if (!message) throw new CodexChatError('보낼 지시를 넣어줘.')
  if (message.length > CHAT_ROUTINE_LIMITS.message) throw new CodexChatError(`지시는 ${CHAT_ROUTINE_LIMITS.message}자까지 넣을 수 있어.`)

  const target: ChatRoutineTarget = input.target === 'room' ? 'room' : 'dedicated'
  let profileId: number | null = null
  let threadId: number | null = null
  if (target === 'room') {
    threadId = optionalId(input.threadId)
    if (threadId === null || !CodexChatStore.findThread(threadId, accountId)) throw new CodexChatError('내 채팅방을 골라줘.')
  } else {
    profileId = optionalId(input.profileId)
    if (profileId === null || !ChatProfileStore.find(profileId)) throw new CodexChatError('캐릭터를 골라줘.')
  }

  const scheduleType: ChatRoutineScheduleType = input.scheduleType === 'once' || input.scheduleType === 'daily' ? input.scheduleType : 'interval'
  const timezone = resolveScheduleTimezone(input.timezone ?? DEFAULT_SCHEDULE_TIMEZONE)
  let runAt: string | null = null
  let intervalMinutes: number | null = null
  let dailyTime: string | null = null
  if (scheduleType === 'once') {
    const at = new Date(String(input.runAt ?? ''))
    if (Number.isNaN(at.getTime())) throw new CodexChatError('실행할 시각을 넣어줘.')
    runAt = at.toISOString()
  } else if (scheduleType === 'interval') {
    intervalMinutes = Number(input.intervalMinutes)
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < CHAT_ROUTINE_LIMITS.minIntervalMinutes) throw new CodexChatError(`간격은 ${CHAT_ROUTINE_LIMITS.minIntervalMinutes}분 이상인 정수로 넣어줘.`)
  } else {
    dailyTime = String(input.dailyTime ?? '')
    if (!parseDailyTime(dailyTime)) throw new CodexChatError('매일 실행할 시각을 HH:mm으로 넣어줘.')
  }

  const chain = input.chainLimit === null || input.chainLimit === undefined || (input.chainLimit as unknown) === '' ? null : Number(input.chainLimit)
  if (chain !== null && (!Number.isInteger(chain) || chain < 0 || chain > CHAT_ROUTINE_LIMITS.chain)) throw new CodexChatError(`이어 부르기는 0부터 ${CHAT_ROUTINE_LIMITS.chain}까지야.`)
  const max = input.maxRunCount === null || input.maxRunCount === undefined || (input.maxRunCount as unknown) === '' ? null : Number(input.maxRunCount)
  if (max !== null && (!Number.isInteger(max) || max < 1)) throw new CodexChatError('최대 실행 횟수는 1 이상의 정수로 넣어줘.')

  return {
    name, message, target, profile_id: profileId, thread_id: threadId, account_id: accountId,
    schedule_type: scheduleType, run_at: runAt, interval_minutes: intervalMinutes, daily_time: dailyTime, timezone,
    chain_limit: chain, max_run_count: max,
  }
}

const POLL_MS = 15_000
/** Failures in a row before a routine stops itself (a skip because the room was busy is not a failure). */
const FAIL_LIMIT = 3

/** Why a run failed that the server's shutdown or restart cut off. */
const RESTART_INTERRUPTED = '실행 중에 서버가 다시 시작돼서 끊겼어.'

let pollTimer: NodeJS.Timeout | null = null
let polling = false
let stopped = false
const running = new Map<number, { controller: AbortController; finished: Promise<ChatRoutine | null> }>()

/**
 * Record one failed run. A scheduled one-time routine has no next turn: it stops at once for the person to check what
 * the run already did. Any other routine stops after FAIL_LIMIT failures in a row.
 */
function recordFailure(routine: ChatRoutine, message: string, startedAt: string | undefined, manual: boolean) {
  const failStreak = ((table().prepare('SELECT fail_streak FROM chat_routines WHERE id = ?').get(routine.id) as { fail_streak: number } | undefined)?.fail_streak ?? 0) + 1
  const onceFailed = routine.scheduleType === 'once' && !manual
  const stopped = onceFailed || failStreak >= FAIL_LIMIT
  return ChatRoutineStore.update(routine.id, {
    last_result: 'failed', last_run_at: startedAt, last_error: message, fail_streak: failStreak, run_count: routine.runCount + 1,
    ...(stopped ? { status: 'error_stopped' as const, stop_reason: onceFailed ? `한 번 실행할 루틴이 실패해서 멈췄어. 실제 결과를 확인한 뒤 다시 실행해줘: ${message}` : `${FAIL_LIMIT}번 연속 실패해서 멈췄어: ${message}`, next_run_at: null } : {}),
  })
}

/** Execute one admitted run and persist its outcome before the runner releases the routine. */
async function runRoutine(routine: ChatRoutine, manual: boolean, signal: AbortSignal) {
  const { id } = routine
  const startedAt = new Date().toISOString()
  const interrupted = () => routine.scheduleType === 'once'
    ? recordFailure(routine, RESTART_INTERRUPTED, startedAt, manual)
    : ChatRoutineStore.update(id, { last_result: 'skipped', last_run_at: startedAt, last_error: RESTART_INTERRUPTED })
  const pause = (reason: string) => ChatRoutineStore.update(id, { status: 'paused', stop_reason: reason, next_run_at: null })
  if (signal.aborted) return interrupted()
  const runAs = resolveAutomationRunAs(routine.accountId, [])
  if (!runAs.ok) return pause(runAs.message)
  const requester = runAs.requester
  let threadId = routine.threadId
  try {
    if (routine.target === 'dedicated') {
      if (routine.profileId === null || !ChatProfileStore.find(routine.profileId)) return pause('캐릭터가 없어져서 멈췄어.')
      threadId = (await ensureAutomationRoom(requester, routine.profileId, roomKey(id), routine.name)).id
      if (threadId !== routine.threadId) ChatRoutineStore.update(id, { thread_id: threadId })
    } else if (threadId === null || !CodexChatStore.findThread(threadId, requester.accountId)) {
      return pause('채팅방이 없어져서 멈췄어.')
    }
  } catch (error) {
    return signal.aborted ? interrupted() : pause(`채팅방을 준비하지 못했어: ${clip(error instanceof Error ? error.message : error, 200)}`)
  }

  try {
    const result = await wakeChatRoom({ requester, threadId, instruction: routine.message, routing: { source: 'routine', id, name: routine.name }, chainLimit: routine.chainLimit, signal })
    const failure = wakeFailure(result, '캐릭터가 답하지 못했어.')
    if (failure !== null) throw new Error(failure)
  } catch (error) {
    if (signal.aborted) return interrupted()
    if (error instanceof ChatWakeBusyError) {
      // Only a scheduled one-time run needs another due time when the room was busy.
      const retry = routine.scheduleType === 'once' && !manual ? { next_run_at: new Date(Date.now() + 60_000).toISOString() } : {}
      return ChatRoutineStore.update(id, { last_result: 'skipped', last_run_at: startedAt, last_error: error.message, ...retry })
    }
    return recordFailure(routine, clip(error instanceof Error ? error.message : error, 300), startedAt, manual)
  }

  const runCount = routine.runCount + 1
  const finished = (routine.scheduleType === 'once' && !manual) || (routine.maxRunCount !== null && runCount >= routine.maxRunCount)
  return ChatRoutineStore.update(id, {
    last_result: 'ok', last_run_at: startedAt, last_error: null, fail_streak: 0, run_count: runCount,
    ...(finished ? { status: 'completed' as const, stop_reason: routine.scheduleType === 'once' ? '한 번 실행하고 끝났어.' : '최대 실행 횟수를 채웠어.', next_run_at: null } : {}),
  })
}

/** Owns scheduling, admission and shutdown for timed and manual runs alike. */
export const ChatRoutineRunner = {
  start() {
    if (pollTimer) return false
    stopped = false
    ChatRoutineRunner.recover()
    void ChatRoutineRunner.poll()
    pollTimer = setInterval(() => { void ChatRoutineRunner.poll() }, POLL_MS)
    pollTimer.unref?.()
    return true
  },

  /**
   * Stops polling and cuts off the wakes still answering (a shutdown). A one-time routine records the cut as its run's
   * failure; a repeating one records it as skipped.
   */
  stop() {
    stopped = true
    for (const { controller } of running.values()) controller.abort()
    if (!pollTimer) return false
    clearInterval(pollTimer)
    pollTimer = null
    return true
  },

  /** No new wakes may enter while the admitted ones finish writing their results to the still-open database. */
  async stopAndDrain() {
    ChatRoutineRunner.stop()
    await Promise.allSettled(Array.from(running.values(), (run) => run.finished))
  },

  /**
   * A scheduled one-time routine still active with no next run had its run cut off by a restart (its due time is
   * taken before the wake). It is closed as that run's failure and never fired again on its own: the cut-off run may
   * already have done work or cost.
   */
  recover() {
    const rows = table().prepare("SELECT * FROM chat_routines WHERE status = 'active' AND schedule_type = 'once' AND next_run_at IS NULL").all() as RoutineRow[]
    for (const routine of rows.map(toRoutine)) {
      if (!running.has(routine.id)) recordFailure(routine, RESTART_INTERRUPTED, undefined, false)
    }
  },

  isRunning(id: number) {
    return running.has(id)
  },

  async poll(now = new Date()) {
    if (stopped || polling) return
    polling = true
    try {
      // The stop-everything switch: due routines wait until it is off again.
      if (AutomationSwitch.isPaused()) return
      for (const routine of ChatRoutineStore.due(now.toISOString())) {
        if (stopped) break
        if (running.has(routine.id)) continue
        // The next due time is taken before the wake starts, so a slow answer cannot make the routine fire again.
        const next = followingRunAt(routine, routine.nextRunAt, now)
        ChatRoutineStore.update(routine.id, { next_run_at: next })
        void ChatRoutineRunner.fire(routine.id)?.catch((error: unknown) => {
          console.warn(`[chat-routine] routine ${routine.id} failed:`, error instanceof Error ? error.message : error)
        })
      }
    } catch (error) {
      console.error('[chat-routine] poll failed:', error)
    } finally {
      polling = false
    }
  },

  /**
   * Claim the routine synchronously, so "run now" acknowledges only an admitted wake. Missing or already running:
   * null. Otherwise its promise settles after the outcome is stored. A manual run does not consume a one-time schedule.
   */
  fire(id: number, options: { manual?: boolean } = {}) {
    if (stopped) throw new CodexChatError('서버가 종료 중이라 루틴을 실행할 수 없어.', 503)
    if (running.has(id)) return null
    const routine = ChatRoutineStore.find(id)
    if (!routine) return null
    const controller = new AbortController()
    const finished = Promise.resolve().then(() => runRoutine(routine, options.manual === true, controller.signal)).finally(() => running.delete(id))
    running.set(id, { controller, finished })
    return finished
  },
}

/** The first due time for a routine switched on now. */
export function chatRoutineFirstRunAt(routine: Pick<ChatRoutine, 'scheduleType' | 'runAt' | 'intervalMinutes' | 'dailyTime' | 'timezone'>, now = new Date()) {
  return initialRunAt(routine, now)
}
