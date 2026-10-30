import { ALBUM_PATH } from './gallery.mjs'
import { randomUUID } from 'node:crypto'

/**
 * Save slots: an account keeps up to SLOT_LIMIT separate villages. Every village table stores its rows under one
 * `owner` key, so a slot is just that key: slot 1 is the bare account key (the data from before slots existed),
 * slot n is `${account}#${n}`. `#` never appears in an account key and keeps `${owner}:` prefixes distinct.
 */
export const SLOT_LIMIT = 5
export const NAME_MAX = 30
const FIRST_NAME = '첫 번째 마을'
// Every table with rows owned by a slot key; `kept` survives a reset of that slot.
const TABLES = ['worlds', 'dialogue', 'memory', 'memory_summary', 'memory_segments', 'memory_context', 'aquarium_lore', 'aquarium_lore_migrations',
  'rpg_worlds', 'rpg_commands', 'rpg_replays', 'gallery_queue', 'gallery_album', 'gallery_added', 'llm_payloads']
const KEPT_ON_RESET = new Set(['gallery_queue', 'gallery_album', 'gallery_added'])

export const keyOf = (account, id) => id === 1 ? account : `${account}#${id}`
const split = key => { const [account, n] = key.split('#'); return { account, id: n ? Number(n) : 1 } }

/** Created after every village table exists. */
export function createSlots(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS save_slots (account TEXT NOT NULL, id INTEGER NOT NULL, name TEXT NOT NULL, album TEXT NOT NULL,
      created_at INTEGER NOT NULL, played_at INTEGER NOT NULL, PRIMARY KEY(account, id));
    CREATE TABLE IF NOT EXISTS save_active (account TEXT PRIMARY KEY, slot INTEGER NOT NULL);`)
  if (!db.prepare('PRAGMA table_info(save_slots)').all().some(c => c.name === 'generation')) db.exec("ALTER TABLE save_slots ADD COLUMN generation TEXT NOT NULL DEFAULT ''")
  db.exec("UPDATE save_slots SET generation=lower(hex(randomblob(16))) WHERE generation=''")
  const ensure = account => {
    if (!db.prepare('SELECT 1 FROM save_slots WHERE account=?').get(account)) {
      const now = Date.now()
      db.prepare('INSERT INTO save_slots(account,id,name,album,created_at,played_at,generation) VALUES(?,?,?,?,?,?,?)').run(account, 1, FIRST_NAME, ALBUM_PATH, now, now, randomUUID())
    }
  }
  const rows = account => { ensure(account); return db.prepare('SELECT id, name, album, created_at AS createdAt, played_at AS playedAt FROM save_slots WHERE account=? ORDER BY id').all(account) }
  const row = (account, id) => { ensure(account); return db.prepare('SELECT id, name, album, created_at AS createdAt, played_at AS playedAt FROM save_slots WHERE account=? AND id=?').get(account, id) }
  const activeId = account => {
    ensure(account)
    const id = db.prepare('SELECT slot FROM save_active WHERE account=?').get(account)?.slot
    return id !== undefined && row(account, id) ? id : db.prepare('SELECT MIN(id) AS id FROM save_slots WHERE account=?').get(account).id
  }
  const active = account => keyOf(account, activeId(account))
  const current = account => row(account, activeId(account))
  const ofKey = key => { const { account, id } = split(key); return row(account, id) }
  const need = (account, id) => {
    const slot = Number.isSafeInteger(id) ? row(account, id) : null
    if (!slot) throw new Error('없는 세이브 슬롯이야. 목록을 새로 확인해줘.')
    return slot
  }
  const nameOf = (account, value, except = null) => {
    const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
    if (!name || name.length > NAME_MAX) throw new Error(`슬롯 이름은 1–${NAME_MAX}자로 써줘.`)
    if (/[\\/]/.test(name)) throw new Error('슬롯 이름에는 / 나 \\ 를 쓸 수 없어.')
    if (rows(account).some(s => s.id !== except && s.name === name)) throw new Error('같은 이름의 슬롯이 이미 있어.')
    return name
  }
  /** The library group a slot's pictures go to; fixed when the slot is made, so renaming keeps the same album. */
  const albumOf = key => { const { account, id } = split(key); return db.prepare('SELECT album FROM save_slots WHERE account=? AND id=?').get(account, id)?.album ?? ALBUM_PATH }
  const roomKey = key => {
    const { account, id } = split(key)
    const slot = db.prepare('SELECT generation FROM save_slots WHERE account=? AND id=?').get(account, id)
    if (!slot) throw new Error('없는 세이브 슬롯이야.')
    return `${account}:${id}:${slot.generation}`
  }

  function create(account, value, now) {
    const list = rows(account)
    if (list.length >= SLOT_LIMIT) throw new Error(`세이브 슬롯은 ${SLOT_LIMIT}개까지야. 안 쓰는 슬롯을 지워줘.`)
    const name = nameOf(account, value), id = Math.max(...list.map(s => s.id)) + 1
    db.prepare('INSERT INTO save_slots(account,id,name,album,created_at,played_at,generation) VALUES(?,?,?,?,?,?,?)').run(account, id, name, `${ALBUM_PATH} · ${name}`, now, now, randomUUID())
    return id
  }
  const rename = (account, id, value) => { need(account, id); db.prepare('UPDATE save_slots SET name=? WHERE account=? AND id=?').run(nameOf(account, value, id), account, id) }
  const select = (account, id, now) => {
    need(account, id)
    db.prepare('INSERT INTO save_active(account,slot) VALUES(?,?) ON CONFLICT(account) DO UPDATE SET slot=excluded.slot').run(account, id)
    touch(account, id, now)
  }
  const touch = (account, id, now) => db.prepare('UPDATE save_slots SET played_at=? WHERE account=? AND id=?').run(now, account, id)
  /** Deletes every row of the slot key; with `reset` the album rows and the shared world book (resident 0) stay. */
  const wipe = (key, reset) => db.transaction(() => {
    const { account, id } = split(key)
    db.prepare('UPDATE save_slots SET generation=? WHERE account=? AND id=?').run(randomUUID(), account, id)
    for (const table of TABLES) {
      if (reset && KEPT_ON_RESET.has(table)) continue
      db.prepare(`DELETE FROM ${table} WHERE owner=?${reset && table === 'aquarium_lore' ? ' AND resident<>0' : ''}`).run(key)
    }
  })()
  function remove(account, id) {
    need(account, id)
    if (id === activeId(account)) throw new Error('지금 쓰는 슬롯은 지울 수 없어. 다른 슬롯으로 바꾼 뒤 지워줘.')
    db.transaction(() => { wipe(keyOf(account, id), false); db.prepare('DELETE FROM save_slots WHERE account=? AND id=?').run(account, id) })()
  }
  /** A reset slot counts as started again: the page clears what it shows when `createdAt` changes. */
  const restarted = (account, id, now) => db.prepare('UPDATE save_slots SET created_at=?, played_at=? WHERE account=? AND id=?').run(now, now, account, id)
  /** Copies the shared world book (resident 0) of one slot key into another. */
  function copyWorldBook(from, to) {
    const columns = db.prepare('PRAGMA table_info(aquarium_lore)').all().map(c => c.name)
    db.prepare(`INSERT OR IGNORE INTO aquarium_lore(${columns.join(',')}) SELECT ${columns.map(c => c === 'owner' ? '?' : c).join(',')} FROM aquarium_lore WHERE owner=? AND resident=0`).run(to, from)
  }
  return { rows, row, ofKey, active, activeId, current, need, albumOf, roomKey, create, rename, select, touch, wipe, remove, restarted, copyWorldBook }
}
