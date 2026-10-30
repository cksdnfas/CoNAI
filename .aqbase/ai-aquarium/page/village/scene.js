import { TILE, GATE, PLACES, runtimeMap } from '../../shared/tiles.mjs'
import { FACILITIES } from '../../shared/life.mjs'
import { spokenText } from '../../shared/speech.mjs'
import { EARSHOT } from '../../shared/village-settings.mjs'
import { placeBubble } from '../ui/bubble-layout.js'
import { MARGIN, skyAt, buildMap } from './map-paint.js'
import { createPortrait } from '../ui/portrait.js'
import { NPC_ROLE, CONSTRUCTION_STATE } from '../guild/common.js'

const T = TILE
// In adventure mode the guild and the shop open their guild pages; the south road leads to the dungeon.
// Every other facility (and these, while adventure is off) opens its facility detail; the temple's holds its donations.
const OPENS = { guild: 'guild', merchant: 'shop' }
const ACTIVE = new Set(['reserved', 'approved', 'building'])
const NPC_COLOR = { merchant: '#b0703a', producer: '#5f8a57', builder: '#6d6a8f' }
/**
 * The save's runtime geometry from `rpg.life` (the shared tile map without one), and the key that changes only when the
 * painted ground must change: map revision, site states, or a generated building/furniture picture becoming ready.
 */
function geometryOf(life, sprite) {
  // Before the save arrives only the ground is drawn: a new village has none of the template's facilities.
  if (!life?.map) return { key: 'static', map: runtimeMap(null), buildings: [], sites: [], placements: [] }
  const items = new Map((life.catalog?.items ?? []).map(i => [i.id, i]))
  const sites = life.constructions.filter(c => ACTIVE.has(c.status) && !c.buildingId && c.kind !== 'expansion').map(c => ({ ...c.site, status: c.status }))
  const placements = life.placements.map(p => ({ x: p.x, y: p.y, sprite: sprite(items.get(p.itemId)?.artKey) }))
  const art = [...life.buildings.map(b => sprite(b.artKey) ? 1 : 0), ...placements.map(p => p.sprite ? 1 : 0)].join('')
  return { key: `${life.epoch}:${life.map.revision}:${sites.map(s => s.status).join()}:${art}`, map: life.map, buildings: life.buildings, sites, placements }
}
const MAX_TILE = 84 // px a tile may grow to when zoomed in
const VIEW_KEY = 'ai-aquarium.view'
const loadView = () => { try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); return v && [v.zoom, v.cx, v.cy].every(Number.isFinite) ? v : null } catch { return null } }

/**
 * The whole page is the village: the map is fitted to the screen and the forest fills the rest.
 * Residents stand on tile centres, one per tile. A bubble sits right above its speaker's head with a short tail;
 * when the speaker talks to a neighbour, it opens away from them so the listener's head stays clear.
 */
export function createScene(stage, canvas, onSelect, onPlace = () => {}, onView = () => {}, { sprite = () => null, onBuilding = () => {}, onNpc = () => {} } = {}) {
  const map = { width: 0, height: 0 } // the painted copy is dropped; the canvas keeps the pixels
  // Time of day: a colour multiplied over the map, then the lit windows and lamps fading in.
  const tint = document.createElement('div'); tint.className = 'tint'
  const glow = document.createElement('canvas'); glow.className = 'glow'; glow.style.opacity = '0'
  canvas.after(tint, glow)
  let sky = skyAt(7 * 60)
  const camera = { x: 0, y: 0, s: 1 }
  const layer = document.createElement('div'); layer.className = 'village-actors'; stage.querySelector('.world').after(layer)
  const ring = document.createElement('div'); ring.className = 'earshot'; ring.hidden = true
  const signs = new Map() // key -> { node, x, y }
  let places = [], geo = null, W = 0, H = 0, inn = null, placed = ''
  // Who is asleep at the inn, under its door.
  const sleepers = document.createElement('span'); sleepers.className = 'sign sleepers'; sleepers.hidden = true
  const gate = document.createElement('button'); gate.type = 'button'; gate.className = 'gate'; gate.hidden = true
  gate.addEventListener('click', () => onPlace('dungeon'))
  // Where a new facility or a piece of furniture would go while the player picks a site (life.js asks for it).
  const ghost = document.createElement('div'); ghost.className = 'pick-ghost'; ghost.hidden = true
  layer.append(ring, sleepers, gate, ghost)
  const actors = new Map(), bubbles = new Map(), npcs = new Map()
  let world = { residents: [], running: false }, selected = null, selectedNpc = null, portraits = new Map(), frame = null, previous = 0, picking = null

  /** Paints the save's ground and facilities again (map revision, expansion, a site, a generated picture arriving). */
  function paint(next) {
    geo = next; W = next.map.width; H = next.map.height
    const built = buildMap({ ...next, sprite })
    canvas.width = built.canvas.width; canvas.height = built.canvas.height
    canvas.getContext('2d').drawImage(built.canvas, 0, 0)
    glow.width = built.glow.width; glow.height = built.glow.height
    glow.getContext('2d')?.drawImage(built.glow, 0, 0)
    map.width = canvas.width; map.height = canvas.height
    // The layers keep their full size and move by transform only, so panning and zooming never re-lay them out.
    for (const el of [canvas, tint, glow]) Object.assign(el.style, { width: `${map.width}px`, height: `${map.height}px` })
    for (const [, n] of places) n.remove()
    places = next.buildings.map(b => {
      const n = document.createElement('button'); n.type = 'button'; n.className = 'place-hit'
      n.setAttribute('aria-label', `${b.name} 살펴보기`); n.dataset.tip = b.level > 1 ? `${b.name} · ${b.level}단계` : b.name
      n.addEventListener('click', () => { if (world.rpg?.settings.enabled && OPENS[b.role]) onPlace(OPENS[b.role]); else if (b.id) onBuilding(b.id) })
      return [b, n]
    })
    ring.after(...places.map(([, n]) => n))
    inn = next.buildings.find(b => b.role === 'inn')?.door ?? null
    placed = ''
  }
  /** Facility names, and what each construction is waiting for, over their roofs. */
  function labelSigns() {
    const life = world.rpg?.life, wanted = new Map()
    for (const b of geo.buildings) if (b.role !== 'home' || b.level > 1 || !b.seeded) wanted.set(`b:${b.id ?? b.name}`, { text: b.level > 1 ? `${b.name} ${b.level}단계` : b.name, x: (b.x + b.w / 2) * T, y: b.y * T - 2 })
    for (const c of life?.constructions ?? []) {
      if (!ACTIVE.has(c.status) || c.kind === 'expansion') continue
      const at = c.buildingId ? geo.buildings.find(b => b.id === c.buildingId) : c.site, state = c.status === 'building' ? `공사 ${Math.floor(c.progress / c.seconds * 100)}%` : CONSTRUCTION_STATE[c.status]
      if (at) wanted.set(`c:${c.id}`, { text: `${c.buildingId ? '증축' : FACILITIES[c.kind]?.name ?? '공사'} · ${state}`, x: (at.x + at.w / 2) * T, y: (at.y + (c.buildingId ? -.6 : at.h / 2)) * T, site: true })
    }
    let moved = false
    for (const [key, s] of signs) if (!wanted.has(key)) { s.node.remove(); signs.delete(key); moved = true }
    for (const [key, want] of wanted) {
      let s = signs.get(key)
      if (!s) { const node = document.createElement('span'); node.className = want.site ? 'sign site' : 'sign'; sleepers.before(node); s = { node }; signs.set(key, s); moved = true }
      if (s.node.textContent !== want.text) s.node.textContent = want.text
      if (s.x !== want.x || s.y !== want.y) { s.x = want.x; s.y = want.y; moved = true }
    }
    if (moved) placed = ''
  }
  paint(geometryOf(null, sprite))

  // What the viewer looks at: a zoom over the fitted map (1 = whole village) and the map point at the screen centre.
  const square = PLACES[0].tiles, saved = loadView()
  const view = saved ?? { zoom: 0, cx: (square.reduce((n, t) => n + t.x, 0) / square.length + .5) * T, cy: (square.reduce((n, t) => n + t.y, 0) / square.length + .5) * T }
  let zoomShown = -1, saveTimer = null
  // The stage's size, read when it resizes: reading it every frame forced a fresh style and layout pass each time.
  const size = { w: stage.clientWidth, h: stage.clientHeight }
  const baseScale = () => Math.min(size.w / (W * T), size.h / (H * T))
  const maxZoom = () => Math.max(1, MAX_TILE / (T * baseScale()))
  /** Keeps the zoom in range and the map filling the screen along any side it overflows. */
  const settle = () => {
    const w = size.w, h = size.h
    // First visit on a tall phone: the whole village is a thin strip, so start closer in around the plaza.
    if (!view.zoom) view.zoom = h > w * 1.2 ? Math.min(maxZoom(), 2.2) : 1
    view.zoom = Math.max(1, Math.min(maxZoom(), view.zoom))
    const sc = baseScale() * view.zoom
    for (const [k, size, half] of [['cx', W * T, w / 2 / sc], ['cy', H * T, h / 2 / sc]]) view[k] = size <= half * 2 ? size / 2 : Math.max(half, Math.min(size - half, view[k]))
    return sc
  }
  const remember = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)) } catch {} }, 400) }
  const fit = () => {
    const w = size.w, h = size.h
    if (!w || !h) return
    camera.s = settle(); camera.x = w / 2 - view.cx * camera.s; camera.y = h / 2 - view.cy * camera.s
    if (zoomShown !== view.zoom) { zoomShown = view.zoom; onView({ zoom: view.zoom, min: view.zoom <= 1.001, max: view.zoom >= maxZoom() - .001 }) }
    // Everything below only moves when the camera does.
    const key = `${w}:${h}:${camera.s}:${camera.x}:${camera.y}`
    if (key === placed) return
    placed = key
    const box = `translate(${camera.x - MARGIN * camera.s}px,${camera.y - MARGIN * camera.s}px) scale(${camera.s})`
    for (const el of [canvas, tint, glow]) el.style.transform = box
    if (inn) sleepers.style.transform = `translate(${camera.x + (inn.x + .5) * T * camera.s}px,${camera.y + (inn.y + .55) * T * camera.s}px) translate(-50%,-50%)`
    stage.style.setProperty('--tile', `${T * camera.s}px`)
    for (const s of signs.values()) s.node.style.transform = `translate(${camera.x + s.x * camera.s}px,${camera.y + s.y * camera.s}px) translate(-50%,-50%)`
    for (const [b, n] of places) Object.assign(n.style, { width: `${b.w * T * camera.s}px`, height: `${b.h * T * camera.s}px`, transform: `translate(${camera.x + b.x * T * camera.s}px,${camera.y + b.y * T * camera.s}px)` })
    gate.style.transform = `translate(${camera.x + (GATE.x + .5) * T * camera.s}px,${camera.y + (GATE.y + .4) * T * camera.s}px) translate(-50%,-50%)`
    placeGhost()
  }
  function placeGhost() {
    const at = picking?.at
    ghost.hidden = !at
    if (!at) return
    Object.assign(ghost.style, { width: `${picking.w * T * camera.s}px`, height: `${picking.h * T * camera.s}px`, transform: `translate(${camera.x + at.x * T * camera.s}px,${camera.y + at.y * T * camera.s}px)` })
    ghost.dataset.valid = String(picking.valid(at.x, at.y))
  }
  /** The footprint's top-left tile when the pointer is over (clientX, clientY): the pointer sits at its middle. */
  const pickAt = (clientX, clientY) => {
    const box = stage.getBoundingClientRect()
    return { x: Math.floor((clientX - box.left - camera.x) / (T * camera.s)) - Math.floor(picking.w / 2), y: Math.floor((clientY - box.top - camera.y) / (T * camera.s)) - Math.floor(picking.h / 2) }
  }
  const endPick = at => { const done = picking?.done; picking = null; ghost.hidden = true; done?.(at) }
  const screen = (tx, ty) => ({ x: camera.x + tx * T * camera.s, y: camera.y + ty * T * camera.s })
  const repaint = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(draw) }
  // Panels that float over the map for good; menus and toasts that open for a moment may cover a bubble.
  const PANELS = '.top-l, .top-r, #party, #zoom, #chat, #bc-pip'
  const keepClear = () => {
    const at = stage.getBoundingClientRect()
    return [...stage.querySelectorAll(PANELS)].filter(el => !el.hidden && el.getClientRects().length)
      .map(el => { const r = el.getBoundingClientRect(); return { x: r.left - at.left, y: r.top - at.top, w: r.width, h: r.height } })
      .filter(r => r.w && r.h)
  }
  /** Zooms by `factor` keeping the map point under (px, py) — stage pixels — where it is. */
  const zoomAt = (factor, px, py) => {
    const w = size.w, h = size.h
    if (!w || !h) return
    fit()
    const wx = (px - camera.x) / camera.s, wy = (py - camera.y) / camera.s
    view.zoom = Math.max(1, Math.min(maxZoom(), view.zoom * factor))
    const sc = baseScale() * view.zoom
    view.cx = wx - (px - w / 2) / sc; view.cy = wy - (py - h / 2) / sc
    remember(); repaint()
  }
  const panBy = (dx, dy) => { view.cx -= dx / camera.s; view.cy -= dy / camera.s; remember(); repaint() }
  const centreOn = (tx, ty) => { view.cx = tx * T; view.cy = ty * T; remember(); repaint() }

  // Mouse wheel and pinch zoom; dragging anywhere on the map pans. A drag never counts as a click on what it started on.
  const onMap = target => target instanceof Element && !!target.closest('.world, .village-actors > .tok, .village-actors > .place-hit, .village-actors > .gate')
  const pointers = new Map()
  let drag = null, swallow = false
  stage.addEventListener('wheel', e => {
    if (!onMap(e.target)) return
    e.preventDefault()
    const box = stage.getBoundingClientRect()
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? .05 : .0018)), e.clientX - box.left, e.clientY - box.top)
  }, { passive: false })
  stage.addEventListener('pointerdown', e => {
    if (!onMap(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: false }
  })
  stage.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId)
    if (!p || !drag) return
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()], gap = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      p.x = e.clientX; p.y = e.clientY
      const [c, d] = [...pointers.values()], next = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 }, box = stage.getBoundingClientRect()
      drag.moved = true
      panBy(next.x - mid.x, next.y - mid.y)
      if (gap > 0) zoomAt(Math.hypot(c.x - d.x, c.y - d.y) / gap, next.x - box.left, next.y - box.top)
      return
    }
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return
      drag.moved = true; stage.dataset.panning = 'true'
      try { stage.setPointerCapture(e.pointerId) } catch {}
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX; p.y = e.clientY
    panBy(dx, dy)
  })
  const release = e => {
    if (!pointers.delete(e.pointerId) || pointers.size) return
    if (drag?.moved) { swallow = true; setTimeout(() => { swallow = false }, 0) }
    drag = null; delete stage.dataset.panning
  }
  stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release)
  stage.addEventListener('pointermove', e => { if (picking && onMap(e.target)) { picking.at = pickAt(e.clientX, e.clientY); placeGhost() } })
  // While picking a site, a tap on the map chooses it instead of opening what is under it; a drag still pans.
  stage.addEventListener('click', e => {
    if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); return }
    if (picking && onMap(e.target)) { e.preventDefault(); e.stopPropagation(); endPick(pickAt(e.clientX, e.clientY)) }
  }, true)
  document.addEventListener('keydown', e => { if (picking && e.key === 'Escape') endPick(null) })

  function sync() {
    const adventure = !!world.rpg?.settings.enabled
    const next = geometryOf(world.rpg?.life, sprite)
    if (next.key !== geo.key) paint(next)
    labelSigns()
    gate.hidden = !adventure
    // Rule-based NPCs: no profile or memory, a role, opening hours and a route of their own.
    const people = world.rpg?.life?.npcs ?? []
    for (const [id, a] of npcs) if (!people.some(n => n.id === id)) { a.node.remove(); npcs.delete(id) }
    for (const n of people) {
      let a = npcs.get(n.id)
      if (!a) {
        const node = document.createElement('button'); node.type = 'button'; node.className = 'tok npc'
        const face = createPortrait(n.name, null, NPC_COLOR[n.role] ?? '#668578'), name = document.createElement('span'); name.className = 'nm'
        node.append(face, name); layer.append(node)
        node.addEventListener('click', () => onNpc(n.id))
        a = { node, name, x: n.x, y: n.y }; npcs.set(n.id, a)
      }
      if (Math.hypot(n.x - a.x, n.y - a.y) > 4) { a.x = n.x; a.y = n.y }
      a.to = { x: n.x, y: n.y }
      const label = `${n.name} · ${NPC_ROLE[n.role] ?? n.role}`
      if (a.name.textContent !== n.name) a.name.textContent = n.name
      a.node.setAttribute('aria-label', `${label} · ${n.open ? '영업 중' : '쉬는 중'} 살펴보기`)
      a.node.dataset.open = String(!!n.open); a.node.dataset.tip = label
      a.node.setAttribute('aria-pressed', String(selectedNpc === n.id))
    }
    if (Number.isFinite(world.clock?.minute)) {
      sky = skyAt(world.clock.minute)
      tint.style.backgroundColor = sky.color; glow.style.opacity = sky.glow.toFixed(2)
      // Blend layers cost a full-screen composite; in plain daylight they would change nothing.
      tint.hidden = sky.day; glow.hidden = sky.glow < .01
    }
    const asleep = world.residents.filter(r => r.asleep && !r.rough).map(r => r.name)
    sleepers.hidden = !asleep.length
    if (asleep.length) sleepers.textContent = `z ${asleep.slice(0, 3).join(' · ')}${asleep.length > 3 ? ` 외 ${asleep.length - 3}명` : ''}`
    if (adventure) {
      const inside = world.residents.filter(r => r.away && world.rpg.actors.some(a => a.profileId === r.profileId && a.expedition && a.phase !== 'dead'))
      const key = JSON.stringify([inside.map(r => [r.profileId, portraits.get(r.profileId)?.url ?? ''])])
      if (gate.dataset.key !== key) {
        gate.dataset.key = key; gate.dataset.live = String(inside.length > 0)
        const faces = document.createElement('span'); faces.className = 'gate-faces'
        for (const r of inside.slice(0, 4)) faces.append(createPortrait(r.name, portraits.get(r.profileId), r.color))
        gate.replaceChildren(faces, Object.assign(document.createElement('b'), { textContent: inside.length ? 'LIVE' : '던전' }))
        gate.setAttribute('aria-label', inside.length ? `던전 방송 · ${inside.map(r => r.name).join(', ')}` : '던전 방송')
      }
    }
    for (const [id, a] of actors) if (!world.residents.some(r => r.profileId === id)) { a.node.remove(); actors.delete(id) }
    for (const r of world.residents) {
      let a = actors.get(r.profileId)
      if (!a) {
        const node = document.createElement('button'); node.type = 'button'; node.className = 'tok'; node.setAttribute('aria-label', `${r.name} 살펴보기`)
        const face = createPortrait(r.name, null, r.color), name = document.createElement('span'); name.className = 'nm'
        node.append(face, name); layer.append(node)
        node.addEventListener('click', () => onSelect(r.profileId))
        a = { node, face, name, x: r.x, y: r.y, faceKey: '' }; actors.set(r.profileId, a)
      }
      a.name.textContent = r.name
      a.node.hidden = !!r.away || (!!r.asleep && !r.rough)
      a.node.dataset.sleeping = String(!!r.asleep)
      // Walk the server's route instead of easing to each 1 s snapshot: where it is now, then the tiles ahead.
      const route = world.running && !r.away && !r.asleep ? [{ x: r.x, y: r.y }, ...(r.path ?? [])] : []
      if (Math.hypot(r.x - a.x, r.y - a.y) > 4) { a.x = r.x; a.y = r.y }
      // Already past the first waypoint (the server tick ran late): don't walk back to it.
      while (route.length > 1 && Math.hypot(route[1].x - a.x, route[1].y - a.y) <= Math.hypot(route[1].x - route[0].x, route[1].y - route[0].y)) route.shift()
      a.route = route
      a.node.setAttribute('aria-pressed', String(selected === r.profileId))
      a.node.dataset.walking = String(world.running && (r.moving || a.route.length > 1))
      const portrait = portraits.get(r.profileId), faceKey = `${r.name}:${r.color}:${portrait?.url || ''}`
      if (a.faceKey !== faceKey) { const face = createPortrait(r.name, portrait, r.color); a.face.replaceWith(face); a.face = face; a.faceKey = faceKey }
    }
    // At most two bubbles: what the speaker said and who is thinking of an answer.
    const thinking = world.thinking?.from
    const wanted = world.residents.filter(r => r.profileId === thinking || r.bubble).sort((a, b) => (b.profileId === thinking) - (a.profileId === thinking)).slice(0, 2)
    for (const [id, b] of bubbles) if (!wanted.some(r => r.profileId === id)) { b.remove(); bubbles.delete(id) }
    for (const r of wanted) {
      let b = bubbles.get(r.profileId)
      if (!b) { b = document.createElement('div'); layer.append(b); bubbles.set(r.profileId, b) }
      const dots = r.profileId === thinking
      b.classList.add('say'); b.classList.toggle('dots', dots)
      if (dots) { if (!b.querySelector('i')) { b.innerHTML = '<i></i><i></i><i></i>'; b.size = null } }
      else {
        const line = spokenText(r.bubble)
        if (b.line !== line || b.who !== r.name) { b.line = line; b.who = r.name; b.replaceChildren(Object.assign(document.createElement('b'), { className: 'say-who', textContent: r.name }), Object.assign(document.createElement('p'), { textContent: line })); b.size = null }
      }
      if (dots) b.line = b.who = null
      b.style.setProperty('--who', /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#668578')
      b.title = dots ? `${r.name}: 생각 중` : `${r.name}: ${b.line}`
    }
    repaint()
  }

  // A window over the map (settings, broadcast, guild, album, memory) dims and blurs it: positions keep moving for the
  // broadcast's village camera, but nothing on the map is restyled, so the blurred backdrop is not redrawn every frame.
  const covers = [stage.getElementsByClassName('menu-layer'), stage.getElementsByClassName('album-layer')] // live lists
  let covered = false
  new MutationObserver(repaint).observe(stage, { subtree: true, attributes: true, attributeFilter: ['hidden'] })
  function draw(time) {
    frame = null
    const dt = Math.min((time - previous) / 1000, .1); previous = time
    const cover = covers.some(list => Array.prototype.some.call(list, el => !el.hidden))
    if (cover !== covered) { covered = cover; stage.dataset.covered = String(cover) }
    if (!covered) fit()
    const width = size.w
    if (!width) return
    // Panel boxes are read before anything moves, so the read never forces a fresh layout mid-frame.
    const placed = bubbles.size && !covered ? keepClear() : []
    let settling = false
    const speed = world.settings?.walkSpeed ?? 1.1
    for (const r of world.residents) {
      const a = actors.get(r.profileId)
      if (a.route?.length) {
        // Walking pace, a little quicker while behind the server so the lag never grows.
        const lag = Math.hypot(a.route[0].x - a.x, a.route[0].y - a.y)
        let budget = dt * speed * (1 + Math.max(0, lag - .3) * .8)
        while (budget > 0 && a.route.length) {
          const p = a.route[0], d = Math.hypot(p.x - a.x, p.y - a.y)
          if (d <= budget) { a.x = p.x; a.y = p.y; budget -= d; a.route.shift() } else { a.x += (p.x - a.x) / d * budget; a.y += (p.y - a.y) / d * budget; budget = 0 }
        }
        settling = true
      } else {
        const f = Math.min(1, dt * 3)
        a.x += (r.x - a.x) * f; a.y += (r.y - a.y) * f
        if (Math.abs(r.x - a.x) + Math.abs(r.y - a.y) > .01) settling = true
      }
      if (covered) continue
      a.p = screen(a.x + .5, a.y + .82)
      const place = `translate(${a.p.x}px,${a.p.y}px)`, z = 10 + Math.round(a.y * 10)
      if (a.place !== place) { a.place = place; a.node.style.transform = place }
      if (a.z !== z) { a.z = z; a.node.style.zIndex = String(z) }
    }
    // NPCs ease to each snapshot (the server walks them 1.5 tiles/s along their own route).
    for (const a of npcs.values()) {
      const f = Math.min(1, dt * 3)
      a.x += (a.to.x - a.x) * f; a.y += (a.to.y - a.y) * f
      if (Math.abs(a.to.x - a.x) + Math.abs(a.to.y - a.y) > .01) settling = true
      if (covered) continue
      const p = screen(a.x + .5, a.y + .82), place = `translate(${p.x}px,${p.y}px)`, z = 10 + Math.round(a.y * 10)
      if (a.place !== place) { a.place = place; a.node.style.transform = place }
      if (a.z !== z) { a.z = z; a.node.style.zIndex = String(z) }
    }
    if (covered) { if (settling && !document.hidden) repaint(); return }
    const chosen = world.residents.find(r => r.profileId === selected)
    ring.hidden = !chosen
    if (chosen) {
      const a = actors.get(chosen.profileId), c = screen(a.x + .5, a.y + .5), radius = EARSHOT * T * camera.s
      Object.assign(ring.style, { width: `${radius * 2}px`, height: `${radius * 2}px`, transform: `translate(${c.x - radius}px,${c.y - radius}px)` })
    }
    // Nearer speakers (lower on screen) are placed first; a bubble that would cover a placed one moves aside (bubble-layout.js).
    // The floating panels count as placed boxes, so a bubble never hides under the party list, the bars or the chat.
    const order = [...bubbles].sort(([x], [y]) => (actors.get(y)?.p?.y ?? 0) - (actors.get(x)?.p?.y ?? 0))
    for (const [id, b] of order) {
      const r = world.residents.find(x => x.profileId === id), a = actors.get(id)
      if (!r || !a) continue
      const partnerId = world.thinking?.from === id ? world.thinking.to : world.thinking?.to === id ? world.thinking.from : null
      const partner = actors.get(partnerId ?? world.residents.find(o => o !== r && o.activity === 'talk' && r.activity === 'talk')?.profileId)
      const off = a.p.x < -40 || a.p.x > width + 40 || a.p.y < 0 || a.p.y > size.h + 60
      const visibility = off ? 'hidden' : ''
      if (b.style.visibility !== visibility) b.style.visibility = visibility
      if (off) continue
      b.size ??= { w: b.offsetWidth, h: b.offsetHeight }
      const { w, h } = b.size
      const head = a.p.y - T * camera.s * 1.05
      // Both bubbles of a talking pair open away from each other; the tail stays over each speaker's head.
      let left = !partner || Math.abs(partner.p.x - a.p.x) < 4 ? a.p.x - w / 2 : partner.p.x > a.p.x ? a.p.x - w + 12 : a.p.x - 12
      left = Math.max(8, Math.min(width - w - 8, left))
      const want = Math.max(8, head - h - 8), spot = placeBubble(placed, { x: left, y: want, w, h }, { x: 8, y: 8, w: width - 16, h: size.h - 16 })
      const move = `translate(${spot.x}px,${spot.y}px)`, z = String(400 + order.length - placed.length) // nearer speakers on top, like the broadcast
      if (b.style.transform !== move) b.style.transform = move
      if (b.style.zIndex !== z) b.style.zIndex = z
      // The tail stays only while the bubble still sits right over its speaker's head.
      b.classList.toggle('lifted', spot.moved && !(spot.y === want && a.p.x > spot.x + 12 && a.p.x < spot.x + w - 12))
      const tail = `${Math.round(Math.max(12, Math.min(w - 12, a.p.x - spot.x)))}px`
      if (b.tail !== tail) { b.tail = tail; b.style.setProperty('--tail', tail) }
    }
    if (settling && !document.hidden) repaint()
  }

  new ResizeObserver(() => { size.w = stage.clientWidth; size.h = stage.clientHeight; for (const b of bubbles.values()) b.size = null; repaint() }).observe(stage)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) repaint() })
  fit()
  return {
    update(next, selection) { world = next; selected = selection; sync() },
    /** Highlights an NPC token (the life window's selection), or none. */
    selectNpc(id) { selectedNpc = id; sync() },
    /**
     * Site picking: a w×h footprint follows the pointer and the next tap on the map chooses its top-left tile
     * (`done({ x, y })`); Escape or `cancelPick()` ends it with `done(null)`. `valid(x, y)` only tints the footprint —
     * the server's quote decides.
     */
    pick({ w, h, valid }, done) { endPick(null); picking = { w, h, valid, done, at: null } },
    cancelPick() { if (picking) endPick(null) },
    /** Centres the map on a tile (a facility or site picked in the life window). */
    show(tx, ty) { view.zoom = Math.max(view.zoom, Math.min(maxZoom(), 2)); centreOn(tx + .5, ty + .5) },
    select(id) {
      selected = id; sync()
      // Picked from the list while zoomed in and out of sight: bring the resident into view.
      const a = actors.get(id), w = size.w, h = size.h
      if (a && !a.node.hidden && view.zoom > 1) { const p = screen(a.x + .5, a.y + .5); if (p.x < 60 || p.x > w - 60 || p.y < 80 || p.y > h - 80) centreOn(a.x + .5, a.y + .5) }
    },
    /** +1 / -1 zooms around the screen centre; 0 shows the whole village again. */
    zoom(step) {
      if (!step) { view.zoom = 1; remember(); repaint(); return }
      zoomAt(step > 0 ? 1.5 : 1 / 1.5, size.w / 2, size.h / 2)
    },
    /** 지도에서 보기: zoom in to at least 2x and centre on the resident. */
    focus(id) { const a = actors.get(id); if (!a || a.node.hidden) return false; view.zoom = Math.max(view.zoom, Math.min(maxZoom(), 2)); centreOn(a.x + .5, a.y + .5); return true },
    setPortraits(next) { portraits = next; sync() },
    repaint,
    /** Screen box of a resident's token, or null while the resident is away from the village. */
    anchor(id) { const a = actors.get(id); return a && !a.node.hidden ? a.face.getBoundingClientRect() : null },
    /** The painted village for the broadcast's village camera. */
    view: () => ({ canvas, glow, sky, tile: T, margin: MARGIN, width: W, height: H, pos: id => { const a = actors.get(id); return a ? { x: a.x, y: a.y, walking: !!a.route?.length } : null } }),
  }
}
