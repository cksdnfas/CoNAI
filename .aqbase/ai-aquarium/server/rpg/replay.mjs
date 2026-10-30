import { stats } from './rules.mjs'

/**
 * Expedition replays: not video, just the game again. Each expedition keeps the floor as it was at the start,
 * then one small frame whenever the explorer moves, fights or changes phase, plus its own log lines.
 * Recording happens in memory while the expedition runs; one row is written when it ends.
 */
const KEEP = 30 // replays per account
const MAX_FRAMES = 4000
const MAX_LOGS = 200

export function createReplays(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS rpg_replays (id TEXT PRIMARY KEY, owner TEXT NOT NULL, profile_id INTEGER NOT NULL, name TEXT NOT NULL,
      title TEXT NOT NULL, floor INTEGER NOT NULL, zone TEXT NOT NULL, outcome TEXT NOT NULL, kills INTEGER NOT NULL,
      started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS rpg_replays_owner ON rpg_replays(owner, ended_at);`)
  const open = new Map() // `${owner}:${expeditionId}` → recording

  function start(state, actor, now) {
    const e = actor.expedition, zone = state.zones.find(z => z.id === e.zoneId), map = zone?.map
    if (!map) return null
    const quest = state.quests.find(q => q.id === actor.questId)
    const entities = map.entities.map(x => ({ id: x.id, at: x.at, kind: x.kind, boss: !!x.boss, done: !!x.done, hp: x.hp ?? null, max: x.monster?.hp ?? null, name: x.monster?.name ?? '' }))
    const s = stats(state, actor)
    return {
      expeditionId: e.id, actorId: actor.id, t0: now, logAfter: state.seq,
      seen: actor.knowledge?.[zone.id] ?? '', done: entities.map(x => x.done), prev: '',
      base: {
        actor: { profileId: actor.profileId, name: actor.name, job: actor.job, level: actor.level, rank: actor.rank, maxHp: s.hp, maxMp: s.mp },
        title: e.title || '', startedAt: e.startedAt, late: now - e.startedAt > 5_000,
        zone: { id: zone.id, name: zone.name, floor: zone.floor, cleared: !!zone.cleared, width: map.width, height: map.height, tiles: map.tiles, entrance: map.entrance, exit: map.exit },
        quest: quest ? { title: quest.title, type: quest.type ?? 'hunt', count: quest.count, progress: quest.progress } : null,
        seen: actor.knowledge?.[zone.id] ?? '', entities: entities.map(({ done, ...x }) => ({ ...x, done })),
      },
      frames: [], logs: [], kills: 0,
    }
  }

  // Frame: [t, position, phase, hp, mp, enemy index or -1, enemy hp, damage dealt this round, quest progress, newly seen tiles, newly cleared entities]
  function frame(rec, state, actor, now) {
    const e = actor.expedition, zone = state.zones.find(z => z.id === rec.base.zone.id), map = zone.map
    const quest = state.quests.find(q => q.id === actor.questId)
    const enemy = e.encounterId ? map.entities.findIndex(x => x.id === e.encounterId) : -1
    const sig = [e.position, actor.phase, actor.hp, actor.mp, enemy, e.foeHp, e.round, quest?.progress ?? -1].join(',')
    const seenNow = actor.knowledge?.[zone.id] ?? rec.seen, added = []
    for (let i = 0; i < seenNow.length; i++) if (seenNow[i] === '1' && rec.seen[i] !== '1') added.push(i)
    const gone = []
    map.entities.forEach((x, i) => { if (x.done && !rec.done[i]) { gone.push(i); rec.done[i] = true } })
    rec.seen = seenNow
    rec.kills = e.kills ?? rec.kills
    if (sig === rec.prev && !added.length && !gone.length) return
    const dealt = sig.split(',')[6] !== rec.prev.split(',')[6] && e.last ? e.last.dealt ?? 0 : 0
    rec.prev = sig
    if (rec.frames.length < MAX_FRAMES) rec.frames.push([now - rec.t0, e.position, actor.phase, actor.hp, actor.mp, enemy, e.foeHp ?? 0, dealt, quest?.progress ?? -1, added.length ? added : 0, gone.length ? gone : 0])
  }

  function logs(rec, state) {
    for (const l of state.logs) if (l.id > rec.logAfter) {
      rec.logAfter = l.id
      if (l.actorId === rec.actorId && rec.logs.length < MAX_LOGS) rec.logs.push([Math.max(0, l.at - rec.t0), l.text])
    }
  }

  function finish(owner, rec, state, actor, now) {
    logs(rec, state)
    const last = actor?.journal?.at(-1)
    const outcome = actor?.phase === 'dead' ? 'death' : last && last.at >= rec.t0 ? last.outcome : 'recalled'
    rec.frames.push([now - rec.t0, rec.frames.at(-1)?.[1] ?? rec.base.zone.entrance, outcome === 'death' ? 'dead' : 'home', actor?.hp ?? 0, actor?.mp ?? 0, -1, 0, 0, rec.frames.at(-1)?.[8] ?? -1, 0, 0])
    if (rec.frames.length < 3 && !rec.logs.length) return
    const b = rec.base
    db.prepare('INSERT OR REPLACE INTO rpg_replays(id,owner,profile_id,name,title,floor,zone,outcome,kills,started_at,ended_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(rec.expeditionId, owner, b.actor.profileId, b.actor.name, b.title, b.zone.floor, b.zone.name, outcome, rec.kills, b.startedAt, now,
        JSON.stringify({ v: 1, ...b, outcome, kills: rec.kills, duration: now - rec.t0, frames: rec.frames, logs: rec.logs }))
    db.prepare('DELETE FROM rpg_replays WHERE owner=? AND id NOT IN (SELECT id FROM rpg_replays WHERE owner=? ORDER BY ended_at DESC LIMIT ?)').run(owner, owner, KEEP)
  }

  /** Called after every game write with the state just saved. */
  function capture(owner, state, now = Date.now()) {
    const live = new Set()
    for (const actor of state.actors) {
      if (!actor.active || !actor.expedition) continue
      const key = `${owner}:${actor.expedition.id}`
      live.add(key)
      let rec = open.get(key)
      if (!rec) { rec = start(state, actor, now); if (!rec) continue; open.set(key, rec) }
      frame(rec, state, actor, now); logs(rec, state)
    }
    for (const [key, rec] of open) {
      if (!key.startsWith(`${owner}:`) || live.has(key)) continue
      open.delete(key)
      finish(owner, rec, state, state.actors.find(a => a.id === rec.actorId), now)
    }
  }

  const list = owner => db.prepare('SELECT id, profile_id AS profileId, name, title, floor, zone, outcome, kills, started_at AS startedAt, ended_at AS endedAt FROM rpg_replays WHERE owner=? ORDER BY ended_at DESC LIMIT ?').all(owner, KEEP)
  function get(owner, id) {
    const row = typeof id === 'string' ? db.prepare('SELECT id, data FROM rpg_replays WHERE owner=? AND id=?').get(owner, id) : null
    if (!row) throw new Error('다시보기를 찾을 수 없어.')
    return { id: row.id, ...JSON.parse(row.data) }
  }
  /** Drops unfinished recordings of a save slot whose rows were deleted, so none is written back into it. */
  const drop = owner => { for (const key of [...open.keys()]) if (key.startsWith(`${owner}:`)) open.delete(key) }
  return { capture, list, get, drop }
}
