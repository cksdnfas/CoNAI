import { busy, route, freeNear } from './world.mjs'
import { DEFAULT_SETTINGS } from '../../shared/village-settings.mjs'
import { doorOf, GATE } from '../../shared/tiles.mjs'
import { clockOf, advanceBy, DAY, WEEKDAYS } from '../../shared/clock.mjs'
import { AWAY, ERRAND_TEXT } from './constants.mjs'

export const postOf = (world, r, role) => {
  const door = doorOf(role, world.geometry)
  return door ? freeNear(world, { x: door.x + 1, y: door.y }, r) : { x: Math.round(r.x), y: Math.round(r.y) }
}

/** Only coordinate/phase synchronisation remains here. Work, shrine visits and
 * sleep/wake are explicit resident choices; default schedules are model context. */
export function createErrands({ store }) {
  function errands(owner, world, now, game) {
    const gate = GATE.tile, shrine = doorOf('oracle', game?.life)
    for (const r of world.residents) {
      const actor = game?.actors.find(a => a.active && a.profileId === r.profileId)
      const phase = game?.settings.enabled ? actor?.phase : null
      r.posted = !!actor?.working
      if (actor?.sleeping !== undefined) r.asleep = actor.sleeping
      if (phase === 'travel' && actor.expedition) {
        r.asleep = false
        if (r.gate === actor.expedition.id || Math.hypot(r.x - gate.x, r.y - gate.y) < 1) {
          r.gate = actor.expedition.id; r.away = true; r.errand = ''; r.path = []; r.awayPhase = phase
        } else if (!busy(world, r)) {
          r.away = false; r.errand = 'depart'; r.destination = ERRAND_TEXT.depart; r.activity = 'walk'
          if (!r.path.length) r.path = route(r, gate, world.geometry?.map)
        }
        continue
      }
      if (AWAY.has(phase)) { r.away = true; r.asleep = false; r.errand = ''; r.path = []; r.awayPhase = phase; continue }
      if (r.away) {
        const spot = freeNear(world, r.awayPhase === 'dead' && shrine ? shrine : gate, r)
        Object.assign(r, { away: false, gate: '', awayPhase: '', errand: '', x: spot.x, y: spot.y, path: [], activity: 'idle' })
      }
      if (['post', 'bed', 'rough', 'depart'].includes(r.errand)) { r.errand = ''; r.path = [] }
      if (r.errand === 'oracle' && !actor?.oracleRequested) r.errand = ''
    }
  }
  function passTime(owner, world, seconds, now) {
    const before = world.clock
    world.clock += advanceBy(Math.min(5, seconds), world.settings.dayMinutes ?? DEFAULT_SETTINGS.dayMinutes)
    const morning = m => Math.floor((m - 360) / DAY)
    if (morning(world.clock) > morning(before)) { const c = clockOf(world.clock); store.event(owner, null, `${c.day}일째 ${WEEKDAYS[c.weekday]}요일 아침이 밝았어`, now) }
  }
  return { errands, passTime }
}
