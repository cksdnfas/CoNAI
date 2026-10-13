import { getUserSettingsDb } from '../../database/userSettingsDb'
import type Database from 'better-sqlite3'

const initialized = new WeakSet<Database.Database>()
export function pluginDb(): Database.Database {
  const db = getUserSettingsDb()
  if (!initialized.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY, version TEXT NOT NULL, manifest TEXT NOT NULL, digest TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0, installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS plugin_instances (
        id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, version TEXT NOT NULL, digest TEXT NOT NULL,
        page_id TEXT NOT NULL, session_key TEXT NOT NULL, owner_key TEXT NOT NULL, files TEXT NOT NULL,
        expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS plugin_instances_expiry ON plugin_instances(expires_at);
      CREATE TABLE IF NOT EXISTS plugin_proposals (
        id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, file_id TEXT NOT NULL, body TEXT NOT NULL,
        approval_hash TEXT, result TEXT, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS plugin_proposals_instance ON plugin_proposals(instance_id);
    `)
    initialized.add(db)
  }
  return db
}
