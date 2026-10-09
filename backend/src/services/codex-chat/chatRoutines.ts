import type Database from 'better-sqlite3'
import { CHAT_ROUTINE_LIMITS, type ChatRoutine, type ChatRoutineInput, type ChatRoutineLastResult, type ChatRoutineScheduleType, type ChatRoutineStatus, type ChatRoutineTarget } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import { resolveAutomationRunAs } from '../automationRunAs'
import { AutomationSwitch } from '../automationSwitch'
import { DEFAULT_SCHEDULE_TIMEZONE, followingRunAt, initialRunAt, parseDailyTime, resolveScheduleTimezone } from '../scheduleTiming'
import { ChatProfileStore } from './chatProfiles'
import { ChatWakeBusyError, ensureAutomationRoom, forgetAutomationRoom, wakeChatRoom } from './chatRoomWake'
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

const timingOf = (routine: ChatRoutine) => ({ scheduleType: routine.scheduleType, runAt: routine.runAt, intervalMinutes: routine.intervalMinutes, dailyTime: routine.dailyTime, timezone: routine.timezone })
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
    if (keys.length) table().prepare(`UPDATE chat_routines SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map((key) => patch[key] ?? null), id)
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

let pollTimer: NodeJS.Timeout | null = null
let polling = false
const running = new Set<number>()

/** Runs due routines. Each wake goes on in the background; a routine never runs twice at once. */
export const ChatRoutineRunner = {
  start() {
    if (pollTimer) return false
    void ChatRoutineRunner.poll()
    pollTimer = setInterval(() => { void ChatRoutineRunner.poll() }, POLL_MS)
    pollTimer.unref?.()
    return true
  },

  stop() {
    if (!pollTimer) return false
    clearInterval(pollTimer)
    pollTimer = null
    return true
  },

  isRunning(id: number) {
    return running.has(id)
  },

  async poll(now = new Date()) {
    if (polling) return
    polling = true
    try {
      // The stop-everything switch: due routines wait until it is off again.
      if (AutomationSwitch.isPaused()) return
      for (const routine of ChatRoutineStore.due(now.toISOString())) {
        if (running.has(routine.id)) continue
        // The next due time is taken before the wake starts, so a slow answer cannot make the routine fire again.
        const next = followingRunAt(timingOf(routine), routine.nextRunAt, now)
        ChatRoutineStore.update(routine.id, { next_run_at: next })
        void ChatRoutineRunner.fire(routine.id).catch((error: unknown) => {
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
   * Wake the routine's room once now (a timed run or "run now"). Resolves when the room has answered; the outcome is
   * recorded on the routine. A run that cannot start (no account, no room) pauses the routine with the reason.
   * A manual run does not use up a one-time routine.
   */
  async fire(id: number, options: { manual?: boolean } = {}) {
    const routine = ChatRoutineStore.find(id)
    if (!routine || running.has(id)) return null
    const pause = (reason: string, status: ChatRoutineStatus = 'paused') => ChatRoutineStore.update(id, { status, stop_reason: reason, next_run_at: null })

    const runAs = resolveAutomationRunAs(routine.accountId, [])
    if (!runAs.ok) return pause(runAs.message)
    const requester = runAs.requester

    running.add(id)
    try {
      let threadId = routine.threadId
      try {
        if (routine.target === 'dedicated') {
          const profile = routine.profileId === null ? null : ChatProfileStore.find(routine.profileId)
          if (!profile) return pause('캐릭터가 없어져서 멈췄어.')
          threadId = (await ensureAutomationRoom(requester, profile.id, roomKey(id), routine.name)).id
          if (threadId !== routine.threadId) ChatRoutineStore.update(id, { thread_id: threadId })
        } else if (threadId === null || !CodexChatStore.findThread(threadId, requester.accountId)) {
          return pause('채팅방이 없어져서 멈췄어.')
        }
      } catch (error) {
        return pause(`채팅방을 준비하지 못했어: ${clip(error instanceof Error ? error.message : error, 200)}`)
      }

      const startedAt = new Date().toISOString()
      try {
        await wakeChatRoom({ requester, threadId: threadId as number, instruction: routine.message, routing: { source: 'routine', id, name: routine.name }, chainLimit: routine.chainLimit })
      } catch (error) {
        if (error instanceof ChatWakeBusyError) {
          // A one-time routine has no next turn of its own: it tries again in a minute.
          const retry = routine.scheduleType === 'once' && !options.manual ? { next_run_at: new Date(Date.now() + 60_000).toISOString() } : {}
          return ChatRoutineStore.update(id, { last_result: 'skipped', last_run_at: startedAt, last_error: error.message, ...retry })
        }
        const message = clip(error instanceof Error ? error.message : error, 300)
        const failStreak = ((table().prepare('SELECT fail_streak FROM chat_routines WHERE id = ?').get(id) as { fail_streak: number } | undefined)?.fail_streak ?? 0) + 1
        const stopped = failStreak >= FAIL_LIMIT
        return ChatRoutineStore.update(id, {
          last_result: 'failed', last_run_at: startedAt, last_error: message, fail_streak: failStreak, run_count: routine.runCount + 1,
          ...(stopped ? { status: 'error_stopped' as const, stop_reason: `${FAIL_LIMIT}번 연속 실패해서 멈췄어: ${message}`, next_run_at: null } : {}),
        })
      }

      const runCount = routine.runCount + 1
      const finished = (routine.scheduleType === 'once' && !options.manual) || (routine.maxRunCount !== null && runCount >= routine.maxRunCount)
      return ChatRoutineStore.update(id, {
        last_result: 'ok', last_run_at: startedAt, last_error: null, fail_streak: 0, run_count: runCount,
        ...(finished ? { status: 'completed' as const, stop_reason: routine.scheduleType === 'once' ? '한 번 실행하고 끝났어.' : '최대 실행 횟수를 채웠어.', next_run_at: null } : {}),
      })
    } finally {
      running.delete(id)
    }
  },
}

/** The first due time for a routine switched on now. */
export function chatRoutineFirstRunAt(routine: Pick<ChatRoutine, 'scheduleType' | 'runAt' | 'intervalMinutes' | 'dailyTime' | 'timezone'>, now = new Date()) {
  return initialRunAt(timingOf(routine as ChatRoutine), now)
}
