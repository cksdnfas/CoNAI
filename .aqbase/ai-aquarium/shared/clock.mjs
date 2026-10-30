/**
 * Village time: game minutes counted from day 1, 00:00. The clock only moves while the village is awake,
 * at one game day per `dayMinutes` real minutes.
 */
export const DAY = 1440
export const START_MINUTE = 7 * 60 // a new village wakes on day 1 at 07:00
/** Real minutes per game day the settings may choose; the page steps through these. */
export const DAY_LENGTHS = [4, 6, 8, 12, 16, 24, 36, 48, 72, 96, 144, 240]
const PHASES = { dawn: '새벽', day: '낮', evening: '저녁', night: '밤' }

export const minuteOfDay = minute => ((Math.floor(minute) % DAY) + DAY) % DAY
export function phaseOf(minute) {
  const m = minuteOfDay(minute)
  return m < 300 ? 'night' : m < 420 ? 'dawn' : m < 1020 ? 'day' : m < 1200 ? 'evening' : 'night'
}
/** Game minutes that pass in `seconds` real seconds. */
export const advanceBy = (seconds, dayMinutes) => seconds * DAY / (dayMinutes * 60)

/** The village week: day 1 is a Monday. */
export const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']
export const weekdayOf = minute => ((Math.floor(minute / DAY) % 7) + 7) % 7

export function clockOf(minute) {
  const m = minuteOfDay(minute), phase = phaseOf(minute), day = Math.floor(minute / DAY) + 1, weekday = weekdayOf(minute)
  const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return { minute: Math.floor(minute), day, weekday, time, phase, label: `${WEEKDAYS[weekday]}요일 ${PHASES[phase]} ${time}`, text: `${day}일째 ${WEEKDAYS[weekday]}요일 ${PHASES[phase]} ${time}` }
}

/**
 * Bedtime: from 22:00 to 06:00, shifted per resident by up to an hour so the village doesn't go dark at once.
 * The shift comes from the profile id, so it stays the same every night.
 */
export function sleepy(minute, profileId) {
  const m = minuteOfDay(minute), shift = (profileId * 37) % 60
  return m >= 22 * 60 + shift || m < 6 * 60 + Math.floor(shift / 2)
}
