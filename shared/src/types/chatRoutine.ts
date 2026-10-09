/**
 * A chat routine wakes one chat on a schedule: at the set time the app sends the routine's instruction into the room
 * as its account, and the character answers with its own tools. Workflows can do the same with the 채팅방 깨우기 node.
 */
export type ChatRoutineScheduleType = 'once' | 'interval' | 'daily'
export type ChatRoutineStatus = 'active' | 'paused' | 'error_stopped' | 'completed'
/** Where the routine talks: its own room for one character (made on first run), or a room the person picked. */
export type ChatRoutineTarget = 'dedicated' | 'room'
export type ChatRoutineLastResult = 'ok' | 'skipped' | 'failed'

export type ChatRoutine = {
  id: number
  name: string
  accountId: number | null
  target: ChatRoutineTarget
  /** The character of a dedicated room. */
  profileId: number | null
  /** The picked room, or the dedicated room once it exists. */
  threadId: number | null
  message: string
  scheduleType: ChatRoutineScheduleType
  runAt: string | null
  intervalMinutes: number | null
  dailyTime: string | null
  timezone: string
  /** Group rooms: how many times members may call each other after the wake (the room's own limit still applies). */
  chainLimit: number | null
  maxRunCount: number | null
  runCount: number
  status: ChatRoutineStatus
  stopReason: string | null
  nextRunAt: string | null
  lastRunAt: string | null
  lastResult: ChatRoutineLastResult | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type ChatRoutineInput = {
  name: string
  target: ChatRoutineTarget
  profileId?: number | null
  threadId?: number | null
  message: string
  scheduleType: ChatRoutineScheduleType
  runAt?: string | null
  intervalMinutes?: number | null
  dailyTime?: string | null
  timezone?: string | null
  chainLimit?: number | null
  maxRunCount?: number | null
  active?: boolean
}

export const CHAT_ROUTINE_LIMITS = { name: 80, message: 4000, minIntervalMinutes: 1, chain: 10 } as const

/** Marks a message an automation sent (a routine or a workflow); shown as one thin line instead of a user message. */
/** What woke a chat: a routine, a workflow node, or a call from a posts board comment (`id` = the post). */
export type ChatRoutineRouting = { source: 'routine' | 'workflow' | 'post'; id: number | null; name: string }
