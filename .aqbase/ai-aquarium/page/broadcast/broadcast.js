import { speechNodes } from '../ui/speech.js'
import { createFloorPainter } from '../ui/floor-paint.js'
import { setText, place } from '../ui/dom.js'
import { BC_PHASE, BC_ROLE, BC_TAG, BC_OUTCOME, BC_SPEEDS, BC_SVG, bcTilePath, bcAgo, bcClock, buildChannels } from './channels.js'
import { replayFrame, replayScene } from './replay-scene.js'
import { chatLines, replayLines } from './chat-lines.js'
import { createTown } from './town.js'

/**
 * The village broadcast: every resident is a channel. Residents in the dungeon stream their floor (LIVE),
 * residents at home stream their village life, and sleeping ones are off air. Watching only reads snapshots;
 * it never starts the game or calls a model.
 */
export function createBroadcast(stage, { inspect = () => {}, memory = null, village = () => null, portraits = () => null, feed = () => [], changed = () => {}, server = null, say = null, toast = () => {}, art = null } = {}) {
  const layer = document.createElement('div'); layer.id = 'broadcast'; layer.className = 'menu-layer bc-layer'; layer.hidden = true
  layer.innerHTML = `<div class="dim"></div><section class="menu bc" role="dialog" aria-modal="true" aria-labelledby="bc-heading">
    <header><span class="bc-logo">${BC_SVG.tv}</span><h2 id="bc-heading">햇살 방송</h2>
      <div id="bc-filters" class="mtabs" role="tablist"><button type="button" data-filter="all" aria-selected="true">전체</button><button type="button" data-filter="live" aria-selected="false">던전</button><button type="button" data-filter="life" aria-selected="false">생활</button><button type="button" data-filter="replay" aria-selected="false">다시보기</button></div>
      <span class="grow"></span>
      <button id="broadcast-home" type="button" class="btn bc-home-btn">${BC_SVG.grid}채널 목록</button>
      <button id="broadcast-mini" type="button" class="ib" data-tip="미니 플레이어로" aria-label="미니 플레이어로">${BC_SVG.mini}</button>
      <button id="broadcast-close" type="button" class="ib" data-tip="닫기" aria-label="닫기">${BC_SVG.close}</button></header>
    <div id="bc-home" class="bc-home"><div id="bc-grid" class="bc-grid"></div>
      <section id="bc-replay-section" class="bc-replays" aria-labelledby="bc-replay-heading"><h3 id="bc-replay-heading">다시보기</h3><div id="bc-replays"></div></section>
      <p id="bc-offline" class="bc-offline"></p></div>
    <div id="bc-watch" class="bc-watch" hidden>
      <div class="bc-main">
        <div class="bc-player"><canvas id="broadcast-canvas" role="img"></canvas>
          <div class="bc-tl"><span id="bc-tag" class="bc-tag"></span><span id="bc-time" class="bc-time num"></span></div>
          <div id="bc-goal" class="bc-goal"></div>
          <div class="bc-lower"><span id="bc-face" class="bc-face big"></span><span class="bc-who"><b id="bc-name"></b><small id="bc-where"></small></span><span id="bc-bars" class="bc-bars"></span></div>
          <div id="bc-foe" class="bc-foe"></div>
        </div>
        <div id="bc-replay-bar" class="bc-replay-bar" hidden><button id="bc-replay-play" type="button" class="ib" data-tip="재생" aria-label="재생">${BC_SVG.play}</button>
          <input id="bc-replay-seek" type="range" min="0" max="1000" value="0" aria-label="재생 위치"><span id="bc-replay-time" class="num"></span>
          <div id="bc-replay-speed" class="bc-seg" role="group" aria-label="재생 속도">${BC_SPEEDS.map(x => `<button type="button" data-speed="${x}" aria-pressed="false">${x}×</button>`).join('')}</div></div>
        <h1 id="bc-title" class="bc-title"></h1>
        <div class="bc-row"><span id="bc-chan-face" class="bc-face"></span><span class="bc-chan"><b id="bc-chan-name"></b><small id="bc-chan-sub"></small></span><span class="grow"></span>
          <div class="bc-seg" role="group" aria-label="카메라"><button id="broadcast-follow" type="button" aria-pressed="true">따라가기</button><button id="broadcast-camera" type="button" aria-pressed="false">층 전체</button></div>
          <button id="broadcast-memory" type="button" class="ib framed" data-tip="기억 보기" aria-label="기억 보기">${BC_SVG.memory}</button>
          <button id="broadcast-inspect" type="button" class="ib framed" data-tip="모험 정보" aria-label="모험 정보">${BC_SVG.shield}</button></div>
        <nav id="bc-others" class="bc-others" aria-label="다른 방송"></nav>
      </div>
      <aside class="bc-chat" aria-label="채팅"><b>채팅</b><div id="bc-feed" class="bc-feed" role="log" aria-live="polite"></div>
        <div id="bc-say" class="bc-input"><input id="bc-say-input" type="text" maxlength="200" autocomplete="off" enterkeyhint="send" placeholder="한마디 남기기" aria-label="방송 채팅"><button id="bc-say-send" type="button" class="ib up" data-tip="보내기" aria-label="보내기">${BC_SVG.send}</button></div></aside>
    </div></section>`
  const pip = document.createElement('section'); pip.id = 'bc-pip'; pip.className = 'hud bc-pip'; pip.hidden = true; pip.setAttribute('aria-label', '방송 미니 플레이어')
  pip.innerHTML = `<div class="bc-pip-screen"><canvas id="bc-pip-canvas" role="img"></canvas><div class="bc-tl"><span id="bc-pip-tag" class="bc-tag"></span><span id="bc-pip-time" class="bc-time num"></span></div>
    <div class="bc-pip-tools"><button id="bc-pip-expand" type="button" class="ib" data-tip="크게 보기" aria-label="크게 보기">${BC_SVG.expand}</button><button id="bc-pip-close" type="button" class="ib" data-tip="닫기" aria-label="미니 플레이어 닫기">${BC_SVG.close}</button></div>
    <div class="bc-lower"><span id="bc-pip-face" class="bc-face"></span><span class="bc-who"><b id="bc-pip-name"></b></span><span id="bc-pip-bars" class="bc-bars"></span></div></div>
    <div class="bc-pip-bar"><span id="bc-pip-title"></span><button id="bc-pip-prev" type="button" class="ib up" data-tip="이전 방송" aria-label="이전 방송">${BC_SVG.prev}</button><span id="bc-pip-index" class="num"></span><button id="bc-pip-next" type="button" class="ib up" data-tip="다음 방송" aria-label="다음 방송">${BC_SVG.next}</button></div>`
  stage.append(layer, pip)
  const $ = id => document.getElementById(id), canvas = $('broadcast-canvas'), pipCanvas = $('bc-pip-canvas')
  const dPos = new Map(), hits = new Map(), seenExpeditions = new Set()
  let world = null, channels = [], chosen = 'auto', view = 'home', filter = 'all', follow = true, pipChoice = null, pipDismissed = false, frame = null, lastDraw = 0, opener = null, feedSig = ''
  let replay = null, replayList = null, replayListAt = 0, replayToken = 0, seeking = false, sending = false
  const set = (id, value) => { const el = $(id); if (el.textContent !== value) el.textContent = value }

  const current = () => (chosen === 'auto' ? channels.find(c => c.kind !== 'rest') : channels.find(c => String(c.id) === chosen)) ?? channels[0] ?? null
  const onAir = () => channels.filter(c => c.kind !== 'rest')
  const pipChannel = () => onAir().find(c => c.id === pipChoice) ?? channels.find(c => c.kind === 'live') ?? null

  /* Drawing */
  const artHash = key => world?.rpg?.art?.[key] ?? null
  const floor = createFloorPainter({ portraits, colorOf: id => world?.residents.find(r => r.profileId === id)?.color ?? '#668578', loaded: () => request(), sprite: key => art && artHash(key) ? art.sprite(artHash(key)) : null })
  const { blank, dungeon } = floor
  const town = createTown({ village, floor, world: () => world })
  /** A live floor as a scene: tiles, what is known, entities and the explorers on it. */
  function liveScene(ch, now) {
    const zone = ch.zone, map = zone.map
    const step = world.rpg.settings?.stepMs ?? 1000
    const point = a => {
      const wk = dPos.get(a.id), at = a.expedition.position
      if (!wk || !world.running) return { x: at % map.width + .5, y: Math.floor(at / map.width) + .5, walking: false }
      const dt = Math.max(0, Math.min(1000, now - wk.t)); wk.t = now
      if (wk.queue.length) {
        // Stay about one snapshot (≈1.1 s) behind the game: slower when few tiles are queued, faster when many,
        // so the walk never stops between snapshots and never falls far behind.
        let left = 0, from = wk
        for (const q of wk.queue) { left += Math.hypot(q.x - from.x, q.y - from.y); from = q }
        let budget = dt / step * Math.max(.55, Math.min(3, left / Math.max(1, 1100 / step)))
        while (budget > 0 && wk.queue.length) {
          const q = wk.queue[0], d = Math.hypot(q.x - wk.x, q.y - wk.y)
          if (d <= budget) { wk.x = q.x; wk.y = q.y; budget -= d; wk.queue.shift() } else { wk.x += (q.x - wk.x) / d * budget; wk.y += (q.y - wk.y) / d * budget; budget = 0 }
        }
      }
      return { x: wk.x, y: wk.y, walking: wk.queue.length > 0 }
    }
    const crew = world.rpg.actors.filter(a => a.expedition?.zoneId === zone.id).map(a => {
      const hit = hits.get(a.id), age = hit ? now - hit.at : 1e9
      return { id: a.id, profileId: a.profileId, name: a.name, at: a.expedition.position, pos: point(a), phase: a.phase, encounterId: a.expedition.encounterId,
        hit: world.running && a.phase === 'combat' && age < 900 && (hit.dealt > 0 || hit.taken > 0 || hit.healed > 0) ? { age, dealt: hit.dealt, taken: hit.taken, healed: hit.healed, skill: hit.skill, skillName: hit.skillName } : null,
        say: world.running && hit?.say && age < 2600 ? hit.say : '', thinking: world.running && a.phase === 'combat' && !!a.expedition.awaiting && !(age < 900) }
    })
    return { key: zone.id, map, cleared: zone.cleared, seen: ch.actor.visible || map.explored, explored: map.explored, focusId: ch.actor.id, crew, moving: true,
      entities: map.entities.map(e => ({ id: e.id, at: e.at, kind: e.kind, boss: !!e.boss, done: !!e.done, hp: e.hp, max: e.monster?.hp })) }
  }
  function paint(target, ch, now, wide) {
    const rect = target.getBoundingClientRect(), w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height)), dpr = Math.min(2, window.devicePixelRatio || 1)
    if (target.width !== Math.round(w * dpr) || target.height !== Math.round(h * dpr)) { target.width = Math.round(w * dpr); target.height = Math.round(h * dpr) }
    const ctx = target.getContext('2d'); if (!ctx?.setTransform) return false
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (!ch) { blank(ctx, w, h, '방송할 주민이 없어'); return false }
    if (ch.kind === 'replay') return dungeon(ctx, w, h, replayScene(replay), now, wide)
    if (ch.kind === 'live' && ch.zone?.map) return dungeon(ctx, w, h, liveScene(ch, now), now, wide)
    if (ch.kind === 'life') return town(ctx, w, h, ch, wide)
    blank(ctx, w, h, ch.status); return false
  }
  const replayChannel = () => replay && { kind: 'replay', id: replay.data.actor.profileId, name: replay.data.actor.name, color: world?.residents.find(r => r.profileId === replay.data.actor.profileId)?.color ?? '#668578' }
  function loadReplays(force) {
    if (!server || (!force && Date.now() - replayListAt < 15_000)) return
    replayListAt = Date.now()
    Promise.resolve(server({ op: 'replays' })).then(list => { replayList = Array.isArray(list) ? list : []; if (!layer.hidden && view === 'home') renderHome() }).catch(() => { replayList ??= []; if (!layer.hidden && view === 'home') renderHome() })
  }
  async function openReplay(id) {
    if (!server) return
    const token = ++replayToken
    try {
      const data = await server({ op: 'replay', id })
      if (token !== replayToken) return
      replay = { id, data, t: 0, playing: true, speed: 2, clock: performance.now(), cache: null, shownAt: 0 }
      follow = true; open('watch')
    } catch (error) { toast(error.message) }
  }
  function setPlaying(on) {
    if (!replay) return
    if (on && replay.t >= replay.data.duration) replay.t = 0
    replay.playing = on; replay.clock = performance.now(); renderReplay(); request(); changed()
  }

  const watching = () => !layer.hidden && view === 'watch', listing = () => !layer.hidden && view === 'home'
  function loop(now) {
    frame = null
    if (document.hidden || (!watching() && !listing() && pip.hidden)) return
    let moving = false
    if (replay && watching()) {
      if (replay.playing) {
        replay.t = Math.min(replay.data.duration, replay.t + (now - replay.clock) * replay.speed)
        if (replay.t >= replay.data.duration) replay.playing = false
        if (now - replay.shownAt > 200 || !replay.playing) { replay.shownAt = now; renderReplay() }
      }
      replay.clock = now
    }
    if (now - lastDraw >= (watching() ? 30 : 64)) {
      lastDraw = now
      if (watching()) moving = paint(canvas, replay ? replayChannel() : current(), now, !follow) || moving
      // Thumbnails at the mini player's rate; cards scrolled out of view are skipped.
      if (listing()) for (const el of $('bc-grid').children) {
        const thumb = el.parts?.canvas, box = thumb?.getBoundingClientRect()
        if (box && box.bottom > 0 && box.top < innerHeight) moving = paint(thumb, el.parts.ch, now, false) || moving
      }
      if (!pip.hidden) moving = paint(pipCanvas, pipChannel(), now, false) || moving
    } else moving = true
    if (moving) frame = requestAnimationFrame(loop)
  }
  function request() { if (!frame && !document.hidden && typeof requestAnimationFrame === 'function' && (watching() || listing() || !pip.hidden)) frame = requestAnimationFrame(loop) }

  /* DOM */
  function faceNode(target, ch, ring) {
    const portrait = portraits()?.get?.(ch.id), key = `${ch.color}:${portrait?.url ?? ''}:${ring ?? ''}`
    if (target.dataset.key === key && target.dataset.id === String(ch.id)) return
    target.dataset.key = key; target.dataset.id = String(ch.id)
    target.style.setProperty('--resident-color', ch.color); target.style.setProperty('--ring', ring ?? 'transparent')
    target.replaceChildren(Object.assign(document.createElement('span'), { textContent: Array.from(ch.name.trim())[0] || '?' }))
    if (portrait?.url?.startsWith('blob:')) {
      const img = Object.assign(document.createElement('img'), { alt: '', src: portrait.url, draggable: false })
      if (portrait.crop) { const pos = `${portrait.crop.x}% ${portrait.crop.y}%`; img.style.objectPosition = pos; img.style.transformOrigin = pos; img.style.transform = `scale(${portrait.crop.scale})` }
      target.append(img)
    }
  }
  const ringOf = kind => kind === 'live' ? '#d93a40' : kind === 'life' ? '#3fae6a' : null
  function tag(id, ch) { const el = $(id); el.textContent = BC_TAG[ch?.kind] ?? ''; el.dataset.kind = ch?.kind ?? ''; el.hidden = !ch }
  function bars(target, ch) {
    target.replaceChildren()
    if (ch?.kind !== 'live') return
    for (const [name, value, max, kind] of [['HP', ch.actor.hp, ch.actor.stats.hp, 'hp'], ['MP', ch.actor.mp, ch.actor.stats.mp, 'mp']]) {
      const row = document.createElement('span'); row.className = `bc-bar ${kind}`; row.title = `${name} ${value}/${max}`
      const fill = document.createElement('i'); fill.style.width = `${Math.max(0, Math.min(100, value / max * 100))}%`
      const track = document.createElement('span'); track.append(fill)
      row.append(Object.assign(document.createElement('b'), { textContent: name }), track); target.append(row)
    }
  }
  const elapsed = ch => ch?.startedAt && world?.now ? bcClock(world.now - ch.startedAt) : ''
  function renderChat(ch) {
    const box = $('bc-feed'), lines = replay ? replayLines(replay) : ch ? chatLines(ch, world, feed) : [], key = replay ? `replay:${replay.id}` : String(ch?.id)
    const sig = `${key}:${lines.length}:${lines.at(-1)?.at ?? 0}:${lines.at(-1)?.text ?? ''}`
    if (sig === feedSig) return
    feedSig = sig
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 60
    box.replaceChildren(...lines.map(l => {
      const row = document.createElement('p'); row.className = l.sys ? `bc-sys ${l.kind}` : 'bc-say'
      if (l.sys) row.textContent = l.text
      else {
        const who = Object.assign(document.createElement('b'), { textContent: l.who }); if (l.viewer) { who.className = 'bc-viewer'; row.classList.add('mine') } else who.style.color = l.color; row.append(who)
        if (l.host) row.append(Object.assign(document.createElement('span'), { className: 'bc-host', textContent: '방송' }))
        else if (l.to) row.append(Object.assign(document.createElement('small'), { textContent: `→ ${l.to}` }))
        row.append(' ', ...(l.viewer ? [l.text] : speechNodes(l.text)))
      }
      return row
    }))
    if (!lines.length) box.append(Object.assign(document.createElement('p'), { className: 'bc-sys', textContent: replay ? '아직 기록이 없어.' : '아직 조용해.' }))
    if (near || box.dataset.channel !== key) box.scrollTop = box.scrollHeight
    box.dataset.channel = key
  }
  /*
   * One card per channel (list cards and the player's "other channels" row), kept across polls: rebuilding them every
   * second threw away the thumbnails' canvases and hover state. Thumbnails are painted by the loop, not here.
   */
  const cards = new Map(), empty = Object.assign(document.createElement('p'), { className: 'bc-empty' })
  function card(ch, compact) {
    const key = `${compact ? 'o' : 'c'}${ch.id}`
    let button = cards.get(key)
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.className = compact ? 'bc-other' : 'bc-card'; button.id = `${compact ? 'bc-other' : 'bc-card'}-${ch.id}`
      const face = Object.assign(document.createElement('span'), { className: 'bc-face' }), meta = document.createElement('span'), head = document.createElement('b'), sub = document.createElement('small')
      meta.className = 'bc-meta'; meta.append(head, sub)
      const parts = button.parts = { face, head, sub, ch }
      if (compact) {
        parts.label = document.createTextNode(''); parts.tag = Object.assign(document.createElement('i'), { className: 'bc-mini-tag' }); head.append(parts.label, parts.tag)
        button.append(face, meta)
      } else {
        const thumb = document.createElement('span'); thumb.className = 'bc-thumb'
        parts.canvas = document.createElement('canvas'); parts.canvas.setAttribute('aria-hidden', 'true')
        parts.tag = Object.assign(document.createElement('span'), { className: 'bc-tag' }); parts.time = Object.assign(document.createElement('span'), { className: 'bc-time num' })
        thumb.append(parts.canvas, parts.tag, parts.time)
        const row = document.createElement('span'); row.className = 'bc-card-row'; row.append(face, meta)
        button.append(thumb, row)
      }
      button.addEventListener('click', () => watch(ch.id))
      cards.set(key, button)
    }
    const p = button.parts
    p.ch = ch; button.dataset.kind = p.tag.dataset.kind = ch.kind
    const title = `${ch.name} · ${ch.status}`
    if (button.title !== title) button.title = title
    faceNode(p.face, ch, ringOf(ch.kind)); setText(p.tag, BC_TAG[ch.kind] ?? '')
    if (compact) { if (p.label.data !== ch.name) p.label.data = ch.name; setText(p.sub, ch.status) }
    else {
      setText(p.head, ch.title); setText(p.sub, title)
      p.time.hidden = !ch.startedAt; if (ch.startedAt) setText(p.time, elapsed(ch))
    }
    return button
  }
  function renderReplays() {
    const section = $('bc-replay-section'), box = $('bc-replays')
    section.hidden = !server || !(filter === 'all' || filter === 'replay')
    if (section.hidden) return
    const list = filter === 'replay' ? replayList ?? [] : (replayList ?? []).slice(0, 5), now = world?.now ?? Date.now()
    const sig = JSON.stringify([replayList === null, list.map(r => [r.id, r.title, r.name, r.floor, r.zone, r.outcome, bcAgo(now - r.endedAt), world?.residents.find(x => x.profileId === r.profileId)?.color])])
    if (box.dataset.sig === sig) return
    box.dataset.sig = sig
    box.replaceChildren(...list.map(r => {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'bc-replay-row'; row.id = `bc-replay-${r.id}`; row.dataset.outcome = r.outcome
      const faceEl = Object.assign(document.createElement('span'), { className: 'bc-face' })
      faceNode(faceEl, { id: r.profileId, name: r.name, color: world?.residents.find(x => x.profileId === r.profileId)?.color ?? '#668578' }, null)
      const meta = document.createElement('span'); meta.className = 'bc-meta'
      meta.append(Object.assign(document.createElement('b'), { textContent: r.title || `${r.floor}층 ${r.zone} 원정` }), Object.assign(document.createElement('small'), { textContent: `${r.name} · ${r.floor}층 ${r.zone} · ${bcClock(r.endedAt - r.startedAt)} · ${bcAgo((world?.now ?? Date.now()) - r.endedAt)}` }))
      row.append(faceEl, meta, Object.assign(document.createElement('span'), { className: 'bc-outcome', textContent: BC_OUTCOME[r.outcome] ?? r.outcome }))
      row.addEventListener('click', () => openReplay(r.id))
      return row
    }))
    if (!list.length) box.append(Object.assign(document.createElement('p'), { className: 'bc-empty', textContent: replayList === null ? '불러오는 중…' : '아직 다시보기가 없어. 원정이 끝나면 여기에 남아.' }))
  }
  function renderHome() {
    for (const b of layer.querySelectorAll('[data-filter]')) b.setAttribute('aria-selected', String(b.dataset.filter === filter))
    const shown = filter === 'replay' ? [] : onAir().filter(c => filter === 'all' || c.kind === filter), grid = $('bc-grid')
    grid.hidden = filter === 'replay'
    renderReplays()
    if (shown.length || filter === 'replay') place(grid, shown.map(ch => card(ch)))
    else { setText(empty, !channels.length ? '주민을 초대하면 방송이 시작돼.' : !world.running ? '마을이 잠들어 있어.' : '지금 이 방송은 없어.'); place(grid, [empty]) }
    const resting = channels.filter(c => c.kind === 'rest')
    set('bc-offline', resting.length ? `쉬는 중 · ${resting.map(c => `${c.name}(${c.status})`).join(', ')}` : '')
  }
  function renderReplay() {
    const d = replay.data, f = replayFrame(replay), ch = replayChannel(), z = d.zone
    tag('bc-tag', ch); set('bc-time', `${bcClock(replay.t)} / ${bcClock(d.duration)}`); $('bc-time').hidden = false
    faceNode($('bc-face'), ch, '#7f8fa6'); faceNode($('bc-chan-face'), ch, null)
    const phase = f?.[2] === 'home' ? BC_OUTCOME[d.outcome] ?? '귀환' : BC_PHASE[f?.[2]] ?? '던전 입장'
    set('bc-name', d.actor.name); set('bc-where', `던전 ${z.floor}층 · ${phase}`)
    const bar = $('bc-bars'); bar.replaceChildren()
    for (const [name, value, max, kind] of [['HP', f?.[3] ?? d.actor.maxHp, d.actor.maxHp, 'hp'], ['MP', f?.[4] ?? d.actor.maxMp, d.actor.maxMp, 'mp']]) {
      const row = document.createElement('span'); row.className = `bc-bar ${kind}`; row.title = `${name} ${value}/${max}`
      const fill = document.createElement('i'); fill.style.width = `${Math.max(0, Math.min(100, value / max * 100))}%`
      const track = document.createElement('span'); track.append(fill); row.append(Object.assign(document.createElement('b'), { textContent: name }), track); bar.append(row)
    }
    const goal = $('bc-goal'); goal.replaceChildren(); goal.hidden = false
    const progress = f && f[8] >= 0 ? f[8] : d.quest?.progress ?? 0
    goal.append(Object.assign(document.createElement('small'), { textContent: d.quest ? '길드 의뢰' : '원정' }), Object.assign(document.createElement('b'), { textContent: d.quest ? `${d.quest.title} ${progress}/${d.quest.count}${d.quest.type === 'explore' ? '%' : ''}` : `${z.floor}층 자유 탐험` }))
    if (d.quest) { const track = document.createElement('span'); track.className = 'bc-progress'; const fill = document.createElement('i'); fill.style.width = `${Math.min(100, progress / d.quest.count * 100)}%`; track.append(fill); goal.append(track) }
    const foe = $('bc-foe'), enemy = f && f[2] === 'combat' && f[5] >= 0 ? d.entities[f[5]] : null; foe.replaceChildren(); foe.hidden = !enemy
    if (enemy) { const track = document.createElement('span'); track.className = 'bc-progress foe'; const fill = document.createElement('i'); fill.style.width = `${Math.max(0, f[6] / (enemy.max || 1) * 100)}%`; track.append(fill); foe.append(Object.assign(document.createElement('b'), { textContent: enemy.name }), track) }
    set('bc-title', d.title || `${z.floor}층 ${z.name} 원정`)
    set('bc-chan-name', d.actor.name); set('bc-chan-sub', `${BC_OUTCOME[d.outcome] ?? ''} · 처치 ${d.kills} · ${new Date(d.startedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`)
    $('bc-replay-bar').hidden = false
    const play = $('bc-replay-play'); play.innerHTML = replay.playing ? BC_SVG.pause : BC_SVG.play; play.dataset.tip = replay.playing ? '일시정지' : '재생'; play.setAttribute('aria-label', play.dataset.tip)
    if (!seeking) $('bc-replay-seek').value = String(Math.round(replay.t / Math.max(1, d.duration) * 1000))
    set('bc-replay-time', `${bcClock(replay.t)} / ${bcClock(d.duration)}`)
    for (const b of $('bc-replay-speed').querySelectorAll('[data-speed]')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === replay.speed))
    canvas.setAttribute('aria-label', `${d.actor.name} 원정 다시보기`)
    renderChat(null)
  }
  function renderWatch() {
    $('bc-say').hidden = !!replay || !say
    if (replay) {
      renderReplay()
      $('broadcast-follow').setAttribute('aria-pressed', String(follow)); $('broadcast-camera').setAttribute('aria-pressed', String(!follow)); set('broadcast-camera', '층 전체')
      $('broadcast-inspect').hidden = !world?.rpg?.actors.some(a => a.profileId === replay.data.actor.profileId); $('broadcast-memory').hidden = !memory
      place($('bc-others'), onAir().slice(0, 5).map(c => card(c, true)))
      return
    }
    $('bc-replay-bar').hidden = true
    const ch = current()
    const input = $('bc-say-input'), canSay = !!ch && !!world?.running
    input.disabled = !canSay; $('bc-say-send').disabled = !canSay || sending
    input.placeholder = !world?.running ? '마을이 잠들어 있어' : ch ? `${ch.name}에게 한마디` : '한마디 남기기'
    tag('bc-tag', ch); set('bc-time', elapsed(ch)); $('bc-time').hidden = !ch?.startedAt
    if (ch) { faceNode($('bc-face'), ch, ringOf(ch.kind)); faceNode($('bc-chan-face'), ch, null) }
    set('bc-name', ch?.name ?? ''); set('bc-where', ch?.status ?? ''); bars($('bc-bars'), ch)
    const goal = $('bc-goal'); goal.replaceChildren(); goal.hidden = !ch || ch.kind === 'rest'
    if (ch?.kind === 'live') {
      goal.append(Object.assign(document.createElement('small'), { textContent: ch.quest ? '길드 의뢰' : '원정' }), Object.assign(document.createElement('b'), { textContent: ch.quest ? `${ch.quest.title} ${ch.quest.progress}/${ch.quest.count}${ch.quest.type === 'explore' ? '%' : ''}` : `${ch.zone.floor}층 자유 탐험` }))
      if (ch.quest) { const bar = document.createElement('span'); bar.className = 'bc-progress'; const fill = document.createElement('i'); fill.style.width = `${Math.min(100, ch.quest.progress / ch.quest.count * 100)}%`; bar.append(fill); goal.append(bar) }
    } else if (ch?.kind === 'life') goal.append(Object.assign(document.createElement('small'), { textContent: '오늘의 상황' }), Object.assign(document.createElement('b'), { textContent: (world.settings?.scene ?? '').split(/[.\n]/)[0].slice(0, 40) || '평범한 하루' }))
    const foe = $('bc-foe'), e = ch?.actor?.expedition; foe.replaceChildren(); foe.hidden = !(ch?.kind === 'live' && ch.actor.phase === 'combat' && e?.monster)
    if (!foe.hidden) {
      const bar = document.createElement('span'); bar.className = 'bc-progress foe'; const fill = document.createElement('i'); fill.style.width = `${Math.max(0, e.foeHp / e.monster.hp * 100)}%`; bar.append(fill)
      const boss = !!ch.zone.map?.entities?.find(x => x.id === e.encounterId)?.boss, picture = art && (artHash(`${boss ? 'boss' : 'monster'}:${ch.zone.id}`) ?? artHash(`monster:${ch.zone.id}`))
      const url = picture ? art.url(picture) : null
      if (url) foe.append(Object.assign(document.createElement('img'), { src: url, alt: '', className: 'bc-foe-art' }))
      foe.append(Object.assign(document.createElement('b'), { textContent: e.monster.name }), bar)
    }
    set('bc-title', ch?.title ?? '방송할 주민이 없어')
    set('bc-chan-name', ch?.name ?? ''); set('bc-chan-sub', ch?.actor ? `Lv.${ch.actor.level} ${BC_ROLE[ch.actor.role] ?? ch.actor.calling?.translation?.job ?? ch.actor.calling?.job ?? '신탁 전'} · ${ch.actor.rank} 랭크` : ch?.status ?? '')
    $('broadcast-follow').setAttribute('aria-pressed', String(follow)); $('broadcast-camera').setAttribute('aria-pressed', String(!follow))
    set('broadcast-camera', ch?.kind === 'live' ? '층 전체' : '마을 전체')
    $('broadcast-inspect').hidden = !ch?.actor; $('broadcast-memory').hidden = !memory || !ch
    const others = channels.filter(c => c !== ch).slice(0, 5)
    place($('bc-others'), others.map(c => card(c, true)))
    canvas.setAttribute('aria-label', ch ? `${ch.name} 방송 · ${ch.status}` : '방송 없음')
    renderChat(ch)
  }
  function renderPip() {
    const ch = pipChannel(), show = layer.hidden && !pipDismissed && !!ch
    if (pip.hidden !== !show) { pip.hidden = !show; changed() }
    if (!show) return
    tag('bc-pip-tag', ch); set('bc-pip-time', elapsed(ch)); $('bc-pip-time').hidden = !ch.startedAt
    faceNode($('bc-pip-face'), ch, ringOf(ch.kind)); set('bc-pip-name', `${ch.name} · ${ch.status}`); bars($('bc-pip-bars'), ch)
    set('bc-pip-title', ch.title); pipCanvas.setAttribute('aria-label', `${ch.name} 방송`)
    const list = onAir(); set('bc-pip-index', `${list.indexOf(ch) + 1}/${list.length}`)
    $('bc-pip-prev').disabled = $('bc-pip-next').disabled = list.length < 2
  }
  function render() {
    $('bc-home').hidden = view !== 'home'; $('bc-watch').hidden = view !== 'watch'
    $('bc-filters').hidden = view !== 'home'; $('broadcast-home').hidden = $('broadcast-mini').hidden = view !== 'watch'
    if (!layer.hidden) view === 'home' ? renderHome() : renderWatch()
    renderPip(); request()
  }

  function update(next) {
    world = next
    if (!world) return
    channels = buildChannels(world)
    const now = performance.now()
    let fresh = false
    for (const ch of channels) {
      const a = ch.actor
      if (ch.kind === 'live' && !seenExpeditions.has(a.expedition.id)) { seenExpeditions.add(a.expedition.id); fresh = true }
      if (!a?.expedition || !ch.zone?.map) continue
      const map = ch.zone.map, pos = a.expedition.position, cellAt = i => ({ x: i % map.width + .5, y: Math.floor(i / map.width) + .5 }), wk = dPos.get(a.id)
      if (!wk || wk.zoneId !== ch.zone.id || wk.expedition !== a.expedition.id) dPos.set(a.id, { ...cellAt(pos), last: pos, queue: [], t: now, zoneId: ch.zone.id, expedition: a.expedition.id })
      else if (wk.last !== pos) {
        const path = bcTilePath(map, wk.last, pos)
        if (path) wk.queue.push(...path.map(cellAt)); else Object.assign(wk, cellAt(pos), { queue: [] })
        wk.last = pos
      }
      const stamp = `${a.expedition.id}:${a.expedition.encounterId}:${a.expedition.round}`
      if (a.phase === 'combat' && a.expedition.last && hits.get(a.id)?.stamp !== stamp) hits.set(a.id, { stamp, at: now, dealt: a.expedition.last.dealt, taken: a.expedition.last.taken ?? 0, healed: a.expedition.last.healed ?? 0, skill: !!a.expedition.last.skill, skillName: a.expedition.last.skillName ?? '', say: a.expedition.last.displaySay ?? a.expedition.last.say ?? '' })
    }
    for (const id of dPos.keys()) if (!channels.some(c => c.actor?.id === id && c.actor.expedition)) dPos.delete(id)
    for (const key of cards.keys()) if (!channels.some(c => key.slice(1) === String(c.id))) cards.delete(key)
    if (fresh) pipDismissed = false
    render()
  }
  function open(next = 'home', profileId) {
    if (profileId !== undefined && profileId !== null && !channels.some(c => c.id === profileId)) throw new Error('방송할 주민을 확인해줘.')
    if (profileId !== undefined) chosen = profileId ? String(profileId) : 'auto'
    if (layer.hidden) opener = document.activeElement
    if (next === 'home' || profileId !== undefined) { replay = null; replayToken++ }
    if (next === 'home') loadReplays()
    view = next; layer.hidden = false; feedSig = ''
    render(); (view === 'home' ? layer.querySelector('[data-filter][aria-selected=true]') : $('broadcast-close'))?.focus({ preventScroll: true }); changed()
  }
  function watch(profileId) { follow = true; open('watch', profileId ?? null) }
  function close() {
    if (layer.hidden) return
    layer.hidden = true; replay = null; replayToken++; render()
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    changed()
  }
  const cycle = by => { const list = onAir(), at = list.indexOf(pipChannel()); if (list.length) { pipChoice = list[(at + by + list.length) % list.length].id; render(); changed() } }

  for (const b of layer.querySelectorAll('[data-filter]')) b.addEventListener('click', () => { filter = b.dataset.filter; if (filter === 'replay') loadReplays(true); render(); changed() })
  $('bc-replay-play').addEventListener('click', () => setPlaying(!replay?.playing))
  const seek = $('bc-replay-seek')
  seek.addEventListener('pointerdown', () => { seeking = true })
  seek.addEventListener('change', () => { seeking = false })
  seek.addEventListener('input', () => { if (!replay) return; replay.t = Number(seek.value) / 1000 * replay.data.duration; replay.clock = performance.now(); renderReplay(); request() })
  for (const b of $('bc-replay-speed').querySelectorAll('[data-speed]')) b.addEventListener('click', () => { if (!replay) return; replay.speed = Number(b.dataset.speed); renderReplay(); changed() })
  // No <form>: the host frame is sandboxed without allow-forms, so a submit never fires. Send on the button or Enter.
  async function sendSay() {
    const ch = current(), input = $('bc-say-input'), text = input.value.trim()
    if (!say || !ch || !text || sending || replay) return
    sending = true; $('bc-say-send').disabled = true
    try { await say(ch.id, text); input.value = '' } catch (error) { toast(error.message) } finally { sending = false; if (!layer.hidden) render() }
  }
  $('bc-say-send').addEventListener('click', sendSay)
  // Enter while a Korean syllable is still composing only finishes it; the next Enter sends.
  $('bc-say-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendSay() } })
  $('broadcast-home').addEventListener('click', () => open('home'))
  $('broadcast-mini').addEventListener('click', () => { pipChoice = current()?.id ?? null; pipDismissed = false; close() })
  $('broadcast-close').addEventListener('click', close); layer.querySelector('.dim').addEventListener('click', close)
  $('broadcast-follow').addEventListener('click', () => { follow = true; render(); changed() })
  $('broadcast-camera').addEventListener('click', () => { follow = false; render(); changed() })
  const shownChannel = () => replay ? replayChannel() : current()
  $('broadcast-inspect').addEventListener('click', () => { const ch = shownChannel(); if (ch && world?.rpg?.actors.some(a => a.profileId === ch.id)) { close(); inspect(ch.id) } })
  $('broadcast-memory').addEventListener('click', () => { const ch = shownChannel(); if (ch && memory) { close(); memory(ch.id, ch.name) } })
  $('bc-pip-expand').addEventListener('click', () => { const ch = pipChannel(); if (ch) watch(ch.id) })
  $('bc-pip-close').addEventListener('click', () => { pipDismissed = true; pipChoice = null; render(); changed() })
  $('bc-pip-prev').addEventListener('click', () => cycle(-1)); $('bc-pip-next').addEventListener('click', () => cycle(1))
  pipCanvas.addEventListener('click', () => { const ch = pipChannel(); if (ch) watch(ch.id) })
  document.addEventListener('keydown', event => {
    if (layer.hidden) return
    if (event.key === 'Escape') { event.stopPropagation(); close() }
    if (event.key === 'Tab') {
      const controls = [...layer.querySelectorAll('button,input,select,textarea')].filter(e => !e.disabled && e.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
  })
  document.addEventListener('visibilitychange', () => { if (document.hidden && frame) { cancelAnimationFrame(frame); frame = null } else render() })
  if (typeof ResizeObserver !== 'undefined') { const resize = new ResizeObserver(request); resize.observe(canvas); resize.observe(pipCanvas) }

  return {
    update, open, watch, close, openReplay,
    isOpen: () => !layer.hidden,
    liveCount: () => channels.filter(c => c.kind === 'live').length,
    snapshot() {
      const ch = replay ? replayChannel() : current()
      return {
        open: !layer.hidden, view, profileId: ch?.id ?? null, kind: ch?.kind ?? null, mode: chosen === 'auto' ? 'auto' : 'selected',
        follow, zoneId: ch?.zone?.id ?? null, filter, pip: pip.hidden ? null : pipChannel()?.id ?? null,
        replay: replay ? { id: replay.id, profileId: replay.data.actor.profileId, t: Math.round(replay.t), duration: replay.data.duration, playing: replay.playing, speed: replay.speed } : null,
        channels: channels.map(c => ({ profileId: c.id, name: c.name, kind: c.kind, status: c.status, title: c.title })),
      }
    },
  }
}
