/**
 * The village as one tile array: the renderer paints it and walking reads it, so they cannot drift apart.
 * . grass  , tall grass  = dirt path  # stone plaza  ~ water  T tree  H house  D door  f flower bed
 * b bench  o fountain  l lamp
 * A river splits it: the busy west bank (guild, shop, inn, plaza) and the quiet east bank (shrine, library).
 */
export const TILE = 32
/** Bump when the map changes so saved residents and paths are re-placed on walkable tiles. */
export const MAP_VERSION = 3
export const MAP = [
  'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT~~~TTTTTTTTTTTTTTTT',
  'T....,.,........TT....,..........~~~...,....,......T',
  'T...,................HHHHHHHHH...~~~...HHHHHHHHH...T',
  'T.,HHHHHHHH..HHHHHHH.HHHHHHHHH...~~~...HHHHHHHHH...T',
  'T..HHHHHHHH.,HHHHHHH.HHHHHHHHH...~~~.T.HHHHHHHHH...T',
  'T..HHHHHHHH..HHHHHHH.HHHHHHHHH...~~~...HHHHHHHHH...T',
  'T..HHHDHHHH..HHHDHHH.HHHHDHHHH..,~~~...HHHHDHHHH...T',
  'T.....=.......,.=........=.,.....~~~..,..,.=.......T',
  'T.....=.....l,..=...l....=......l~~~l......=.l...,.T',
  'T==================================================T',
  'T==================================================T',
  'T..............==,,..............~~~...............T',
  'T.HHHHH..##############.........b~~~b.HHHHHHH......T',
  'T.HHHHH,,##############.HHHHHH...~~~..HHHHHHH.HHHH.T',
  'T.HHDHH..######oo######.HHHHHH...~~~..HHHHHHH.HHHH.T',
  'T...=.,..######oo######.HHHHHH...~~~..HHHDHHH.HDHH,T',
  'T...=....##############.HHDHHH...~~~.....=.....=...T',
  'T...=....##############...=..,...~~~..============.T',
  'T...=....##############==========~~~........=......T',
  'T...=,.HHHHH...==.b..b....=......~~~........=......T',
  'T..,=..HHHHH..l==l........=......~~~.l...,..=.....TT',
  'T...=..HHDHH...==.........===================,.....T',
  'T,..=============.........===================.....,T',
  'T.....,........==........,.......~~~...........TTTTT',
  'T..............==................~~~..fffffffffTTTTT',
  'TTTTTTT........==....TTTTTTTTTT..~~~.,fffffffffTTTTT',
  'TTTTTTT.....,..==....TTTTTTTTTT..~~~..fffffffffTTTTT',
  'TTTTTTT........==....TTTTTTTTTT..~~~..fffffffffTTTTT',
  'TTTTTTT,.......==....TTTTTTTTTT..~~~,..........TTTTT',
  'TTTTTTTTTTTTTTT==TTTTTTTTTTTTTTTT~~~TTTTTTTTTTTTTTTT',
]
export const WIDTH = MAP[0].length, HEIGHT = MAP.length
export const at = (x, y) => (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT ? MAP[y][x] : 'T')
const WALK = new Set(['.', ',', '=', '#'])
export const walkable = (x, y) => WALK.has(at(x, y))

/** role: what the building is for (guild/merchant/oracle are where those residents stand); roof: how it is painted. */
export const BUILDINGS = [
  { name: '모험가 길드', role: 'guild', roof: 'guild', x: 3, y: 3, w: 8, h: 4 },
  { name: '잡화점', role: 'merchant', roof: 'shop', x: 13, y: 3, w: 7, h: 4 },
  { name: '여관', role: 'inn', roof: 'inn', x: 21, y: 2, w: 9, h: 5 },
  { name: '느린 찻집', role: 'tea', roof: 'tea', x: 24, y: 13, w: 6, h: 4 },
  { name: '집', role: 'home', roof: 'home', x: 2, y: 12, w: 5, h: 3 },
  { name: '집', role: 'home', roof: 'home', x: 7, y: 19, w: 5, h: 3 },
  { name: '신전', role: 'oracle', roof: 'shrine', x: 39, y: 2, w: 9, h: 5 },
  { name: '작은 서가', role: 'library', roof: 'library', x: 38, y: 12, w: 7, h: 4 },
  { name: '집', role: 'home', roof: 'home', x: 46, y: 13, w: 4, h: 3 },
]
/** The walkable tile right in front of a building's door. */
export function doorOf(role, life = null) {
  if (life) return life.buildings.find(b => b.role === role)?.door ?? null
  const b = BUILDINGS.find(b => b.role === role)
  if (!b) return null
  for (let x = b.x; x < b.x + b.w; x++) if (at(x, b.y + b.h - 1) === 'D') return { x, y: b.y + b.h }
  return { x: b.x + Math.floor(b.w / 2), y: b.y + b.h }
}
/** Where the south road leaves the village: the way to the dungeon. `tile` is where residents walk to. */
export const GATE = { x: 15.5, y: 28.4, tile: { x: 15, y: 28 } }

const NEAR = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const touches = (x, y, tile) => NEAR.some(([dx, dy]) => at(x + dx, y + dy) === tile)
const front = role => { const b = BUILDINGS.find(b => b.role === role); return region(b.x - 1, b.y + b.h, b.x + b.w, b.y + b.h + 1, t => t !== '#') }
/** Places are tile regions; residents pick a free tile inside one, so nobody stands on anybody. */
export const PLACES = [
  { name: '광장', tiles: region(9, 12, 22, 17, t => t === '#') },
  { name: '길드 앞', role: 'guild', tiles: front('guild') },
  { name: '잡화점 앞', role: 'merchant', tiles: front('merchant') },
  { name: '여관 앞', role: 'inn', tiles: front('inn') },
  { name: '찻집 앞', role: 'tea', tiles: front('tea') },
  { name: '신전 앞', role: 'oracle', tiles: front('oracle') },
  { name: '서가 앞', role: 'library', tiles: front('library') },
  // River banks, not the bridges over it.
  { name: '강가', tiles: region(1, 1, WIDTH - 2, HEIGHT - 2, (_, x, y) => (x < 33 || x > 35) && touches(x, y, '~')) },
  { name: '꽃밭', tiles: region(36, 22, 48, 28, (_, x, y) => touches(x, y, 'f')) },
  { name: '산책길', tiles: region(15, 23, 16, 27, () => true) },
]
function region(x0, y0, x1, y1, keep) {
  const tiles = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (walkable(x, y) && keep(at(x, y), x, y)) tiles.push({ x, y })
  return tiles
}

/** Per-save geometry. No mutable module-global map: simultaneous slots cannot affect one another. */
export const tileAt = (map, x, y) => x >= 0 && y >= 0 && x < (map?.width ?? WIDTH) && y < (map?.height ?? HEIGHT) ? (map?.tiles ?? MAP)[y]?.[x] ?? 'T' : 'T'
export const canWalk = (map, x, y) => WALK.has(tileAt(map, x, y))
export function runtimeMap(life) {
  if (!life) return { revision: MAP_VERSION, width: WIDTH, height: HEIGHT, tiles: MAP }
  const map = { ...life.map, tiles: life.map.tiles.map(row => [...row]) }
  const paint = (b, tile) => {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) map.tiles[y][x] = tile
  }
  for (const b of life.buildings) {
    paint(b, 'H')
    map.tiles[b.door.y - 1][b.door.x] = 'D'
  }
  for (const c of life.constructions) if (['reserved', 'approved', 'building'].includes(c.status) && !c.buildingId && c.kind !== 'expansion') paint(c.site, 'H')
  for (const p of life.placements) map.tiles[p.y][p.x] = 'b'
  map.tiles = map.tiles.map(row => row.join(''))
  return map
}
export function findPath(map, from, to) {
  const start = { x: Math.round(from.x), y: Math.round(from.y) }, target = { x: Math.round(to.x), y: Math.round(to.y) }
  if (!canWalk(map, start.x, start.y) || !canWalk(map, target.x, target.y)) return []
  const key = p => `${p.x},${p.y}`, queue = [start], seen = new Map([[key(start), null]])
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]
    if (p.x === target.x && p.y === target.y) {
      const path = []
      for (let at = p; seen.get(key(at)); at = seen.get(key(at))) path.unshift(at)
      return path
    }
    for (const [dx, dy] of NEAR) {
      const n = { x: p.x + dx, y: p.y + dy }
      if (canWalk(map, n.x, n.y) && !seen.has(key(n))) { seen.set(key(n), p); queue.push(n) }
    }
  }
  return []
}
export function runtimePlaces(life) {
  if (!life) return PLACES
  const map = runtimeMap(life)
  // Keep established social regions/order, but never retain a removed facility's meeting place.
  // A single door tile cannot accommodate neighbours: new facilities also need walkable frontage.
  const frontage = b => {
    const tiles = []
    for (let y = b.y + b.h; y <= b.y + b.h + 1; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
      if (canWalk(map, x, y) && tileAt(map, x, y) !== '#') tiles.push({ x, y })
    }
    return { name: `${b.name} 앞`, tiles }
  }
  return [...PLACES.filter(p => !p.role || life.buildings.some(b => b.seeded && b.role === p.role)).map(p => ({ ...p, tiles: p.tiles.filter(t => canWalk(map, t.x, t.y)) })),
    ...life.buildings.filter(b => !b.seeded).map(frontage)].filter(p => p.tiles.length)
}
