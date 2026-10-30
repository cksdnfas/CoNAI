import { node, svgIcon, tip } from '../ui/dom.js'
import { PHASE, P, parseTool, ENTITY, clock } from './common.js'

/* Dungeon: floors on the left, the floor itself drawn like the broadcast, facts on the right. */
export function createZones({ guild, layer, parts, floor, glyph, monsterKey, publish }) {
  const $ = id => document.getElementById(id)
  const { face, bar, itemIcon, watchButton } = parts
  let mapFrame = 0, mapDrawn = 0
  const zoneImages = new Map()
  async function showImage(zone) {
    const serial = ++guild.imageSerial, image = $('rpg-zone-image')
    if (zoneImages.has(zone.id)) { image.src = zoneImages.get(zone.id); image.alt = zone.name; $('rpg-zone-preview').hidden = false; return }
    image.removeAttribute('src'); $('rpg-zone-preview').hidden = true
    try {
      const data = parseTool(await guild.api.app.call('get_media_download', { composite_hashes: [zone.imageHash] }))
      const id = data.items?.[0]?.artifact?.artifact_id
      if (!id) throw new Error('지역 이미지를 열 수 없어.')
      const media = await guild.api.media.open(id)
      zoneImages.set(zone.id, media.url)
      if (serial === guild.imageSerial) { image.src = media.url; image.alt = zone.name; $('rpg-zone-preview').hidden = false }
    } catch { if (serial === guild.imageSerial) $('rpg-zone-preview').hidden = true }
  }
  const zoneOf = () => guild.world?.rpg.zones.find(z => z.id === guild.selectedFloor)
  const crewOf = zone => guild.world.rpg.actors.filter(a => a.expedition?.zoneId === zone?.id)
  function seenMask(zone) {
    const map = zone?.map
    if (!map) return ''
    return guild.mapMode === 'all' ? '1'.repeat(map.tiles.length) : guild.mapMode === 'actor' ? crewOf(zone).find(a => a.profileId === guild.selected)?.visible || '' : map.explored
  }
  function renderZones() {
    if (!guild.world.rpg.zones.some(z => z.id === guild.selectedFloor)) guild.selectedFloor = guild.world.rpg.actors.find(a => a.profileId === guild.selected)?.expedition?.zoneId ?? guild.world.rpg.zones.findLast(z => z.unlocked)?.id ?? guild.world.rpg.zones[0]?.id
    $('rpg-zone-list').replaceChildren(...guild.world.rpg.zones.map(z => {
      const button = node('button', '', 'rz-floor'); button.type = 'button'; button.dataset.state = z.cleared ? 'cleared' : z.unlocked ? 'open' : 'locked'; button.setAttribute('aria-pressed', String(z.id === guild.selectedFloor))
      const crew = crewOf(z), mark = node('span', '', 'rz-mark')
      mark.append(svgIcon(z.cleared ? P.crown : z.unlocked ? P.foe : P.lock))
      const text = node('span', '', 'rz-floor-text'); text.append(node('b', z.name), node('small', `Lv.${z.level}${z.unlocked ? ` · ${z.summary.total ? Math.round(z.summary.explored / z.summary.total * 100) : 0}%` : ''}`, 'num'))
      const faces = node('span', '', 'rz-faces'); for (const a of crew.slice(0, 3)) faces.append(face(a.profileId, a.name))
      button.append(node('span', String(z.floor), 'rz-no num'), text, faces, mark)
      tip(button, `${z.floor}층 ${z.name} · ${z.cleared ? '공략 완료' : z.unlocked ? '수호자 남음' : '잠김'}`)
      button.addEventListener('click', () => { guild.selectedFloor = z.id; guild.hoverTile = -1; renderZones(); publish() }); return button
    }))
    const zone = zoneOf(), map = zone?.map, crew = crewOf(zone)
    $('rpg-map-title').textContent = zone ? `${zone.floor}층 · ${zone.name}` : '던전'
    $('rpg-map-info').textContent = zone ? zone.design.theme : ''
    for (const b of $('rpg-map-mode').children) b.setAttribute('aria-pressed', String(b.dataset.mode === guild.mapMode))
    $('rpg-map-mode').hidden = !map
    $('rpg-map').hidden = !map
    $('rpg-map-empty').hidden = !!map
    $('rpg-map-empty').textContent = !zone ? '' : zone.unlocked ? '아직 아무도 들어가지 않았어.' : '앞 층을 공략하면 열려.'
    $('rpg-map-actors').replaceChildren(...crew.map(a => {
      const chip = node('div', '', 'rz-chip'), pick = node('button', '', 'rz-chip-pick'); pick.type = 'button'; pick.setAttribute('aria-pressed', String(a.profileId === guild.selected)); tip(pick, `${a.name} · ${PHASE[a.phase]} · HP ${a.hp}/${a.stats.hp}`)
      const who = node('span', '', 'rz-chip-who'); who.append(node('b', a.name), bar(a.hp, a.stats.hp, 'hp'))
      pick.append(face(a.profileId, a.name), who)
      pick.addEventListener('click', () => { guild.selected = guild.selected === a.profileId && guild.mapMode !== 'actor' ? null : a.profileId; renderZones(); publish() })
      chip.append(pick, watchButton(a, null, 'ib onair sm')); return chip
    }))
    // Floor facts as icon + number; the words live in the tooltips.
    const entities = map?.entities ?? [], alive = kind => entities.filter(e => e.kind === kind && !e.done)
    const boss = entities.find(e => e.boss)
    const stats = [
      [P.map, zone && zone.summary.total ? `${Math.round(zone.summary.explored / zone.summary.total * 100)}%` : '—', zone ? `발견 ${zone.summary.explored}/${zone.summary.total}칸` : '발견', '발견'],
      [P.foe, map ? String(alive('enemy').filter(e => !e.boss).length) : '—', '남은 적', '적'],
      [P.crown, zone?.cleared ? '처치' : boss && !boss.done ? `${boss.hp}` : '—', zone?.cleared ? '수호자 처치 완료' : '수호자 HP', '수호자'],
      [P.chest, map ? String(alive('chest').length) : '—', '남은 보물상자', '보물'],
      [P.gem, map ? String(alive('relic').length) : '—', '남은 유물', '유물'],
      [P.skull, String(zone?.summary.metrics?.deaths ?? 0), `사망 · 입장 ${zone?.summary.metrics?.entries ?? 0}회`, '사망'],
    ]
    const cast = (picture, title, sub) => { const el = node('div', '', 'rz-cast-row'), text = node('span'); text.append(node('b', title), node('small', sub)); el.append(picture, text); return el }
    const drop = zone?.drop ? itemIcon(zone.drop) : null
    $('rpg-zone-cast').replaceChildren(...(zone ? [cast(glyph(`monster:${zone.id}`, P.foe), zone.monster?.name ?? '몬스터', '몬스터'), cast(glyph(monsterKey(zone.id, true), P.crown), zone.monster?.name ?? '수호자', '수호자'), ...(drop ? [cast(drop, zone.drop.name, `전리품 · ${zone.drop.rarity}`)] : [])] : []))
    $('rpg-zone-stats').replaceChildren(...stats.map(([path, value, label, short]) => { const cell = node('div', '', 'rz-stat'); cell.dataset.tip = label; cell.append(svgIcon(path), node('b', value, 'num'), node('small', short)); return cell }))
    if (zone?.imageHash && guild.api) void showImage(zone); else { ++guild.imageSerial; $('rpg-zone-preview').hidden = true }
    const ids = new Set(crew.map(a => a.id)), logs = guild.world.rpg.logs.filter(l => ids.has(l.actorId))
    $('rpg-map-log').replaceChildren(...(logs.length ? logs : guild.world.rpg.logs).slice(-8).reverse().map(l => { const p = node('p'); p.append(node('time', clock(l.at), 'num'), node('span', l.text)); return p }))
    if (!$('rpg-map-log').children.length) $('rpg-map-log').append(node('p', '조용해.', 'rpg-muted'))
    canvasLabel()
    drawMap(); animateMap()
  }
  function canvasLabel() {
    const zone = zoneOf()
    if (zone?.map) $('rpg-map').setAttribute('aria-label', `${zone.floor}층 ${zone.name}, 발견 ${zone.summary.explored}/${zone.summary.total}, 탐험 중 ${crewOf(zone).length}명`)
  }
  function scene(zone) {
    const map = zone.map, mask = seenMask(zone), focus = crewOf(zone).find(a => a.profileId === guild.selected)
    const crew = crewOf(zone).map(a => ({ id: a.id, profileId: a.profileId, name: a.name, at: a.expedition.position, pos: { x: a.expedition.position % map.width + .5, y: Math.floor(a.expedition.position / map.width) + .5, walking: false }, phase: a.phase, encounterId: a.expedition.encounterId, hit: null, say: '', thinking: false }))
    return { key: zone.id, map, cleared: zone.cleared, seen: mask, explored: mask, focusId: focus?.id ?? null, crew, moving: true,
      entities: map.entities.map(e => ({ id: e.id, at: e.at, kind: e.kind, boss: !!e.boss, done: !!e.done, hp: e.hp, max: e.monster?.hp })) }
  }
  function drawMap(now = performance.now()) {
    const canvas = $('rpg-map'), zone = zoneOf()
    if (layer.hidden || guild.tab !== 'zones' || !zone?.map || canvas.hidden) return false
    const rect = canvas.getBoundingClientRect(), w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height)), dpr = Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr) }
    const ctx = canvas.getContext('2d'); if (!ctx?.setTransform) return false
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    floor.dungeon(ctx, w, h, scene(zone), now, true)
    // The hovered tile gets a thin frame so the tooltip reads as "this one".
    const c = guild.hoverTile >= 0 ? floor.tileCenter(guild.hoverTile) : null
    if (c) { ctx.strokeStyle = '#ffd98acc'; ctx.lineWidth = 1.5; ctx.strokeRect(c.x - c.unit / 2 + 1, c.y - c.unit / 2 + 1, c.unit - 2, c.unit - 2) }
    mapDrawn = now
    return true
  }
  // Torches flicker and monsters breathe while the dungeon tab is open; about 20 frames a second is plenty.
  function animateMap() {
    if (mapFrame || typeof requestAnimationFrame !== 'function') return
    const step = now => { mapFrame = 0; if (document.hidden || layer.hidden || guild.tab !== 'zones') return; if (now - mapDrawn >= 50) drawMap(now); mapFrame = requestAnimationFrame(step) }
    mapFrame = requestAnimationFrame(step)
  }
  function hoverText(zone, at) {
    const map = zone.map, mask = seenMask(zone)
    if (at < 0 || mask[at] !== '1') return ''
    const here = crewOf(zone).filter(a => a.expedition.position === at).map(a => `${a.name} · ${PHASE[a.phase]} · HP ${a.hp}/${a.stats.hp}`)
    const e = map.entities.find(x => x.at === at && !x.done)
    if (e) here.push(e.kind === 'enemy' ? `${e.boss ? '수호자 ' : ''}${e.monster?.name ?? '적'} · HP ${e.hp}/${e.monster?.hp ?? e.hp}` : ENTITY[e.kind] ?? e.kind)
    if (at === map.entrance) here.push('입구')
    if (zone.cleared && at === map.exit) here.push('다음 층 계단')
    return here.join('\n')
  }
  $('rpg-map').addEventListener('pointermove', event => {
    const zone = zoneOf(); if (!zone?.map) return
    const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top, at = floor.tileAt(x, y), text = hoverText(zone, at), box = $('rpg-map-hover')
    guild.hoverTile = text ? at : -1
    box.hidden = !text; box.textContent = text
    if (text) { const stageBox = event.currentTarget.parentElement.getBoundingClientRect(); box.style.left = `${Math.min(event.clientX - stageBox.left + 14, stageBox.width - box.offsetWidth - 8)}px`; box.style.top = `${Math.min(event.clientY - stageBox.top + 14, stageBox.height - box.offsetHeight - 8)}px` }
    event.currentTarget.style.cursor = crewOf(zone).some(a => a.expedition.position === at) ? 'pointer' : ''
  })
  $('rpg-map').addEventListener('pointerleave', () => { guild.hoverTile = -1; $('rpg-map-hover').hidden = true })
  $('rpg-map').addEventListener('click', event => {
    const zone = zoneOf(); if (!zone?.map) return
    const rect = event.currentTarget.getBoundingClientRect(), at = floor.tileAt(event.clientX - rect.left, event.clientY - rect.top)
    const a = crewOf(zone).find(x => x.expedition.position === at)
    if (a) { guild.selected = a.profileId; renderZones(); publish() }
  })
  for (const b of $('rpg-map-mode').children) b.addEventListener('click', () => { guild.mapMode = b.dataset.mode; renderZones(); publish() })
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => drawMap()).observe($('rpg-map'))
  function mapSnapshot() {
    const zone = zoneOf(), map = zone?.map
    if (!map) return null
    const actors = crewOf(zone), seen = seenMask(zone)
    const tiles = [...map.tiles].map((tile, i) => seen[i] === '1' ? tile : '?').join('')
    return { zoneId: zone.id, width: map.width, height: map.height, tiles, entities: map.entities.filter(e => seen[e.at] === '1').map(e => ({ at: e.at, kind: e.kind, boss: !!e.boss, pattern: e.pattern ?? null, done: e.done, hp: e.hp ?? null })), actors: actors.filter(a => seen[a.expedition.position] === '1').map(a => ({ profileId: a.profileId, position: a.expedition.position, phase: a.phase })) }
  }

  return { renderZones, drawMap, mapSnapshot }
}
