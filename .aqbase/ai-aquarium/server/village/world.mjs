import { WIDTH, HEIGHT, TILE, MAP_VERSION, BUILDINGS, PLACES, walkable, runtimeMap, runtimePlaces, canWalk, findPath } from '../../shared/tiles.mjs'
import { START_MINUTE } from '../../shared/clock.mjs'
import { DEFAULT_SETTINGS, replyTimeoutMinutesOf } from '../../shared/village-settings.mjs'

export { WIDTH, HEIGHT, TILE, BUILDINGS, PLACES, walkable }
export const COLORS = ['#ebad76', '#83b6b1', '#b0a2d4', '#dd8e97', '#b8c77b', '#87a8d0']
export const TALK_DISTANCE = 2.6
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const key = p => `${p.x},${p.y}`

export const route = (from, to, map = null) => findPath(map, from, to)
/** Geometry is a transient projection of the RPG store, not a second persistent map. */
export function bindGeometry(world, life) {
  if (world.geometry?.epoch === life.epoch && world.geometry?.map.revision === life.map.revision) return
  const map = runtimeMap(life)
  Object.defineProperty(world, 'geometry', { value: { epoch: life.epoch, map, buildings: life.buildings, places: runtimePlaces(life) }, configurable: true })
  for (const r of world.residents) {
    r.path = []
    if (r.activity !== 'talk') r.activity = 'idle'
  }
  world.lifeMapRevision = life.map.revision
  arrange(world)
}

/** The tile each resident stands on or is walking to; nobody else may end a walk there. */
const claimed = (world, except) => new Set(world.residents.filter(r => r !== except && !r.asleep && !r.away).map(r => key(r.path.at(-1) ?? { x: Math.round(r.x), y: Math.round(r.y) })))
/** The nearest walkable tile nobody claims, searching outward from `from`. */
export function freeNear(world, from, except) {
  const taken = claimed(world, except), start = { x: Math.round(from.x), y: Math.round(from.y) }
  const queue = [start], seen = new Set([key(start)])
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]
    if (canWalk(world.geometry?.map, p.x, p.y) && !taken.has(key(p))) return p
    for (const [dx, dy] of NEIGHBOURS) {
      const n = { x: p.x + dx, y: p.y + dy }
      if (n.x >= 0 && n.y >= 0 && n.x < (world.geometry?.map.width ?? WIDTH) && n.y < (world.geometry?.map.height ?? HEIGHT) && !seen.has(key(n))) { seen.add(key(n)); queue.push(n) }
    }
  }
  return start
}

export function newWorld() {
  return { v: 2, profileBudgetVersion: 1, profileTimeoutVersion: 1, map: MAP_VERSION, revision: 0, residents: [], settings: { ...DEFAULT_SETTINGS }, running: false, runId: '', seq: 0, lastTick: 0,
    pending: null, conversation: null, conversations: [], error: null, failures: 0, talkReadyAt: 0, clock: START_MINUTE }
}
/** Older saves ran per observation window; they come back stopped with their residents and scene. */
export function normalize(saved) {
  const world = { ...newWorld(), ...(saved && saved.v === 2 ? saved : {}) }
  if (saved && saved.v !== 2) {
    world.revision = saved.revision ?? 0
    world.residents = (saved.residents ?? []).map((r, i) => ({ ...resident({ id: r.profileId, name: r.name }, i, 0), color: r.color, x: r.x, y: r.y }))
    world.settings = { ...DEFAULT_SETTINGS, scene: saved.settings?.scene || DEFAULT_SETTINGS.scene }
  }
  if (saved?.map !== MAP_VERSION) for (const r of world.residents) { r.path = []; if (r.activity !== 'talk') r.activity = 'idle' }
  world.settings = { ...world.settings, replyTimeoutMinutes: replyTimeoutMinutesOf(world.settings) }
  if (saved?.profileTimeoutVersion !== 1) {
    if (saved?.settings?.replyTimeoutMinutes === undefined || saved.settings.replyTimeoutMinutes === 5) world.settings.replyTimeoutMinutes = 0
    world.profileTimeoutVersion = 1
  }
  if (saved?.profileBudgetVersion !== 1) { world.settings.replyLength = 0; world.profileBudgetVersion = 1 }
  delete world.settings.assumedContext
  delete world.settings.draw
  delete world.drawReadyAt
  delete world.cooldowns
  for (const r of world.residents) {
    delete r.drawingUntil
    delete r.lastCategory
    if (r.agentJob?.request && !r.agentJob.request.payloadRef) {
      if (r.agentJob.request.state) delete r.agentJob.request.state.memories
      if (r.agentJob.request.decider === 'rules') r.agentJob.request.decider = 'judge'
    }
    if (r.agentRoute?.decider === 'rules') r.agentRoute = null
    r.decisionLog = (r.decisionLog ?? []).slice(0, 30)
    for (const e of r.decisionLog) if (e.options) {
      e.offeredCount ??= e.options.length
      if (e.options.length) e._catalog ??= { options: e.options }
      delete e.options
    }
  }
  world.conversations ??= []
  if (!world.conversations.length && world.conversation) {
    const c = world.conversation
    c.id ??= `legacy:${world.runId}`; c.participants ??= [c.a, c.b]; c.speaker ??= c.turn === 0 ? c.a : c.b
    c.lines ??= []; c.pending ??= world.pending
    world.conversations.push(c)
  }
  world.conversation = world.conversations[0] ?? null
  // Old text-mode/schema jobs cannot be interpreted as native speech or inherit an unscoped room.
  const obsolete = pending => pending && (pending.input?.mode !== 'profile' || !pending.input?.roomKey)
  const discard = pending => { if (pending?.jobId) (world.obsoleteTalkJobs ??= []).push(pending.jobId) }
  for (const c of world.conversations) if (obsolete(c.pending)) {
    discard(c.pending); discard(c.nextChoice)
    c.pending = null; c.nextChoice = null; c.selection = null; c.nextAt = 0; delete c.admission
  }
  if (obsolete(world.sideJob)) { discard(world.sideJob); discard(world.sideJob.selection); world.sideJob = null }
  world.sideWaiting = (world.sideWaiting ?? []).filter(p => {
    if (!obsolete(p)) return true
    discard(p); discard(p.selection); return false
  })
  world.pending = world.conversations.find(c => c.pending)?.pending ?? null
  world.map = MAP_VERSION
  if (!Number.isFinite(world.clock)) world.clock = START_MINUTE
  if (!world.lifeMapRevision) arrange(world)
  return world
}
export function resident(profile, i, now) {
  const square = PLACES[0].tiles, spot = square[(i * 2) % square.length] // two tiles apart: close enough to talk
  return { profileId: profile.id, name: profile.name, color: COLORS[i % COLORS.length],
    x: spot.x, y: spot.y, path: [], destination: '광장', activity: 'idle', nextAt: now + 1000 + i * 700, bubble: '', bubbleUntil: 0 }
}
/** Residents standing on an unwalkable or already taken tile (old maps, new arrivals) step to the nearest free one. */
export function arrange(world) {
  const placed = []
  for (const r of world.residents) {
    if (r.asleep || r.away) continue
    if (r.path.length) { placed.push(r); continue }
    const tile = { x: Math.round(r.x), y: Math.round(r.y) }
    const taken = placed.some(o => key(o.path.at(-1) ?? { x: Math.round(o.x), y: Math.round(o.y) }) === key(tile))
    if (!canWalk(world.geometry?.map, tile.x, tile.y) || taken) {
      const free = freeNear({ residents: placed, geometry: world.geometry }, tile)
      r.x = free.x; r.y = free.y
    }
    placed.push(r)
  }
}
export function placeOf(r, world = null) {
  const tile = { x: Math.round(r.x), y: Math.round(r.y) }
  let best = null, distance = Infinity
  for (const place of world?.geometry?.places ?? PLACES) for (const t of place.tiles) {
    const d = Math.hypot(t.x - tile.x, t.y - tile.y)
    if (d < distance) { best = place; distance = d }
  }
  return best && distance <= 1.5 ? best.name : '마을 길'
}
export const busy = (world, r) => (world.research?.status === 'running' && world.research.input.profileIds.includes(r.profileId)) ||
  (world.conversations ?? (world.conversation ? [world.conversation] : [])).some(c => (c.participants ?? [c.a, c.b]).includes(r.profileId))
export function actionDelay(settings, random) {
  return Math.round((settings.actionMin + random() * (settings.actionMax - settings.actionMin)) * 1000)
}

/** Walks every free resident along its path. Returns arrivals at named places. */
export function step(world, dt) {
  const events = []
  for (const r of world.residents) {
    if (busy(world, r) || r.away || r.asleep || !r.path.length) continue
    let budget = dt * (world.settings.walkSpeed ?? DEFAULT_SETTINGS.walkSpeed)
    while (budget > 0 && r.path.length) {
      const p = r.path[0], d = Math.hypot(p.x - r.x, p.y - r.y)
      if (d <= budget) { r.x = p.x; r.y = p.y; r.path.shift(); budget -= d }
      else { r.x += (p.x - r.x) / d * budget; r.y += (p.y - r.y) / d * budget; budget = 0 }
    }
    if (!r.path.length) {
      if (r.activity === 'walk') events.push({ resident: r, place: r.destination })
      r.activity = 'idle'; r.destination = placeOf(r, world)
    }
  }
  return events
}

function partnerFor(world, r, now) {
  let best = null, distance = Infinity
  for (const o of world.residents) {
    if (o === r || o.away || o.asleep || o.errand || busy(world, o)) continue
    const d = Math.hypot(o.x - r.x, o.y - r.y)
    if (d < distance) { best = o; distance = d }
  }
  return best && distance <= TALK_DISTANCE ? best : null
}

/** Stops a walk on the tile it is crossing, or the nearest free one (the page eases the small step). */
function halt(world, r) {
  if (!r.path.length) return
  r.path = []
  const tile = freeNear(world, r, r)
  r.x = tile.x; r.y = tile.y
}

/** One key per group of residents, independent of who spoke first. */
export const talkKey = ids => [...ids].sort((a, b) => a - b).join(':')
/** Every two-resident key of a group, so rest and last lines also hold for residents who met in a group talk. */
export const pairKeys = ids => ids.flatMap((a, i) => ids.slice(i + 1).map(b => talkKey([a, b])))
/** Whether two residents still rest from talking to each other, in game time. */
export const resting = (world, a, b) => (world.talkRest?.[talkKey([a, b])] ?? -Infinity) > world.clock

export function endConversation(world, now, random = Math.random, conversation = world.conversation) {
  const c = conversation
  if (!c) return
  // The next conversation of the same residents continues from here instead of opening the same topic again.
  if (c.lines?.length) {
    const last = c.lines.slice(-4).map(l => ({ profileId: l.profileId, name: l.name, text: l.text }))
    for (const k of pairKeys(c.participants ?? [c.a, c.b])) (world.recentTalks ??= {})[k] = last
  }
  for (const id of c.participants ?? [c.a, c.b]) {
    const r = world.residents.find(x => x.profileId === id)
    if (r) { r.activity = 'idle'; r.nextAt = now }
  }
  world.conversations = (world.conversations ?? []).filter(x => x !== c)
  world.conversation = world.conversations[0] ?? null
  world.pending = world.conversations.find(x => x.pending)?.pending ?? null
}
