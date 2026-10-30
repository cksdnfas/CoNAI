import { spokenText } from '../../shared/speech.mjs'
import { placeBubble } from '../ui/bubble-layout.js'
import { shade } from './channels.js'

/** Canvas text wrapped to `max` px in at most `lines` lines; the last one ends in … when cut. */
function wrap(ctx, text, max, lines) {
  const out = []; let line = '', cut = false
  for (const char of Array.from(text.replace(/\s+/g, ' ').trim())) {
    if (ctx.measureText(line + char).width <= max || !line) { line += char; continue }
    out.push(line); line = char.trimStart()
    if (out.length === lines) { cut = true; break }
  }
  if (!cut && line) out.push(line)
  if (cut) out[lines - 1] = `${out[lines - 1].slice(0, -1)}…`
  return out
}

/** A life channel: the village map around the resident, its residents and their speech bubbles. */
export function createTown({ village, floor, world: getWorld }) {
  const { face, label, blank } = floor
  const vPos = new Map()
  function town(ctx, w, h, ch, wide) {
    const world = getWorld()
    const v = village(), src = v?.canvas
    if (!src?.width) { blank(ctx, w, h, ch.status); return false }
    const T = v.tile, M = v.margin, now = performance.now()
    for (const r of world.residents) {
      if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) continue
      const shown = v.pos?.(r.profileId), p = vPos.get(r.profileId)
      if (shown) { vPos.set(r.profileId, shown); continue }
      if (!p || Math.abs(p.x - r.x) + Math.abs(p.y - r.y) > 4) { vPos.set(r.profileId, { x: r.x, y: r.y }); continue }
      p.x += (r.x - p.x) * .12; p.y += (r.y - p.y) * .12; p.walking = Math.abs(r.x - p.x) + Math.abs(r.y - p.y) > .02
    }
    const me = vPos.get(ch.id) ?? { x: v.width / 2, y: v.height / 2 }
    const k = wide ? Math.min(w / ((v.width + 1) * T), h / ((v.height + 1) * T)) : w / ((w > 500 ? 13 : 10) * T)
    const viewW = w / k, viewH = h / k
    const cx = wide ? M + v.width * T / 2 : M + (me.x + .5) * T, cy = wide ? M + v.height * T / 2 : M + (me.y + .5) * T
    const sx = Math.max(0, Math.min(src.width - viewW, cx - viewW / 2)), sy = Math.max(0, Math.min(src.height - viewH, cy - viewH / 2))
    ctx.imageSmoothingEnabled = false; ctx.fillStyle = '#2c4a36'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(src, sx, sy, viewW, viewH, 0, 0, w, h)
    // The village's time of day, the same tint and lights as the map.
    if (v.sky && !v.sky.day) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = v.sky.color; ctx.fillRect(0, 0, w, h)
      if (v.glow?.width && v.sky.glow > 0) { ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = v.sky.glow; ctx.imageSmoothingEnabled = true; ctx.drawImage(v.glow, sx / 2, sy / 2, viewW / 2, viewH / 2, 0, 0, w, h) }
      ctx.restore()
    }
    const at = p => ({ x: (M + (p.x + .5) * T - sx) * k, y: (M + (p.y + .5) * T - sy) * k })
    const r = Math.max(5, T * k * .4), bubbles = []
    for (const res of [...world.residents].filter(x => !x.away && (!x.asleep || x.rough) && vPos.has(x.profileId)).sort((a, b) => vPos.get(a.profileId).y - vPos.get(b.profileId).y)) {
      const spot = vPos.get(res.profileId), ground = at(spot)
      if (ground.x < -r * 2 || ground.y < -r * 2 || ground.x > w + r * 2 || ground.y > h + r * 2) continue
      const lift = spot.walking ? Math.abs(Math.sin(now / 140 + res.profileId)) * r * .28 : Math.sin(now / 800 + res.profileId) * r * .04, p = { x: ground.x, y: ground.y - lift }
      ctx.fillStyle = '#1d2e2266'; ctx.beginPath(); ctx.ellipse(ground.x, ground.y + r * .95, r * .9, r * .3, 0, 0, Math.PI * 2); ctx.fill()
      face(ctx, res.profileId, res.name, res.color || '#668578', p.x, p.y, r, res.profileId === ch.id ? '#ffd98a' : '#fffbf0')
      if (r > 8) label(ctx, res.name, p.x, p.y + r + Math.max(8, r * .5), Math.max(9, Math.min(12, r * .6)))
      const thinking = world.thinking?.from === res.profileId
      if (res.bubble || thinking) bubbles.push({ p, res, text: thinking ? '…' : spokenText(res.bubble) })
    }
    // Nearer speakers (lower) first; a bubble that would cover a placed one moves aside and drops its tail (bubble-layout.js).
    // Each bubble names its speaker over a bar in the resident colour, so stacked bubbles stay tellable apart.
    const size = Math.max(10, Math.min(15, r * .62)), nameSize = Math.max(9, size * .78), placed = [], drawn = []
    const top = h > 200 ? 40 : 6 // below the LIVE/생활 tag row
    for (const { p, res, text } of bubbles.sort((a, b) => b.p.y - a.p.y)) {
      const dots = text === '…', color = /^#[0-9a-f]{6}$/i.test(res.color || '') ? res.color : '#668578'
      ctx.font = `600 ${size}px system-ui,sans-serif`
      const lines = wrap(ctx, text, Math.min(w * .42, size * 18), 3), head = dots ? 0 : nameSize * 1.45
      ctx.font = `750 ${nameSize}px system-ui,sans-serif`; const nameW = dots ? 0 : ctx.measureText(res.name).width
      ctx.font = `600 ${size}px system-ui,sans-serif`
      const bw = Math.max(nameW, ...lines.map(l => ctx.measureText(l).width)) + size * 1.4, bh = head + lines.length * size * 1.45 + size * .8
      const want = Math.max(top, p.y - r - bh - size * .6), spot = placeBubble(placed, { x: Math.max(6, Math.min(w - bw - 6, p.x - bw / 2)), y: want, w: bw, h: bh }, { x: 6, y: top, w: w - 12, h: h - top - 6 })
      drawn.push({ p, res, dots, color, lines, head, bw, bh, bx: spot.x, by: spot.y, lifted: spot.moved && !(spot.y === want && p.x > spot.x + size && p.x < spot.x + bw - size) })
    }
    // Farther speakers are drawn first so a nearer bubble that still touches one hides its right edge, not its name.
    for (const { p, res, dots, color, lines, head, bw, bh, bx, by, lifted } of drawn.reverse()) {
      ctx.fillStyle = '#fffdf6'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, size * .7); else ctx.rect(bx, by, bw, bh); ctx.fill()
      if (!lifted) { ctx.beginPath(); ctx.moveTo(p.x - size * .4, by + bh - 1); ctx.lineTo(p.x, by + bh + size * .5); ctx.lineTo(p.x + size * .4, by + bh - 1); ctx.fill() }
      if (!dots) {
        ctx.save(); ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, size * .7); else ctx.rect(bx, by, bw, bh); ctx.clip()
        ctx.fillStyle = color; ctx.fillRect(bx, by, 3, bh); ctx.restore()
        ctx.fillStyle = shade(color, .55); ctx.font = `750 ${nameSize}px system-ui,sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
        ctx.fillText(res.name, bx + size * .7, by + size * .4)
      }
      ctx.font = `600 ${size}px system-ui,sans-serif`; ctx.fillStyle = '#2a2a24'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      lines.forEach((l, i) => ctx.fillText(l, bx + size * .7, by + head + size * .45 + i * size * 1.45))
    }
    return true
  }

  return town
}
