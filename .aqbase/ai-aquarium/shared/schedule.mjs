/*
 * The village week and the staff's working hours. Day 1 is a Monday; a week is seven village days.
 * The guild clerk, the merchant and the priest each keep their role's hours: at their post while on duty, otherwise
 * they live like everyone else (walk, talk, sleep). Hours are village minutes; a shift may run past midnight.
 */
import { DAY, minuteOfDay, WEEKDAYS, weekdayOf } from './clock.mjs'

export { WEEKDAYS, weekdayOf }
export const STAFF = Object.freeze({ guild: '길드 접수원', merchant: '상인', oracle: '신관' })
export const SHIFT_DEFAULTS = Object.freeze({
  guild: Object.freeze({ open: 9 * 60, close: 18 * 60, off: Object.freeze([6]) }),
  merchant: Object.freeze({ open: 8 * 60, close: 20 * 60, off: Object.freeze([2]) }),
  oracle: Object.freeze({ open: 6 * 60, close: 19 * 60, off: Object.freeze([]) }),
})
/** What a worked shift pays; the merchant also keeps a share of what the shop sells during it. */
export const WAGES = Object.freeze({ guild: 30, merchant: 15, oracle: 20 })
export const SALES_SHARE = .25
/** What an adventurer leaves at the shrine for a calling, when it has the gold. */
export const OFFERING = 10
const STEP = 30

export const shiftsOf = settings => Object.fromEntries(Object.keys(STAFF).map(role => [role, { ...SHIFT_DEFAULTS[role], ...settings?.shifts?.[role] }]))

/** Whether `role` works at `minute`. A night shift belongs to the day it started on, so its day off is that day. */
export function onDuty(shifts, role, minute) {
  const s = shifts?.[role]
  if (!s) return false
  const m = minuteOfDay(minute), today = weekdayOf(minute)
  if (s.open < s.close) return m >= s.open && m < s.close && !s.off.includes(today)
  if (m >= s.open) return !s.off.includes(today)
  return m < s.close && !s.off.includes((today + 6) % 7)
}

export const hhmm = minute => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
/** "09:00–18:00 · 일 휴무" */
export const shiftLabel = s => `${hhmm(s.open)}–${hhmm(s.close)}${s.off.length ? ` · ${[...s.off].sort().map(d => WEEKDAYS[d]).join('·')} 휴무` : ''}`

/** Validates the settings' `shifts`: half-hour steps, a shift of at least an hour, at least one working day a week. */
export function parseShifts(input, current) {
  if (input === undefined) return current
  if (!input || typeof input !== 'object') throw new Error('근무 시간을 확인해줘.')
  const next = { ...current }
  for (const [role, value] of Object.entries(input)) {
    if (!Object.hasOwn(STAFF, role) || !value || typeof value !== 'object') throw new Error('근무 시간을 확인해줘.')
    const base = { ...SHIFT_DEFAULTS[role], ...current?.[role] }, open = value.open ?? base.open, close = value.close ?? base.close, off = value.off ?? base.off
    const minute = x => Number.isInteger(x) && x >= 0 && x < DAY && x % STEP === 0
    if (!minute(open) || !minute(close)) throw new Error(`${STAFF[role]} 근무 시간은 30분 단위로 정해줘.`)
    if ((close - open + DAY) % DAY < 60) throw new Error(`${STAFF[role]} 근무는 한 시간 이상이어야 해.`)
    if (!Array.isArray(off) || off.length > 6 || new Set(off).size !== off.length || !off.every(d => Number.isInteger(d) && d >= 0 && d < 7)) throw new Error(`${STAFF[role]} 휴무 요일을 확인해줘.`)
    next[role] = { open, close, off: [...off].sort() }
  }
  return next
}
