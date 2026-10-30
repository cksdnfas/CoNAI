import { randomUUID } from 'node:crypto'
import { normalize } from './world.mjs'
import { healLanguageLabels } from '../memory/bilingual.mjs'
import { payloadStore } from '../llm-payloads.mjs'

const KEEP = { say: 200, event: 120, viewer: 100, react: 100, dm: 100 }

/** The village tables: one world per account, and the log of speech, events, viewer chat and reactions. */
export function createStore(db) {
  const payloads = payloadStore(db, 'village')
  db.exec(`CREATE TABLE IF NOT EXISTS worlds (owner TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dialogue (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
      speaker INTEGER NOT NULL, name TEXT NOT NULL, recipient TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS dialogue_owner ON dialogue(owner,id);`)
  if (!db.prepare('PRAGMA table_info(dialogue)').all().some(c => c.name === 'kind')) db.exec("ALTER TABLE dialogue ADD COLUMN kind TEXT NOT NULL DEFAULT 'say'")
  const dialogueColumns = db.prepare('PRAGMA table_info(dialogue)').all().map(c => c.name)
  for (const field of ['display_text', 'language', 'display_language']) if (!dialogueColumns.includes(field)) db.exec(`ALTER TABLE dialogue ADD COLUMN ${field} TEXT`)
  healLanguageLabels(db, 'dialogue', { source: row => row.text, display: row => row.display_text, displayLanguage: row => row.display_language, clear: 'display_text=NULL,display_language=NULL' })

  const worlds = new Map()
  const ownerOf = account => {
    if (!account || (account.id !== null && !Number.isInteger(account.id))) throw new Error('로그인한 계정이 필요해.')
    return String(account.id ?? 'bootstrap')
  }
  const load = owner => {
    if (!worlds.has(owner)) worlds.set(owner, normalize(payloads.decode(owner, db.prepare('SELECT state FROM worlds WHERE owner=?').get(owner)?.state ?? 'null')))
    return worlds.get(owner)
  }
  const save = db.transaction((owner, world) => db.prepare('INSERT INTO worlds(owner,state) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET state=excluded.state WHERE state<>excluded.state').run(owner, payloads.encode(owner, world)))
  const history = (owner, after = 0) => db.prepare('SELECT id,kind,speaker,name,recipient,text,display_text,language,display_language,at FROM (SELECT * FROM dialogue WHERE owner=? AND id>? ORDER BY id DESC LIMIT 100) ORDER BY id').all(owner, after)
  const record = (owner, kind, requestId, speaker, name, recipient, text, now, translation = {}) => db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO dialogue(owner,kind,request_id,speaker,name,recipient,text,at,display_text,language,display_language) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(owner, kind, requestId, speaker, name, recipient, text, now, translation.displaySay ?? null, translation.language ?? null, translation.displayLanguage ?? null)
    db.prepare('DELETE FROM dialogue WHERE owner=? AND kind=? AND id NOT IN (SELECT id FROM dialogue WHERE owner=? AND kind=? ORDER BY id DESC LIMIT ?)').run(owner, kind, owner, kind, KEEP[kind])
  })()
  const event = (owner, r, text, now) => record(owner, 'event', `event:${randomUUID()}`, r?.profileId ?? 0, r?.name ?? '', '', text, now)
  const forget = owner => worlds.delete(owner) // after a save slot's rows were deleted
  const isCurrent = (owner, world) => worlds.get(owner) === world
  return { ownerOf, load, save, forget, isCurrent, history, record, event }
}
