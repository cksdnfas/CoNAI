export const BC_PHASE = { town: '길드 대기', rest: '쉬는 중', travel: '던전 입장', explore: '탐험 중', combat: '전투 중', consider: '판단 중', return: '귀환 중', dead: '부활 대기' }
export const BC_ROLE = { guild: '길드 접수원', merchant: '상인', oracle: '신관' }
export const BC_ORDER = { combat: 0, consider: 1, explore: 2, travel: 3, return: 4 }
export const BC_TAG = { live: 'LIVE', life: '생활', rest: '휴식', replay: '다시보기' }
export const BC_OUTCOME = { completed: '의뢰 완료', returned: '귀환', recalled: '중단', death: '쓰러짐' }
export const BC_SPEEDS = [1, 2, 4, 8]
/** A #rrggbb colour mixed toward black, for names drawn on light bubbles. */
export const shade = (hex, keep) => `rgb(${[1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * keep)).join(',')})`
export const BC_SVG = {
  tv: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6.5" width="18" height="13" rx="2.5"/><path d="M8.5 3l3.5 3.5L15.5 3"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  mini: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="12" width="6" height="4" rx="1" class="fill"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  memory: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
}
/** Shortest floor path from one tile to another, excluding the start; null when farther than `limit` steps. */
export function bcTilePath(map, from, to, limit = 12) {
  if (from === to) return []
  const back = new Map([[from, -1]]), queue = [from]
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i], x = at % map.width, y = Math.floor(at / map.width)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * map.width + nx
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height || back.has(next) || map.tiles[next] !== '.') continue
      back.set(next, at)
      if (next === to) { const path = []; for (let c = to; c !== from; c = back.get(c)) path.unshift(c); return path.length <= limit ? path : null }
      queue.push(next)
    }
  }
  return null
}
export const bcAgo = ms => { const m = Math.max(0, Math.round(ms / 60_000)); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전` }
export const bcClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}` }

/** One channel per resident: LIVE in the dungeon, 생활 at home, 휴식 asleep or away; on-air channels first. */
export function buildChannels(world) {
  const rpg = world?.rpg ?? null
  const list = (world?.residents ?? []).map(r => {
    const actor = rpg?.actors.find(a => a.profileId === r.profileId) ?? null
    const zone = actor?.expedition ? rpg.zones.find(z => z.id === actor.expedition.zoneId) ?? null : null
    const quest = actor?.questId ? rpg.quests.find(q => q.id === actor.questId) ?? null : null
    // An adventurer still walking down the road to the dungeon is on its life channel until it leaves the village.
    const inside = zone && actor.phase !== 'dead' && (actor.phase !== 'travel' || r.away)
    const kind = inside ? 'live' : !world.running || actor?.phase === 'dead' || r.away || r.asleep ? 'rest' : 'life'
    const place = r.destination || '마을'
    const doing = world.thinking?.from === r.profileId ? '생각 중' : r.activity === 'talk' ? '이야기하는 중' : r.errand ? '가는 중' : r.moving ? '산책 중' : '쉬는 중'
    let title, status
    if (kind === 'live') { status = `던전 ${zone.floor}층 · ${BC_PHASE[actor.phase] ?? '탐험 중'}`; title = actor.expedition.title || `${zone.floor}층 ${zone.name}${quest ? ` · ${quest.title}` : ' 탐험'}` }
    else if (kind === 'life') { status = r.errand || place.endsWith('근무 중') ? place : `${place} · ${doing}`; title = place.endsWith('중') || r.errand ? place : `${place}에서 ${doing}` }
    else status = title = actor?.phase === 'dead' ? '부활 대기' : r.asleep ? r.rough ? '광장에서 노숙 중' : '여관에서 자는 중' : world.running ? '쉬는 중' : '자는 중'
    return { id: r.profileId, name: r.name, color: r.color || '#668578', kind, resident: r, actor, zone, quest, title, status, startedAt: kind === 'live' ? actor.expedition.startedAt : null }
  })
  const rank = c => c.kind === 'live' ? BC_ORDER[c.actor.phase] ?? 5 : c.kind === 'life' ? 10 : 20
  return list.sort((a, b) => rank(a) - rank(b))
}
