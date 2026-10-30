import { node, svg, setText } from '../ui/dom.js'
import { createPortrait } from '../ui/portrait.js'
import { P } from '../guild/common.js'
import { DECIDER_LABEL } from './agents.js'

/*
 * The resident window: goal, statuses (values per resident, definitions shared or from the profile), relationships,
 * the conversations and consent requests they are in, and which decider the server actually used. Status values and
 * relationships are edited here (`resident-status-set`, `relationship-set`); accepting or refusing a request is the
 * residents' own decision and is only shown.
 */
const PULSE = 'M3 12h4l3-7 4 14 3-7h4'
const KIND = { item: '물품', gold: '골드', help: '도움', accompany: '동행' }
const DECISION_KIND = { everyday: '일상', 'request reply': '요청 답변', combat: '전투', expedition: '탐사', oracle: '신탁', conversation: '대화', broadcast: '방송' }
const DECISION_CATEGORY = { village: '생활', social: '교류', combat: '전투·탐사' }
export const REQUEST_STATUS = { pending: '대기 중', accepted: '수락', refused: '거절', expired: '만료', failed: '실패', cancelled: '취소' }
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const fmt = v => typeof v === 'number' ? String(Math.round(v * 10) / 10) : String(v ?? '')
/** `{id: value}` as `[{id, value}]` for published page data (an id could look like a protected key). */
export const listOf = map => Object.entries(map ?? {}).map(([id, value]) => ({ id, value }))
const nameOf = (world, id) => world?.residents.find(r => r.profileId === id)?.name ?? `#${id}`

/** One consent request as words: who asks whom for what, and how it ended. Shared with the village feed. */
export function requestText(world, q) {
  const id = q.action?.id, e = q.action?.effect ?? {}
  const item = q.item ? world?.rpg?.life?.catalog.items.find(i => i.id === q.item)?.name ?? q.item : ''
  const gold = id === 'trade' || q.kind === 'gold' || e.transfer === 'gold'
  const bits = [item && `${item} ×${id === 'trade' ? 1 : q.amount}`, gold && `${q.amount}G`, !item && !gold && KIND[q.kind], q.place && `장소 ${q.place}`, q.detail].filter(Boolean)
  return { title: `${nameOf(world, q.from)} → ${nameOf(world, q.to)} · ${q.action?.label ?? id ?? '요청'}`, detail: bits.join(' · '),
    status: REQUEST_STATUS[q.status] ?? q.status, reason: q.status === 'pending' ? '' : q.reason || '' }
}
/** Whole real minutes until a pending request expires (`expiresAt`), or null without a deadline. */
export const minutesLeft = (world, q) => q.status === 'pending' && q.expiresAt ? Math.max(0, Math.ceil((q.expiresAt - (world?.now ?? Date.now())) / 60_000)) : null
/** A request card for lists; a pending one shows its time left and, given `cancel`, a cancel button. */
export function requestCard(world, q, cancel = null) {
  const t = requestText(world, q), card = node('div', '', 'rs-request'); card.dataset.status = q.status
  const head = node('div', '', 'rs-request-head'), left = minutesLeft(world, q)
  head.append(node('b', t.title), node('span', left === null ? t.status : `${t.status} · ${left ? `${left}분 남음` : '곧 만료'}`, 'rs-request-state'))
  if (cancel && q.status === 'pending') {
    const b = node('button', '취소', 'btn danger rs-cancel'); b.type = 'button'; b.setAttribute('aria-label', `${t.title} 요청 취소`)
    // `cancel` resolves false when it did not run or failed; the card stays usable then.
    b.addEventListener('click', async event => { event.stopPropagation(); b.disabled = true; if (!await cancel(q) && b.isConnected) b.disabled = false })
    head.append(b)
  }
  card.append(head)
  if (t.detail) card.append(node('small', t.detail))
  if (t.reason) card.append(node('small', `이유 · ${t.reason}`, 'rs-reason'))
  return card
}
/** Which way the server decided, as recorded in `agentRoute`. */
export function routeText(route) {
  if (!route) return '기록 없음'
  const how = DECIDER_LABEL[route.decider] ?? route.decider
  const via = [route.model, route.engine].filter(Boolean).join(' · ')
  return `${how}${route.fallback ? ' (판단 모델이 없어 채팅 모델로 전환)' : ''}${via ? ` · ${via}` : ''}`
}
/** A resident waits to retry a failed village decision: `agentError` and `agentReadyAt` are village-only (combat has `combatError`). */
export const backoff = (world, r) => !!r?.agentError && (r.agentReadyAt ?? 0) > (world?.now ?? 0)

export function createResidentView({ app, request, toast, publish, faces, onOpen }) {
  const stage = document.getElementById('stage')
  const layer = document.createElement('div'); layer.id = 'resident'; layer.className = 'menu-layer life-layer'; layer.hidden = true
  layer.innerHTML = `<div class="dim"></div><section class="menu gw life-panel resident-panel" role="dialog" aria-modal="true" aria-labelledby="resident-heading">
    <header class="gw-head"><span class="gw-icon">${svg(PULSE)}</span><h2 id="resident-heading">주민 상태</h2><span class="grow"></span><span id="resident-state" class="gw-status"></span><button type="button" id="resident-close" class="ib" data-tip="닫기" aria-label="닫기">${svg(P.close)}</button></header>
    <div class="life-body"><div class="life-split"><nav id="resident-list" class="life-list" aria-label="주민"></nav>
      <div class="life-detail"><div id="rs-hero"></div><div id="rs-ai" class="life-sec"></div><div id="rs-status" class="life-sec"></div><div id="rs-rel" class="life-sec"></div><div id="rs-talk" class="life-sec"></div></div></div></div></section>`
  stage.append(layer)
  const $ = id => document.getElementById(id)
  const ui = { profileId: null, edits: new Map(), relEdits: new Map(), busy: false, sig: {} }
  let opener = null, statRows = new Map(), relRows = new Map(), waitText = null
  let historyKey = '', history = null
  function loadHistory(r) {
    const key = JSON.stringify([app.world.save?.id, r.profileId, (r.decisionLog ?? []).map(e => [e.id, e.status])])
    if (key === historyKey) return
    historyKey = key
    request('resident-decisions', { profileId: r.profileId, saveId: app.world.save?.id }, true).then(result => {
      if (historyKey !== key || layer.hidden) return
      history = { profileId: r.profileId, entries: result.entries ?? [] }; ui.sig['rs-ai'] = ''; renderAi(resident())
    }).catch(error => { if (historyKey === key) toast(error.message) })
  }

  const resident = () => app.world?.residents.find(r => r.profileId === ui.profileId) ?? null
  const face = r => createPortrait(r.name, faces.get(r.profileId), r.color)
  const others = r => app.world.residents.filter(o => o.profileId !== r.profileId && app.world.rpg?.actors.some(a => a.profileId === o.profileId))
  const relation = (a, b) => app.world.relationships?.find(x => x.a === Math.min(a, b) && x.b === Math.max(a, b)) ?? null
  const defsOf = r => (r.statusDefs ?? []).filter(d => d.enabled)
  const editsOf = id => ui.edits.get(id) ?? {}
  /** Status edits keep only values the resident's current definitions still accept (a status may be turned off meanwhile). */
  function pruneEdits(r) {
    const edits = ui.edits.get(r.profileId); if (!edits) return
    const defs = defsOf(r), kept = Object.fromEntries(Object.entries(edits).filter(([id, v]) => { const d = defs.find(x => x.id === id); return d && (d.kind === 'number' ? Number.isFinite(v) : d.values.includes(v)) }))
    if (Object.keys(kept).length) ui.edits.set(r.profileId, kept); else ui.edits.delete(r.profileId)
  }
  /** A relationship edit keeps only what differs from the server: the affinity as typed, a label only when typed and new. */
  function relEdit(from, to, affinity, label) {
    const rel = relation(from, to), e = {}
    if (affinity !== '' && Number(affinity) !== Math.round(rel?.affinity ?? 0)) e.affinity = affinity
    const name = label.trim().slice(0, 30); if (name && name !== (rel?.label ?? '')) e.label = name
    return Object.keys(e).length ? e : null
  }
  const setRel = (key, e) => { if (e) ui.relEdits.set(key, e); else ui.relEdits.delete(key) }
  /** Re-draws a section only when what it shows changed; live numbers are written in place (`refresh`). */
  const section = (id, sig, build) => { if (ui.sig[id] === sig) return; ui.sig[id] = sig; const el = $(id), top = layer.querySelector('.life-body').scrollTop; el.replaceChildren(...build()); layer.querySelector('.life-body').scrollTop = top }
  /** Runs one write at a time; resolves true only when it ran and succeeded. */
  const run = fn => async () => {
    if (ui.busy) return false
    ui.busy = true; render(); let ok = false
    try { await fn(); ok = true } catch (error) { toast(error.message) } finally { ui.busy = false; render(); publish() }
    return ok
  }
  /** Ends a pending request as cancelled; a request that already ended is left as it is (the server no-ops). */
  const cancelRequest = q => run(() => request('request-cancel', { saveId: app.world.save?.id, requestId: q.id, reason: '사용자가 화면에서 취소했어.' }))()

  function renderList() {
    const sig = JSON.stringify([ui.profileId, app.world.residents.map(r => [r.profileId, r.name, r.color, faces.get(r.profileId)?.url ?? '', backoff(app.world, r)])])
    section('resident-list', sig, () => app.world.residents.map(r => {
      const b = node('button', '', 'life-item rs-who'); b.type = 'button'; b.setAttribute('aria-pressed', String(r.profileId === ui.profileId))
      b.append(face(r), node('b', r.name)); if (backoff(app.world, r)) b.append(node('i', '', 'rs-warn'))
      b.addEventListener('click', () => { ui.profileId = r.profileId; ui.sig = {}; render(); publish() })
      return b
    }))
  }
  function renderHero(r) {
    section('rs-hero', JSON.stringify([r.profileId, r.name, r.color, faces.get(r.profileId)?.url ?? '', r.goal, r.destination]), () => {
      const hero = node('div', '', 'life-hero'), title = node('div', '', 'life-title')
      title.append(node('b', r.name), node('small', r.destination || ''))
      hero.append(face(r), title)
      const goal = node('p', '', 'rs-goal'); goal.append(node('span', '목표', 'rs-goal-label'), document.createTextNode(r.goal || '아직 정한 목표가 없어'))
      return [hero, goal]
    })
  }
  function renderAi(r) {
    const decisionLog = history?.profileId === r.profileId ? history.entries.map(e => ({ ...e, ...(r.decisionLog ?? []).find(x => x.id === e.id), options: e.options })) : r.decisionLog ?? []
    // The retry countdown is written in place by refresh(); only whether there is a wait shapes the section.
    section('rs-ai', JSON.stringify([r.profileEngine, r.judge, r.agentRoutes, r.agentRoute, r.decisionLog, r.agentError, r.combatError, r.agentBudgetText, r.combatBudgetText, r.budgetRemaining, r.budgetRetries, backoff(app.world, r), !!app.world.memoryBacklogged]), () => {
      waitText = null
      const fact = (label, value, tip = '') => { const f = node('div', '', 'life-fact'); if (tip) f.dataset.tip = tip; f.append(node('small', label), node('b', value)); return f }
      const facts = node('div', '', 'life-facts')
      const judge = r.judge?.presetName ? `${r.judge.presetName}${r.judge.available ? '' : ' · 판단 모델 없음'}` : r.judge?.available ? '프리셋 없음 · 판단 모델 있음' : '없음'
      facts.append(fact('엔진', r.profileEngine || '알 수 없음', '주민 채팅 프로필의 엔진이야.'),
        fact('판단 프리셋', judge, '프로필의 판단 프리셋이야. 대화 차례의 금지 행동·지시와 다음 발언자 판단에 쓰여.'),
        fact('마을 판단', routeText(r.agentRoutes?.village), `생활·교류 통합 일상 판단과 받은 요청 답변 · ${routeText(r.agentRoutes?.village)}`),
        fact('모험 판단', routeText(r.agentRoutes?.rpg), `전투·원정 출발·계속/귀환 판단(AI 행동의 전투·원정 줄) · ${routeText(r.agentRoutes?.rpg)}`))
      const out = [node('h4', 'AI 판단'), facts]
      if (r.agentBudgetText) out.push(node('p', r.agentBudgetText, 'life-note'))
      if (r.combatBudgetText) out.push(node('p', `모험 · ${r.combatBudgetText}`, 'life-note'))
      if (r.budgetRemaining) out.push(node('p', `${r.budgetRemaining} · 재시도/연속 실패 ${r.budgetRetries ?? 0}`, 'life-note'))
      if (r.agentError) {
        const note = node('p', `마을 판단 실패 · ${r.agentError}`, 'life-note warn')
        if (backoff(app.world, r)) { waitText = node('span'); note.append(waitText) }
        out.push(note)
      }
      if (r.combatError) out.push(node('p', `모험 판단 실패 · ${r.combatError}`, 'life-note warn'))
      if (app.world.memoryBacklogged) out.push(node('p', '기억 정리가 밀려서 새 주민 판단·대화를 기다리고 있어. 이미 정한 이동·휴식·생산은 계속돼.', 'life-note warn'))
      const history = node('details'), summary = node('summary', `판단 기록 · 최근 ${decisionLog.length}개`)
      history.open = $('rs-ai').querySelector('details')?.open ?? false
      history.append(summary)
      for (const e of decisionLog) {
        const card = node('div', '', 'conai-list-row'), body = node('div', '', 'conai-row-main')
        const chosen = e.chosen, how = DECIDER_LABEL[e.method] ?? e.method ?? '대기'
        const title = `${DECISION_KIND[e.kind] ?? e.kind} · ${chosen?.label ?? (e.status === 'wait' ? '대기' : '실패')}`
        body.append(node('b', title, 'conai-row-title'), node('small', `${new Date(e.at).toLocaleString()} · ${e.gameTime} · ${how}${[e.engine, e.model].filter(Boolean).map(x => ` · ${x}`).join('')}`, 'conai-row-meta'))
        if (chosen) body.append(node('p', [chosen.targetName || (chosen.target ? `#${chosen.target}` : ''), chosen.place].filter(Boolean).join(' · '), 'life-note'))
        if (e.probability !== null && e.probability !== undefined || e.confidence !== null && e.confidence !== undefined)
          body.append(node('p', `확률 ${e.probability ?? '없음'} · 신뢰도 ${e.confidence ?? '없음'}`, 'life-note'))
        if (e.reason || e.effect || e.failure) body.append(node('p', [e.reason, e.effect, e.failure, e.count > 1 ? `같은 이유 ${e.count}회 · 최근 ${new Date(e.lastAt).toLocaleString()}` : ''].filter(Boolean).join(' · '), 'life-note'))
        body.append(node('small', `제시한 선택지: ${(e.options ?? []).map(o => `${o.id} · ${o.label} [${DECISION_CATEGORY[o.category] ?? o.category}]`).join(' / ') || `${e.offeredCount ?? 0}개`}`, 'conai-row-meta'))
        card.append(body); history.append(card)
      }
      out.push(history)
      return out
    })
  }
  function renderStatus(r) {
    const defs = defsOf(r)
    section('rs-status', JSON.stringify([r.profileId, defs, ui.busy]), () => {
      statRows = new Map()
      const save = node('button', '상태 저장', 'btn main'); save.type = 'button'; save.id = 'rs-status-save'
      save.addEventListener('click', run(async () => {
        // Checked against the latest state, not the one this section was drawn from.
        const now = resident(); if (!now) return
        pruneEdits(now)
        const values = Object.fromEntries(Object.entries(editsOf(now.profileId)).map(([id, v]) => { const d = defsOf(now).find(x => x.id === id); return [id, d.kind === 'number' ? clamp(v, d.min, d.max) : v] }))
        if (!Object.keys(values).length) return
        await request('resident-status-set', { profileId: r.profileId, values, saveId: app.world.save?.id })
        ui.edits.delete(r.profileId)
      }))
      const undo = node('button', '되돌리기', 'btn'); undo.type = 'button'; undo.id = 'rs-status-undo'
      undo.addEventListener('click', () => { ui.edits.delete(r.profileId); refresh(r); publish() })
      const head = node('div', '', 'rs-sec-head'); head.append(node('h4', '상태'), node('span', '', 'grow'), undo, save)
      if (!defs.length) return [head, node('p', '켜진 상태가 없어. 마을 관리 › 상태 정의에서 켤 수 있어.', 'gw-empty')]
      return [head, ...defs.map(d => {
        const row = node('div', '', 'rs-stat'), name = node('span', '', 'life-name')
        const title = node('b', d.name); if (d.readonly) title.append(node('span', '프로필', 'ag-tag'))
        if (d.valueReadonly) title.append(node('span', '프로필 고정 필드', 'ag-tag'))
        name.append(title, node('small', d.description || ''))
        const meter = node('span', '', 'rs-meter'), hint = node('small', '', 'rs-hint'), value = node('span', '', 'rs-value num')
        let input, fill = null
        if (d.kind === 'number') {
          const bar = node('span', '', 'rpg-bar'); fill = node('i'); bar.append(fill); meter.append(bar, value)
          input = Object.assign(document.createElement('input'), { type: 'number', min: d.min, max: d.max, step: 'any', className: 'life-num' })
        } else {
          meter.append(value); value.classList.add('rs-chip')
          input = document.createElement('select'); input.className = 'life-select'
          input.append(...d.values.map(v => Object.assign(node('option', v), { value: v })))
        }
        input.setAttribute('aria-label', `${d.name} 값`); input.disabled = ui.busy
        if (d.valueReadonly) input.dataset.tip = '프로필 고정 필드야. 모델 판단·행동 효과로는 바뀌지 않고 여기서 직접 고칠 때만 바뀌어.'
        input.addEventListener(d.kind === 'number' ? 'input' : 'change', () => {
          const edits = { ...editsOf(r.profileId) }
          if (d.kind === 'number' && (input.value === '' || !Number.isFinite(Number(input.value)))) delete edits[d.id]
          else edits[d.id] = d.kind === 'number' ? Number(input.value) : input.value
          ui.edits.set(r.profileId, edits); refresh(r); publish()
        })
        // The clamped number is what will be saved, so the edit takes it too.
        if (d.kind === 'number') input.addEventListener('change', () => {
          if (input.value === '' || !Number.isFinite(Number(input.value))) return
          const v = clamp(Number(input.value), d.min, d.max); input.value = fmt(v)
          ui.edits.set(r.profileId, { ...editsOf(r.profileId), [d.id]: v }); refresh(r); publish()
        })
        row.append(name, meter, input, hint)
        statRows.set(d.id, { d, fill, value, hint, input, row })
        return row
      })]
    })
  }
  function renderRelations(r) {
    const list = others(r)
    section('rs-rel', JSON.stringify([r.profileId, list.map(o => [o.profileId, o.name, o.color, faces.get(o.profileId)?.url ?? '']), ui.busy]), () => {
      relRows = new Map()
      if (!list.length) return [node('h4', '관계'), node('p', '다른 주민이 없어.', 'gw-empty')]
      return [node('h4', '관계'), ...list.map(o => {
        const row = node('div', '', 'rs-rel'), name = node('span', '', 'life-name'), label = node('small')
        name.append(node('b', o.name), label)
        const bar = node('span', '', 'rpg-bar rs-affinity'), fill = node('i'); bar.append(fill)
        const value = node('span', '', 'rs-value num'), meter = node('span', '', 'rs-meter'); meter.append(bar, value)
        const affinity = Object.assign(document.createElement('input'), { type: 'number', min: -100, max: 100, step: 1, className: 'life-num' }); affinity.setAttribute('aria-label', `${o.name}와의 호감도`)
        const tag = Object.assign(document.createElement('input'), { type: 'text', maxLength: 30, className: 'ag-text rs-label', placeholder: '관계 이름' }); tag.setAttribute('aria-label', `${o.name}와의 관계 이름`)
        const key = `${r.profileId}:${o.profileId}`
        const edit = () => { setRel(key, relEdit(r.profileId, o.profileId, affinity.value, tag.value)); refresh(r); publish() }
        affinity.addEventListener('input', edit); tag.addEventListener('input', edit)
        const save = node('button', '저장', 'btn'); save.type = 'button'
        save.addEventListener('click', run(async () => {
          const e = ui.relEdits.get(key); if (!e) return
          // An unchanged affinity is sent as it is; the label only when one was typed, so an automatic label stays automatic.
          const n = e.affinity === undefined ? relation(r.profileId, o.profileId)?.affinity ?? 0 : Math.round(Number(e.affinity))
          if (!Number.isFinite(n)) throw new Error('호감도는 -100–100 사이 숫자로 써줘.')
          await request('relationship-set', { from: r.profileId, to: o.profileId, affinity: clamp(n, -100, 100), ...(e.label ? { label: e.label } : {}), saveId: app.world.save?.id })
          ui.relEdits.delete(key)
        }))
        const undo = node('button', '되돌리기', 'btn'); undo.type = 'button'
        undo.addEventListener('click', () => { ui.relEdits.delete(key); refresh(r); publish() })
        for (const c of [affinity, tag, save, undo]) c.disabled = ui.busy
        const controls = node('span', '', 'rs-rel-edit'); controls.append(affinity, tag, undo, save)
        row.append(face(o), name, meter, controls)
        relRows.set(o.profileId, { key, label, fill, value, affinity, tag, save, undo })
        return row
      })]
    })
  }
  function renderTalk(r) {
    const id = r.profileId, talks = (app.world.conversations ?? []).filter(c => c.participants.includes(id))
    const requests = (app.world.pendingRequests ?? []).filter(q => q.from === id || q.to === id)
    const open = requests.filter(q => q.status === 'pending'), done = requests.filter(q => q.status !== 'pending').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)).slice(0, 5)
    section('rs-talk', JSON.stringify([talks.map(c => [c.id, c.participants, c.speaker, c.turn, c.maxTurns, c.thinking, c.lines.slice(-3)]), open, open.map(q => minutesLeft(app.world, q)), done, ui.busy]), () => {
      const out = [node('h4', '대화 · 요청')]
      for (const c of talks) {
        const box = node('div', '', 'rs-talk'), head = node('div', '', 'rs-request-head')
        head.append(node('b', c.participants.map(p => nameOf(app.world, p)).join(' · ')), node('span', `${c.turn}/${c.maxTurns}차례${c.thinking ? ` · ${nameOf(app.world, c.speaker)} 생각 중…` : ` · 다음 ${nameOf(app.world, c.speaker)}`}`, 'rs-request-state'))
        box.append(head, ...c.lines.slice(-3).map(l => node('small', `${l.name}: ${l.text}`)))
        out.push(box)
      }
      out.push(...open.map(q => requestCard(app.world, q, ui.busy ? null : cancelRequest)), ...done.map(q => requestCard(app.world, q)))
      if (out.length === 1) out.push(node('p', '지금 대화하거나 주고받는 요청이 없어.', 'gw-empty'))
      return out
    })
  }
  /** Live numbers in place: bars, values, hints; an input shows the server value unless it is being edited. */
  function refresh(r) {
    const values = r.statuses ?? {}, edits = editsOf(r.profileId)
    for (const { d, fill, value, hint, input, row } of statRows.values()) {
      const v = values[d.id] ?? d.initial
      setText(value, fmt(v))
      if (fill) fill.style.width = `${d.max > d.min ? clamp((v - d.min) / (d.max - d.min), 0, 1) * 100 : 0}%`
      const level = d.kind === 'number' ? v <= d.low ? 'low' : v >= d.high ? 'high' : '' : ''
      row.dataset.level = level
      setText(hint, level === 'low' ? `낮음 · ${d.lowHint || `${d.low} 이하`}` : level === 'high' ? `높음 · ${d.highHint || `${d.high} 이상`}` : '')
      const edited = Object.hasOwn(edits, d.id)
      row.dataset.edited = String(edited)
      if (document.activeElement !== input) input.value = edited ? String(edits[d.id]) : d.kind === 'number' ? fmt(v) : String(v)
    }
    for (const [other, x] of relRows) {
      const rel = relation(r.profileId, other), affinity = rel?.affinity ?? 0
      // An edit the server has caught up with (same affinity and label) is dropped.
      const before = ui.relEdits.get(x.key); if (before) setRel(x.key, relEdit(r.profileId, other, before.affinity ?? '', before.label ?? ''))
      const edit = ui.relEdits.get(x.key)
      setText(x.label, rel ? rel.label : '기록 없음'); setText(x.value, String(Math.round(affinity)))
      x.fill.style.width = `${(affinity + 100) / 2}%`; x.fill.parentElement.dataset.sign = affinity < 0 ? 'neg' : 'pos'
      if (document.activeElement !== x.affinity) x.affinity.value = edit?.affinity ?? String(Math.round(affinity))
      if (document.activeElement !== x.tag) x.tag.value = edit?.label ?? rel?.label ?? ''
      x.save.disabled = x.undo.disabled = ui.busy || !edit
    }
    if (waitText) {
      const seconds = backoff(app.world, r) ? Math.ceil((r.agentReadyAt - app.world.now) / 1000) : 0
      setText(waitText, seconds ? ` · ${seconds}초 뒤 다시 시도` : ' · 다시 시도하는 중')
    }
    const pending = Object.keys(edits).length
    if ($('rs-status-save')) { $('rs-status-save').disabled = ui.busy || !pending; $('rs-status-undo').disabled = ui.busy || !pending }
  }
  function render() {
    if (layer.hidden || !app.world) return
    if (!resident()) ui.profileId = app.world.residents[0]?.profileId ?? null
    renderList()
    const r = resident()
    for (const id of ['rs-hero', 'rs-ai', 'rs-status', 'rs-rel', 'rs-talk']) $(id).hidden = !r
    const pill = $('resident-state')
    if (!r) { setText(pill, ''); return }
    loadHistory(r)
    pill.dataset.state = backoff(app.world, r) ? 'wait' : r.activity === 'talk' ? 'busy' : 'on'
    setText(pill, backoff(app.world, r) ? '판단 재시도 대기' : r.activity === 'talk' ? '대화 중' : app.world.running ? '깨어 있음' : '마을이 자는 중')
    pruneEdits(r)
    renderHero(r); renderAi(r); renderStatus(r); renderRelations(r); renderTalk(r)
    refresh(r)
  }
  function open(profileId = app.selected) {
    if (!app.world) throw new Error('마을을 불러오는 중이야.')
    if (profileId !== null && profileId !== undefined && !app.world.residents.some(r => r.profileId === profileId)) throw new Error('마을에 없는 주민이야.')
    onOpen?.()
    if (layer.hidden) opener = document.activeElement
    if (profileId !== null && profileId !== undefined && profileId !== ui.profileId) { ui.profileId = profileId; ui.sig = {} }
    layer.hidden = false; render(); publish()
    $('resident-close').focus({ preventScroll: true })
  }
  function close() {
    if (layer.hidden) return
    layer.hidden = true
    historyKey = ''; history = null
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    publish()
  }
  $('resident-close').addEventListener('click', close); layer.querySelector('.dim').addEventListener('click', close)
  document.addEventListener('keydown', event => { if (!layer.hidden && event.key === 'Escape') close() })

  return {
    open, close, update: render, cancelRequest,
    get isOpen() { return !layer.hidden },
    get dirty() { return ui.edits.size > 0 || ui.relEdits.size > 0 },
    /** Another save slot: its residents are not this one's. */
    reset() { ui.edits.clear(); ui.relEdits.clear(); ui.profileId = null; ui.sig = {} },
    /**
     * The assistant's draft (`ai-aquarium.resident_prepare`): fills this window's status and relationship edits with the
     * same definitions and bounds the save buttons use, then opens it. Nothing is saved; a person presses 상태 저장 / 저장.
     */
    prepare(args) {
      if (!app.world) throw new Error('마을을 불러오는 중이야.')
      const rel = args.relationship, id = args.profileId ?? rel?.from
      if (id === undefined) throw new Error('profileId나 relationship을 줘.')
      if (args.statusValues?.length && args.profileId === undefined) throw new Error('상태 값을 바꿀 주민 profileId를 줘.')
      const r = app.world.residents.find(x => x.profileId === id)
      if (!r) throw new Error('마을에 없는 주민이야.')
      const values = {}, clamped = []
      for (const v of args.statusValues ?? []) {
        const d = defsOf(r).find(x => x.id === v.id)
        if (!d) throw new Error(`${r.name}에게 켜진 상태 ${v.id}가 없어. agentSettings.statusDefs의 켜진 ID나 그 주민의 profileStatusIds를 써줘.`)
        if (d.kind === 'number') {
          if (v.number === undefined || v.choice !== undefined) throw new Error(`${d.name}은 숫자 상태야. number만 써줘.`)
          const n = clamp(v.number, d.min, d.max); if (n !== v.number) clamped.push(`${d.name} ${v.number}→${n}`)
          values[d.id] = n
        } else {
          if (v.choice === undefined || v.number !== undefined) throw new Error(`${d.name}은 선택형 상태야. choice만 써줘.`)
          if (!d.values.includes(v.choice)) throw new Error(`${d.name}의 선택지는 ${d.values.join('/')}야.`)
          values[d.id] = v.choice
        }
      }
      let relKey = null, relNext = null
      if (rel) {
        if (![rel.from, rel.to].includes(r.profileId)) throw new Error('relationship은 profileId 주민과 다른 주민 사이여야 해.')
        const other = rel.from === r.profileId ? rel.to : rel.from
        if (!others(r).some(o => o.profileId === other)) throw new Error('관계를 정할 수 있는 다른 주민이 아니야.')
        // Like typing in the row: a label only when given, so an automatic label is not pinned by an affinity draft.
        relKey = `${r.profileId}:${other}`; relNext = relEdit(r.profileId, other, String(clamp(Math.round(rel.affinity), -100, 100)), rel.label ?? '')
      }
      if (Object.keys(values).length) ui.edits.set(r.profileId, { ...editsOf(r.profileId), ...values })
      if (relKey) setRel(relKey, relNext)
      open(r.profileId)
      return { opened: true, profileId: r.profileId, statusEdits: listOf(editsOf(r.profileId)), relationshipEdit: relNext ? { from: r.profileId, to: Number(relKey.split(':')[1]), ...relNext } : null, clamped,
        note: `초안만 채웠어.${rel && !relNext ? ' 관계는 지금 값과 같아서 바꿀 게 없어.' : ''} 사람이 주민 상태 창의 상태 저장(상태 값)이나 그 관계 줄의 저장을 눌러야 반영돼.` }
    },
    /** Status ids are user-chosen, so edits are published as lists, never as object keys. */
    snapshot() {
      return { open: !layer.hidden, profileId: layer.hidden ? null : ui.profileId,
        statusEdits: [...ui.edits].map(([profileId, values]) => ({ profileId, values: listOf(values) })),
        relationshipEdits: [...ui.relEdits].map(([key, e]) => { const [from, to] = key.split(':').map(Number); return { from, to, ...e } }) }
    },
  }
}
