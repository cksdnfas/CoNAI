import { newRpg, migrateRpg, syncActors } from './rules.mjs'
import { ensureStatuses } from '../../shared/agents.mjs'
import { payloadStore } from '../llm-payloads.mjs'

/** All state transitions are short SQLite transactions; model/tool awaits never hold a DB lock. */
export function createStore(db, replays, onEvent) {
  const payloads = payloadStore(db, 'rpg')
  db.exec('CREATE TABLE IF NOT EXISTS rpg_worlds(owner TEXT PRIMARY KEY, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS rpg_commands(owner TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(owner,request_id));')
  const stored = owner => {
    const row = db.prepare('SELECT state FROM rpg_worlds WHERE owner=?').get(owner)
    if (!row) return { state: newRpg(), raw: null }
    const state = payloads.decode(owner, row.state)
    if (state.v < 5 || (state.agentVersion ?? 0) < 5) {
      if (state.v < 2) state.obsoleteJobId = state.pending?.jobId ?? null
      migrateRpg(state)
      db.transaction(() => db.prepare('UPDATE rpg_worlds SET state=? WHERE owner=?').run(payloads.encode(owner, state), owner))()
      return { state, raw: null }
    }
    return { state, raw: row.state }
  }
  const read = owner => stored(owner).state
  /** `onlyChanged`: a change that left the state as it was is not stored (the tick's step runs twice a second). */
  const write = (owner, change, onlyChanged = false, captureReplay = true) => db.transaction(() => {
    const { state, raw } = stored(owner), before = state.seq
    const hadExpedition = state.actors.some(a => a.expedition)
    const result = change(state)
    if (onlyChanged && raw !== null && payloads.encode(owner, state) === raw) return result
    state.revision++
    db.prepare('INSERT INTO rpg_worlds(owner,state) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET state=excluded.state').run(owner, payloads.encode(owner, state))
    if (captureReplay && (hadExpedition || state.actors.some(a => a.expedition))) replays.capture(owner, state)
    for (const entry of state.logs.filter(e => e.id > before)) onEvent(owner, entry, state.actors.find(a => a.id === entry.actorId))
    return result
  })()
  function sync(owner, residents) {
    const state = read(owner)
    if (state.actors.some(a => a.active !== residents.some(r => r.profileId === a.profileId)) || residents.some(r => !state.actors.some(a => a.profileId === r.profileId && a.name === r.name))) write(owner, s => { syncActors(s, residents); for (const a of s.actors) ensureStatuses(s, a) })
  }
  return { read, write, sync }
}
