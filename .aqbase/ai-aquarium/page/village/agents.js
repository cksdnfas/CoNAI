import { node, setOptions } from '../ui/dom.js'
import { CATEGORIES, DECIDERS, ACTION_DEFAULTS, agentSettings, statusDefinition, actionDefinition } from '../../shared/agents.mjs'

/*
 * 마을 관리 › AI 행동 · 상태 정의: one draft of the slot's agent settings (`agent-configure`). Every decision uses the
 * resident's own profile; everyday and request/conversation decisions use judge / chat, never rules.
 * Bounds and normalization are `shared/agents.mjs` itself, run here before sending.
 */
export const CATEGORY_LABEL = { combat: '전투·탐사', social: '대화·방송·신탁', village: '일상·요청 판단' }
export const DECIDER_LABEL = { judge: '판단 모델', chat: '채팅 모델' }
const CATEGORY_HELP = {
  combat: '전투 행동·스킬·물약과 던전 이동 목적지·시설 이용·귀환 판단이야. 한도에 닿으면 해당 주민의 차례만 기다려. 몬스터와 다른 주민은 계속 진행해.',
  social: '대화·방송·신탁의 실제 모델 호출마다 시간당·하루 한도를 1회씩 사용해. 대화 사전 판단·발언·사후 판단·다음 발언자 선택도 각각 호출이야. 최소 간격만 대화 한 차례에 한 번 적용해. 한도나 답변 실패로 진행할 수 없으면 대화를 끝내고 두 주민을 풀어 줘.',
  village: '생활·교류·장비·근무·수면·원정 출발과 받은 요청의 수락·거절을 함께 제시해. 요청을 나중에 답할지 여부도 모델이 골라. 모든 일상 선택에 이 줄의 호출 규칙만 적용돼.',
}
/** The effect fields a custom action of each category actually runs (rules.mjs, social.mjs, agent-actions.mjs). */
const EFFECT_FIELDS = {
  combat: ['damage', 'guard', 'heal', 'fleeChance', 'mpCost'],
  social: ['affinity', 'targetStatuses', 'actorStatuses', 'needsAcceptance', 'transfer', 'amount', 'place'],
  village: ['actorStatuses', 'duration', 'place'],
}
// [label, min, max, step, unit, tip] — the clamps of actionDefinition().
const EFFECT_NUM = {
  damage: ['피해 배율', 0, 2, 0.05, '배', '기본 공격 대비 피해야. 0이면 공격하지 않아.'],
  guard: ['받는 피해 감소', 0, 0.75, 0.05, '', '0.5면 이번 차례 받는 피해가 절반이야.'],
  heal: ['회복', 0, 0.3, 0.01, '', '최대 HP 대비 회복 비율이야.'],
  fleeChance: ['도망 확률', 0, 1, 0.05, '', '1이면 반드시 후퇴해.'],
  mpCost: ['MP 소모', 0, 20, 1, '', 'MP가 모자라면 효과 없이 기본 공격이 돼.'],
  affinity: ['관계 변화', -20, 20, 1, '', '실행(또는 수락)되면 두 주민의 호감도가 이만큼 바뀌어.'],
  amount: ['기본 수량', 1, 100, 1, '개/G', '주고받을 기본 수량이야. 주민이 직접 정하면 그 값을 써.'],
  duration: ['걸리는 시간', 5, 300, 1, '초', '이 행동을 하는 동안 다른 생활 행동을 쉬어.'],
}
const STATUS_TIP = { actorStatuses: '하는 주민의 상태 변화야. 상태마다 ±30, 한 번에 그 상태의 증감 한도(step)까지만 적용돼.', targetStatuses: '상대 주민의 상태 변화야. 상태마다 ±30, 한 번에 그 상태의 증감 한도(step)까지만 적용돼.' }
const TRANSFER = { none: '없음', item: '물품', gold: '골드' }
const ID = /^[a-zA-Z][\w-]{0,39}$/
const STATUS_MAX = 16
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const round = (n, step) => step >= 1 ? Math.round(n) : Math.round(n / step) * step

export function createAgentSettings({ app, request, toast, publish, changed }) {
  const $ = id => document.getElementById(id)
  const ui = { draft: null, base: null, dirty: false, category: 'combat', action: null, status: null, profileSig: '' }
  let daily = new Map()
  // The state's settings carry the normalized agent part; normalizing again fills the defaults if one is missing.
  const current = () => app.world ? agentSettings(app.world.settings) : null
  const take = s => JSON.parse(JSON.stringify({ statusDefs: s.statusDefs, actionCatalog: s.actionCatalog, deciders: s.deciders, conversationMaxTurns: s.conversationMaxTurns, maxConversations: s.maxConversations }))
  // "New" means not in the saved settings yet: its ID (and a status's kind) can still change. Drafts from the assistant count too.
  const savedAction = a => !!app.world?.settings.actionCatalog?.some(p => p.category === a.category && p.id === a.id)
  const savedStatus = d => !!app.world?.settings.statusDefs?.some(p => p.id === d.id)

  function reset(force = false) {
    if (!app.world || (ui.dirty && !force)) return
    ui.base = app.world.agentSettingsRevision; ui.draft = take(current()); ui.dirty = false; ui.action = ui.status = null
    render()
  }
  function touch(rerender = false) { ui.dirty = true; changed(); publish(); if (rerender) render() }

  /* Small controls. A number commits on change (typing is not interrupted) and is clamped to its range. */
  function stepper(value, [min, max, step], label, commit, unlimited = false) {
    const box = node('div', '', 'rpg-num'), input = Object.assign(document.createElement('input'), { type: 'number', min, max, step, value: value ?? '', placeholder: unlimited ? '무제한' : '' })
    input.setAttribute('aria-label', label)
    const set = raw => { const n = Number(raw); const v = unlimited && raw === '' ? null : Number.isFinite(n) ? round(clamp(n, min, max), step) : value; input.value = v == null ? '' : String(v); if (v !== value) { value = v; commit(v); touch() } }
    const button = (by, text) => { const b = node('button', text); b.type = 'button'; b.dataset.num = ''; b.setAttribute('aria-label', `${label} ${by < 0 ? '줄이기' : '늘리기'}`); b.addEventListener('click', () => set(Number(input.value) + step * by)); return b }
    input.addEventListener('change', () => set(input.value))
    box.append(button(-1, '−'), input, button(1, '+')); return box
  }
  function field(value, min, max, label, commit, step = 'any') {
    const input = Object.assign(document.createElement('input'), { type: 'number', min, max, step, value, className: 'life-num' })
    input.setAttribute('aria-label', label)
    input.addEventListener('change', () => { const n = Number(input.value); const v = Number.isFinite(n) && input.value !== '' ? clamp(n, min, max) : null; if (v === null) { input.value = String(value); return } input.value = String(v); value = v; commit(v); touch() })
    return input
  }
  function text(value, max, label, commit, cls = 'ag-text') {
    const input = Object.assign(document.createElement('input'), { type: 'text', maxLength: max, value: value ?? '', className: cls })
    input.setAttribute('aria-label', label); input.addEventListener('input', () => { commit(input.value); touch() }); return input
  }
  function toggle(on, label, commit, disabled = false) {
    const wrap = node('label', '', 'switch'), input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: on, disabled })
    input.setAttribute('aria-label', label); input.addEventListener('change', () => { commit(input.checked); touch() }); wrap.append(input, node('i')); return wrap
  }
  function seg(entries, value, label, commit, disabled = false) {
    const box = node('div', '', 'seg'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', label)
    for (const [id, name] of entries) {
      const b = node('button', name); b.type = 'button'; b.disabled = disabled; b.setAttribute('aria-pressed', String(id === value))
      b.addEventListener('click', () => { if (id === value) return; value = id; for (const x of box.children) x.setAttribute('aria-pressed', String(x === b)); commit(id) })
      box.append(b)
    }
    return box
  }
  const row = (label, control, tip = '') => { const r = node('div', '', 'set-row'), l = node('span', label, 'set-label'); if (tip) l.dataset.tip = tip; const c = node('div', '', 'set-control'); c.append(...[control].flat()); r.append(l, c); return r }
  const group = (title, ...children) => { const s = node('section', '', 'set-group'); s.append(node('h3', title), ...children); return s }
  const help = t => node('p', t, 'lore-help ag-help')
  const button = (label, run, cls = 'btn') => { const b = node('button', label, cls); b.type = 'button'; b.addEventListener('click', run); return b }

  /* AI 행동: deciders, conversation limits, the action catalog. */
  function renderAgents() {
    const box = $('tab-agents'); if (!box || !ui.draft) return
    const d = ui.draft
    daily = new Map()
    const deciders = group('판단 방식', help('그 주민 자신의 프로필만 써. 판단 모델이 없으면 같은 프로필의 채팅 모델을 써. 모델을 부를 수 없으면 행동하지 않고 기다리며 이유를 판단 기록에 남겨. 모든 규칙 설정은 판단 모델로 이관돼. 간격은 실제 초, 시간당 한도는 주민마다 마을 시간 한 시간의 호출 수, 하루 한도는 슬롯 전체의 실제 하루(UTC) 호출 수야. 새 슬롯은 모든 줄이 시간당·하루 무제한(빈 값/null)이고 일상 기본 간격은 20초야. 저장된 한도는 유지해. 빈 값은 무제한, 0이면 호출하지 않고 기다려.'),
      ...CATEGORIES.map(c => {
        const used = node('span', '', 'ag-daily num'); daily.set(c, used)
        // Each number keeps its unit (and the day cap its usage) on one line when the row wraps.
        const cap = (...parts) => { const g = node('span', '', 'ag-cap'); g.append(...parts); return g }
        return row(CATEGORY_LABEL[c], [
          seg(DECIDERS.map(id => [id, DECIDER_LABEL[id]]), d.deciders[c].decider, `${CATEGORY_LABEL[c]} 판단 방식`, v => { d.deciders[c].decider = v; touch() }),
          cap(stepper(d.deciders[c].minInterval, [1, 3600, 1], `${CATEGORY_LABEL[c]} 최소 간격`, v => { d.deciders[c].minInterval = v }), node('span', '초 간격', 'set-unit')),
          cap(stepper(d.deciders[c].maxCallsPerHour, [0, 120, 1], `${CATEGORY_LABEL[c]} 시간당 한도 · 빈 값은 무제한`, v => { d.deciders[c].maxCallsPerHour = v }, true), node('span', '회/시간 · 빈 값 무제한', 'set-unit')),
          cap(stepper(d.deciders[c].maxCallsPerDay, [0, 10000, 1], `${CATEGORY_LABEL[c]} 하루 한도 · 빈 값은 무제한`, v => { d.deciders[c].maxCallsPerDay = v; paintDaily() }, true), node('span', '회/하루 · 빈 값 무제한', 'set-unit'), used),
        ], CATEGORY_HELP[c])
      }))
    paintDaily()
    const talk = group('대화',
      row('대화 최대 차례', [stepper(d.conversationMaxTurns, [2, 24, 1], '대화 최대 차례', v => { d.conversationMaxTurns = v }), node('span', '차례', 'set-unit')], '한 대화에서 오갈 수 있는 발언 수야. 그 안에서 주민이 이어 말할지·끝낼지 판단해.'),
      row('동시 대화', [stepper(d.maxConversations, [1, 3, 1], '동시 대화', v => { d.maxConversations = v }), node('span', '개', 'set-unit')], '한꺼번에 진행할 수 있는 대화 수야. 호스트의 플러그인 실행 슬롯을 함께 써.'))
    const notice = node('div', '', 'conai-notice')
    notice.dataset.combatMigrationNotice = ''
    notice.hidden = !app.world?.rpg?.combatMigrationNotice || app.world.rpg.combatMigrationNotice.dismissed
    notice.append(help('이전 전투 끔/수호자만 설정은 매 차례 모델 판단으로 바뀌었어. 전투·탐사 줄의 호출 한도를 확인해줘.'),
      button('확인했어', () => request('combat-notice-dismiss', { saveId: app.world.save?.id }).catch(e => toast(e.message))))
    fill(box, notice, deciders, talk, renderCatalog())
  }
  /** Today's slot-wide model calls per category (`agentDaily`, UTC real day) against the drafted daily cap. */
  function paintDaily() {
    const w = app.world, today = new Date(w?.now ?? Date.now()).toISOString().slice(0, 10), counts = w?.agentDaily?.day === today ? w.agentDaily : null
    for (const [c, el] of daily) {
      const used = counts?.[c] ?? 0, cap = ui.draft?.deciders[c].maxCallsPerDay
      el.textContent = `오늘 ${used}/${cap == null ? '무제한' : cap}`; el.dataset.full = String(cap != null && used >= cap)
      el.dataset.tip = cap == null ? '하루 한도 없이 최소 간격만 적용해. 빈 값은 무제한, 0은 호출 중지야.' : '사용자가 정한 UTC 하루 한도야. 0이면 호출하지 않고 기다려.'
    }
  }
  /** Rebuilds a tab's page, keeping where it was scrolled. */
  function fill(box, ...groups) {
    const top = box.scrollTop, page = node('div', '', 'rpg-settings ag-page')
    page.append(...groups); box.replaceChildren(page); box.scrollTop = top
  }
  function renderCatalog() {
    const d = ui.draft, c = ui.category, list = d.actionCatalog.filter(a => a.category === c)
    const tabs = node('div', '', 'gw-seg ag-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '행동 분류')
    for (const id of CATEGORIES) {
      const b = node('button', CATEGORY_LABEL[id]); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(id === c))
      b.append(node('span', String(d.actionCatalog.filter(a => a.category === id).length), 'gw-count num'))
      b.addEventListener('click', () => { ui.category = id; ui.action = null; renderAgents() }); tabs.append(b)
    }
    const rows = list.map(a => actionRow(a))
    const add = button('+ 행동 추가', () => {
      const ids = new Set(d.actionCatalog.filter(a => a.category === c).map(a => a.id)); let n = 1; while (ids.has(`custom${n}`)) n++
      const a = actionDefinition({ id: `custom${n}`, category: c, label: '새 행동', description: '' })
      d.actionCatalog.push(a); ui.action = `${c}:${a.id}`; touch(true)
    })
    return group('행동 목록', help('주민이 고를 수 있는 선택지야. 설명은 모델에게 보여 주는 글이고 실행되지 않아. 기본 행동은 켜기·이름·설명만 바꾸고, 추가 행동은 아래의 정해진 효과만 실행해.'), tabs, ...rows, add)
  }
  function actionRow(a) {
    const key = `${a.category}:${a.id}`, open = ui.action === key, wrap = node('div', '', 'ag-item'); wrap.dataset.open = String(open)
    const head = node('div', '', 'ag-head'), tag = node('span', a.builtin ? `기본 · ${a.id}` : `추가 · ${a.id}`, `ag-tag${a.builtin ? '' : ' custom'}`)
    head.append(toggle(a.enabled, `${a.label} 켜기`, v => { a.enabled = v }), text(a.label, 40, `${a.id} 이름`, v => { a.label = v }, 'ag-text ag-name'), tag)
    if (!a.builtin) {
      const more = button(open ? '접기' : '효과', () => { ui.action = open ? null : key; renderAgents() }); more.setAttribute('aria-expanded', String(open))
      head.append(more, button('삭제', () => { ui.draft.actionCatalog = ui.draft.actionCatalog.filter(x => x !== a); if (open) ui.action = null; touch(true) }, 'btn danger'))
    }
    wrap.append(head, text(a.description, 300, `${a.label} 설명`, v => { a.description = v }, 'ag-text ag-desc'))
    if (open) wrap.append(effectEditor(a, tag))
    return wrap
  }
  function effectEditor(a, tag) {
    const box = node('div', '', 'ag-effect'), e = a.effect
    const item = (label, control, tip = '') => { const r = node('div', '', 'ag-field'), l = node('span', label); if (tip) l.dataset.tip = tip; r.append(l, ...[control].flat()); return r }
    if (!savedAction(a)) box.append(item('ID', text(a.id, 40, '행동 ID', v => { a.id = v.trim(); ui.action = `${a.category}:${a.id}`; tag.textContent = `추가 · ${a.id}` }), '영문으로 시작하는 1–40자 영문·숫자·_·- 야. 저장 뒤에는 바꿀 수 없어.'))
    for (const k of EFFECT_FIELDS[a.category]) {
      if (EFFECT_NUM[k]) { const [label, min, max, step, unit, tip] = EFFECT_NUM[k]; box.append(item(label, [field(e[k], min, max, label, v => { e[k] = v }, step), unit ? node('small', unit) : ''].filter(Boolean), `${tip} (${min}–${max})`)) }
      else if (k === 'needsAcceptance') box.append(item('상대 수락 필요', toggle(e.needsAcceptance || e.transfer !== 'none', '상대 수락 필요', v => { e.needsAcceptance = v }, e.transfer !== 'none'), '켜면 상대가 수락한 뒤에만 효과가 적용돼. 물품·골드를 주고받으면 항상 필요해.'))
      else if (k === 'transfer') box.append(item('주고받기', seg(Object.entries(TRANSFER), e.transfer, '주고받기', v => { e.transfer = v; if (v !== 'none') e.needsAcceptance = true; touch(true) }), '수락하면 하는 주민이 상대에게 물품이나 골드를 줘. 물품이면 주민이 실제 생활 물품을 골라야 요청이 만들어지고, 물품이 없다고 골드로 바뀌지 않아. 잔액·재고는 수락할 때 다시 확인해.'))
      else if (k === 'place') box.append(item('장소', text(e.place, 60, '장소', v => { e.place = v.trim() }), '비우면 주민이 고르거나 지금 자리에서 해. 정확한 마을 장소 이름만 써.'))
      else box.append(item(k === 'actorStatuses' ? '내 상태 변화' : '상대 상태 변화', statusDeltas(e, k), STATUS_TIP[k]))
    }
    return box
  }
  function statusDeltas(e, key) {
    // Every slot number status the action may change: built-in or added, plus a turned-off one it already changes.
    const box = node('span', '', 'ag-deltas'), defs = ui.draft.statusDefs.filter(d => d.kind === 'number' && (d.enabled || e[key]?.[d.id]))
    if (!defs.length) return node('small', '켜진 숫자 상태가 없어. 상태 정의 탭에서 추가하거나 켜줘.')
    for (const d of defs) {
      const cell = node('span', '', 'ag-delta'); cell.append(node('small', d.enabled ? d.name : `${d.name} (꺼짐)`), field(e[key]?.[d.id] ?? 0, -30, 30, `${d.name} 변화`, v => { e[key] = { ...e[key] }; if (v) e[key][d.id] = v; else delete e[key][d.id] }, 1))
      box.append(cell)
    }
    return box
  }

  /* 상태 정의: the slot's shared definitions (values stay per resident) and each profile's read-only status blocks. */
  function renderStatuses() {
    const box = $('tab-statuses'); if (!box || !ui.draft) return
    const defs = ui.draft.statusDefs
    const add = button('+ 상태 추가', () => {
      const ids = new Set(defs.map(d => d.id)); let n = 1; while (ids.has(`custom${n}`)) n++
      const d = statusDefinition({ id: `custom${n}`, name: '새 상태', kind: 'number' })
      defs.push(d); ui.status = d.id; touch(true)
    })
    add.disabled = defs.length >= STATUS_MAX
    const shared = group(`공용 상태 ${defs.length}/${STATUS_MAX}`, help('이 슬롯의 모든 주민이 같은 정의를 쓰고 값은 주민마다 따로야. 시간 변화는 마을 시간 기준, 행동·대화로 바뀌는 양은 한 번에 증감 한도(step)까지야. 기본 상태는 ID·종류를 바꿀 수 없고 끄기만 할 수 있어.'),
      ...defs.map(d => statusRow(d)), add)
    const profiles = (app.world.statuses?.residents ?? []).map(r => [r, r.definitions.filter(d => d.readonly)]).filter(([, list]) => list.length)
    const blocks = group('프로필 상태 블록', help('각 주민 채팅 프로필의 상태 블록에서 읽어 와. 정의는 프로필에서만 바꿀 수 있어. 프로필 고정 필드는 모델 판단·행동 효과로는 바뀌지 않고 주민 창에서 직접 고칠 때만 바뀌어.'),
      ...(profiles.length ? profiles.map(([r, list]) => {
        const name = app.world.residents.find(x => x.profileId === r.profileId)?.name ?? `#${r.profileId}`
        return row(name, node('span', list.map(d => `${d.name}${d.kind === 'choice' ? ` (${d.values.join('/')})` : ` (${d.min}–${d.max})`}${d.valueReadonly ? ' · 고정 필드' : ''}`).join(' · '), 'ag-readonly'))
      }) : [node('p', '상태 블록이 있는 프로필이 없어.', 'set-empty')]))
    fill(box, shared, blocks)
  }
  function describe(d) {
    if (d.kind === 'choice') return `선택 · ${d.values.join('/')} · 처음 ${d.initial}`
    const drift = d.perHour ? ` · 시간당 ${d.perHour > 0 ? '+' : ''}${d.perHour}` : ''
    return `숫자 ${d.min}–${d.max} · 처음 ${d.initial}${drift} · 낮음 ≤${d.low} · 높음 ≥${d.high}`
  }
  function statusRow(d) {
    const open = ui.status === d.id, wrap = node('div', '', 'ag-item'); wrap.dataset.open = String(open)
    const head = node('div', '', 'ag-head'), name = node('span', '', 'ag-title')
    name.append(node('b', d.name), node('small', `${d.id} · ${describe(d)}`))
    const more = button(open ? '접기' : '편집', () => { ui.status = open ? null : d.id; renderStatuses() }); more.setAttribute('aria-expanded', String(open))
    head.append(toggle(d.enabled, `${d.name} 켜기`, v => { d.enabled = v }), name, node('span', d.builtin ? '기본' : '추가', `ag-tag${d.builtin ? '' : ' custom'}`), more)
    if (!d.builtin) head.append(button('삭제', () => { ui.draft.statusDefs = ui.draft.statusDefs.filter(x => x !== d); if (open) ui.status = null; touch(true) }, 'btn danger'))
    wrap.append(head)
    if (open) wrap.append(statusEditor(d))
    return wrap
  }
  function statusEditor(d) {
    const box = node('div', '', 'ag-effect')
    const item = (label, control, tip = '') => { const r = node('div', '', 'ag-field'), l = node('span', label); if (tip) l.dataset.tip = tip; r.append(l, ...[control].flat()); return r }
    const range = (label, key, lo, hi, tip, step = 'any') => item(label, field(d[key], lo, hi, label, v => { d[key] = v; if (fit()) renderStatuses() }, step), `${tip} (${lo}–${hi})`)
    // Keep the dependent bounds inside min..max the way statusDefinition() will; redraw only when one moved.
    const fit = () => {
      const before = [d.max, d.initial, d.low, d.high]
      d.max = Math.max(d.min, d.max); for (const k of ['initial', 'low', 'high']) d[k] = clamp(d[k], d.min, d.max)
      return [d.max, d.initial, d.low, d.high].some((v, i) => v !== before[i])
    }
    const fresh = !savedStatus(d)
    if (fresh) box.append(item('ID', text(d.id, 40, '상태 ID', v => { const id = v.trim(); if (ui.status === d.id) ui.status = id; d.id = id }), '영문으로 시작하는 1–40자 영문·숫자·_·- 야. profile_로 시작할 수 없고 저장 뒤에는 바꿀 수 없어.'))
    box.append(item('이름', text(d.name, 40, '상태 이름', v => { d.name = v })), item('설명', text(d.description, 300, '상태 설명', v => { d.description = v }, 'ag-text ag-desc'), '모델에게 보여 주는 뜻이야.'))
    box.append(item('종류', seg([['number', '숫자'], ['choice', '선택']], d.kind, '상태 종류', v => {
      d.kind = v
      if (v === 'choice' && d.values.length < 2) d.values = ['보통', '좋음']
      d.initial = v === 'choice' ? d.values[0] : clamp(Number(d.initial) || d.min, d.min, d.max)
      touch(true)
    }, !fresh), fresh ? '' : '저장된 상태의 종류는 바꿀 수 없어.'))
    if (d.kind === 'number') {
      box.append(range('최소', 'min', -10000, 10000, '값의 하한'), range('최대', 'max', -10000, 10000, '값의 상한, 최소보다 작으면 최소로 맞춰'),
        range('처음 값', 'initial', -10000, 10000, '새 주민의 값, 최소–최대 안'), range('시간당 변화', 'perHour', -100, 100, '마을 시간 한 시간마다 더해져'),
        range('한 번 증감 한도', 'step', 0, 100, '행동·대화로 한 번에 바뀌는 최대 폭'),
        range('낮음 기준', 'low', -10000, 10000, '이 값 이하면 낮음 힌트를 줘'), range('높음 기준', 'high', -10000, 10000, '이 값 이상이면 높음 힌트를 줘'),
        item('낮을 때 힌트', text(d.lowHint, 160, '낮을 때 힌트', v => { d.lowHint = v }, 'ag-text ag-desc')), item('높을 때 힌트', text(d.highHint, 160, '높을 때 힌트', v => { d.highHint = v }, 'ag-text ag-desc')))
    } else {
      const values = document.createElement('textarea'); values.className = 'ag-text ag-values'; values.rows = 3; values.value = d.values.join('\n'); values.setAttribute('aria-label', '선택지')
      const initial = document.createElement('select'); initial.className = 'life-select'; initial.setAttribute('aria-label', '처음 값')
      const fill = () => { setOptions(initial, d.values.map(v => [v, v])); initial.value = d.values.includes(d.initial) ? d.initial : d.values[0] ?? '' }
      values.addEventListener('input', () => { d.values = [...new Set(values.value.split('\n').map(v => v.trim().slice(0, 40)).filter(Boolean))].slice(0, 16); if (!d.values.includes(d.initial)) d.initial = d.values[0]; fill(); touch() })
      initial.addEventListener('change', () => { d.initial = initial.value; touch() })
      fill()
      box.append(item('선택지', values, '한 줄에 하나, 2–16개, 각 40자까지야.'), item('처음 값', initial))
    }
    return box
  }
  function render() { renderAgents(); renderStatuses() }

  /** Everything the server will store, normalized by the same rules; throws the server's own messages. */
  function checked() {
    for (const a of ui.draft.actionCatalog.filter(a => !savedAction(a))) if (!ID.test(a.id)) throw new Error(`행동 ID "${a.id}"를 확인해줘. 영문으로 시작하는 1–40자 영문·숫자·_·-야.`)
    agentSettings(current(), ui.draft)
    return ui.draft
  }
  async function save() {
    if (!ui.dirty) return
    const settings = checked()
    try { await request('agent-configure', { revision: ui.base, saveId: app.world.save?.id, settings }) }
    catch (error) {
      if (!/설정이 바뀌었어/.test(error.message)) throw error
      ui.dirty = false; changed()
      await request('agent-state').catch(() => {})
      reset(true); publish()
      throw new Error('다른 곳에서 AI 행동 설정이 바뀌어서 지금 설정을 새로 불러왔어. 다시 고친 뒤 적용해줘.')
    }
    ui.dirty = false; reset(true); changed(); publish()
  }

  return {
    get dirty() { return ui.dirty },
    reset() { ui.dirty = false; reset(true); changed() },
    save,
    /** Another settings write (모험 설정) shares the revision: our own accepted write moves the base along with it. */
    rebase(next) { if (ui.dirty && ui.base === next - 1) ui.base = next },
    update() {
      if (!app.world) return
      if (!ui.dirty && (ui.draft === null || app.world.agentSettingsRevision !== ui.base)) { reset(); return }
      paintDaily()
      const sig = JSON.stringify((app.world.statuses?.residents ?? []).map(r => [r.profileId, r.definitions.filter(d => d.readonly).map(d => d.id)]))
      if (sig !== ui.profileSig) { ui.profileSig = sig; renderStatuses() }
    },
    /** The assistant's draft: same merge rules as the server (lists replace, deciders merge per category). */
    prepare(args) {
      if (!app.world) throw new Error('마을을 불러오는 중이야.')
      if (!ui.draft) reset(true)
      const patch = {}
      for (const k of ['statusDefs', 'conversationMaxTurns', 'maxConversations']) if (args[k] !== undefined) patch[k] = args[k]
      // A built-in action's effect is fixed (it has no effect editor here), so only its switch, label and description are taken.
      if (args.actionCatalog !== undefined) patch.actionCatalog = args.actionCatalog.map(a => ACTION_DEFAULTS.some(b => b.category === a.category && b.id === a.id) ? (({ effect, ...rest }) => rest)(a) : a)
      if (args.deciders) patch.deciders = Object.fromEntries(CATEGORIES.map(c => [c, { ...ui.draft.deciders[c], ...args.deciders[c] }]))
      const base = { ...current(), ...ui.draft }
      ui.draft = take(agentSettings(base, patch))
      ui.action = ui.status = null
      touch(true)
      return args.statusDefs && !args.actionCatalog && !args.deciders ? 'statuses' : 'agents'
    },
    snapshot() {
      const s = current()
      if (!s) return null
      // Status ids are user-chosen, so effect maps are published as [{id, delta}] lists; built-ins carry no effect.
      const list = m => Object.entries(m ?? {}).map(([id, delta]) => ({ id, delta }))
      const brief = a => a.builtin ? { category: a.category, id: a.id, label: a.label, description: a.description, enabled: a.enabled, builtin: true }
        : { ...a, effect: { ...a.effect, actorStatuses: list(a.effect.actorStatuses), targetStatuses: list(a.effect.targetStatuses) } }
      // The draft shows only the parts that differ from the saved settings.
      const draft = ui.dirty && ui.draft ? Object.fromEntries(Object.keys(ui.draft).filter(k => JSON.stringify(ui.draft[k]) !== JSON.stringify(s[k])).map(k => [k, k === 'actionCatalog' ? ui.draft[k].map(brief) : ui.draft[k]])) : null
      return { revision: app.world.agentSettingsRevision, deciders: s.deciders, conversationMaxTurns: s.conversationMaxTurns, maxConversations: s.maxConversations,
        actionCatalog: s.actionCatalog.map(brief), statusDefs: s.statusDefs, agentDaily: app.world.agentDaily ?? null, draft,
        note: 'judge/chat은 각 주민 자신의 프로필에 적용돼. 분류별 간격·주민별 게임 시간당·UTC 하루 슬롯 공용 한도를 따라. 0이면 기다려. village는 일상·구매·장비·근무·수면·출발·받은 요청의 답변 여부, combat은 전투·탐사, social은 대화·방송·신탁이야. 요청이 와도 다른 행동을 먼저 고를 수 있어. statusDefs·actionCatalog는 전체 교체하며 빠진 기본 항목은 꺼져. 상태 효과는 [{id,delta}]로 슬롯의 숫자 상태를 참조해. 기본 효과는 고정이고 deciders는 분류별로 합쳐. 사람이 적용해.' }
    },
  }
}
