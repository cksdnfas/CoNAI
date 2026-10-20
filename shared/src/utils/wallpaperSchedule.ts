import type { WallpaperSchedule } from '../types/settings'

function toMinutes(clock: string) {
  const [hours, minutes] = clock.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * The scheduled preset for `date`: the first enabled window that matches the weekday and time (the upper entry wins).
 * A window that wraps midnight belongs to the weekday it started on. Shared by the live wallpaper page and the MCP
 * wallpaper tools.
 */
export function resolveScheduledWallpaperPresetId(schedule: WallpaperSchedule | null | undefined, date = new Date()): string | null {
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
