import type Database from 'better-sqlite3'
import { getUserSettingsDb } from '../database/userSettingsDb'

/**
 * The stop-everything switch for automations: while it is on, neither chat routines nor workflow schedules start
 * anything. Due work waits; when it is switched off again each one runs once and goes on from there.
 */
const ensured = new WeakSet<Database.Database>()
function table() {
  const db = getUserSettingsDb()
  if (!ensured.has(db)) {
    db.exec('CREATE TABLE IF NOT EXISTS automation_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')))')
    ensured.add(db)
  }
  return db
}

export const AutomationSwitch = {
  isPaused() {
    const row = table().prepare("SELECT value FROM automation_state WHERE key = 'paused'").get() as { value: string } | undefined
    return row?.value === '1'
  },
  setPaused(paused: boolean) {
    table().prepare("INSERT INTO automation_state (key, value) VALUES ('paused', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").run(paused ? '1' : '0')
    return AutomationSwitch.isPaused()
  },
}
