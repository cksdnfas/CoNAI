// Versioned, bounded, deterministic geometry. Generated maps are persisted, never rebuilt on read.
export const GENERATOR_VERSION = 2
export const SIZES = { small: 15, medium: 19, large: 23 }
export function seeded(seed) {
  let value = 2166136261
  for (const c of String(seed)) value = Math.imul(value ^ c.charCodeAt(0), 16777619)
  return () => { value += 0x6D2B79F5; let t = Math.imul(value ^ value >>> 15, 1 | value); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
export function neighbors(map, at) {
  const x = at % map.width, y = Math.floor(at / map.width)
  return [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]].filter(([a, b]) => a >= 0 && b >= 0 && a < map.width && b < map.height).map(([a, b]) => b * map.width + a)
}
export function route(map, start, target, seen = null) {
  if (start === target) return []
  const queue = [start], previous = new Map([[start, null]])
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbors(map, queue[i])) {
      if (map.tiles[next] !== '.' || previous.has(next) || (seen && seen[next] !== '1')) continue
      previous.set(next, queue[i]); queue.push(next)
      if (next === target) {
        const path = [target]; let at = queue[i]
        while (at !== start) { path.push(at); at = previous.get(at) }
        return path.reverse()
      }
    }
  }
  return null
}
export function reveal(map, seen, at) {
  const chars = (seen || '0'.repeat(map.tiles.length)).split(''), queue = [[at, 0]], visited = new Set([at])
  while (queue.length) {
    const [pos, depth] = queue.shift(); chars[pos] = '1'
    if (depth >= 3 || map.tiles[pos] !== '.') continue
    for (const next of neighbors(map, pos)) if (!visited.has(next)) { visited.add(next); queue.push([next, depth + 1]) }
  }
  return chars.join('')
}
export function generateDungeon(seed, design, monster) {
  const random = seeded(seed), width = SIZES[design.size], height = width
  if (!Object.hasOwn(SIZES, design.size) || !['maze', 'rooms', 'loops'].includes(design.layout) || !Number.isInteger(design.enemies) || design.enemies < 3 || design.enemies > 10) throw new Error('던전 설계 범위를 확인해줘.')
  const tiles = Array(width * height).fill('#'), entrance = width + 1, stack = [entrance]
  tiles[entrance] = '.'
  while (stack.length) {
    const at = stack.at(-1), x = at % width, y = Math.floor(at / width)
    const choices = [[x + 2, y], [x - 2, y], [x, y + 2], [x, y - 2]].filter(([a, b]) => a > 0 && b > 0 && a < width - 1 && b < height - 1 && tiles[b * width + a] === '#')
    if (!choices.length) { stack.pop(); continue }
    const [a, b] = choices[Math.floor(random() * choices.length)], next = b * width + a
    tiles[(at + next) / 2] = tiles[next] = '.'; stack.push(next)
  }
  // Small rooms retain connected corridors, and extra passages make optional loops.
  for (let i = 0; i < (design.layout === 'rooms' ? 5 : 2); i++) {
    const x = 2 + Math.floor(random() * (width - 5)), y = 2 + Math.floor(random() * (height - 5))
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) tiles[(y + dy) * width + x + dx] = '.'
  }
  if (design.layout === 'loops') for (let i = 0; i < width * 2; i++) {
    const at = (1 + Math.floor(random() * (height - 2))) * width + 1 + Math.floor(random() * (width - 2))
    if ((tiles[at - 1] === '.' && tiles[at + 1] === '.') || (tiles[at - width] === '.' && tiles[at + width] === '.')) tiles[at] = '.'
  }
  const map = { version: GENERATOR_VERSION, seed, width, height, tiles: tiles.join(''), entrance, exit: entrance, entities: [], explored: '0'.repeat(tiles.length), cycle: 1, resetAt: 0 }
  const distance = new Map([[entrance, 0]]), queue = [entrance]
  for (let i = 0; i < queue.length; i++) for (const next of neighbors(map, queue[i])) if (tiles[next] === '.' && !distance.has(next)) { distance.set(next, distance.get(queue[i]) + 1); queue.push(next) }
  if (queue.length !== tiles.filter(t => t === '.').length) throw new Error('던전 연결 검증에 실패했어.')
  map.exit = queue.at(-1)
  const candidates = queue.filter(at => distance.get(at) >= 5 && at !== map.exit)
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]] }
  const enemy = (at, boss) => ({
    id: `enemy-${map.entities.length}`, kind: 'enemy', at, boss, pattern: boss ? design.bossPattern ?? 'charge' : 'normal',
    monster: { ...monster, name: boss ? monster.bossName || `${monster.name} 수호자` : monster.name, hp: Math.round(monster.hp * (boss ? 1.5 : 1)), attack: Math.round(monster.attack * (boss ? 1.15 : 1)) },
    hp: Math.round(monster.hp * (boss ? 1.5 : 1)), claimedBy: null, done: false,
  })
  for (let i = 0; i < design.enemies; i++) map.entities.push(enemy(candidates.pop(), false))
  map.entities.push(enemy(map.exit, true))
  for (const kind of ['chest', 'chest', 'rest', 'trap']) map.entities.push({ id: `${kind}-${map.entities.length}`, kind, at: candidates.pop(), done: false })
  ensureObjectives(map)
  return map
}
export function ensureObjectives(map) {
  if (map.objectivesVersion === 1) return
  const random = seeded(`${map.seed}:objectives`), occupied = new Set([map.entrance, map.exit, ...map.entities.map(e => e.at)])
  const free = [...map.tiles].flatMap((t, at) => t === '.' && !occupied.has(at) ? [at] : [])
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [free[i], free[j]] = [free[j], free[i]] }
  const room = free.find(at => [-1, 0, 1].every(dy => [-1, 0, 1].every(dx => map.tiles[at + dy * map.width + dx] === '.')))
  const landmark = room ?? free.at(-1)
  map.entities.push({ id: 'landmark', kind: 'landmark', at: landmark, name: '지하 기록실', done: false })
  for (const at of free.filter(at => at !== landmark).slice(0, 3)) map.entities.push({ id: `relic-${at}`, kind: 'relic', at, done: false })
  map.objectivesVersion = 1
}
export function explorationTarget(map, at, seen, returning = false, objective = 'hunt') {
  if (returning) return map.entrance
  const choices = []
  for (let pos = 0; pos < map.tiles.length; pos++) if (seen[pos] === '1' && map.tiles[pos] === '.') {
    const entity = map.entities.find(e => e.at === pos && !e.done && !e.claimedBy && (e.kind !== 'relic' || objective === 'recover') && (e.kind !== 'landmark' || objective === 'survey'))
    const frontier = neighbors(map, pos).some(next => seen[next] !== '1')
    if (!entity && !frontier) continue
    const path = route(map, at, pos, seen)
    if (path && (path.length || entity)) choices.push({ pos, score: path.length + (entity?.boss ? 8 : 0) })
  }
  choices.sort((a, b) => a.score - b.score || a.pos - b.pos)
  return choices[0]?.pos ?? map.entrance
}
export function floorSummary(zone) {
  const map = zone.map
  return { id: zone.id, name: zone.name, floor: zone.floor, level: zone.level, cleared: !!zone.cleared, theme: zone.design.theme, size: zone.design.size, layout: zone.design.layout, kills: zone.kills,
    explored: map ? [...map.tiles].filter((t, i) => t === '.' && map.explored[i] === '1').length : 0, total: map ? [...map.tiles].filter(t => t === '.').length : 0, elapsedToClearSeconds: zone.clearedAt && zone.firstEnteredAt ? Math.round((zone.clearedAt - zone.firstEnteredAt) / 1000) : null, metrics: zone.metrics }
}
