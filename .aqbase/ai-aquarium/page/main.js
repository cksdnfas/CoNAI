import { connectPlugin } from '../conai-plugin.js'
import { createScene } from './village/scene.js'
import { createPortrait } from './ui/portrait.js'
import { createAlbum } from './village/album.js'
import { createMemoryView } from './village/memory-view.js'
import { createRpgView } from './guild/guild.js'
import { DEFAULT_SETTINGS } from '../shared/village-settings.mjs'
import { safeDecisionText } from '../shared/decision-log.mjs'
import { installTips } from './ui/tip.js'
import { installHold } from './ui/hold.js'
import { createQuickMenu } from './village/quick-menu.js'
import { createParty } from './village/party.js'
import { createChat } from './village/chat.js'
import { createFaces } from './village/faces.js'
import { createSettingsMenu } from './village/settings-menu.js'
import { createSetupView } from './village/setup.js'
import { createDmView } from './village/dm.js'
import { createLifeView } from './village/life.js'
import { createResearchView } from './village/research.js'
import { createResidentView, requestText, routeText, backoff, listOf } from './village/resident.js'

const $ = id => document.getElementById(id)
installTips(); installHold()
const FEED_LIMIT = 150
/** Page state the village parts share; each part keeps its own view state. */
const app = {
  api: null, world: null, profiles: [], selected: null, working: false, feed: [], dirty: false,
  draft: { profileIds: [], residentInstructions: [], ...DEFAULT_SETTINGS, scene: '' },
}
let cursor = 0, toastTimer = null, transient = ''
// Floor maps the page already holds; the server leaves out a map whose hash is unchanged.
const mapCache = new Map()
const knownMaps = () => Object.fromEntries([...mapCache].map(([id, m]) => [id, m.hash]))
const faces = new Map() // profileId -> { key, url, crop }
const lifeTry = fn => { try { quick.close(); fn() } catch (error) { toast(error.message) } }
const painter = createScene($('stage'), $('village'), id => selectResident(id), place => openPlace(place), v => { $('zoom-out').disabled = v.min; $('zoom-fit').disabled = v.min; $('zoom-in').disabled = v.max },
  { sprite: key => rpgView.sprite?.(key) ?? null, onBuilding: id => lifeTry(() => lifeView.openBuilding(id)), onNpc: id => lifeTry(() => lifeView.openNpc(id)) })
for (const [id, step] of [['zoom-in', 1], ['zoom-out', -1], ['zoom-fit', 0]]) $(id).addEventListener('click', () => painter.zoom?.(step))
const album = createAlbum({ toast: message => toast(message) })
const memoryView = createMemoryView({ toast: message => toast(message), publish: () => publish(), onOpen: () => { settingsMenu.close(); rpgView.close?.(); quick.close(); lifeView.close() } })
const rpgView = createRpgView({ request: (op, args) => request(op, args), toast: message => toast(message), publish: () => publish(),
  openMenu: next => settingsMenu.open(next), memory: (id, name) => memoryView.open(id, name), village: () => painter.view?.() ?? null, portraits: () => faces, portrait: createPortrait, feed: () => app.feed })
// Life operations use the same server request as every other action; a quote only reads, so it never replaces the view.
const lifeView = createLifeView({ app, request: (op, args) => request(op, args), query: (op, args) => app.api ? exclusive(() => app.api.server({ op, ...args }), true) : Promise.reject(new Error('CoNAI에서 플러그인을 열어줘.')),
  toast: message => toast(message), publish: () => publish(), painter, art: { url: key => rpgView.artUrl?.(key) ?? null }, onOpen: () => { closeOthers(); dmView.close() }, openGuild: tab => rpgView.open?.(tab) })
const researchView = createResearchView({ app, request: (op, args) => request(op, args), toast: message => toast(message), publish: () => publish(), onOpen: () => { closeOthers(); dmView.close() } })
const residentView = createResidentView({ app, request: (op, args) => request(op, args), toast: message => toast(message), publish: () => publish(), faces,
  onOpen: () => { settingsMenu.close(); rpgView.close?.(); quick.close(); lifeView.close(); researchView.close(); dmView.close() } })
// 생활 중심 화면 hides the dungeon's HUD only; the save's dungeon settings, gear and records are not touched.
let display = { value: 'adventure', revision: null }
function setDisplay(value) {
  display.value = value === 'life' ? 'life' : 'adventure'
  document.body.dataset.display = display.value
  for (const b of $('display').querySelectorAll('[data-display]')) b.setAttribute('aria-pressed', String(b.dataset.display === display.value))
}
for (const b of $('display').querySelectorAll('[data-display]')) b.addEventListener('click', handle(async () => {
  const before = display.value; setDisplay(b.dataset.display); renderHud(); publish()
  if (!app.api?.storage) return
  try { display.revision = (await app.api.storage.set('display', display.value, display.revision)).revision ?? null }
  catch (error) { setDisplay(before); renderHud(); publish(); throw error }
}))

// A tapped-away village error stays hidden until a different one replaces it.
let dismissed = null
function showToast() { const message = transient || (app.world?.error !== dismissed && app.world?.error) || ''; $('toast').textContent = message; $('toast').hidden = !message }
function toast(text, sticky = false) {
  clearTimeout(toastTimer); transient = text
  toastTimer = text && !sticky ? setTimeout(() => { transient = ''; showToast() }, 6000) : null
  showToast()
}

function selectResident(id, anchor = null) {
  if (!app.world?.residents.some(r => r.profileId === id)) throw new Error('마을에 없는 주민이야.')
  app.selected = app.selected === id ? null : id; quick.from(anchor ? 'list' : 'map')
  painter.select(app.selected); rpgView.select(app.selected); party.render(); quick.render(); publish()
}
function openPlace(place) {
  quick.close()
  if (place === 'guild') rpgView.open?.('quests')
  else if (place === 'shop') rpgView.open?.('shop')
  else rpgView.open?.('live')
}

const quick = createQuickMenu({ app, painter, rpgView, memoryView, renderParty: () => party.render(), publish, openLife: id => lifeTry(() => lifeView.open('resident', { profileId: id })), openStatus: id => lifeTry(() => residentView.open(id)) })

/**
 * The autonomous-resident part of the page state: what each resident is doing and why, kept to what a decision needs.
 * Lists are capped so the page data stays far below the host's size limit.
 */
function agentData() {
  const w = app.world, requests = w.pendingRequests ?? []
  const brief = q => { const t = requestText(w, q); return { id: q.id, from: q.from, to: q.to, action: q.action?.id ?? null, status: q.status, statusLabel: t.status, expiresAt: q.expiresAt ?? null, title: t.title, detail: t.detail, reason: t.reason } }
  const pending = requests.filter(q => q.status === 'pending')
  return {
    memoryBacklogged: !!w.memoryBacklogged,
    relationships: (w.relationships ?? []).slice(0, 120).map(x => ({ a: x.a, b: x.b, affinity: x.affinity, label: x.label })), relationshipCount: w.relationships?.length ?? 0,
    requests: { pending: pending.slice(0, 20).map(brief), pendingCount: pending.length, recent: requests.filter(q => q.status !== 'pending').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)).slice(0, 5).map(brief) },
    conversations: (w.conversations ?? []).map(c => ({ id: c.id, participants: c.participants, speaker: c.speaker, turn: c.turn, maxTurns: c.maxTurns, thinking: c.thinking, lastLines: c.lines.slice(-2).map(l => ({ name: l.name, text: safeDecisionText(String(l.text ?? '').slice(0, 300)) })) })),
    agentSettings: settingsMenu.agents.snapshot(),
    residentWindow: residentView.snapshot(),
  }
}
function publish() {
  if (!app.api || !app.world) return
  const { statusDefs, actionCatalog, deciders, conversationMaxTurns, maxConversations, ...settings } = app.world.settings // the agent part is in agentSettings
  app.api.publish({ revision: `${app.world.revision}:${app.world.rpg?.configRevision ?? 0}:${app.world.rpg?.revision ?? 0}:${memoryView.revision}`, dirty: app.dirty || rpgView.dirty || memoryView.dirty || lifeView.dirty || researchView.dirty || residentView.dirty || settingsMenu.agents.dirty, data: {
    running: app.world.running, canRun: app.world.canRun, repliesToday: app.world.today, saveSlot: app.world.save ? { id: app.world.save.id, name: app.world.save.name } : null, settings, selectedProfileId: app.selected,
    residents: app.world.residents.map(r => ({ profileId: r.profileId, name: r.name, destination: r.destination, activity: r.activity, instructions: r.instructions ?? '',
      goal: safeDecisionText(r.goal), statuses: listOf(r.statuses), profileStatusIds: (r.statusDefs ?? []).filter(d => d.readonly).map(d => ({ id: d.id, name: d.name, kind: d.kind, min: d.min, max: d.max, values: d.values, valueReadonly: !!d.valueReadonly })),
      decider: { village: routeText(r.agentRoutes?.village), rpg: routeText(r.agentRoutes?.rpg) }, judgePreset: r.judge?.presetName ?? null, engine: r.profileEngine ?? null,
      decisionLog: (r.decisionLog ?? []).slice(0, 5).map(({ options, ...entry }) => ({ ...entry, offeredCount: options?.length ?? entry.offeredCount ?? 0 })),
      agentError: r.agentError ?? null, combatError: r.combatError ?? null, retryInSeconds: backoff(app.world, r) ? Math.ceil((r.agentReadyAt - app.world.now) / 1000) : 0 })),
    ...agentData(),
    availableProfiles: app.profiles.slice(0, 60).map(p => ({ id: p.id, name: p.name })), availableProfileCount: app.profiles.length,
    draft: app.dirty ? app.draft : null, recentFeed: app.feed.slice(-5).map(e => safeDecisionText(e.kind === 'say' ? `${e.name} → ${e.recipient}: ${e.text}`.slice(0, 600) : e.text)),
    rpg: rpgView.snapshot(),
    life: lifeView.snapshot(),
    research: researchView.snapshot(),
    display: display.value,
    lore: memoryView.snapshot(),
    gm: dmView.snapshot(),
    error: app.world.error, note: '마을은 페이지를 닫아도 서버에서 움직여. 생활·구매·장비·근무·수면·출발과 받은 요청에 지금 답할지는 village, 전투·탐사는 combat, 대화·방송·신탁은 social 호출 규칙을 써. 새 슬롯은 세 줄 모두 시간당·하루 무제한(null/빈 값)이며 일상 기본 간격은 20초야. 저장된 한도는 유지하고 0은 호출 중지야. unlimitedHour/unlimitedDay로 한도를 지울 수 있어. 구형 전투 off/boss도 모든 차례 모델 판단으로 이관하고 설정·AI 행동의 일회성 안내에서 한도를 확인해. 요청 답변과 다른 일상 선택지를 함께 제시하며 요청 만료는 유지해. 수면·휴식 종료 조건도 모델이 선택하고 조건 변화는 자동 기상이 아닌 새 판단을 요청해. 자기 프로필의 모델만 사용하고 호출을 기다릴 때는 행동을 대신하지 않아. 전투 대기 중 몬스터와 다른 주민은 계속 행동해. decisionLog는 최근 5개 요약이고 전체 선택지는 주민 상태 창에서 봐. prepare와 resident_prepare는 초안만 준비하며 사람이 적용해. 슬롯 변경·삭제와 요청 취소도 사람이 버튼으로 해.',
  } })
}

/* HUD */
function renderHud() {
  document.body.dataset.running = String(!!app.world?.running)
  document.body.dataset.rpg = String(!!app.world?.rpg?.settings.enabled)
  $('save-title').textContent = app.world?.save?.name ?? '햇살 마을'
  // The wake switch says what state the village is in; the tip says what pressing it does.
  const toggle = $('toggle'), running = !!app.world?.running
  toggle.dataset.running = String(running)
  $('toggle-label').textContent = running ? '깨어 있음' : '잠든 마을'
  toggle.dataset.tip = running ? '눌러서 재우기' : '눌러서 깨우기'; toggle.setAttribute('aria-label', running ? '마을 재우기' : '마을 깨우기')
  toggle.disabled = !app.api || !app.world || app.working || (!running && (!app.world.canRun || !app.world.residents.length))
  const live = rpgView.liveCount?.() ?? 0, badge = $('live-count')
  badge.hidden = !live; badge.textContent = `LIVE ${live}`
  $('open-guild').hidden = !app.world?.rpg?.settings.enabled || display.value === 'life'
  if (display.value === 'life') badge.hidden = true
  $('open-life').hidden = !app.world?.rpg?.life
  const flag = $('memory-flag'), backlog = !!app.world?.memoryBacklogged
  if (flag.hidden === backlog) flag.hidden = !backlog
  flag.dataset.tip = app.world?.memoryError || '기억 정리가 밀려 새 AI 대화·판단을 잠시 쉬고 있어. 이동·식사·휴식·생산은 계속돼.'
  const center = $('center'), menuOpen = !$('menu').hidden
  if (!app.world || menuOpen || running) { center.hidden = true; return }
  center.hidden = false
  // First steps: make the world with a DM, invite residents, wake the village. The world step can be skipped.
  const made = !!app.world.setup?.appliedAt, invited = app.world.residents.length > 0
  const states = { world: made ? 'done' : invited ? 'todo' : 'now', invite: invited ? 'done' : made ? 'now' : 'todo', wake: invited ? 'now' : 'todo' }
  for (const li of $('center-steps').children) li.dataset.state = states[li.dataset.step]
  $('center-save').textContent = app.world.save?.name ?? ''
  const action = $('center-action')
  if (!invited && !made) { $('center-title').textContent = '어떤 세계에서 시작할까?'; action.textContent = 'GM과 세계 만들기'; action.hidden = false; action.disabled = false; action.onclick = () => dmView.open() }
  else if (!invited) { $('center-title').textContent = '어떤 이웃을 만나게 될까?'; action.textContent = '+ 주민 초대하기'; action.hidden = false; action.disabled = false; action.onclick = () => settingsMenu.open('residents') }
  else if (app.world.canRun) { $('center-title').textContent = '마을이 잠들어 있어'; action.textContent = '마을 깨우기'; action.hidden = false; action.onclick = handle(start); action.disabled = app.working }
  else { $('center-title').textContent = '플러그인을 켠 관리자 계정에서만 마을을 깨울 수 있어'; action.hidden = true }
}
function tickClock() {
  const d = new Date(), c = app.world?.clock
  $('clock').textContent = c ? `${c.label} · ${c.day}일째` : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const party = createParty({ app, faces, selectResident, openMenu: next => settingsMenu.open(next) })
const chat = createChat({ app, painter, memoryView, selectResident, openResident: id => lifeTry(() => residentView.open(id)), cancelRequest: q => residentView.cancelRequest(q) })
const faceLoader = createFaces({ app, faces, onLoad: () => { party.invalidate(); party.render(); painter.setPortraits(faces); if (!$('menu').hidden) settingsMenu.render() } })
const settingsMenu = createSettingsMenu({ app, faces, rpgView, loadFace: profile => faceLoader.load(profile), closeQuick: () => quick.close(), renderHud, publish, toast, request, handle, openSetup: () => dmView.open() })
const closeOthers = () => { settingsMenu.close(); rpgView.close?.(); quick.close(); lifeView.close(); researchView.close(); residentView.close() }
/** Whose book a profileId opens: 0 the world, a resident, or the DM (the negative of its profile id). */
const bookName = id => {
  if (id === 0) return '세계관'
  const r = app.world.residents.find(r => r.profileId === id), dm = app.world.setup?.dm
  if (r) return r.name
  if (dm && id === -dm.id) return `${dm.name} (GM)`
  throw new Error('마을에 없는 주민이야.')
}
const setupView = createSetupView({ app, faces, request, toast, handle, loadFace: profile => faceLoader.load(profile), openArt: openGameArt, onOpen: () => { closeOthers(); dmView.close(); artSetupButton.hidden = true }, onLive: () => dmView.open() })
function openGameArt() {
  dmView.close(); setupView.close(); rpgView.open('settings')
  requestAnimationFrame(() => { $('rpg-art-section')?.scrollIntoView({ block: 'center' }); $('rpg-art-service')?.querySelector('button')?.focus({ preventScroll: true }) })
}
const dmView = createDmView({ app, faces, request, toast, handle, openSetup: () => setupView.open(), pickDm: () => setupView.open(true), openLore: () => memoryView.open(0, '세계관', 'lore'), openMemory: (id, name) => memoryView.open(id, name), openArt: openGameArt, onOpen: () => { closeOthers(); artSetupButton.hidden = true } })
const artSetupButton = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: '게임 그림 설정이 필요해', hidden: true })
artSetupButton.addEventListener('click', openGameArt)
$('corner').append(artSetupButton)
// The broadcast mini player joins the corner column between the zoom and the DM, so the three never overlap.
if ($('bc-pip')) $('corner').insertBefore($('bc-pip'), $('dm-call')) // page tests replace the broadcast with a stub
$('toast').addEventListener('click', () => { if (transient) toast(''); else { dismissed = app.world?.error ?? null; showToast() } })

/* Server */
const slotToken = world => world?.save ? `${world.save.id}:${world.save.createdAt}` : ''
function accept(next) {
  for (const notice of document.querySelectorAll('[data-combat-migration-notice]'))
    notice.hidden = !next.rpg?.combatMigrationNotice || next.rpg.combatMigrationNotice.dismissed
  // Another save slot (or this one started over): what the page held belongs to the old village.
  const switched = !!app.world && slotToken(app.world) !== slotToken(next)
  if (switched) {
    app.feed = []; cursor = 0; mapCache.clear(); app.selected = null; app.dirty = false
    if (rpgView.settingsDirty) rpgView.resetSettings?.()
    lifeView.reset(); researchView.reset(); residentView.reset()
  }
  const changed = switched || app.world?.revision !== next.revision
  // A known floor comes back as its live parts only (enemies, explored tiles); the geometry is the cached one.
  for (const z of next.rpg?.zones ?? []) {
    const known = mapCache.get(z.id)
    if (z.map && z.mapLive) z.map = known?.hash === z.mapHash ? { ...known.map, ...z.map } : null
    else if (z.map) mapCache.set(z.id, { hash: z.mapHash, map: z.map })
    if (!z.map) { z.map = undefined; mapCache.delete(z.id) }
  }
  // A memory pass failure is news, not a state: say it once and let the memory window keep the details.
  if (next.memoryError && next.memoryError !== app.world?.memoryError) toast(next.memoryError)
  app.world = next
  if (switched) settingsMenu.agents.reset() // the AI behaviour draft belonged to the old slot
  tickClock()
  rpgView.update(app.world, app.profiles)
  if (app.selected && !app.world.residents.some(r => r.profileId === app.selected)) app.selected = null
  for (const entry of next.logs) if (entry.id > cursor) { app.feed.push(entry); cursor = entry.id }
  if (app.feed.length > FEED_LIMIT) app.feed = app.feed.slice(-FEED_LIMIT)
  if (next.logs.length || switched) chat.render()
  if (changed) settingsMenu.resetDraft()
  if (switched) {
    for (const r of next.residents) faceLoader.load(app.profiles.find(p => p.id === r.profileId))
    // A switch made elsewhere arrived with this page's old cursor and maps: read the new village whole.
    void request('state', {}, true).catch(() => {})
  }
  party.render(); renderHud(); painter.update(app.world, app.selected); lifeView.update(); researchView.update(); residentView.update(); settingsMenu.agents.update(); chat.renderTalks(); album.update(app.world.gallery); quick.render(); setupView.update(app.world); dmView.update(app.world)
  const artSetup = app.world.rpg?.dm.art?.setup
  artSetupButton.hidden = !artSetup || !app.world.rpg.dm.art.needed || dmView.isOpen || setupView.isOpen
  artSetupButton.title = artSetup || ''
  showToast()
  if (changed || next.logs.length) publish()
}
// Server calls run one at a time; a user action queues behind the 1s poll however slow the server is.
// Only user actions mark the page busy: a poll that disabled the buttons made them blink every second, and the
// settings menu (its portraits are rebuilt on render) is redrawn by a poll only when the village changed.
let queue = Promise.resolve()
function exclusive(run, quiet = false) {
  const next = queue.then(async () => {
    if (quiet) { const before = app.world?.revision; const result = await run(); if (!$('menu').hidden && app.world?.revision !== before) settingsMenu.render(); return result }
    app.working = true; renderHud()
    try { return await run() } finally { app.working = false; renderHud(); if (!$('menu').hidden) settingsMenu.render(); setupView.render(); dmView.render() }
  })
  queue = next.catch(() => {})
  return next
}
async function request(op, extra = {}, quiet = false) {
  if (!app.api) throw new Error('CoNAI에서 플러그인을 열어줘.')
  return exclusive(async () => { const next = await app.api.server({ op, after: cursor, maps: knownMaps(), ...extra }); if (op !== 'resident-decisions') accept(next); return next }, quiet)
}
async function refresh() {
  if (app.working) return
  await exclusive(async () => {
    app.profiles = await app.api.server({ op: 'profiles' }); faceLoader.prune()
    accept(await app.api.server({ op: 'state', after: cursor, maps: knownMaps() }))
    for (const r of app.world.residents) faceLoader.load(app.profiles.find(p => p.id === r.profileId))
    painter.setPortraits(faces); publish()
  })
}
async function start() { await request('start') }
async function pause() { await request('pause') }
function handle(fn) { return async event => { event?.preventDefault?.(); try { await fn() } catch (error) { toast(error.message) } } }
$('toggle').addEventListener('click', handle(() => app.world?.running ? pause() : start()))
$('open-setup').addEventListener('click', () => dmView.open())
$('open-guild').addEventListener('click', () => { quick.close(); dmView.close(); lifeView.close(); rpgView.open?.('quests') })
$('open-life').addEventListener('click', () => lifeTry(() => lifeView.open(app.selected ? 'resident' : undefined, app.selected && app.world.rpg.actors.some(a => a.profileId === app.selected) ? { profileId: app.selected } : {})))
$('open-research').addEventListener('click', () => researchView.open())
for (const id of ['open-saves', 'center-saves']) $(id).addEventListener('click', () => settingsMenu.open('saves'))
$('world-lore').addEventListener('click', handle(async () => { settingsMenu.close(); await memoryView.open(0, '세계관', 'lore') }))


// The village runs on the server. The page only watches while it is visible.
setInterval(async () => {
  if (!app.api || app.working || document.hidden || !app.world) return
  try { await request('state', {}, true) } catch { /* The next poll retries; actions report their own errors. */ }
}, 1000)
document.addEventListener('visibilitychange', () => { if (!document.hidden && app.api) void handle(refresh)() })
window.addEventListener('pagehide', () => { for (const face of faces.values()) if (face.url) URL.revokeObjectURL(face.url); faces.clear() })
tickClock(); setInterval(tickClock, 10_000); chat.render()

if (window.parent === window) {
  toast('독립 미리보기야. CoNAI에 설치하고 AI 어항 페이지를 열어줘.', true)
} else {
  try {
    app.api = await connectPlugin({ 'ai-aquarium.refresh': refresh, 'ai-aquarium.select': args => selectResident(args.profileId), 'ai-aquarium.prepare': args => settingsMenu.prepare(args), 'ai-aquarium.resident_prepare': args => residentView.prepare(args), 'ai-aquarium.pause': pause,
      'ai-aquarium.gm_open': async () => { await dmView.open(); return dmView.snapshot() },
      'ai-aquarium.gm_prepare': args => dmView.prepare(args.text),
      'ai-aquarium.lore_open': args => memoryView.open(args.profileId, bookName(args.profileId), args.tab ?? 'lore', args.query ?? '', args.offset ?? 0),
      'ai-aquarium.lore_prepare': args => memoryView.prepare(args, bookName(args.profileId)),
      'ai-aquarium.watch': args => rpgView.watch(args.profileId || null), 'ai-aquarium.rpg_open': args => rpgView.open(args.tab ?? 'live', args.zoneId), 'ai-aquarium.commission': args => rpgView.prepareQuest(args), 'ai-aquarium.rpg_prepare': args => rpgView.prepareSettings(args), 'ai-aquarium.commission_cancel': args => rpgView.prepareCancel(args),
      'ai-aquarium.life_open': args => lifeView.open(args.tab, Object.fromEntries(['profileId', 'npcId', 'buildingId'].filter(k => args[k] !== undefined).map(k => [k, args[k]]))),
      'ai-aquarium.life_prepare': args => lifeView.prepare(args),
      'ai-aquarium.research_open': () => { researchView.open(); return researchView.snapshot() },
      'ai-aquarium.research_prepare': args => researchView.prepare(args) })
    album.connect(app.api); memoryView.connect(app.api); rpgView.connect(app.api)
    if (typeof app.api.server !== 'function') throw new Error('서버 플러그인을 지원하는 CoNAI 버전이 필요해.')
    if (app.api.storage) { const saved = await app.api.storage.get('display'); display.revision = saved?.revision ?? null; setDisplay(saved?.value) }
    await refresh()
  } catch (error) { toast(error.message, true) }
}
