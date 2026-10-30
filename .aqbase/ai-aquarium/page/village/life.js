import { LIFE_ACTIONS, LIFE_INPUT, FACILITIES, RECIPES } from '../../shared/life.mjs'
import { OFFERING } from '../../shared/schedule.mjs'
import { tileAt } from '../../shared/tiles.mjs'
import { svgIcon, svg, setOptions } from '../ui/dom.js'
import { P, NPC_ROLE, CONSTRUCTION_STATE, PHASE, POTION_ICON } from '../guild/common.js'

/*
 * The life window: a resident's goods, the rule-based NPCs' finite stock, the facilities and their services, and
 * construction. Every change goes through the server's `life-action` with a request ID that stays the same while the
 * same operation is retried, so a lost answer never pays twice. A quote (`life-quote`) only reads. What the assistant
 * prepares waits in the bar at the top until a person presses 실행.
 */
const TABS = { resident: '주민 생활', market: '상점·NPC', facility: '시설', works: '공사·공공' }
const ACTION = { buy: '구매', sell: '판매', use: '사용', store: '보관', take: '꺼내기', produce: '제작', work: '근무', deliver: '납품', place: '설치', construct: '공사 신청', 'cancel-construction': '공사 취소', donate: '기부', 'temple-donate': '신전 발전 헌금', service: '이용' }
const SERVICE = { production: '제작', rest: '휴식', storage: '보관', shop: '물약·장비 상점', quests: '길드 의뢰' }
const CATEGORY = { material: '자재', consume: '소비', tool: '도구', place: '가구' }
const ITEM_ICON = { material: P.crate, consume: POTION_ICON, tool: P.pen, place: 'M6 11V5h12v6M5 11h14v3H5zM7 14v6M17 14v6' }
const FACILITY_ROLE = { guild: '모험가 길드', merchant: '잡화점', inn: '여관', tea: '찻집', home: '주택', oracle: '신전', library: '서가', workshop: '공방', warehouse: '창고' }
const FUNDING = { private: '개인 자금', public: '공공 자금' }
const DIRECTION = { east: '동쪽', south: '남쪽' }
const ACTIVE = new Set(['reserved', 'approved', 'building'])
const IN_TOWN = new Set(['town', 'rest'])
const FIELDS = Object.keys(LIFE_INPUT.properties).filter(k => k !== 'requestId')
const HOUSE = 'M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5'
const MAX_EXPANSIONS = 3

export function createLifeView({ app, request, query, toast, publish, painter, art, onOpen, openGuild = () => {} }) {
  const stage = document.getElementById('stage')
  const layer = document.createElement('div'); layer.id = 'life'; layer.className = 'menu-layer life-layer'; layer.hidden = true
  layer.innerHTML = `<div class="dim"></div><section class="menu gw life-panel" role="dialog" aria-modal="true" aria-labelledby="life-heading">
    <header class="gw-head"><span class="gw-icon">${svg(HOUSE)}</span><h2 id="life-heading">마을 생활</h2><nav id="life-tabs" class="gw-tabs" role="tablist" aria-label="생활"></nav>
      <span class="grow"></span><span id="life-status" class="gw-status"></span><button type="button" id="life-close" class="ib" data-tip="닫기" aria-label="닫기">${svg(P.close)}</button></header>
    <div id="life-draft" class="life-draft" role="region" aria-label="준비된 생활 작업" hidden></div>
    <div id="life-bar" class="life-bar"></div><div id="life-body" class="life-body"></div></section>`
  const banner = document.createElement('div'); banner.id = 'life-pick'; banner.className = 'hud surf life-pick'; banner.hidden = true
  banner.innerHTML = '<span id="life-pick-text"></span><button type="button" id="life-pick-cancel" class="btn">취소</button>'
  stage.append(layer, banner)
  const $ = id => document.getElementById(id)
  for (const [id, label] of Object.entries(TABS)) {
    const b = document.createElement('button'); b.type = 'button'; b.id = `life-nav-${id}`; b.textContent = label; b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'life-body')
    b.addEventListener('click', () => { ui.tab = id; render(); publish() }); $('life-tabs').append(b)
  }

  const newForm = () => ({ kind: 'workshop', buildingId: null, funding: 'private', x: null, y: null, direction: 'east' })
  const ui = { tab: 'resident', actorId: null, npcId: null, buildingId: null, quantity: 1, partnerId: '', storeId: '', amount: 10, busy: false, draft: null, form: newForm() }
  const retries = new Map() // operation fingerprint -> request ID, kept until the server confirms that operation
  let signature = '', opener = null, deferred = false

  const life = () => app.world?.rpg?.life ?? null
  const actors = () => app.world?.rpg?.actors ?? []
  const actor = () => actors().find(a => a.id === ui.actorId) ?? null
  const itemOf = id => life()?.catalog.items.find(i => i.id === id) ?? null
  const itemName = id => itemOf(id)?.name ?? id
  const npcOf = id => life()?.npcs.find(n => n.id === id) ?? null
  const buildingOf = id => life()?.buildings.find(b => b.id === id) ?? null
  const who = id => actors().find(a => a.id === id)?.name ?? npcOf(id)?.name ?? '떠난 주민'
  const goods = bag => Object.entries(bag ?? {}).map(([id, n]) => `${itemName(id)} ${n}`).join(' · ') || '없음'
  /** How many of `id` a bag holds, counting the GM's named variants made from that template. */
  const holding = (bag, id) => (life()?.catalog.items ?? []).filter(d => d.id === id || d.templateId === id).reduce((n, d) => n + (bag?.[d.id] ?? 0), 0)
  const newId = () => `life:${crypto.randomUUID()}`
  const fingerprint = input => JSON.stringify(FIELDS.map(k => input[k] ?? null))
  const inTown = a => !!a && IN_TOWN.has(a.phase)
  const built = role => !!life()?.buildings.some(b => b.role === role)
  /**
   * Temple development donations: `total` only grows, `reviewedTotal` is what the GM's last development judgement saw
   * (a snapshot taken when that judgement started, so later gifts stay waiting). The treasury is what is left to spend.
   */
  function judgement() {
    const l = life(), r = app.world.rpg, d = l.donations ?? { total: 0, reviewedTotal: 0 }, waiting = Math.max(0, d.total - d.reviewedTotal)
    const reviewing = l.constructions.some(c => c.status === 'reserved')
    const [state, text] = !waiting ? ['clear', d.total ? 'GM이 지금까지의 헌금을 모두 살펴봤어.' : '아직 발전 헌금이 없어.']
      : !r.settings.dmProfileId ? ['no-gm', 'GM 프로필이 없어 판단이 미뤄져. 길드 설정에서 GM을 골라줘.']
        : !(r.settings.dmDailyLimit > 0) ? ['no-budget', 'GM 하루 한도가 0이라 판단하지 않아.']
          : r.thinking?.kind === 'life' && !reviewing ? ['judging', 'GM이 마을 발전을 판단하는 중이야. 판단이 시작된 뒤 낸 헌금은 다음 판단에 들어가.']
            : reviewing ? ['queued', 'GM이 대기 중인 공사 심사를 먼저 해. 그 뒤에 헌금을 판단해.']
              : ['waiting', 'GM 판단 대기 · 마을이 깨어 있을 때 하루 한 번까지 살펴봐.']
    return { total: d.total, reviewedTotal: d.reviewedTotal, waiting, state, text }
  }

  /* Elements: text is always a text node, never markup. */
  const h = (tag, cls, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; e.append(...kids.filter(k => k !== null && k !== undefined && k !== false)); return e }
  const btn = (label, run, { main = false, disabled = false, tip = '', id = '', pressed } = {}) => {
    const b = h('button', main ? 'btn main' : 'btn', label); b.type = 'button'; if (id) b.id = id
    b.disabled = disabled || ui.busy; if (tip) b.dataset.tip = tip
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed))
    b.addEventListener('click', run); return b
  }
  const icon = item => { const url = item?.artKey ? art.url(item.artKey) : null; return h('span', 'life-ic', url ? Object.assign(document.createElement('img'), { src: url, alt: '', draggable: false }) : svgIcon(ITEM_ICON[item?.category] ?? P.crate)) }
  const fact = (label, value) => h('div', 'life-fact', h('small', '', label), h('b', 'num', String(value)))
  const empty = text => h('p', 'gw-empty', text)
  const section = (title, ...kids) => h('section', 'life-sec', h('h4', '', title), ...kids)
  /** One life action from a person's click: sent at once, with the retry identity of the same operation. */
  const act = (action, fields, label, extra = {}) => btn(label, () => perform({ action, actorId: ui.actorId, ...fields }, label), { disabled: !inTown(actor()), tip: inTown(actor()) ? '' : '마을에 돌아온 주민만 할 수 있어.', ...extra })

  async function perform(input, label) {
    if (ui.busy) return
    const key = fingerprint(input), requestId = ui.draft?.key === key ? ui.draft.requestId : retries.get(key) ?? newId()
    retries.set(key, requestId)
    if (retries.size > 40) retries.delete(retries.keys().next().value)
    ui.busy = true; render()
    try {
      const next = await request('life-action', { ...input, requestId, saveId: app.world?.save?.id })
      retries.delete(key); if (ui.draft?.key === key) ui.draft = null
      toast(next?.lifeResult?.repeated ? `${label}: 이미 처리된 요청이야.` : `${label} 완료`)
    } catch (error) { toast(error.message) } finally { ui.busy = false; signature = ''; render(); publish() }
  }
  /** What waits for a person's 실행: the exact input, its request ID and, for construction, the server's quote. */
  function setDraft(input, quote = null) {
    const key = fingerprint(input)
    ui.draft = { input, key, quote, requestId: retries.get(key) ?? newId(), label: describe(input) }
    retries.set(ui.draft.key, ui.draft.requestId)
  }
  function describe(input) {
    const name = who(input.actorId), what = ACTION[input.action]
    if (input.action === 'construct') return `${name} · ${input.buildingId ? `${buildingOf(input.buildingId)?.name ?? '시설'} 증축` : input.kind === 'expansion' ? `${DIRECTION[input.direction] ?? ''} 인접 구역 개방` : `${FACILITIES[input.kind]?.name ?? '시설'} 신축 (${input.x}, ${input.y})`} · ${FUNDING[input.funding ?? 'private']}`
    const bits = [input.itemId && `${itemName(input.itemId)} ×${input.quantity ?? 1}`, input.npcId && npcOf(input.npcId)?.name, input.buildingId && buildingOf(input.buildingId)?.name,
      input.recipeId && RECIPES.find(r => r.id === input.recipeId)?.name, input.amount && `${input.amount}G`, input.x !== undefined && `(${input.x}, ${input.y})`].filter(Boolean)
    return `${name} · ${what}${bits.length ? ` · ${bits.join(' · ')}` : ''}`
  }
  const constructInput = () => {
    const f = ui.form, input = { action: 'construct', actorId: ui.actorId, kind: f.kind, funding: f.funding }
    if (f.kind === 'expansion') input.direction = f.direction
    else if (f.buildingId) input.buildingId = f.buildingId
    else { input.x = f.x; input.y = f.y }
    return input
  }
  async function quote(input = constructInput()) {
    if (!input.actorId) throw new Error('공사를 신청할 주민을 골라줘.')
    if (input.kind !== 'expansion' && !input.buildingId && (!Number.isInteger(input.x) || !Number.isInteger(input.y))) throw new Error('부지를 지도에서 고르거나 좌표를 써줘.')
    ui.busy = true; render()
    try { const answer = await query('life-quote', { ...input, saveId: app.world?.save?.id }); setDraft(input, answer.quote) } finally { ui.busy = false; render(); publish() }
  }
  const tryQuote = async () => { try { await quote() } catch (error) { toast(error.message) } }

  /* Site picking on the map: the window steps aside, a footprint follows the pointer, the server's quote decides. */
  function pick(w, h, text, done) {
    if (!painter.pick) return
    const m = life().map
    // The same bounds the server checks (facilities keep a row below for the door); the quote has the final say.
    const building = w > 1, valid = (x, y) => {
      if (x < 1 || y < 1 || x > m.width - w - 1 || y > m.height - h - (building ? 2 : 1)) return false
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!['.', ','].includes(tileAt(m, xx, yy))) return false
      return true
    }
    layer.hidden = true; banner.hidden = false; $('life-pick-text').textContent = text
    painter.pick({ w, h, valid }, at => { banner.hidden = true; layer.hidden = false; if (at) done(at); render(); $('life-close').focus({ preventScroll: true }) })
  }
  $('life-pick-cancel').addEventListener('click', () => painter.cancelPick?.())
  const pickSite = () => { const d = FACILITIES[ui.form.kind]; pick(d.w, d.h, `${d.name} 부지(${d.w}×${d.h})를 지도에서 눌러줘 · 풀밭만 · Esc 취소`, at => { ui.form.x = at.x; ui.form.y = at.y; void tryQuote() }) }
  const pickPlace = itemId => pick(1, 1, `${itemName(itemId)}을(를) 둘 풀밭 한 칸을 눌러줘 · Esc 취소`, at => { setDraft({ action: 'place', actorId: ui.actorId, itemId, quantity: 1, x: at.x, y: at.y }); publish() })

  /* Rendering */
  const pct = (v, max) => max > 0 ? Math.floor(Math.max(0, Math.min(1, v / max)) * 100) : 0
  function toolbar() {
    const list = actors(), select = h('select', 'life-select'); select.id = 'life-actor'; select.setAttribute('aria-label', '행동할 주민')
    setOptions(select, list.map(a => [a.id, `${a.name}${inTown(a) ? '' : ` · ${PHASE[a.phase] ?? a.phase}`}`])); select.value = ui.actorId ?? ''
    select.disabled = ui.busy
    select.addEventListener('change', () => { ui.actorId = select.value; ui.draft = null; render(); publish() })
    const qty = h('input', 'life-num num'); Object.assign(qty, { id: 'life-quantity', type: 'number', min: 1, max: 99, value: String(ui.quantity) }); qty.setAttribute('aria-label', '수량')
    qty.addEventListener('change', () => { ui.quantity = Math.max(1, Math.min(99, Math.round(Number(qty.value)) || 1)); qty.value = String(ui.quantity); render() })
    const a = actor()
    $('life-bar').replaceChildren(h('label', 'life-who', '누가', select), a ? h('span', 'life-gold num', svgIcon(P.coin), `${a.gold}G`) : null, h('label', 'life-who', '수량', qty))
  }
  function renderResident() {
    const a = actor(), l = life()
    if (!a) return [empty('길드에 등록된 주민이 없어. 주민을 초대하고 마을을 깨워줘.')]
    const traders = l.npcs.filter(n => n.role !== 'builder' && n.open), partner = traders.find(n => n.id === ui.partnerId) ?? traders[0] ?? null
    const partnerSel = h('select', 'life-select'); partnerSel.id = 'life-partner'; partnerSel.setAttribute('aria-label', '팔 상대')
    setOptions(partnerSel, traders.length ? traders.map(n => [n.id, `${n.name} · ${n.gold}G`]) : [['', '영업 중인 상대 없음']]); partnerSel.value = partner?.id ?? ''
    partnerSel.addEventListener('change', () => { ui.partnerId = partnerSel.value; render() })
    const warehouses = l.buildings.filter(b => b.role === 'warehouse'), storeSel = h('select', 'life-select'); storeSel.id = 'life-store'; storeSel.setAttribute('aria-label', '보관할 곳')
    setOptions(storeSel, [['', '기본 보관함 · 물품당 99개'], ...warehouses.map(b => [b.id, `${b.name} ${b.level}단계 · 물품당 ${99 + b.level * 200}개 · 1G`])]); storeSel.value = ui.storeId
    storeSel.addEventListener('change', () => { ui.storeId = storeSel.value; render() })
    const quests = l.deliveryQuests.filter(q => q.status === 'open')
    const row = (id, n, stored) => {
      const d = itemOf(id), q = Math.min(ui.quantity, n), acts = h('span', 'life-acts')
      if (stored) acts.append(act('take', { itemId: id, quantity: q }, `꺼내기 ${q}`))
      else {
        if (d?.capabilities.includes('consume') && d.effect === 'restore') acts.append(act('use', { itemId: id, quantity: q }, `사용 ${q}`, { tip: `HP +${q * 8} · MP +${q * 4}` }))
        if (partner && d) acts.append(act('sell', { npcId: partner.id, itemId: id, quantity: q }, `팔기 ${Math.max(1, Math.floor(d.price / 2)) * q}G`))
        acts.append(act('store', { itemId: id, quantity: q, ...(ui.storeId ? { buildingId: ui.storeId } : {}) }, `보관 ${q}`))
        if (d?.capabilities.includes('material')) acts.append(act('donate', { itemId: id, quantity: q }, `공공 기부 ${q}`))
        for (const quest of quests.filter(x => x.itemId === id || x.itemId === d?.templateId)) { const k = Math.min(q, quest.count - quest.progress); acts.append(act('deliver', { questId: quest.id, itemId: id, quantity: k }, `납품 ${k} · +${k * quest.price}G`, { tip: quest.title })) }
        if (d?.capabilities.includes('place')) acts.append(btn('설치…', () => pickPlace(id), { disabled: !inTown(a), tip: '지도에서 풀밭 한 칸을 골라' }))
      }
      return h('div', 'life-row', icon(d), h('span', 'life-name', h('b', '', d?.name ?? id), h('small', '', d ? `${CATEGORY[d.category] ?? d.category} · ${d.price}G${d.description ? ` · ${d.description}` : ''}` : '')), h('span', 'life-qty num', `×${n}`), acts)
    }
    const bag = Object.entries(a.stacks ?? {}), stored = Object.entries(a.storedStacks ?? {})
    const jobs = l.production.filter(j => j.actorId === a.id).map(j => h('div', 'life-row', icon(itemOf(j.output.itemId)), h('span', 'life-name', h('b', '', j.npcId ? `${npcOf(j.npcId)?.name ?? '고용주'} 밑에서 근무 · +${j.wage}G` : RECIPES.find(r => r.id === j.recipeId)?.name ?? '제작'), h('small', '', `${buildingOf(j.buildingId)?.name ?? ''} · ${itemName(j.output.itemId)} ${j.output.quantity}`)), h('span', 'life-qty num', `${pct(j.progress, j.seconds)}%`)))
    const amount = h('input', 'life-num num'); Object.assign(amount, { id: 'life-amount', type: 'number', min: 1, max: 10000, value: String(ui.amount) }); amount.setAttribute('aria-label', '기부할 골드')
    amount.addEventListener('change', () => { ui.amount = Math.max(1, Math.min(10000, Math.round(Number(amount.value)) || 1)); amount.value = String(ui.amount); render() })
    return [
      h('div', 'life-facts', fact('위치', PHASE[a.phase] ?? a.phase), fact('골드', `${a.gold}G`), fact('HP', `${a.hp}/${a.stats?.hp ?? a.hp}`), fact('MP', `${a.mp}/${a.stats?.mp ?? a.mp}`)),
      !inTown(a) ? h('p', 'life-note', '던전이나 길 위에 있어. 마을에 돌아오면 생활 행동을 할 수 있어.') : null,
      jobs.length ? section('작업 중', ...jobs, h('p', 'life-note', '마을이 깨어 있을 때만 진행돼.')) : null,
      section(`가방 · ${bag.length}종`, h('div', 'life-opts', h('label', 'life-who', '팔 상대', partnerSel), h('label', 'life-who', '보관', storeSel)), ...(bag.length ? bag.map(([id, n]) => row(id, n, false)) : [empty('가방에 생활 물품이 없어. 상점·NPC 탭에서 살 수 있어.')])),
      section(`창고 · ${stored.length}종`, ...(stored.length ? stored.map(([id, n]) => row(id, n, true)) : [empty('맡긴 물품이 없어.')])),
      section('공공 금고에 골드 기부', h('div', 'life-opts', h('label', 'life-who', '골드', amount), act('donate', { amount: ui.amount }, `${ui.amount}G 기부`, { disabled: !inTown(a) || a.gold < ui.amount })), h('p', 'life-note', `공공 금고 ${l.treasury}G · 공공 공사와 증축에 쓰여. GM의 마을 발전 판단에 쌓이는 건 신전 발전 헌금(시설 탭의 신전)뿐이야.`)),
    ]
  }
  function npcDetail(n) {
    const l = life(), a = actor(), home = buildingOf(n.buildingId), r = l.catalog.replenishment
    const stock = Object.entries(n.stock ?? {}).map(([id, k]) => {
      const d = itemOf(id), q = Math.min(ui.quantity, k), trade = n.role !== 'builder' && d
      return h('div', 'life-row', icon(d), h('span', 'life-name', h('b', '', d?.name ?? id), h('small', '', d ? `${CATEGORY[d.category] ?? ''} · ${d.price}G` : '')), h('span', 'life-qty num', `${k}개`),
        h('span', 'life-acts', trade ? act('buy', { npcId: n.id, itemId: id, quantity: q }, `사기 ${q} · ${d.price * q}G`, { disabled: !n.open || !inTown(a) || (a?.gold ?? 0) < d.price * q, tip: n.open ? '' : '영업 시간이 아니야.' }) : null))
    })
    const sell = n.role === 'builder' || !a ? [] : Object.entries(a.stacks ?? {}).map(([id, k]) => {
      const d = itemOf(id), q = Math.min(ui.quantity, k), price = d ? Math.max(1, Math.floor(d.price / 2)) * q : 0
      return h('div', 'life-row', icon(d), h('span', 'life-name', h('b', '', d?.name ?? id), h('small', '', `${a.name}의 가방`)), h('span', 'life-qty num', `×${k}`), h('span', 'life-acts', d ? act('sell', { npcId: n.id, itemId: id, quantity: q }, `팔기 ${q} · ${price}G`, { disabled: !n.open || !inTown(a) || n.gold < price }) : null))
    })
    const quests = l.deliveryQuests.filter(q => q.npcId === n.id && q.status === 'open').map(q => h('div', 'life-row', icon(itemOf(q.itemId)), h('span', 'life-name', h('b', '', q.title), h('small', '', `${itemName(q.itemId)} ${q.progress}/${q.count} · 개당 ${q.price}G · 예치 ${q.escrow}G`)),
      h('span', 'life-acts', act('deliver', { questId: q.id, quantity: Math.max(1, Math.min(ui.quantity, q.count - q.progress, a?.stacks?.[q.itemId] ?? 0)) }, '납품', { disabled: !inTown(a) || !a?.stacks?.[q.itemId] }))))
    const work = n.role === 'builder' ? l.constructions.find(c => c.status === 'building' || c.status === 'approved') : null
    return [
      h('div', 'life-title', h('b', '', n.name), h('small', '', `${NPC_ROLE[n.role] ?? n.role} · ${home?.name ?? ''} · ${n.open ? '영업 중' : '쉬는 중'}`)),
      h('div', 'life-facts', fact('자금', `${n.gold}G`), fact('상태', n.open ? '영업 중' : '근무 시간 밖'), fact('자리', home?.name ?? '-')),
      n.role === 'producer' ? section('일자리', h('div', 'life-row', icon(itemOf('tea-cup')), h('span', 'life-name', h('b', '', `${home?.name ?? '가게'} 일 돕기 · 20초`), h('small', '', '고용주 찻잎 2개로 차 1잔 · 임금 4G · 영업 중·자금 4G 이상·찻잎 2개·완성품 40잔 미만')),
        h('span', 'life-acts', act('work', { npcId: n.id }, '근무', { disabled: !n.open || !inTown(a) })))) : null,
      n.role === 'builder' ? section('공사', h('p', 'life-note', work ? `${FACILITIES[work.kind]?.name ?? '공사'} · ${CONSTRUCTION_STATE[work.status]}${work.status === 'building' ? ` ${pct(work.progress, work.seconds)}%` : ''}` : '맡은 공사가 없어.'),
        h('p', 'life-note', '승인된 공사는 건축가가 근무 시간에 현장에 가서 진행하고, 쓴 공사비는 건축가에게 지급돼. 건축가가 없으면 공사비는 소모돼.')) : null,
      quests.length ? section('납품 의뢰', ...quests) : null,
      n.role !== 'builder' ? section('진열 · 남은 재고', ...(stock.length ? stock : [empty('남은 재고가 없어.')])) : null,
      sell.length ? section('팔기 · 반값', ...sell) : null,
      n.role !== 'builder' ? h('p', 'life-note', `재고와 자금은 유한해. 마을이 깨어 있는 ${r.awakeSeconds / 60}분마다 자금 +${r.gold}G(최대 ${r.maxGold}G), 기본 재료 +${r.materialUnits}개(재료당 최대 ${r.maxMaterialStock}개)씩만 보충돼.`) : null,
    ]
  }
  function listButton(id, selected, title, sub, run, extra = null) {
    const b = h('button', 'life-item', h('span', 'life-name', h('b', '', title), h('small', '', sub)), extra); b.type = 'button'; b.id = id
    b.setAttribute('aria-pressed', String(selected)); b.addEventListener('click', run); return b
  }
  function renderMarket() {
    const l = life(), n = npcOf(ui.npcId) ?? l.npcs[0]
    if (n) ui.npcId = n.id
    const list = h('nav', 'life-list', ...l.npcs.map(x => listButton(`life-npc-${x.id}`, x.id === n?.id, x.name, `${NPC_ROLE[x.role] ?? x.role} · ${x.open ? '영업 중' : '쉬는 중'} · ${x.gold}G`, () => { ui.npcId = x.id; painter.selectNpc?.(x.id); render(); publish() })))
    list.setAttribute('aria-label', 'NPC')
    return [h('div', 'life-split', list, h('div', 'life-detail', ...(n ? npcDetail(n) : [empty('NPC가 없어.')])))]
  }
  const owner = b => b.ownership === 'private' ? `개인 · ${who(b.ownerId)}` : '공공'
  function upgradeTarget(b) {
    const def = FACILITIES[b.role], busy = life().constructions.some(c => ACTIVE.has(c.status) && c.buildingId === b.id)
    if (!def || b.role === 'expansion' || b.level >= 3) return { ok: false, why: b.level >= 3 ? '최고 단계야.' : '증축할 수 없는 시설이야.' }
    if (busy) return { ok: false, why: '이미 증축 공사가 진행 중이야.' }
    if (b.ownership === 'private' && b.ownerId !== ui.actorId) return { ok: false, why: '개인 시설은 소유주만 증축할 수 있어.' }
    return { ok: true, def }
  }
  function facilityDetail(b) {
    const l = life(), a = actor(), url = art.url(b.artKey), def = FACILITIES[b.role]
    const people = l.npcs.filter(n => n.buildingId === b.id)
    const recipes = RECIPES.filter(r => r.role === b.role).map(r => {
      const missing = Object.entries(r.inputs).filter(([id, k]) => holding(a?.stacks, id) < k), tool = r.tool && !holding(a?.stacks, r.tool), fee = def?.fee ?? 1
      return h('div', 'life-row', icon(itemOf(r.output.itemId)), h('span', 'life-name', h('b', '', r.name), h('small', '', `${Object.entries(r.inputs).map(([id, k]) => `${itemName(id)} ${holding(a?.stacks, id)}/${k}`).join(' · ')}${r.tool ? ` · 도구 ${itemName(r.tool)}` : ''} → ${itemName(r.output.itemId)} ${r.output.quantity} · ${Math.round(r.seconds / b.level)}초 · 이용료 ${fee}G`)),
        h('span', 'life-acts', act('produce', { buildingId: b.id, recipeId: r.id }, '제작', { disabled: !inTown(a) || missing.length > 0 || tool || (a?.gold ?? 0) < fee || l.production.some(j => j.actorId === a?.id), tip: missing.length || tool ? '재료나 도구가 부족해.' : '' })))
    })
    const rest = ['home', 'inn'].includes(b.role) ? section('휴식', h('div', 'life-row', icon(null), h('span', 'life-name', h('b', '', '쉬어 가기'), h('small', '', `이용료 ${FACILITIES.home.fee}G · HP +${10 * b.level} · MP +${5 * b.level}`)), h('span', 'life-acts', act('service', { buildingId: b.id }, '이용', { disabled: !inTown(a) || (a?.gold ?? 0) < FACILITIES.home.fee })))) : null
    const storage = b.role === 'warehouse' ? section('보관', h('p', 'life-note', `물품당 ${99 + b.level * 200}개까지 · 맡길 때 이용료 ${FACILITIES.warehouse.fee}G`), btn('이 창고로 보관하기', () => { ui.storeId = b.id; ui.tab = 'resident'; render(); publish() })) : null
    const up = upgradeTarget(b), works = l.constructions.filter(c => c.buildingId === b.id).slice(-3).reverse()
    let temple = null
    if (b.role === 'oracle') {
      const j = judgement(), amount = h('input', 'life-num num')
      Object.assign(amount, { id: 'life-temple-amount', type: 'number', min: 1, max: 10000, value: String(ui.amount) }); amount.setAttribute('aria-label', '헌금할 골드')
      amount.addEventListener('change', () => { ui.amount = Math.max(1, Math.min(10000, Math.round(Number(amount.value)) || 1)); amount.value = String(ui.amount); render() })
      const status = h('p', 'life-note', j.text); status.id = 'life-temple-status'; status.dataset.state = j.state
      temple = section('마을 발전 헌금',
        h('div', 'life-facts', fact('누적 헌금', `${j.total}G`), fact('GM이 판단한 몫', `${j.reviewedTotal}G`), fact('판단 대기', `${j.waiting}G`), fact('공공 금고', `${l.treasury}G`)),
        status,
        h('div', 'life-opts', h('label', 'life-who', '골드', amount),
          act('temple-donate', { buildingId: b.id, amount: ui.amount }, `${ui.amount}G 헌금`, { id: 'life-temple-donate', disabled: !inTown(a) || (a?.gold ?? 0) < ui.amount, tip: inTown(a) ? '' : '마을에 돌아온 주민만 할 수 있어.' })),
        h('p', 'life-note', '헌금은 공공 금고로 들어가 공공 공사에 쓰일 수 있고, 누적 헌금은 쓰여도 줄지 않는 기록이야. GM은 누적 헌금과 실제 완공 시설·던전 진척을 보고 공공 금고·자재 안에서 공공 시설(예치 뒤 공사 심사)이나 기존 기능을 쓰는 새 이름의 물품을 제안할 수 있어. 정해진 보상이나 즉시 무료 공사가 아니고, 아무것도 제안하지 않을 수도 있어.'),
        h('p', 'life-note', `신탁을 받을 때 내는 ${OFFERING}G 헌금은 신관이 받고, 발전 헌금 누적과 공공 금고에는 들어가지 않아.`),
        app.world.rpg.settings.enabled ? btn('길드에서 신관·직업 보기', () => { close(); openGuild('actors') }, { id: 'life-temple-guild' }) : null)
    }
    return [
      h('div', 'life-hero', url ? Object.assign(document.createElement('img'), { src: url, alt: `${b.name} 그림`, className: 'life-art' }) : h('span', 'life-art blank', svgIcon(HOUSE)),
        h('div', 'life-title', h('b', '', b.name), h('small', '', `${FACILITY_ROLE[b.role] ?? b.role} · ${b.level}단계 · ${owner(b)}`)),
        btn('지도에서 보기', () => { close(); painter.show?.(b.door.x, b.door.y) })),
      h('div', 'life-facts', fact('단계', `${b.level} / 3`), fact('소유', owner(b)), fact('크기', `${b.w}×${b.h}`), fact('출입구', `${b.door.x}, ${b.door.y}`)),
      temple,
      h('p', 'life-note', `${def?.service ? `서비스: ${SERVICE[def.service]}. ` : ''}이용료는 ${b.ownership === 'private' ? '소유주' : '공공 금고'}에게 가.${url ? '' : ' 생성 그림이 준비되기 전에는 기본 모습으로 보여.'}`),
      people.length ? section('일하는 NPC', ...people.map(n => btn(`${n.name} · ${NPC_ROLE[n.role] ?? n.role}`, () => { ui.npcId = n.id; ui.tab = 'market'; render(); publish() }))) : null,
      recipes.length ? section('제작', ...recipes) : null, rest, storage,
      section('증축', h('p', 'life-note', up.ok ? `${b.level + 1}단계 · 기본 ${up.def.gold * b.level}G와 ${Object.entries(up.def.materials).map(([id, k]) => `${itemName(id)} ${k * b.level}`).join(' · ')} · ${FUNDING[b.ownership]}` : up.why),
        btn('증축 견적…', () => { Object.assign(ui.form, { kind: b.role, buildingId: b.id, funding: b.ownership }); ui.draft = null; ui.tab = 'works'; void tryQuote() }, { disabled: !up.ok || !inTown(a) }),
        ...works.map(constructionRow)),
    ]
  }
  function renderFacility() {
    const l = life(), b = buildingOf(ui.buildingId) ?? l.buildings[0]
    if (b) ui.buildingId = b.id
    const list = h('nav', 'life-list', ...l.buildings.map(x => listButton(`life-building-${x.id}`, x.id === b?.id, x.name, `${FACILITY_ROLE[x.role] ?? x.role} · ${x.level}단계 · ${owner(x)}`, () => { ui.buildingId = x.id; render(); publish() })))
    list.setAttribute('aria-label', '시설')
    return [h('div', 'life-split', list, h('div', 'life-detail', ...(b ? facilityDetail(b) : [empty('시설이 없어.')])))]
  }
  function constructionRow(c) {
    const def = FACILITIES[c.kind], active = ACTIVE.has(c.status), starter = actors().find(a => a.id === c.actorId)
    const where = c.kind === 'expansion' ? `${DIRECTION[c.site.direction] ?? ''} 인접 구역` : c.buildingId ? `${buildingOf(c.buildingId)?.name ?? '시설'} 증축` : `(${c.site.x}, ${c.site.y}) ${c.site.w}×${c.site.h}`
    const state = `${CONSTRUCTION_STATE[c.status] ?? c.status}${c.status === 'building' ? ` ${pct(c.progress, c.seconds)}%` : ''}`
    const paid = c.spentGold > 0 ? ` · 사용 ${c.spentGold}G${c.recipientId ? ` → ${npcOf(c.recipientId)?.name ?? '건축가'}` : ' (소모)'}` : ''
    const cancel = active ? btn('취소', () => perform({ action: 'cancel-construction', actorId: c.actorId, constructionId: c.id }, '공사 취소'), {
      id: `life-cancel-${c.id}`, disabled: !inTown(starter), tip: c.status === 'building' ? `착공 후 취소: 쓰지 않은 ${c.gold - c.spentGold}G와 남은 자재만 돌아가.` : `착공 전 취소: ${c.gold}G와 자재 전부 돌아가.` }) : null
    const row = h('div', 'life-row life-work', h('span', 'life-ic', svgIcon(c.kind === 'expansion' ? P.map : HOUSE)), h('span', 'life-name', h('b', '', `${def?.name ?? c.kind} · ${where}`),
      h('small', '', `${who(c.actorId)} · ${FUNDING[c.funding]} · 예치 ${c.gold}G · ${goods(c.materials)}${paid}${c.reason ? ` · ${c.reason}` : ''}`)), h('span', 'life-state', state), h('span', 'life-acts', cancel))
    row.dataset.status = c.status
    if (c.status === 'building') row.style.setProperty('--progress', `${pct(c.progress, c.seconds)}%`)
    return row
  }
  function renderWorks() {
    const l = life(), f = ui.form, target = f.buildingId ? buildingOf(f.buildingId) : null, a = actor()
    if (f.buildingId && !target) f.buildingId = null
    const seg = (items, value, set, label) => { const g = h('div', 'gw-seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label); for (const [k, text, disabled] of items) g.append(btn(text, () => { set(k); ui.draft = null; render(); publish() }, { pressed: k === value, disabled })); return g }
    const kinds = Object.entries(FACILITIES).map(([k, d]) => [k, d.name, !!target && k !== f.kind])
    const coord = (axis, max) => { const i = h('input', 'life-num num'); Object.assign(i, { id: `life-${axis}`, type: 'number', min: 0, max, value: f[axis] ?? '' }); i.setAttribute('aria-label', `${axis} 좌표`); i.addEventListener('change', () => { f[axis] = i.value === '' ? null : Math.round(Number(i.value)); ui.draft = null; render() }); return i }
    const def = FACILITIES[f.kind], level = target?.level ?? 1
    const expansionsLeft = MAX_EXPANSIONS - l.expanded
    const site = f.kind === 'expansion'
      ? h('div', 'life-opts', seg(Object.entries(DIRECTION).map(([k, t]) => [k, t, false]), f.direction, v => { f.direction = v }, '확장 방향'), h('span', 'life-note', `8칸 넓어져 · 남은 확장 ${expansionsLeft}/${MAX_EXPANSIONS} · 한 번에 하나`))
      : target ? h('div', 'life-opts', h('span', 'life-note', `${target.name} ${target.level}단계 → ${target.level + 1}단계 · ${owner(target)}`), btn('새 시설로', () => { f.buildingId = null; f.funding = 'private'; ui.draft = null; render() }))
        : h('div', 'life-opts', h('label', 'life-who', 'x', coord('x', l.map.width)), h('label', 'life-who', 'y', coord('y', l.map.height)), btn('지도에서 고르기…', pickSite, { disabled: !inTown(a) }), h('span', 'life-note', `${def.w}×${def.h} · 빈 풀밭 · 길·출입구를 막지 않는 곳`))
    const fundingLocked = !!target
    const missing = ['merchant', 'guild'].filter(role => !built(role))
    const growth = missing.length ? section('마을 키우기', h('p', 'life-note', `새 마을은 여관과 신전에서 시작해. ${npcOf('trader')?.name ?? '행상'}에게 재료를 사고, ${npcOf('producer')?.name ?? '조리사'} 밑에서 일하거나(20초, 4G) 찻잎을 납품해 첫 돈과 재료를 모아. 시설은 여기서 공사로 지어.${missing.includes('merchant') ? ' 잡화점을 지으면 길드 상점의 물약·장비 진열과 자동 보급이 열려.' : ''}${missing.includes('guild') ? ' 모험가 길드를 지으면 길드가 내는 자동 의뢰가 생겨.' : ''} 신전 발전 헌금이 쌓이면 GM이 공공 시설이나 새 물품을 제안할 수도 있어.`)) : null
    return [
      growth,
      h('div', 'life-facts', fact('공공 금고', `${l.treasury}G`), fact('공공 자재', goods(l.materials)), fact('지도', `${l.map.width}×${l.map.height}`), fact('영역 확장', `${l.expanded}/${MAX_EXPANSIONS}`), l.constructionSink ? fact('소모된 공사비', `${l.constructionSink}G`) : null),
      section(target ? '증축 신청' : '공사 신청',
        seg(kinds, f.kind, v => { f.kind = v }, '시설 종류'),
        h('p', 'life-note', `${def.name} · 기본 ${def.gold * level}G · ${goods(Object.fromEntries(Object.entries(def.materials).map(([id, k]) => [id, k * level])))} · 깨어 있는 ${def.seconds * level}초${def.service ? ` · 서비스 ${SERVICE[def.service]}${def.fee ? ` 이용료 ${def.fee}G` : ''}` : ''}`),
        seg(Object.entries(FUNDING).map(([k, t]) => [k, t, fundingLocked && k !== f.funding]), f.funding, v => { f.funding = v }, '자금 출처'),
        h('p', 'life-note', f.funding === 'public' ? `공공 금고 ${l.treasury}G와 공공 자재로 짓고, 완공되면 공공 소유·수입이야.` : `${a?.name ?? '주민'}의 골드 ${a?.gold ?? 0}G와 가방 자재로 짓고, 완공되면 개인 소유·수입이야.`),
        site,
        h('div', 'life-opts', btn('견적 받기', tryQuote, { main: true, id: 'life-quote', disabled: !inTown(a) })),
        h('p', 'life-note', '신청하면 골드·자재를 예치하고 GM이 심사해. 거절이나 착공 전 취소는 전액, 착공 후 취소는 쓰지 않은 만큼만 돌려받아. 공사는 마을이 깨어 있을 때만 진행돼.'),
        app.world?.rpg?.settings.dmProfileId ? null : h('p', 'life-note warn', 'GM 프로필이 없어 심사가 진행되지 않아. 신청은 대기하고, 취소하면 전액 돌아와.')),
      section('공사 현황', ...(l.constructions.length ? [...l.constructions].reverse().sort((x, y) => ACTIVE.has(y.status) - ACTIVE.has(x.status)).slice(0, 20).map(constructionRow) : [empty('아직 공사 기록이 없어.')])),
    ]
  }
  function renderDraft() {
    const box = $('life-draft'), d = ui.draft
    box.hidden = !d
    if (!d) { box.replaceChildren(); return }
    const q = d.quote, l = life(), a = actors().find(x => x.id === d.input.actorId)
    const bag = q?.funding === 'public' ? l.materials : a?.stacks, balance = q?.funding === 'public' ? l.treasury : a?.gold ?? 0
    const detail = q ? h('small', '', `${q.gold}G (가진 ${balance}G) · ${Object.entries(q.materials).map(([id, k]) => `${itemName(id)} ${holding(bag, id)}/${k}`).join(' · ')} · 깨어 있는 ${q.seconds}초 · ${FUNDING[q.funding]}${q.site?.x !== undefined ? ` · 부지 (${q.site.x}, ${q.site.y}) ${q.site.w}×${q.site.h}` : ''}`) : null
    box.replaceChildren(h('span', 'life-name', h('b', '', d.label), detail ?? h('small', '', '실행을 눌러야 서버에 적용돼.')),
      btn(q ? '공사 신청' : '실행', () => perform(d.input, d.label), { main: true, id: 'life-run' }), btn('버리기', () => { ui.draft = null; render(); publish() }, { id: 'life-discard' }))
  }
  function render() {
    if (layer.hidden || !life()) return
    if (layer.contains(document.activeElement) && document.activeElement.tagName === 'SELECT' && !ui.busy) { deferred = true; return }
    deferred = false
    if (!actor()) ui.actorId = (actors().find(inTown) ?? actors()[0])?.id ?? null
    const focused = layer.contains(document.activeElement) ? document.activeElement.id : null
    const scroll = [...layer.querySelectorAll('.life-list, .life-detail, .life-body')].map(e => [e.className, e.scrollTop])
    for (const b of $('life-tabs').children) b.setAttribute('aria-selected', String(b.id === `life-nav-${ui.tab}`))
    const running = !!app.world?.running, pill = $('life-status')
    pill.dataset.state = running ? 'on' : 'off'; pill.textContent = running ? '생활 진행 중' : '마을이 자는 중'
    pill.dataset.tip = running ? '생산·공사·NPC 보충이 진행돼.' : '자는 동안에는 생산·공사·NPC 보충이 멈춰. 거래와 신청은 할 수 있어.'
    toolbar(); renderDraft()
    $('life-body').replaceChildren(...({ resident: renderResident, market: renderMarket, facility: renderFacility, works: renderWorks })[ui.tab]().filter(Boolean))
    for (const [cls, top] of scroll) { const e = layer.getElementsByClassName(cls.split(' ')[0])[0]; if (e) e.scrollTop = top }
    if (focused) $(focused)?.focus({ preventScroll: true })
  }
  layer.addEventListener('focusout', () => { if (deferred) queueMicrotask(render) })
  layer.addEventListener('change', e => { if (e.target.tagName === 'SELECT' && deferred) queueMicrotask(render) })

  function open(tab = ui.tab, target = {}) {
    if (!life()) throw new Error('생활 세계를 불러오는 중이야. 잠시 뒤에 다시 열어줘.')
    if (!Object.hasOwn(TABS, tab)) throw new Error('생활 화면을 확인해줘.')
    if (target.profileId !== undefined) { const a = actors().find(x => x.profileId === target.profileId); if (!a) throw new Error('길드에 등록된 주민이 아니야.'); ui.actorId = a.id }
    if (target.actorId !== undefined) { if (!actors().some(x => x.id === target.actorId)) throw new Error('주민을 확인해줘.'); ui.actorId = target.actorId }
    if (target.npcId !== undefined) { if (!npcOf(target.npcId)) throw new Error('NPC를 확인해줘.'); ui.npcId = target.npcId }
    if (target.buildingId !== undefined) { if (!buildingOf(target.buildingId)) throw new Error('시설을 확인해줘.'); ui.buildingId = target.buildingId }
    ui.tab = tab
    if (layer.hidden) { opener = document.activeElement; onOpen(); layer.hidden = false }
    painter.selectNpc?.(tab === 'market' ? ui.npcId : null)
    signature = ''; render(); $(`life-nav-${tab}`).focus({ preventScroll: true }); publish()
  }
  function close() {
    // Picking a site hides the window without closing it; ending the pick here must not bring it back.
    const picking = !banner.hidden
    painter.cancelPick?.()
    if (layer.hidden && !picking) return
    layer.hidden = true; painter.selectNpc?.(null)
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    publish()
  }
  $('life-close').addEventListener('click', close); layer.querySelector('.dim').addEventListener('click', close)
  document.addEventListener('keydown', event => {
    if (layer.hidden) return
    if (event.key === 'Escape') close()
    if (event.key === 'Tab') {
      const controls = [...layer.querySelectorAll('button,input,select')].filter(e => !e.disabled && e.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
  })

  /** The assistant's draft: the same input a person's click sends, held until 실행. Construction first reads its quote. */
  async function prepare(args) {
    if (!life()) throw new Error('생활 세계를 불러오는 중이야.')
    if (!LIFE_ACTIONS.includes(args.action)) throw new Error('지원하지 않는 생활 행동이야.')
    const target = actors().find(a => a.id === args.actorId)
    if (!target) throw new Error('행동할 주민(actorId)을 확인해줘.')
    const input = Object.fromEntries(FIELDS.filter(k => args[k] !== undefined).map(k => [k, args[k]]))
    ui.actorId = target.id
    if (input.action === 'construct') {
      const b = input.buildingId ? buildingOf(input.buildingId) : null
      if (input.buildingId && !b) throw new Error('증축할 시설을 확인해줘.')
      const kind = b ? b.role : input.kind
      if (!FACILITIES[kind]) throw new Error('시설 종류(kind)를 확인해줘.')
      Object.assign(ui.form, { kind, buildingId: b?.id ?? null, funding: b ? b.ownership : input.funding ?? 'private', x: input.x ?? null, y: input.y ?? null, direction: input.direction ?? ui.form.direction })
      ui.tab = 'works'; ui.draft = null
      if (layer.hidden) open('works'); else render()
      await quote()
      return { quote: ui.draft?.quote ?? null, requestId: ui.draft?.requestId ?? null }
    }
    if (input.action === 'cancel-construction') {
      const c = life().constructions.find(x => x.id === input.constructionId && ACTIVE.has(x.status))
      if (!c) throw new Error('진행 중인 공사를 확인해줘.')
      input.actorId = c.actorId
    }
    if (input.action === 'temple-donate' && input.buildingId === undefined) {
      const temples = life().buildings.filter(b => b.role === 'oracle')
      if (temples.length !== 1) throw new Error('헌금할 신전(buildingId)을 골라줘.')
      input.buildingId = temples[0].id
    }
    setDraft(input)
    const tab = ['buy', 'work'].includes(input.action) ? 'market' : ['produce', 'service', 'temple-donate'].includes(input.action) ? 'facility' : input.action === 'cancel-construction' ? 'works' : 'resident'
    open(tab, { ...(input.npcId && npcOf(input.npcId) ? { npcId: input.npcId } : {}), ...(input.buildingId && buildingOf(input.buildingId) ? { buildingId: input.buildingId } : {}) })
    return { requestId: ui.draft.requestId }
  }

  return {
    open, close, prepare,
    openResident: profileId => open('resident', { profileId }),
    openNpc: id => open('market', { npcId: id }),
    openBuilding: id => open('facility', { buildingId: id }),
    get dirty() { return !!ui.draft },
    /**
     * Another save slot (or this one started over): its residents, NPCs and facilities are not the old ones, so the
     * draft, the chosen site and every pending retry identity are dropped instead of being sent to the new village.
     */
    reset() {
      painter.cancelPick?.()
      ui.draft = null; retries.clear(); ui.form = newForm()
      Object.assign(ui, { actorId: null, npcId: null, buildingId: null, partnerId: '', storeId: '' })
      signature = '' // the next update() redraws with the new village
    },
    update() {
      if (!life()) { if (!layer.hidden) close(); return }
      if (ui.draft && ui.draft.input.actorId && !actors().some(a => a.id === ui.draft.input.actorId)) ui.draft = null
      if (layer.hidden) return
      const l = life(), sig = JSON.stringify([app.world.running, l.treasury, l.donations, app.world.rpg.thinking?.kind ?? null, app.world.rpg.settings.enabled, app.world.rpg.settings.dmDailyLimit, l.materials, l.map.revision, l.expanded, l.buildings, l.placements.length, l.deliveryQuests, l.constructionSink,
        l.npcs.map(n => [n.id, n.open, n.gold, n.stock]), l.constructions.map(c => [c.id, c.status, c.spentGold, c.reason, Math.floor(pct(c.progress, c.seconds) / 5)]),
        l.production.map(j => [j.id, Math.floor(pct(j.progress, j.seconds) / 5)]), actors().map(a => [a.id, a.name, a.phase, a.gold, a.hp, a.mp, a.stacks, a.storedStacks]),
        app.world.rpg.settings.dmProfileId, l.buildings.map(b => !!art.url(b.artKey)), l.catalog.items.map(i => !!art.url(i.artKey))])
      if (sig !== signature) { signature = sig; render() }
    },
    snapshot() {
      const l = life()
      if (!l) return null
      const items = new Map(l.catalog.items.map(i => [i.id, i]))
      return {
        open: !layer.hidden, tab: ui.tab, actorId: ui.actorId, npcId: ui.npcId, buildingId: ui.buildingId, picking: !banner.hidden, running: !!app.world.running,
        treasury: l.treasury, donations: (({ waiting, state, total, reviewedTotal }) => ({ total, reviewedTotal, waiting, judgement: state }))(judgement()),
        facilitiesBuilt: { merchant: built('merchant'), guild: built('guild') }, publicMaterials: l.materials, constructionSink: l.constructionSink ?? 0, map: { width: l.map.width, height: l.map.height, revision: l.map.revision }, expansions: { done: l.expanded, max: MAX_EXPANSIONS },
        residents: actors().map(a => ({ actorId: a.id, profileId: a.profileId, name: a.name, phase: a.phase, inTown: inTown(a), gold: a.gold, hp: a.hp, mp: a.mp, stacks: a.stacks ?? {}, storedStacks: a.storedStacks ?? {} })),
        npcs: l.npcs.map(n => ({ id: n.id, name: n.name, role: n.role, buildingId: n.buildingId, open: n.open, gold: n.gold, stock: n.stock, x: Math.round(n.x), y: Math.round(n.y) })),
        buildings: l.buildings.map(b => ({ id: b.id, name: b.name, role: b.role, level: b.level, ownership: b.ownership, ownerId: b.ownerId, x: b.x, y: b.y, w: b.w, h: b.h, door: b.door, imageReady: !!art.url(b.artKey) })),
        constructions: [...l.constructions.filter(c => ACTIVE.has(c.status)), ...l.constructions.filter(c => !ACTIVE.has(c.status)).slice(-5)].map(c => ({ id: c.id, kind: c.kind, status: c.status, actorId: c.actorId, funding: c.funding, buildingId: c.buildingId, site: c.site, gold: c.gold, materials: c.materials, spentGold: c.spentGold, progress: c.progress, seconds: c.seconds, reason: c.reason })),
        production: l.production.map(j => ({ actorId: j.actorId, recipeId: j.recipeId ?? null, npcId: j.npcId ?? null, buildingId: j.buildingId, progress: j.progress, seconds: j.seconds, output: j.output })),
        deliveryQuests: l.deliveryQuests.filter(q => q.status === 'open'),
        items: [...items.values()].map(i => ({ id: i.id, name: i.name, category: i.category, price: i.price, capabilities: i.capabilities, effect: i.effect ?? null, templateId: i.templateId ?? null })),
        facilities: FACILITIES, recipes: RECIPES, replenishment: l.catalog.replenishment,
        draft: ui.draft ? { input: ui.draft.input, requestId: ui.draft.requestId, quote: ui.draft.quote, label: ui.draft.label } : null,
        note: '생활 작업은 ai-aquarium.life_prepare로 초안만 만들고, 사람이 생활 창의 실행·공사 신청을 눌러야 적용돼. 공사는 견적(읽기 전용) 뒤 신청하면 예치되고 GM 심사를 기다려. temple-donate(신전 buildingId, amount)는 공공 금고로 들어가며 누적 헌금으로 GM 발전 판단(하루 한 번까지, 보상 보장 없음)을 부른다. 생산·공사·보충은 마을이 깨어 있을 때만 진행돼.',
      }
    },
  }
}
