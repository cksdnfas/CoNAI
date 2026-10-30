/* Replays: the recorded frames are applied in order; seeking backwards starts over from the first frame. */
export function replayAt(rp) {
  const d = rp.data
  let c = rp.cache
  if (!c || rp.t < c.t) {
    c = rp.cache = { i: -1, t: 0, seen: Uint8Array.from(d.zone.tiles, (_, i) => d.seen[i] === '1' ? 1 : 0), done: d.entities.map(e => e.done), hp: d.entities.map(e => e.hp) }
  }
  while (c.i + 1 < d.frames.length && d.frames[c.i + 1][0] <= rp.t) {
    const f = d.frames[++c.i]
    if (f[9]) for (const i of f[9]) c.seen[i] = 1
    if (f[10]) for (const i of f[10]) c.done[i] = true
    if (f[5] >= 0) c.hp[f[5]] = f[6]
  }
  c.t = rp.t
  return c
}
export const replayFrame = rp => rp.data.frames[replayAt(rp).i] ?? null
export function replayScene(rp) {
  const d = rp.data, z = d.zone, st = replayAt(rp), f = d.frames[st.i] ?? null, prev = d.frames[st.i - 1] ?? null
  const tileOf = at => ({ x: at % z.width + .5, y: Math.floor(at / z.width) + .5 })
  const next = d.frames[st.i + 1] ?? null
  let pos = { ...tileOf(f ? f[1] : z.entrance), walking: false }
  if (f && next && next[1] !== f[1] && next[0] - f[0] <= 4000) {
    const span = Math.min(next[0] - f[0], 1200), k = Math.max(0, Math.min(1, (rp.t - (next[0] - span)) / span)), to = tileOf(next[1])
    pos = { x: pos.x + (to.x - pos.x) * k, y: pos.y + (to.y - pos.y) * k, walking: k > 0 }
  }
  const enemy = f && f[5] >= 0 ? d.entities[f[5]] : null, age = f ? rp.t - f[0] : 1e9, taken = f && prev && f[2] === 'combat' ? Math.max(0, prev[3] - f[3]) : 0
  const crew = f && f[2] !== 'home' ? [{ id: 'replay', profileId: d.actor.profileId, name: d.actor.name, at: f[1], pos, phase: f[2], encounterId: enemy?.id ?? null,
    hit: f[2] === 'combat' && (f[7] > 0 || taken > 0) && age < 900 ? { age, dealt: f[7], taken, skill: false } : null }] : []
  return { key: z.id, map: z, cleared: z.cleared || st.done.some((x, i) => x && d.entities[i].boss), seen: st.seen, explored: st.seen, focusId: 'replay', crew, moving: true,
    entities: d.entities.map((e, i) => ({ ...e, done: st.done[i], hp: st.hp[i] })) }
}
