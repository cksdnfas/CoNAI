import { useEffect, useState } from 'react'
import type { WallpaperSchedule } from '@conai/shared'

function toMinutes(clock: string) {
  const [hours, minutes] = clock.split(':').map(Number)
  return hours * 60 + minutes
}

/** True when `date` falls in [from, until); a window whose end is before its start wraps past midnight. */
export function isWallpaperClockWindowOpen(from: string | null, until: string | null, date = new Date()) {
  if (!from && !until) return true
  const now = date.getHours() * 60 + date.getMinutes()
  const start = from ? toMinutes(from) : 0
  const end = until ? toMinutes(until) : 24 * 60
  if (start === end) return true
  return start < end ? now >= start && now < end : now >= start || now < end
}

/**
 * The scheduled preset for `date`: the first enabled window that matches the weekday and time. A window that wraps
 * midnight belongs to the weekday it started on.
 */
export function resolveScheduledWallpaperPresetId(schedule: WallpaperSchedule | null | undefined, date = new Date()) {
  if (!schedule?.enabled) return null
  const now = date.getHours() * 60 + date.getMinutes()
  const today = date.getDay()
  const yesterday = (today + 6) % 7
  for (const entry of schedule.entries) {
    const start = toMinutes(entry.start)
    const end = toMinutes(entry.end)
    const everyDay = entry.days.length === 0
    if (start === end) {
      if (everyDay || entry.days.includes(today)) return entry.presetId
      continue
    }
    if (start < end) {
      if (now >= start && now < end && (everyDay || entry.days.includes(today))) return entry.presetId
      continue
    }
    if (now >= start && (everyDay || entry.days.includes(today))) return entry.presetId
    if (now < end && (everyDay || entry.days.includes(yesterday))) return entry.presetId
  }
  return null
}

/** Current time, refreshed at each minute boundary while `enabled`. */
export function useWallpaperMinuteClock(enabled: boolean) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!enabled) return undefined
    let timer = 0
    const schedule = () => {
      const current = new Date()
      timer = window.setTimeout(() => {
        setNow(new Date())
        schedule()
      }, (60 - current.getSeconds()) * 1000 - current.getMilliseconds() + 50)
    }
    setNow(new Date())
    schedule()
    return () => window.clearTimeout(timer)
  }, [enabled])
  return now
}
