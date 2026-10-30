import { TILE, runtimeMap, tileAt } from '../../shared/tiles.mjs'

/**
 * The ground is painted from the tile array, tile by tile, so it always lines up with where residents can walk.
 * The array is the save's runtime map (`runtimeMap`): its size, facilities, reserved sites and placed furniture.
 */
export const MARGIN = 320
const T = TILE
const PAVED = new Set(['=', '#', 'o'])
const rng = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
const SIDES = [[0, -1, 'n'], [1, 0, 'e'], [0, 1, 's'], [-1, 0, 'w']]

/** Each facility has its own roof and a small prop so it reads at a glance. */
const ROOFS = {
  tea: { roof: ['#76564c', '#966759', '#af7a63', '#bd8970'], wall: ['#e4d4b1', '#d6c49d'] },
  library: { roof: ['#4a5566', '#5d6d84', '#74869e', '#8295ab'], wall: ['#e4d4b1', '#d6c49d'] },
  guild: { roof: ['#3d5543', '#4c6d54', '#628768', '#6e9473'], wall: ['#dccaa5', '#cdb993'] },
  shop: { roof: ['#7f5634', '#a06b3d', '#bb8550', '#c9935d'], wall: ['#e7d7b4', '#d9c69f'] },
  inn: { roof: ['#653b3b', '#84504b', '#9f665c', '#b0756a'], wall: ['#e9d3a9', '#d9bf92'] },
  shrine: { roof: ['#3f5b63', '#52737c', '#6b9098', '#789da4'], wall: ['#f1ece0', '#e2dbc9'] },
  home: { roof: ['#6b5541', '#87694f', '#9f8165', '#ab8c70'], wall: ['#e2d2b0', '#d3c19c'] },
}
/** The village's colour through the day (multiplied over the map) and how bright its lights are. */
const SKY = [[0, [58, 70, 119], 1], [300, [58, 70, 119], 1], [390, [226, 191, 184], .35], [450, [255, 255, 255], 0], [1020, [255, 255, 255], 0], [1110, [232, 180, 142], .45], [1230, [58, 70, 119], 1], [1440, [58, 70, 119], 1]]
export function skyAt(minute) {
  const m = ((minute % 1440) + 1440) % 1440, i = SKY.findIndex(([at], k) => m >= at && m <= SKY[k + 1]?.[0])
  const [a, ca, ga] = SKY[i], [b, cb, gb] = SKY[i + 1], k = (m - a) / Math.max(1, b - a)
  const c = ca.map((v, j) => Math.round(v + (cb[j] - v) * k))
  return { color: `rgb(${c.join(',')})`, glow: ga + (gb - ga) * k, day: c.every(v => v === 255) }
}

/**
 * `geo`: { map (runtime map), buildings, sites (reserved/active construction footprints), placements ([{ x, y, sprite }]),
 * sprite(key) → a ready generated picture or null }. A building with a ready picture is drawn from it on its own footprint,
 * bottom-centred on the door row; without one (loading, failed, art off) it keeps the painted roof.
 */
export function buildMap(geo = {}) {
  const grid = geo.map ?? runtimeMap(null), WIDTH = grid.width, HEIGHT = grid.height, at = (x, y) => tileAt(grid, x, y)
  const sprite = geo.sprite ?? (() => null)
  const lights = [], windows = []
  const c = document.createElement('canvas'); c.width = WIDTH * T + MARGIN * 2; c.height = HEIGHT * T + MARGIN * 2
  const ctx = c.getContext('2d'), rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h) }
  const rand = rng(9241)
  const tree = (x, y, s = 1, shade = 0) => {
    const leaf = [['#3b654a', '#477452', '#57865b', '#487851'], ['#335a41', '#3d6848', '#4b7a52', '#3f6c48']][shade]
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s)
    rect(-14, 18, 28, 6, '#2c4a3555'); rect(-3, 4, 6, 18, '#736245')
    rect(-17, -18, 34, 28, leaf[0]); rect(-12, -28, 25, 30, leaf[1]); rect(-7, -33, 15, 21, leaf[2]); rect(-15, -12, 8, 11, leaf[3])
    ctx.restore()
  }
  // Forest outside the village.
  rect(0, 0, c.width, c.height, '#5d8459')
  for (let i = 0; i < 2600; i++) rect(Math.floor(rand() * c.width / 3) * 3, Math.floor(rand() * c.height / 3) * 3, 2, rand() > .5 ? 3 : 1, rand() > .5 ? '#678f62' : '#4f7650')
  const outside = []
  for (let y = 20; y < c.height + 40; y += 34) for (let x = 6; x < c.width + 30; x += 38) {
    const tx = x + (rand() - .5) * 20 + (Math.floor(y / 34) % 2 ? 19 : 0), ty = y + (rand() - .5) * 14
    const inside = tx > MARGIN - 6 && tx < MARGIN + WIDTH * T + 6 && ty > MARGIN - 6 && ty < MARGIN + HEIGHT * T + 20
    if (!inside) outside.push([tx, ty, .85 + rand() * .3, rand() > .5 ? 1 : 0])
  }
  for (const t of outside.sort((a, b) => a[1] - b[1])) tree(...t)

  ctx.save(); ctx.translate(MARGIN, MARGIN)
  const each = fn => { for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) fn(x, y, at(x, y), x * T, y * T) }
  // Grass under everything.
  each((x, y, _, px, py) => {
    rect(px, py, T, T, (x + y) % 2 ? '#6a9265' : '#6c9467')
    for (let i = 0; i < 5; i++) rect(px + Math.floor(rand() * 10) * 3, py + Math.floor(rand() * 10) * 3, 2, rand() > .5 ? 3 : 1, rand() > .5 ? '#77a06f' : '#5b8358')
  })
  // Dirt paths with an edge on every side that meets grass, corners rounded.
  each((x, y, t, px, py) => {
    if (t !== '=') return
    rect(px, py, T, T, '#c9b893')
    for (let i = 0; i < 4; i++) rect(px + 2 + Math.floor(rand() * 9) * 3, py + 2 + Math.floor(rand() * 9) * 3, 2, 2, '#b9a883')
    const open = Object.fromEntries(SIDES.map(([dx, dy, k]) => [k, !PAVED.has(at(x + dx, y + dy))]))
    if (open.n) rect(px, py, T, 3, '#a99772'); if (open.s) rect(px, py + T - 3, T, 3, '#a99772')
    if (open.w) rect(px, py, 3, T, '#a99772'); if (open.e) rect(px + T - 3, py, 3, T, '#a99772')
    const corner = (cx, cy) => { rect(cx, cy, 5, 5, '#6a9265'); rect(cx + (cx === px ? 3 : 0), cy + (cy === py ? 3 : 0), 2, 2, '#a99772') }
    if (open.n && open.w) corner(px, py); if (open.n && open.e) corner(px + T - 5, py)
    if (open.s && open.w) corner(px, py + T - 5); if (open.s && open.e) corner(px + T - 5, py + T - 5)
  })
  // Stone plaza: two bricks per tile, staggered by row, bordered where it meets anything else.
  each((x, y, t, px, py) => {
    if (t !== '#' && t !== 'o') return
    rect(px, py, T, T, '#bfb399')
    const shift = y % 2 ? 8 : 0
    for (const [bx, by] of [[0, 0], [16, 0], [-8, 16], [8, 16], [24, 16]]) {
      const x0 = Math.max(px, px + bx + shift - (by ? 8 : 0)), x1 = Math.min(px + T, px + bx + shift - (by ? 8 : 0) + 15)
      if (x1 > x0) { rect(x0, py + by + 1, x1 - x0, 14, '#d3c9b0'); rect(x0, py + by + 14, x1 - x0, 1, '#b3a78d') }
    }
    for (const [dx, dy, k] of SIDES) if (!['#', 'o'].includes(at(x + dx, y + dy))) {
      if (k === 'n') rect(px, py, T, 2, '#9f9479'); if (k === 's') rect(px, py + T - 2, T, 2, '#9f9479')
      if (k === 'w') rect(px, py, 2, T, '#9f9479'); if (k === 'e') rect(px + T - 2, py, 2, T, '#9f9479')
    }
  })
  // Water with a bank wherever it meets land; outer corners are rounded so the pond reads as one shape.
  each((x, y, t, px, py) => {
    if (t !== '~') return
    rect(px, py, T, T, '#5d9ea0')
    if ((x * 7 + y * 3) % 5 === 0) rect(px + 6, py + 12, 14, 2, '#8cbcb4')
    if ((x * 5 + y) % 7 === 1) { rect(px + 9, py + 17, 12, 6, '#5b7d53'); rect(px + 13, py + 15, 4, 4, '#edc9b5') }
    const land = Object.fromEntries(SIDES.map(([dx, dy, k]) => [k, at(x + dx, y + dy) !== '~']))
    if (land.n) { rect(px, py, T, 6, '#a3b48f'); rect(px, py + 6, T, 2, '#4f8a8d') }
    if (land.s) { rect(px, py + T - 5, T, 5, '#a3b48f'); rect(px, py + T - 7, T, 2, '#78a9a5') }
    if (land.w) { rect(px, py, 6, T, '#a3b48f'); rect(px + 6, py, 2, T, '#4f8a8d') }
    if (land.e) { rect(px + T - 6, py, 6, T, '#a3b48f'); rect(px + T - 8, py, 2, T, '#4f8a8d') }
    const round = (cx, cy) => rect(cx, cy, 10, 10, '#6a9265')
    if (land.n && land.w) round(px, py); if (land.n && land.e) round(px + T - 10, py)
    if (land.s && land.w) round(px, py + T - 10); if (land.s && land.e) round(px + T - 10, py + T - 10)
    if (land.s) for (let i = 0; i < 3; i++) { const rx = px + 5 + i * 10; rect(rx, py + T - 13, 2, 10, '#47694e'); rect(rx + 3, py + T - 16, 2, 13, '#72905c') }
  })
  // Flower beds and tall grass.
  each((x, y, t, px, py) => {
    if (t === ',') for (let i = 0; i < 3; i++) { const gx = px + 6 + i * 8; rect(gx, py + 12, 2, 10, '#4f7a4e'); rect(gx + 3, py + 15, 2, 7, '#5f8a57') }
    if (t !== 'f') return
    rect(px, py, T, T, '#6f5642'); rect(px + 1, py + 1, T - 2, T - 2, '#7d634a')
    for (const [dx, dy, k] of SIDES) if (at(x + dx, y + dy) !== 'f') {
      if (k === 'n') rect(px, py, T, 3, '#9b7b52'); if (k === 's') rect(px, py + T - 3, T, 3, '#8a6b45')
      if (k === 'w') rect(px, py, 3, T, '#9b7b52'); if (k === 'e') rect(px + T - 3, py, 3, T, '#8a6b45')
    }
    const colors = ['#f1d49b', '#e39ca1', '#c7b3ea', '#f4efe2']
    for (const [fx, fy] of [[7, 8], [20, 6], [12, 19], [24, 20]]) { rect(px + fx, py + fy + 3, 2, 6, '#3f6b47'); rect(px + fx - 2, py + fy, 6, 5, colors[(x + y + fx) % 4]) }
  })
  // Fountain, benches and lamps.
  each((x, y, t, px, py) => {
    if (t === 'o' && at(x - 1, y) !== 'o' && at(x, y - 1) !== 'o') {
      const cx = px + T, cy = py + T
      ctx.fillStyle = '#8e9a86'; ctx.beginPath(); ctx.ellipse(cx, cy + 4, 27, 19, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#6fa59e'; ctx.beginPath(); ctx.ellipse(cx, cy + 2, 22, 14, 0, 0, Math.PI * 2); ctx.fill()
      rect(cx - 3, cy - 18, 6, 20, '#b5c3ab'); rect(cx - 9, cy - 19, 18, 4, '#c3cbb5'); rect(cx - 8, cy - 4, 16, 2, '#9cc9c0')
    }
    const placed = t === 'b' && geo.placements?.find(p => p.x === x && p.y === y)?.sprite
    if (placed) { const k = Math.min((T - 2) / placed.width, (T - 2) / placed.height); ctx.drawImage(placed, px + (T - placed.width * k) / 2, py + T - placed.height * k - 1, placed.width * k, placed.height * k) }
    else if (t === 'b') { rect(px + 2, py + 12, 28, 6, '#a38b62'); rect(px + 2, py + 19, 28, 6, '#b89c70'); rect(px + 4, py + 25, 3, 6, '#525747'); rect(px + 25, py + 25, 3, 6, '#525747') }
    if (t === 'l') { rect(px + 14, py + 6, 4, 24, '#4c5246'); rect(px + 10, py + 2, 12, 8, '#59604f'); rect(px + 12, py + 4, 8, 4, '#f5d98f'); rect(px + 11, py + 29, 10, 2, '#3e4339'); lights.push({ x: px + 16, y: py + 6, r: 52, lamp: true }) }
  })
  // Reserved and active construction sites: a dirt pad behind a fence with a timber frame.
  for (const s of geo.sites ?? []) {
    const x = s.x * T, y = s.y * T, w = s.w * T, h = s.h * T
    rect(x + 2, y + 2, w - 4, h - 4, '#9c8a68'); rect(x + 6, y + 6, w - 12, h - 12, '#b19d77')
    for (let k = 0; k <= s.w; k++) rect(x + k * T - (k === s.w ? 4 : 0), y + h - 10, 4, 10, '#6b5238')
    rect(x, y + h - 8, w, 3, '#8a6a4c')
    if (s.status !== 'reserved') { rect(x + 10, y + 8, 4, h - 18, '#a07a4f'); rect(x + w - 14, y + 8, 4, h - 18, '#a07a4f'); rect(x + 10, y + 8, w - 20, 4, '#a07a4f') }
  }
  // Buildings: roof over the top half, wall and door on the row residents walk up to.
  for (const b of geo.buildings ?? []) {
    const st = ROOFS[b.roof] ?? ROOFS.tea, [eave, roof, ridge, shingle] = st.roof
    const x = b.x * T, y = b.y * T, w = b.w * T, h = b.h * T
    const art = b.artKey ? sprite(b.artKey) : null
    if (art) {
      const k = Math.min(w / art.width, (h + T * 1.5) / art.height), dw = art.width * k, dh = art.height * k
      rect(x + 6, y + h - 10, w - 6, 10, '#34543c44')
      ctx.drawImage(art, x + (w - dw) / 2, y + h - dh, dw, dh)
      if (b.door) lights.push({ x: b.door.x * T + 16, y: y + h - 18, r: 46 })
      continue
    }
    rect(x + 6, y + 10, w, h, '#34543c44')
    rect(x, y + h / 2, w, h / 2, st.wall[0]); rect(x + 4, y + h / 2 + 4, w - 8, h / 2 - 4, st.wall[1])
    if (b.roof === 'inn') for (let k = 0; k < w; k += 24) rect(x + k, y + h / 2, 4, h / 2, '#8a6a4c')
    rect(x - 6, y + 6, w + 12, h / 2 + 4, eave); rect(x - 3, y, w + 6, h / 2 + 2, roof); rect(x + 6, y - 6, w - 12, 12, ridge)
    for (let r = 0; r < Math.floor(h / 24); r++) for (let j = 0; j < w / 16; j++) rect(x + j * 16 + (r % 2 ? 6 : 0), y + 8 + r * 12, 11, 2, shingle)
    if (b.roof === 'inn') { rect(x + w - 40, y - 26, 16, 26, '#7a6a5c'); rect(x + w - 43, y - 30, 22, 6, '#5d4f44') }
    if (b.roof === 'shrine') { rect(x + w / 2 - 3, y - 26, 6, 22, '#c9a54e'); rect(x + w / 2 - 10, y - 20, 20, 5, '#d8b866'); rect(x + w / 2 - 6, y - 30, 12, 6, '#e6c979') }
    if (b.roof === 'guild') { rect(x + 10, y - 30, 3, 34, '#5a4a3a'); rect(x + 13, y - 30, 22, 14, '#b4483f'); rect(x + 17, y - 26, 10, 3, '#f0d48a') }
    for (let col = b.x; col < b.x + b.w; col++) {
      const cx = col * T, bottom = y + h
      if (at(col, b.y + b.h - 1) === 'D') {
        rect(cx + 6, bottom - 40, 20, 40, '#685d49'); rect(cx + 9, bottom - 36, 14, 30, '#8d7b59'); rect(cx + 19, bottom - 20, 3, 3, '#edcd83'); rect(cx + 2, bottom, 28, 4, '#c6b38b')
        lights.push({ x: cx + 16, y: bottom - 18, r: 46 })
        if (b.roof === 'shop') for (let k = -2; k < 3; k++) rect(cx + 2 + k * 14, bottom - 52, 14, 10, k % 2 ? '#f1e6cf' : '#c4573f')
        if (b.roof === 'inn') { rect(cx + 34, bottom - 58, 2, 10, '#4c3f33'); rect(cx + 26, bottom - 48, 20, 14, '#7a5636'); rect(cx + 30, bottom - 45, 12, 2, '#f0d48a') }
        if (b.roof === 'shrine') { rect(cx - 8, bottom - 46, 4, 46, '#b04a3c'); rect(cx + 36, bottom - 46, 4, 46, '#b04a3c'); rect(cx - 12, bottom - 50, 56, 5, '#b04a3c') }
      } else if ((col - b.x) % 2 === 1 && col < b.x + b.w - 1) {
        rect(cx + 3, bottom - 36, 26, 22, '#e8dab6'); rect(cx + 6, bottom - 33, 20, 16, '#7d9f9b'); rect(cx + 15, bottom - 33, 2, 16, '#d7c5a0'); rect(cx + 1, bottom - 12, 30, 5, '#567f51')
        windows.push([cx + 6, bottom - 33, 20, 16]); lights.push({ x: cx + 16, y: bottom - 25, r: 38 })
      }
    }
  }
  // Trees last, back to front, so canopies overlap the tile above like a forest edge.
  const trees = []
  each((x, y, t, px, py) => { if (t === 'T') trees.push([px + T / 2 + (rand() - .5) * 6, py + T / 2 - 2, .95 + rand() * .2, (x + y) % 2]) })
  for (const t of trees.sort((a, b) => a[1] - b[1])) tree(...t)
  ctx.restore()
  return { canvas: c, glow: buildGlow(c.width, c.height, lights, windows) }
}
/** Lit windows and lamp glow at half size, laid over the map with a screen blend as the evening comes. */
function buildGlow(width, height, lights, windows) {
  const c = document.createElement('canvas'); c.width = Math.ceil(width / 2); c.height = Math.ceil(height / 2)
  const ctx = c.getContext('2d')
  if (!ctx?.createRadialGradient) return c
  ctx.scale(.5, .5); ctx.translate(MARGIN, MARGIN)
  ctx.fillStyle = '#f2c66d'
  for (const [x, y, w, h] of windows) ctx.fillRect(x, y, w, h)
  ctx.globalCompositeOperation = 'lighter'
  for (const l of lights) {
    const g = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, l.r)
    g.addColorStop(0, `rgba(255,176,84,${l.lamp ? .5 : .3})`); g.addColorStop(1, 'rgba(255,176,84,0)')
    ctx.fillStyle = g; ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2)
  }
  return c
}
