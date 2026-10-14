import { createHash, randomBytes } from 'crypto'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import type Database from 'better-sqlite3'

export class PluginError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
/** Instance, proposal, approval and media tokens: 48 hex characters, stored only as their hash. */
export const pluginToken = () => randomBytes(24).toString('hex')
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

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
      CREATE INDEX IF NOT EXISTS plugin_instances_session ON plugin_instances(session_key, expires_at);
      CREATE TABLE IF NOT EXISTS plugin_proposals (
        id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, file_id TEXT NOT NULL, body TEXT NOT NULL,
        approval_hash TEXT, result TEXT, expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS plugin_proposals_instance ON plugin_proposals(instance_id);
      CREATE TABLE IF NOT EXISTS plugin_app_requests (
        id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
        plugin_id TEXT NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL, context TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', job_id TEXT, expires_at INTEGER NOT NULL,
        UNIQUE(owner_key,request_key));
      CREATE INDEX IF NOT EXISTS plugin_app_requests_owner ON plugin_app_requests(owner_key,expires_at);
      CREATE INDEX IF NOT EXISTS plugin_app_requests_status ON plugin_app_requests(status);
      CREATE TABLE IF NOT EXISTS plugin_llm_requests (
        plugin_id TEXT NOT NULL, owner_key TEXT NOT NULL, request_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL, digest TEXT NOT NULL, profile_id INTEGER NOT NULL,
        job_id TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL,
        PRIMARY KEY(plugin_id, owner_key, request_key));
      CREATE INDEX IF NOT EXISTS plugin_llm_requests_expiry ON plugin_llm_requests(expires_at);
      CREATE TABLE IF NOT EXISTS plugin_storage (
        plugin_id TEXT NOT NULL, owner_key TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, revision TEXT NOT NULL,
        PRIMARY KEY(plugin_id,owner_key,key));
    `)
    if (!(db.prepare('PRAGMA table_info(plugin_instances)').all() as Array<{ name: string }>).some(column => column.name === 'workspace')) db.exec('ALTER TABLE plugin_instances ADD COLUMN workspace TEXT')
    // The administrator who turned a plugin on: its server module's own calls (timers, startup) run as them.
    if (!(db.prepare('PRAGMA table_info(plugins)').all() as Array<{ name: string }>).some(column => column.name === 'enabled_by')) db.exec('ALTER TABLE plugins ADD COLUMN enabled_by INTEGER')
    initialized.add(db)
  }
  return db
}

const changeListeners = new Set<(id: string) => unknown>()
/** Install, update, enable, disable and remove call this; the server runtime follows along. */
export function onPluginChanged(listener: (id: string) => unknown) {
  changeListeners.add(listener)
  return () => { changeListeners.delete(listener) }
}
export async function pluginChanged(id: string) {
  await Promise.all([...changeListeners].map(listener => listener(id)))
}

/**
 * Room for one more review card on a plugin window (file saves, project changes and media jobs share the table):
 * expired cards go first, then at most 24 kept and 4 still waiting for the person.
 */
export function requireProposalRoom(instanceId: string) {
  const store = pluginDb()
  store.prepare('DELETE FROM plugin_proposals WHERE expires_at < ?').run(Date.now())
  const counts = store.prepare('SELECT COUNT(*) AS total, SUM(result IS NULL) AS pending FROM plugin_proposals WHERE instance_id=?').get(instanceId) as { total: number; pending: number | null }
  if (counts.total >= 24 || (counts.pending ?? 0) >= 4) throw new PluginError('대기 중인 검토를 먼저 처리해줘.', 429)
}
/** The host's approval of one card: the token goes back to the host, only its hash is stored. */
export function issueProposalApproval(proposalId: string) {
  const approval = pluginToken()
  pluginDb().prepare('UPDATE plugin_proposals SET approval_hash=? WHERE id=?').run(sha256(approval), proposalId)
  return approval
}

const MEDIA_LINK_MS = 60_000
/**
 * Bearer links for media a plugin page shows (`<video src>` can't send a session). A link lives a minute from its
 * last use, so a player seeking or re-buffering keeps working; the plugin window's lease still bounds it.
 */
export class PluginMediaGrants<T extends { instanceId: string }> {
  private readonly grants = new Map<string, T & { expiresAt: number }>()
  issue(grant: T) {
    const now = Date.now()
    for (const [key, value] of this.grants) if (value.expiresAt <= now) this.grants.delete(key)
    if (this.grants.size >= 1000) throw new PluginError('미디어 요청이 너무 많아.', 429)
    const token = pluginToken(), expiresAt = now + MEDIA_LINK_MS
    this.grants.set(sha256(token), { ...grant, expiresAt })
    return { token, expiresAt }
  }
  use(token: string) {
    const grant = this.grants.get(sha256(token))
    if (!grant || grant.expiresAt <= Date.now()) throw new PluginError('미디어 링크가 만료됐어.', 410)
    grant.expiresAt = Date.now() + MEDIA_LINK_MS
    return grant
  }
}
