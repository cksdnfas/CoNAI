import { createBroadcast } from '../broadcast/broadcast.js'
import { createFloorPainter } from '../ui/floor-paint.js'
import { createArtCache } from '../ui/art-cache.js'
import { NO_DRAW } from '../ui/draw-picker.js'
import { node, svgIcon, svg } from '../ui/dom.js'
import { briefActor, TABS, GUILD_TABS, P, parseTool, closed } from './common.js'
import { createParts } from './parts.js'
import { createActors } from './actors.js'
import { createQuests } from './quests.js'
import { createShop } from './shop.js'
import { createZones } from './zones.js'
import { createSettings } from './settings.js'

export function createRpgView({ request, toast, publish, openMenu = null, memory = null, village = () => null, portraits = () => null, portrait = null, feed = () => [] }) {
  const stage = document.getElementById('stage')
  const layer = document.createElement('div'); layer.id = 'rpg'; layer.className = 'menu-layer rpg-layer'; layer.hidden = true
  const MODES = [['guild', '길드가 아는 곳', P.map], ['actor', '고른 모험가 시야', P.eye], ['all', '전체 지도', P.globe]]
  layer.innerHTML = `<div class="dim"></div><section class="menu gw rpg-panel" role="dialog" aria-modal="true" aria-labelledby="rpg-heading">
    <header class="gw-head"><span class="gw-icon">${svg(P.guild)}</span><h2 id="rpg-heading">모험가 길드</h2><nav id="rpg-navigation" class="gw-tabs" role="tablist" aria-label="길드"></nav>
      <span class="grow"></span><span id="rpg-status" class="gw-status"></span><button type="button" id="rpg-close" class="ib" data-tip="닫기" aria-label="닫기">${svg(P.close)}</button></header>
    <div id="rpg-error-row" class="gw-error" hidden><p id="rpg-error" role="status"></p><button type="button" id="rpg-retry" class="btn">AI 재시도</button></div>
    <div id="rpg-quests" class="rpg-tab" hidden>
      <div class="rq-main"><div class="rq-bar"><div id="rpg-quest-filter" class="gw-seg" role="tablist" aria-label="의뢰 보기"></div><span class="grow"></span><button type="button" id="rpg-new-quest" class="btn main" data-tip="새 의뢰" aria-expanded="false">${svg(P.plus)}의뢰하기</button></div><div id="rpg-board" class="rq-board"></div></div>
      <aside id="rpg-commission" class="rq-compose" hidden aria-label="새 의뢰"><div class="rq-compose-head"><b>새 의뢰</b><button type="button" id="rpg-commission-close" class="ib" data-tip="접기" aria-label="접기">${svg(P.close)}</button></div>
        <div id="rpg-quest-type" class="rq-types" role="radiogroup" aria-label="의뢰 종류"></div>
        <input id="rpg-quest-title" maxlength="80" placeholder="의뢰 이름" aria-label="의뢰 이름">
        <div class="rq-row"><select id="rpg-quest-zone" aria-label="던전 층"></select><div class="rpg-num"><button type="button" data-qcount="-1" aria-label="목표 줄이기">−</button><input id="rpg-quest-count" type="number" min="1" max="20" value="3" aria-label="목표"><button type="button" data-qcount="1" aria-label="목표 늘리기">+</button></div><span id="rpg-count-label" class="rq-unit"></span></div>
        <textarea id="rpg-quest-note" rows="3" maxlength="500" placeholder="모험가에게 한마디" aria-label="내용"></textarea>
        <div class="rq-foot"><span id="rpg-reward" class="rq-reward num"></span><button type="button" id="rpg-submit" class="btn main">등록</button></div></aside></div>
    <div id="rpg-zones" class="rpg-tab" hidden><nav id="rpg-zone-list" class="rz-floors" aria-label="던전 층"></nav>
      <div class="rz-stage"><canvas id="rpg-map" role="img" aria-label="던전 지도"></canvas>
        <div class="rz-top"><div class="rz-title"><b id="rpg-map-title"></b><small id="rpg-map-info"></small></div><span class="grow"></span>
          <div id="rpg-map-mode" class="gw-seg icons" role="group" aria-label="시야">${MODES.map(([mode, label, path]) => `<button type="button" data-mode="${mode}" data-tip="${label}" aria-label="${label}" aria-pressed="${mode === 'guild'}">${svg(path)}</button>`).join('')}</div></div>
        <p id="rpg-map-empty" class="rz-empty" hidden></p><div id="rpg-map-actors" class="rz-crew"></div><div id="rpg-map-hover" class="rz-hover" hidden></div></div>
      <aside class="rz-side"><div id="rpg-zone-stats" class="rz-stats"></div><div id="rpg-zone-cast" class="rz-cast"></div><figure id="rpg-zone-preview" class="rz-art" hidden><img id="rpg-zone-image" alt=""></figure><h4>소식</h4><div id="rpg-map-log" class="rz-log"></div></aside></div>
    <div id="rpg-shop" class="rpg-tab" hidden></div>
    <div id="rpg-actors" class="rpg-tab" hidden><nav id="rpg-roster" aria-label="모험가 목록"></nav><div id="rpg-character"></div></div></section>`
  stage.append(layer)
  const $ = id => document.getElementById(id)
  for (const id of GUILD_TABS) { const b = node('button', TABS[id]); b.type = 'button'; b.dataset.rpgTab = id; b.id = `rpg-nav-${id}`; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', `rpg-${id}`); $('rpg-navigation').append(b) }

  /** View state the guild pages share; each page keeps its own drawing state. */
  const guild = {
    world: undefined, profiles: [], api: undefined, tab: 'quests', detailTab: 'status', selected: null, selectedItem: null, selectedFloor: null,
    configRevision: null, settingsDirty: false, questDirty: false, busy: false, questRequest: null, cancelTarget: null, imageSerial: 0,
    questFilter: 'current', questType: 'hunt', mapMode: 'guild', hoverTile: -1, artDraft: { ...NO_DRAW }, changed: () => {},
  }
  let signature = '', opener = null
  const settings = createSettings({ guild, layer, face: (...args) => parts.face(...args), status: () => status(), publish, request, toast, openMenu, close })
  // Game pictures the DM designed (monsters, guardians, items, potions, skills): one cache for the guild, its map and the broadcast.
  let artPending = 0
  const art = createArtCache({
    open: async hash => {
      const id = parseTool(await guild.api.app.call('get_media_download', { composite_hashes: [hash] })).items?.[0]?.artifact?.artifact_id
      if (!id) throw new Error('그림을 열 수 없어.')
      return (await guild.api.media.open(id)).url
    },
    // Pictures arrive one by one: redraw once per burst, not per picture.
    changed: () => { if (!artPending) artPending = setTimeout(() => { artPending = 0; if (!layer.hidden) render(); zoneView.drawMap() }, 60) },
  })
  const artHash = key => guild.api ? guild.world?.rpg?.art?.[key] ?? null : null
  const artUrl = key => artHash(key) ? art.url(artHash(key)) : null
  /** The game picture for `key` as an <img>, or the old glyph while there is none. */
  const glyph = (key, path) => { const url = artUrl(key); return url ? Object.assign(document.createElement('img'), { src: url, alt: '', className: 'rpg-art', draggable: false }) : svgIcon(path) }
  const monsterKey = (zoneId, boss) => boss && artHash(`boss:${zoneId}`) ? `boss:${zoneId}` : `monster:${zoneId}`
  const broadcast = createBroadcast(stage, { inspect: profileId => { guild.selected = profileId; guild.detailTab = 'status'; open('actors') }, memory, village, portraits, feed, changed: () => publish(),
    server: body => guild.api?.server ? guild.api.server(body) : Promise.reject(new Error('CoNAI에서 플러그인을 열어줘.')), say: (profileId, text) => request('viewer-say', { profileId, text }), toast, art })
  const floor = createFloorPainter({ portraits, colorOf: id => guild.world?.residents?.find(r => r.profileId === id)?.color ?? '#668578', loaded: () => zoneView.drawMap(), sprite: key => artHash(key) ? art.sprite(artHash(key)) : null })
  const parts = createParts({ guild, glyph, portrait, portraits, watchActor })
  const status = () => {
    if (!guild.world?.rpg) return
    const r = guild.world.rpg, state = !r.settings.enabled ? ['off', '자율 모험 꺼짐'] : !guild.world.running ? ['off', '마을이 자는 중']
      : r.aiPaused ? ['wait', 'AI 연결 대기']
      : r.thinking?.kind === 'dm' ? ['busy', 'GM이 다음 층 설계 중'] : r.thinking?.kind === 'judgement' ? ['busy', '탐험 판단 중']
      : r.thinking?.kind === 'oracle' ? ['busy', '신탁 내리는 중'] : r.thinking?.kind === 'life' ? ['busy', 'GM이 마을 생활 판단 중']
      : r.thinking?.kind === 'life-decision' ? ['busy', '주민 생활 결정 중'] : r.thinking ? ['busy', '원정 준비 중']
      : r.aiFailures > 0 ? ['wait', 'AI 재시도 대기'] : ['on', '모험 진행 중']
    const pill = $('rpg-status'); pill.dataset.state = state[0]; if (pill.textContent !== state[1]) pill.textContent = state[1]
    pill.dataset.tip = `GM 오늘 ${r.dm.used}/${r.settings.dmDailyLimit}회${r.dm.art?.on ? ` · 그림 오늘 ${r.dm.art.today}/${r.dm.art.limit}장${r.dm.waitingAssets ? `, 그리는 중 ${r.dm.waitingAssets}` : ''}` : ''}`
    $('rpg-error').textContent = [r.error, r.error && r.budgetText, r.error && `시도 ${r.attempts ?? 0} · 쉬는 작업 ${(r.operationWaits ?? []).map(w => `${w.kind} ${w.count}회 실패`).join(', ') || '없음'} (다른 활동은 계속)`].filter(Boolean).join(' · '); $('rpg-error-row').hidden = !r.error
    $('rpg-retry').disabled = guild.busy || !!r.thinking
    $('rpg-submit').disabled = guild.busy
    for (const control of [...settings.settingsControls(), ...document.querySelectorAll('.rq-compose input, .rq-compose select, .rq-compose textarea, .rq-compose [data-qcount], .rq-types button')]) control.disabled = guild.busy
  }
  const run = fn => async () => { if (guild.busy) return; guild.busy = true; status(); try { await fn() } catch (error) { toast(error.message) } finally { guild.busy = false; render(); publish() } }
  const renderActors = createActors({ guild, parts, glyph, artUrl, monsterKey, open, render, publish, watchActor })
  const quests = createQuests({ guild, layer, parts, open, run, request, publish })
  const renderShop = createShop({ guild, glyph, itemIcon: parts.itemIcon })
  const zoneView = createZones({ guild, layer, parts, floor, glyph, monsterKey, publish })
  function render() {
    if (!guild.world?.rpg || layer.hidden) return
    const focused = layer.contains(document.activeElement) ? document.activeElement.id : null
    const scrolls = ['rpg-character', 'rpg-detail-body', 'rpg-roster', 'rpg-board', 'rpg-zone-list', 'rpg-shop'].map(id => [id, $(id)?.scrollTop ?? 0])
    for (const button of layer.querySelectorAll('[data-rpg-tab]')) { button.setAttribute('aria-selected', String(button.dataset.rpgTab === guild.tab)); button.setAttribute('aria-current', button.dataset.rpgTab === guild.tab ? 'page' : 'false') }
    for (const name of GUILD_TABS) $(`rpg-${name}`).hidden = name !== guild.tab
    $('rpg-new-quest').hidden = quests.composing()
    if (guild.tab === 'actors') renderActors()
    if (guild.tab === 'quests') quests.renderQuests()
    if (guild.tab === 'zones') zoneView.renderZones()
    if (guild.tab === 'shop') renderShop()
    for (const [id, top] of scrolls) if ($(id)) $(id).scrollTop = top
    if (focused && document.activeElement.id !== focused) document.getElementById(focused)?.focus({ preventScroll: true })
    status()
  }
  function open(next = 'live', zoneId) {
    if (!Object.hasOwn(TABS, next)) throw new Error('길드 화면을 확인해줘.')
    if (zoneId !== undefined) { if (!guild.world?.rpg.zones.some(z => z.id === zoneId)) throw new Error('던전 층을 확인해줘.'); guild.selectedFloor = zoneId }
    if (next === 'live') { close(); guild.tab = 'live'; broadcast.open('home'); publish(); return }
    if (next === 'settings') { close(); guild.tab = 'settings'; if (!guild.settingsDirty) settings.resetSettings(); openMenu?.('adventure'); publish(); return }
    broadcast.close()
    if (layer.hidden) opener = document.activeElement
    guild.tab = next; layer.hidden = false; render()
    $(`rpg-nav-${next}`).focus({ preventScroll: true }); publish()
  }
  function watchActor(profileId) {
    if (profileId && !guild.world?.residents.some(r => r.profileId === profileId)) throw new Error('관전할 봇을 확인해줘.')
    guild.selected = profileId ?? guild.selected; close(); guild.tab = 'live'; broadcast.watch(profileId || null); publish()
  }
  function close() { if (layer.hidden) return; layer.hidden = true; ++guild.imageSerial; $('rpg-map-hover').hidden = true; if (opener?.isConnected) opener.focus({ preventScroll: true }); publish() }
  $('rpg-retry').addEventListener('click', run(async () => { await request('rpg-retry') }))
  $('rpg-close').addEventListener('click', close); layer.querySelector('.dim').addEventListener('click', close)
  document.addEventListener('keydown', event => {
    if (layer.hidden) return
    if (event.key === 'Escape') close()
    if (event.key === 'Tab') {
      const controls = [...layer.querySelectorAll('button,input,select,textarea,summary')].filter(e => !e.disabled && e.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
  })
  for (const button of layer.querySelectorAll('[data-rpg-tab]')) button.addEventListener('click', () => open(button.dataset.rpgTab))
  document.getElementById('open-rpg')?.addEventListener('click', () => open('live'))
  return {
    connect(next) { guild.api = next },
    /** The shared game-picture cache for the village map and the life window: a ready canvas / blob URL, or null. */
    sprite: key => artHash(key) ? art.sprite(artHash(key)) : null,
    artUrl,
    update(next, list) {
      guild.world = next; guild.profiles = list
      broadcast.update(guild.world)
      if (!guild.world.rpg) return
      if (!guild.settingsDirty && guild.configRevision !== guild.world.rpg.configRevision) settings.resetSettings()
      const sig = JSON.stringify([guild.world.running, guild.world.rpg.actors, guild.world.rpg.quests, guild.world.rpg.zones, guild.world.rpg.thinking, guild.world.rpg.error, guild.world.rpg.dm, guild.world.rpg.shop?.available, guild.world.rpg.shop?.guildAvailable, guild.world.rpg.actors.some(a => a.phase === 'dead') ? Math.floor(guild.world.now / 1000) : null])
      if (sig !== signature) { signature = sig; render() } else status()
    },
    select(profileId) { if (guild.selected !== profileId) guild.selectedItem = null; guild.selected = profileId; if (!layer.hidden && guild.tab === 'actors') renderActors() },
    open,
    close() { close(); broadcast.close() },
    watch: watchActor,
    inspect(profileId) { if (guild.selected !== profileId) guild.selectedItem = null; guild.selected = profileId; guild.detailTab = 'status'; open('actors') },
    showSettings() { if (!guild.settingsDirty) settings.resetSettings() },
    saveSettings: settings.saveSettings,
    resetSettings() { settings.resetSettings(); publish() },
    onSettingsChange(fn) { guild.changed = fn },
    get settingsDirty() { return guild.settingsDirty },
    liveCount: () => broadcast.liveCount(),
    prepareSettings: settings.prepareSettings,
    prepareQuest: quests.prepareQuest,
    prepareCancel(args) {
      if (!guild.world?.rpg?.quests.some(q => q.id === args.questId && q.source === 'user' && q.status === 'open')) throw new Error('모집 중인 사용자 의뢰를 골라줘.')
      guild.cancelTarget = args.questId; guild.questFilter = 'current'; open('quests'); publish()
    },
    snapshot() {
      const settingsOpen = !$('menu')?.hidden && settings.settingPages.some(page => page.parentElement && !page.parentElement.hidden)
      const view = broadcast.isOpen() ? 'live' : !layer.hidden ? guild.tab : settingsOpen ? 'settings' : null
      return guild.world?.rpg ? {
        open: view !== null, tab: view, detailTab: guild.detailTab, broadcast: broadcast.snapshot(), questFilter: guild.questFilter,
        enabled: guild.world.rpg.settings.enabled, settings: guild.world.rpg.settings, settingsDraft: guild.settingsDirty ? settings.settingsDraft() : null,
        actors: guild.world.rpg.actors.map(a => ({
          profileId: a.profileId, name: a.name, level: a.level, rank: a.rank, role: a.role,
          calling: a.calling ? { job: a.calling.job, skills: a.calling.skills.map(k => k.name) } : null, phase: a.phase, hp: a.hp, gold: a.gold,
        })),
        selectedActor: briefActor(guild.world.rpg.actors.find(a => a.profileId === guild.selected)), selectedFloor: guild.selectedFloor, map: zoneView.mapSnapshot(), mapView: guild.mapMode,
        zones: guild.world.rpg.zones.map(z => ({ ...z.summary, unlocked: z.unlocked })), cancelQuestId: guild.cancelTarget,
        quests: guild.world.rpg.quests.filter(q => !closed(q)), shop: guild.world.rpg.shop ?? null,
        questDraft: guild.questDirty
          ? { type: guild.questType, title: $('rpg-quest-title').value, zoneId: $('rpg-quest-zone').value, count: Number($('rpg-quest-count').value), note: $('rpg-quest-note').value }
          : null,
        error: guild.world.rpg.error,
      }
        : guild.world ? { open: broadcast.isOpen(), tab: broadcast.isOpen() ? 'live' : null, broadcast: broadcast.snapshot(), enabled: false } : null
    },
    get dirty() { return guild.settingsDirty || guild.questDirty },
  }
}
