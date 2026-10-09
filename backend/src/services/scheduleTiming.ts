/** Due-time math shared by workflow schedules and chat routines. Wall-clock times are read in the row's time zone. */

export const DEFAULT_SCHEDULE_TIMEZONE = 'Asia/Seoul'

export type ScheduleKind = 'once' | 'interval' | 'daily'

/** A usable IANA zone name; anything the runtime does not know falls back to the default. */
export function resolveScheduleTimezone(timezone?: string | null) {
  if (!timezone) return DEFAULT_SCHEDULE_TIMEZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return timezone
  } catch {
    return DEFAULT_SCHEDULE_TIMEZONE
  }
}

/** Parse one HH:mm daily time into hour and minute. */
export function parseDailyTime(dailyTime?: string | null) {
  if (!dailyTime || !/^\d{2}:\d{2}$/.test(dailyTime)) return null
  const [hour, minute] = dailyTime.split(':').map(Number)
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

/** The calendar date and wall-clock time `instant` shows in `timeZone`. */
function zonedParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant))
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value)
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') }
}

/** How far `timeZone` is ahead of UTC at `instant`, in ms. */
function zoneOffset(instant: number, timeZone: string) {
  const local = zonedParts(instant, timeZone)
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - Math.floor(instant / 1000) * 1000
}

/** The instant a wall-clock time in `timeZone` happens (the day may overflow; Date.UTC normalises it). */
function zonedTimeToInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const first = guess - zoneOffset(guess, timeZone)
  // A daylight-saving change between the guess and the answer moves the offset once more.
  const second = guess - zoneOffset(first, timeZone)
  return second
}

/** The next time HH:mm comes round in `timezone`, strictly after `now`. */
export function nextDailyRunAt(dailyTime: string | null | undefined, now: Date, timezone?: string | null) {
  const time = parseDailyTime(dailyTime)
  if (!time) return null
  const zone = resolveScheduleTimezone(timezone)
  const today = zonedParts(now.getTime(), zone)
  for (let offset = 0; offset < 3; offset += 1) {
    const at = zonedTimeToInstant(today.year, today.month, today.day + offset, time.hour, time.minute, zone)
    if (at > now.getTime()) return new Date(at).toISOString()
  }
  return null
}

export type ScheduleTiming = {
  scheduleType: ScheduleKind
  runAt?: string | null
  intervalMinutes?: number | null
  dailyTime?: string | null
  timezone?: string | null
}

/** The first due time of a new or resumed schedule. */
export function initialRunAt(timing: ScheduleTiming, now: Date = new Date()) {
  if (timing.scheduleType === 'once') return timing.runAt ?? null
  if (timing.scheduleType === 'interval') {
    if (!timing.intervalMinutes || timing.intervalMinutes <= 0) return null
    return new Date(now.getTime() + timing.intervalMinutes * 60_000).toISOString()
  }
  return nextDailyRunAt(timing.dailyTime, now, timing.timezone)
}

/**
 * The due time after one that was just used. Intervals keep their rhythm from the previous due time, but never land
 * in the past (a server that was down does not fire a burst of missed runs).
 */
export function followingRunAt(timing: ScheduleTiming, previousDueAt: string | null | undefined, now: Date) {
  if (timing.scheduleType === 'once') return null
  if (timing.scheduleType === 'interval') {
    if (!timing.intervalMinutes || timing.intervalMinutes <= 0) return null
    const step = timing.intervalMinutes * 60_000
    let next = (previousDueAt ? new Date(previousDueAt).getTime() : now.getTime()) + step
    if (next <= now.getTime()) next += Math.ceil((now.getTime() - next + 1) / step) * step
    return new Date(next).toISOString()
  }
  return nextDailyRunAt(timing.dailyTime, now, timing.timezone)
}
