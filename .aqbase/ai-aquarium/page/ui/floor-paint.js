/* Dungeon floor drawing shared by the broadcast player and the guild's dungeon map: tiles, torches, sprites and faces. */
// Floor palettes; a floor keeps its palette because it is picked from the zone id.
const FLOOR_THEMES = [
  { void: '#0d1210', floor: '#4a5c4e', grout: '#36453a', top: '#677a68', face: '#2b362e', speck: '#5f8a55', foe: '#7cb36b', foeDark: '#5e9152' },
  { void: '#0f0e14', floor: '#514d60', grout: '#3d3a4a', top: '#7a7492', face: '#2f2b3b', speck: '#6c6585', foe: '#a99de0', foeDark: '#7d71b8' },
  { void: '#130f0c', floor: '#5d4b40', grout: '#46382f', top: '#8c6d59', face: '#362820', speck: '#8a5a3c', foe: '#e09468', foeDark: '#b46d45' },
]
export const floorHash = text => { let h = 7; for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) }

/**
 * `portraits()` gives the profile images, `colorOf(profileId)` a resident colour, `loaded()` runs when a face image arrives,
 * `sprite(key)` a game picture canvas (`monster:<zoneId>`, `boss:<zoneId>`) or null while there is none.
 * A scene is { key, map, cleared, seen, explored, focusId, crew, entities, moving }; `wide` fits the whole floor.
 */
export function createFloorPainter({ portraits = () => null, colorOf = () => '#668578', loaded = () => {}, sprite = () => null } = {}) {
  const images = new Map()
  let view = null
  function image(url) {
    let img = images.get(url)
    if (!img) { img = new Image(); img.onload = () => loaded(); img.src = url; images.set(url, img) }
    return img.complete && img.naturalWidth ? img : null
  }
  function face(ctx, id, name, color, x, y, r, ring) {
    const portrait = portraits()?.get?.(id), img = portrait?.url ? image(portrait.url) : null
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
    if (img) {
      ctx.clip()
      const scale = portrait.crop?.scale > 0 ? portrait.crop.scale : 1, side = Math.min(img.naturalWidth, img.naturalHeight) / scale
      const sx = (img.naturalWidth - side) * (portrait.crop?.x ?? 50) / 100, sy = (img.naturalHeight - side) * (portrait.crop?.y ?? 50) / 100
      ctx.drawImage(img, sx, sy, side, side, x - r, y - r, r * 2, r * 2)
    } else { ctx.fillStyle = '#1d1f1b'; ctx.font = `700 ${Math.max(8, r)}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(Array.from(name.trim())[0] || '?', x, y + 1) }
    ctx.restore()
    ctx.lineWidth = Math.max(1.5, r * .15); ctx.strokeStyle = ring; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
  }
  function label(ctx, text, x, y, size) {
    ctx.font = `600 ${size}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const w = ctx.measureText(text).width + size * .9
    ctx.fillStyle = '#101512cc'; ctx.fillRect(x - w / 2, y - size * .75, w, size * 1.5); ctx.fillStyle = '#f4efe2'; ctx.fillText(text, x, y)
  }
  function blank(ctx, w, h, text) {
    ctx.fillStyle = '#101512'; ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#b8b8a4'; ctx.font = `500 ${Math.max(11, Math.min(16, w / 30))}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, h / 2)
  }
  function dungeon(ctx, w, h, sc, now, wide) {
    const map = sc.map, pal = FLOOR_THEMES[floorHash(sc.key) % FLOOR_THEMES.length], crew = sc.crew
    let moving = sc.moving
    const focus = crew.find(a => a.id === sc.focusId)?.pos ?? { x: map.width / 2, y: map.height / 2 }
    const unit = wide ? Math.min(w / (map.width + 1), h / (map.height + 1)) : Math.min(w / 11, h / 7)
    const ox = wide ? (w - map.width * unit) / 2 : w / 2 - focus.x * unit, oy = wide ? (h - map.height * unit) / 2 : h / 2 - focus.y * unit
    view = { unit, ox, oy, width: map.width, height: map.height }
    const known = wide ? sc.explored : sc.seen, seen = i => known[i] === '1' || known[i] === 1, tile = i => map.tiles[i]
    ctx.fillStyle = pal.void; ctx.fillRect(0, 0, w, h)
    const glows = []
    for (let i = 0; i < map.tiles.length; i++) {
      if (!seen(i)) continue
      const x = i % map.width * unit + ox, y = Math.floor(i / map.width) * unit + oy
      if (x + unit < 0 || y + unit < 0 || x > w || y > h) continue
      if (tile(i) === '.') {
        ctx.fillStyle = pal.grout; ctx.fillRect(x, y, unit, unit); ctx.fillStyle = pal.floor; ctx.fillRect(x + 1, y + 1, unit - 2, unit - 2)
        if (floorHash(i) % 7 === 0) { ctx.fillStyle = pal.speck; ctx.fillRect(x + unit * .3, y + unit * .55, unit * .16, unit * .1) }
      } else {
        ctx.fillStyle = pal.face; ctx.fillRect(x, y, unit, unit); ctx.fillStyle = pal.top; ctx.fillRect(x, y, unit, unit * .3)
        if (floorHash(i * 13) % 11 === 0 && tile(i + map.width) === '.') glows.push([x + unit / 2, y + unit * .45])
      }
    }
    for (const [x, y] of glows) {
      const flicker = 1 + Math.sin(now / 90 + x) * .05 + Math.sin(now / 37 + y) * .04, radius = unit * 2.4 * flicker
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius); g.addColorStop(0, `#ffa046${Math.round(0x40 * flicker).toString(16).padStart(2, '0')}`); g.addColorStop(1, '#ffa04600')
      ctx.fillStyle = g; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
      ctx.fillStyle = '#5a4330'; ctx.fillRect(x - unit * .05, y, unit * .1, unit * .3); ctx.fillStyle = '#ffb04d'; ctx.beginPath(); ctx.ellipse(x, y - unit * .05, unit * .1, unit * .15 * flicker, 0, 0, Math.PI * 2); ctx.fill()
    }
    const cell = at => ({ x: at % map.width * unit + ox + unit / 2, y: Math.floor(at / map.width) * unit + oy + unit / 2 })
    for (const e of sc.entities) {
      if (e.done || !seen(e.at)) continue
      const foe = crew.find(a => a.phase === 'combat' && a.encounterId === e.id), fighting = !!foe
      const struck = foe?.hit && foe.hit.dealt > 0 && foe.hit.age < 260 ? Math.sin(foe.hit.age / 16) * unit * .07 : 0
      const { x: cx, y: cy } = cell(e.at), x = cx + (fighting ? unit * .26 : 0) + struck, s = unit
      const breath = e.kind === 'enemy' ? Math.sin(now / 380 + e.at) * (fighting ? .09 : .05) : 0, y = cy - (e.kind === 'enemy' ? s * breath * .3 : 0)
      // The DM's picture of this floor's monster (the guardian falls back to it); the old blob while none is ready.
      const art = e.kind === 'enemy' ? sprite(`${e.boss ? 'boss' : 'monster'}:${sc.key}`) ?? (e.boss ? sprite(`monster:${sc.key}`) : null) : null
      if (art) {
        const tall = s * (e.boss ? 1.3 : .92) * (1 + breath * .5), fit = Math.min(1, s * (e.boss ? 1.5 : 1.1) / (tall * art.width / art.height))
        const dh = tall * fit, dw = dh * art.width / art.height, foot = cy + s * .32, top = foot - dh
        ctx.fillStyle = '#0006'; ctx.beginPath(); ctx.ellipse(x, foot - s * .03, dw * .38 * (1 - breath * .5), s * .1, 0, 0, Math.PI * 2); ctx.fill()
        ctx.drawImage(art, x - dw / 2, top, dw, dh)
        if (struck) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .55; ctx.drawImage(art, x - dw / 2, top, dw, dh); ctx.restore() }
        if (e.boss) { const c = Math.max(top - s * .02, 2); ctx.fillStyle = '#ffd98a'; ctx.beginPath(); ctx.moveTo(x - s * .14, c); ctx.lineTo(x - s * .08, c - s * .12); ctx.lineTo(x, c - s * .03); ctx.lineTo(x + s * .08, c - s * .12); ctx.lineTo(x + s * .14, c); ctx.closePath(); ctx.fill() }
        if (e.hp < e.max) { ctx.fillStyle = '#0009'; ctx.fillRect(x - s * .32, foot + s * .06, s * .64, Math.max(2, s * .07)); ctx.fillStyle = '#ef8f6c'; ctx.fillRect(x - s * .32, foot + s * .06, s * .64 * e.hp / e.max, Math.max(2, s * .07)) }
      } else if (e.kind === 'enemy') {
        const size = e.boss ? .46 : .34
        ctx.fillStyle = '#0006'; ctx.beginPath(); ctx.ellipse(x, cy + s * .28, s * size * (1 - breath * .5), s * .1, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = struck ? '#fff1e6' : e.boss ? '#b07ad8' : pal.foe; ctx.beginPath(); ctx.ellipse(x, y, s * size, s * size * .8 * (1 + breath), 0, Math.PI, 0); ctx.lineTo(x + s * size, y + s * .2); ctx.lineTo(x - s * size, y + s * .2); ctx.closePath(); ctx.fill()
        ctx.fillStyle = e.boss ? '#8a56b4' : pal.foeDark; ctx.fillRect(x - s * size, y + s * .12, s * size * 2, s * .08)
        ctx.fillStyle = '#1d1a18'; ctx.fillRect(x - s * .12, y - s * .1, s * .06, s * .1); ctx.fillRect(x + s * .06, y - s * .1, s * .06, s * .1)
        if (e.boss) { ctx.fillStyle = '#ffd98a'; ctx.beginPath(); ctx.moveTo(x - s * .18, y - s * .3); ctx.lineTo(x - s * .1, y - s * .44); ctx.lineTo(x, y - s * .32); ctx.lineTo(x + s * .1, y - s * .44); ctx.lineTo(x + s * .18, y - s * .3); ctx.closePath(); ctx.fill() }
        if (e.hp < e.max) { ctx.fillStyle = '#0009'; ctx.fillRect(x - s * .32, y + s * .32, s * .64, Math.max(2, s * .07)); ctx.fillStyle = '#ef8f6c'; ctx.fillRect(x - s * .32, y + s * .32, s * .64 * e.hp / e.max, Math.max(2, s * .07)) }
      } else if (e.kind === 'chest') {
        ctx.fillStyle = '#5d3b1f'; ctx.fillRect(x - s * .26, y - s * .16, s * .52, s * .36); ctx.fillStyle = '#a06c3e'; ctx.fillRect(x - s * .22, y - s * .13, s * .44, s * .12); ctx.fillStyle = '#ffd98a'; ctx.fillRect(x - s * .04, y - s * .04, s * .08, s * .1)
      } else if (e.kind === 'rest') {
        ctx.fillStyle = '#6b4a32'; ctx.fillRect(x - s * .24, y + s * .1, s * .48, s * .08); ctx.fillStyle = '#ffb04d'; ctx.beginPath(); ctx.moveTo(x - s * .14, y + s * .1); ctx.lineTo(x, y - s * .24); ctx.lineTo(x + s * .14, y + s * .1); ctx.closePath(); ctx.fill()
      } else if (e.kind === 'trap') {
        ctx.fillStyle = '#8a8f8a88'; for (const dx of [-.16, 0, .16]) { ctx.beginPath(); ctx.moveTo(x + s * (dx - .06), y + s * .12); ctx.lineTo(x + s * dx, y - s * .08); ctx.lineTo(x + s * (dx + .06), y + s * .12); ctx.closePath(); ctx.fill() }
      } else if (e.kind === 'relic') {
        ctx.fillStyle = '#8fe0e6'; ctx.beginPath(); ctx.moveTo(x, y - s * .24); ctx.lineTo(x + s * .16, y); ctx.lineTo(x, y + s * .22); ctx.lineTo(x - s * .16, y); ctx.closePath(); ctx.fill()
      } else if (e.kind === 'landmark') {
        ctx.fillStyle = '#6a4a32'; ctx.fillRect(x - s * .26, y - s * .28, s * .52, s * .52); ctx.fillStyle = '#c9b38f'; for (const dy of [-.16, 0, .14]) ctx.fillRect(x - s * .2, y + s * dy, s * .4, s * .05)
      }
    }
    const stairs = (at, up) => { const { x, y } = cell(at); ctx.fillStyle = '#7fd49a33'; ctx.fillRect(x - unit * .4, y - unit * .4, unit * .8, unit * .8); ctx.fillStyle = '#7fd49a'; ctx.font = `700 ${Math.max(9, unit * .5)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(up ? '↑' : '↓', x, y) }
    if (seen(map.entrance)) stairs(map.entrance, true)
    if (sc.cleared && seen(map.exit)) stairs(map.exit, false)
    // The streamer is drawn last so nobody covers them; others sharing a tile step back up-left, smaller.
    const order = crew.filter(a => seen(a.at)).sort((a, b) => (a.id === sc.focusId) - (b.id === sc.focusId) || (a.phase === 'combat') - (b.phase === 'combat'))
    const shared = new Map()
    for (const a of [...order].reverse()) { shared.set(a.id, shared.get(a.at) ?? 0); shared.set(a.at, (shared.get(a.at) ?? 0) + 1) }
    for (const a of order) {
      const me = a.id === sc.focusId, back = shared.get(a.id), p = a.pos, hit = a.hit, age = hit?.age ?? 1e9
      // Walking bob, idle breath, a lunge on the blow and a shudder when the enemy hits back.
      const bob = p.walking ? Math.abs(Math.sin(now / 150 + a.at)) * unit * .09 : Math.sin(now / 700 + a.at) * unit * .015
      const lunge = hit?.dealt > 0 && age < 220 ? Math.sin(age / 220 * Math.PI) * unit * .14 : 0
      const hurt = hit?.taken > 0 && age > 260 && age < 560 ? Math.sin(age / 14) * unit * .06 : 0
      const x = p.x * unit + ox - (a.phase === 'combat' && !back ? unit * .24 : unit * .48 * back) + lunge + hurt, y = p.y * unit + oy - unit * .32 * back - bob
      const r = Math.max(5, unit * (back ? .26 : .34))
      ctx.fillStyle = '#0007'; ctx.beginPath(); ctx.ellipse(x, p.y * unit + oy - unit * .32 * back + r * .95, r * .9 - bob * .3, r * .28, 0, 0, Math.PI * 2); ctx.fill()
      face(ctx, a.profileId, a.name, colorOf(a.profileId), x, y, r, hurt ? '#ef8f6c' : me ? '#fffbf0' : '#c9c4b0')
      if (unit > 26 && !me) label(ctx, a.name, x, y - r - 9, 11)
      if (hit?.taken > 0 && age > 260) {
        const size = Math.max(11, unit * .34), ty = y - r - unit * .1 - (age - 260) * .03
        ctx.globalAlpha = Math.max(0, 1 - (age - 260) / 640); ctx.font = `800 ${size}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.lineWidth = 4; ctx.strokeStyle = '#2a0f0f'; ctx.strokeText(`-${hit.taken}`, x - unit * .2, ty); ctx.fillStyle = '#ff9b9b'; ctx.fillText(`-${hit.taken}`, x - unit * .2, ty)
        ctx.globalAlpha = 1
      }
      if (hit?.healed > 0) {
        const size = Math.max(11, unit * .34), hy = y - r - unit * .35 - age * .03
        ctx.globalAlpha = Math.max(0, 1 - age / 900); ctx.font = `800 ${size}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.lineWidth = 4; ctx.strokeStyle = '#0f2a17'; ctx.strokeText(`+${hit.healed}`, x + unit * .1, hy); ctx.fillStyle = '#8fe0a6'; ctx.fillText(`+${hit.healed}`, x + unit * .1, hy)
        if (hit.skill && !(hit.dealt > 0)) { ctx.font = `700 ${size * .6}px system-ui,sans-serif`; ctx.strokeText(hit.skillName || '스킬', x + unit * .1, hy - size * .8); ctx.fillStyle = '#d6f5de'; ctx.fillText(hit.skillName || '스킬', x + unit * .1, hy - size * .8) }
        ctx.globalAlpha = 1
      }
      if (hit?.dealt > 0) {
        const fx = p.x * unit + ox + unit * .45, fy = y - unit * .5 - age * .03, size = Math.max(12, unit * .42)
        ctx.globalAlpha = Math.max(0, 1 - age / 900); ctx.font = `800 ${size}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.lineWidth = 4; ctx.strokeStyle = '#3a2410'; ctx.strokeText(`-${hit.dealt}`, fx, fy); ctx.fillStyle = '#ffd98a'; ctx.fillText(`-${hit.dealt}`, fx, fy)
        if (hit.skill) { const name = hit.skillName || '스킬!'; ctx.font = `700 ${size * .5}px system-ui,sans-serif`; ctx.strokeText(name, fx + size, fy - size * .5); ctx.fillStyle = '#ffefc2'; ctx.fillText(name, fx + size, fy - size * .5) }
        if (age < 260) { ctx.strokeStyle = '#fffbe8'; ctx.lineWidth = Math.max(2, unit * .06); ctx.beginPath(); ctx.moveTo(fx - unit * .35, y + unit * .3); ctx.quadraticCurveTo(fx - unit * .05, y, fx + unit * .25, y - unit * .35); ctx.stroke() }
        ctx.globalAlpha = 1
      }
      // What the fighter shouts this turn, or dots while its model picks the next move.
      if (a.say || a.thinking) {
        const size = Math.max(10, Math.min(14, unit * .36)), text = a.say || '…'
        ctx.font = `600 ${size}px system-ui,sans-serif`
        const bw = Math.min(w * .6, ctx.measureText(text).width + size * 1.2), bh = size * 1.7, bx = Math.max(4, Math.min(w - bw - 4, x - bw / 2)), by = Math.max(4, y - r - bh - size * .7)
        ctx.globalAlpha = a.say ? 1 : .8; ctx.fillStyle = '#fffdf6'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, size * .6); else ctx.rect(bx, by, bw, bh); ctx.fill()
        ctx.beginPath(); ctx.moveTo(x - size * .35, by + bh - 1); ctx.lineTo(x, by + bh + size * .45); ctx.lineTo(x + size * .35, by + bh - 1); ctx.fill()
        ctx.fillStyle = '#2a2a24'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + bw / 2, by + bh / 2, bw - size * .6); ctx.globalAlpha = 1
      }
    }
    if (!wide) {
      const g = ctx.createRadialGradient(w / 2, h / 2, unit * 3, w / 2, h / 2, unit * 5.6)
      g.addColorStop(0, `${pal.void}00`); g.addColorStop(.55, `${pal.void}66`); g.addColorStop(1, `${pal.void}e6`)
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
    }
    return moving
  }
  /** The tile under a point of the last drawn floor, or -1. */
  function tileAt(x, y) {
    if (!view) return -1
    const tx = Math.floor((x - view.ox) / view.unit), ty = Math.floor((y - view.oy) / view.unit)
    return tx < 0 || ty < 0 || tx >= view.width || ty >= view.height ? -1 : ty * view.width + tx
  }
  /** Where a tile's centre was drawn. */
  const tileCenter = at => view ? { x: at % view.width * view.unit + view.ox + view.unit / 2, y: Math.floor(at / view.width) * view.unit + view.oy + view.unit / 2, unit: view.unit } : null
  return { face, label, blank, dungeon, tileAt, tileCenter }
}
