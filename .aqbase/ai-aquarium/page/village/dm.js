import { createPortrait } from '../ui/portrait.js'
import { actionLabel } from '../../shared/gm-actions.mjs'
import { budgetText } from '../../shared/village-settings.mjs'

/**
 * The DM on the game screen: a call button in the bottom-right corner with the DM's last words, and a side sheet for the
 * conversation. Small talk is just talk; a change the DM proposes waits on a card until the player applies it.
 * A world still being set up opens the 세계 만들기 window instead (setup.js).
 */
const $ = id => document.getElementById(id)
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node }
/** The conversation state for the page assistant: the diagnostic object becomes its text (older saves keep `inputTokens`, a key the host refuses). */
const setupState = s => { if (!s) return s; const { budgetDiagnostic, ...rest } = s; return { ...rest, budget: budgetText(budgetDiagnostic) } }

export function createDmView({ app, faces, request, toast, handle, openSetup, pickDm, openLore, openMemory, openArt, onOpen = () => {} }) {
  let detail = null, seen = null, count = 0
  const sheet = $('dm')
  const take = next => { if (next && 'setupDetail' in next) detail = next.setupDetail; render() }
  const fetch = () => request('setup', {}, true).then(take)
  const face = dm => createPortrait(dm.name, faces.get(dm.id))
  async function say(text) {
    if (!text || detail?.busy) return
    take(await request('setup-say', { text }))
    $('dm-text').value = ''; grow()
  }
  const send = handle(() => say($('dm-text').value.trim()))

  function open() {
    const setup = app.world?.setup
    if (!setup) { detail = null; pickDm(); return }
    if (setup.mode === 'setup') {
      const pending = Promise.resolve(openSetup()).then(take)
      pending.catch(error => toast(error.message))
      return pending
    }
    onOpen(); sheet.hidden = false; renderCall()
    render()
    const pending = fetch()
    pending.catch(error => toast(error.message))
    $('dm-text').focus()
    return pending
  }
  function close() { sheet.hidden = true; renderCall() }

  /** One proposed change as label and value; the scene shows what it replaces. */
  function changeRows(change, pending) {
    const L = detail.labels, rows = []
    const row = (label, ...value) => rows.push(el('li', {}, el('em', { textContent: label }), el('span', {}, ...value)))
    if (change.title) row(L.title, change.title)
    if (change.scene) row(L.scene, ...(pending && app.world?.settings.scene ? [el('del', { textContent: app.world.settings.scene }), el('br')] : []), el('ins', { textContent: change.scene }))
    for (const e of change.lore ?? []) row(L.lore, el('b', { textContent: e.title }), ` — ${e.content}`)
    for (const t of change.removeLore ?? []) row(L.removeLore, el('del', { textContent: t }))
    if (change.event) row(L.event, change.event)
    if (change.nextFloor) row(L.nextFloor, change.nextFloor)
    if (change.adventure !== undefined) row(L.adventure, change.adventure ? '켜기' : '끄기')
    for (const i of change.instructions ?? []) row(L.instructions, el('b', { textContent: i.name }), ` — ${i.text || '지시문 지우기'}`)
    if (change.dayMinutes) row(L.dayMinutes, `실제 ${change.dayMinutes}분`)
    if (change.sleep !== undefined) row(L.sleep, change.sleep ? '잠자기' : '안 자기')
    for (const [index, action] of (change.actions ?? []).entries()) row('무료 관리',
      change.actionLabels?.[index] ?? actionLabel(action, app.world?.rpg),
      ...(change.actionErrors?.[index] ? [el('br'), el('strong', { textContent: change.actionErrors[index] })] : []))
    return rows
  }
  function artPrompt(reason) {
    const button = el('button', { type: 'button', className: 'btn', textContent: '게임 그림 설정 열기' })
    button.addEventListener('click', () => { close(); openArt() })
    return el('div', { className: 'dm-error' }, el('span', { textContent: reason }), button)
  }
  function proposalCard(m) {
    const p = m.proposal, pending = p.status === 'pending'
    if (!pending) {
      const title = { applied: '✓ 모두 반영됨', partial: '일부 반영 · 실패 항목 확인', failed: '반영하지 못했어', dismissed: '넘긴 제안' }
      const rows = p.results?.map(r => el('li', {}, el('em', { textContent: `${r.skipped ? '↷ 건너뜀' : r.ok ? '✓' : '✕'} ${r.label}` }), el('span', { textContent: r.text })))
      return el('div', { className: `dm-prop ${p.status}` },
        el('h4', { textContent: p.status === 'applied' && !p.results ? '이전 제안 · 실제 실행 결과 기록 없음' : title[p.status] ?? '처리 결과' }),
        el('ul', {}, ...(rows?.length ? rows : changeRows(p.change, false).length ? changeRows(p.change, false) : [el('li', { textContent: '실행할 변경이 없었어.' })])))
    }
    const apply = el('button', { type: 'button', className: 'btn main', textContent: '적용' })
    apply.addEventListener('click', handle(async () => {
      take(await request('dm-apply', { messageId: m.id }))
      const result = detail.messages.find(x => x.id === m.id)?.proposal
      toast(result?.status === 'applied' ? '카드에서 실제 반영 결과를 확인해줘.' : '반영하지 못한 항목이 있어. 카드의 이유를 확인해줘.')
    }))
    const fix = el('button', { type: 'button', className: 'btn', textContent: '고쳐 줘' })
    fix.addEventListener('click', () => { $('dm-text').value = '제안에서 '; $('dm-text').focus(); grow() })
    const skip = el('button', { type: 'button', className: 'btn', textContent: '안 할래' })
    skip.addEventListener('click', handle(async () => take(await request('dm-dismiss', { messageId: m.id }))))
    for (const b of [apply, skip]) b.disabled = app.working || detail.busy
    return el('div', { className: 'dm-prop' }, el('h4', { textContent: 'GM 제안 · 게임 비용 없음' }), el('ul', {}, ...changeRows(p.change, true)), el('div', { className: 'dm-prop-btns' }, apply, fix, skip))
  }

  function render() {
    renderCall()
    if (sheet.hidden || !detail) return
    $('dm-face').replaceChildren(face(detail.dm)); $('dm-name').textContent = `GM ${detail.dm.name}`
    $('dm-status').textContent = detail.busy ? '답을 쓰는 중…' : '마을을 지켜보는 중'
    const log = $('dm-log'), nodes = []
    const art = app.world.rpg?.dm.art
    if (art?.setup && (art.needed || detail.messages.some(m => m.artSetup || m.proposal?.artSetup))) nodes.push(artPrompt(art.setup))
    for (const m of detail.messages) {
      nodes.push(el('p', { className: `dm-msg ${m.from === 'dm' ? 'dm' : 'me'}`, textContent: m.text }))
      if (m.proposal) nodes.push(proposalCard(m))
    }
    if (detail.busy) nodes.push(el('p', { className: 'dm-msg dm typing' }, el('i'), el('i'), el('i')))
    if (detail.error) {
      const retry = el('button', { type: 'button', className: 'btn', textContent: '다시 보내기' })
      retry.addEventListener('click', handle(async () => take(await request('setup-retry'))))
      nodes.push(el('div', { className: 'dm-error' }, el('span', { textContent: `${detail.error} ${budgetText(detail.budgetDiagnostic)}` }), retry))
    }
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 40, total = nodes.length
    log.replaceChildren(...nodes)
    if (total !== count || atEnd) log.scrollTop = log.scrollHeight
    count = total
    $('dm-text').disabled = $('dm-send').disabled = detail.busy || app.working
    for (const b of document.querySelectorAll('.dm-chips button')) b.disabled = detail.busy || app.working
    seen = detail.messages.findLast(m => m.from === 'dm')?.id ?? seen
  }
  /** The corner button: the DM's face and last words, a dot for a new line or a waiting proposal. */
  function renderCall() {
    const s = app.world?.setup, call = $('dm-call')
    if (seen === null && s?.last) seen = s.last.id // what was said before this page opened is not news
    call.hidden = !sheet.hidden
    $('dm-call-face').replaceChildren(s ? face(s.dm) : el('span', { className: 'dm-blank', textContent: 'GM' }))
    $('dm-call-name').textContent = s ? `GM ${s.dm.name}` : 'GM 부르기'
    $('dm-call-line').textContent = !s ? 'GM과 이야기하며 세계를 만들어 봐' : s.busy ? '답을 쓰는 중…' : s.mode === 'setup' ? '세계 만들기를 이어서 하자' : s.last?.text ?? '말을 걸어 봐'
    $('dm-call-dot').hidden = !s?.last || (!s.last.proposal && s.last.id === seen)
    call.setAttribute('aria-label', `${$('dm-call-name').textContent} · ${$('dm-call-line').textContent}`)
  }
  const grow = () => { const t = $('dm-text'); t.style.height = 'auto'; t.style.height = `${Math.min(140, t.scrollHeight)}px` }

  $('dm-call').addEventListener('click', open)
  $('dm-close').addEventListener('click', close)
  $('dm-change').addEventListener('click', () => { close(); pickDm() })
  $('dm-lore').addEventListener('click', () => { close(); openLore() })
  // The DM's own memory: the same view as a resident's, under the DM's memory key (the negative of its profile id).
  $('dm-memory').addEventListener('click', () => { const dm = app.world?.setup?.dm; if (!dm) return; close(); openMemory(-dm.id, `${dm.name} (GM)`) })
  $('dm-send').addEventListener('click', send)
  $('dm-text').addEventListener('input', grow)
  $('dm-text').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() } })
  for (const b of document.querySelectorAll('.dm-chips button')) b.addEventListener('click', () => {
    if (b.dataset.say) void handle(() => say(b.dataset.say))()
    else { $('dm-text').value = b.dataset.fill; $('dm-text').focus(); grow() }
  })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !sheet.hidden) close() })

  return {
    open, close,
    prepare(text) {
      if (typeof text !== 'string' || !text.trim()) throw new Error('GM에게 할 말을 써줘.')
      open(); $('dm-text').value = text; grow(); $('dm-text').focus()
      return { text, sent: false, note: '사람이 보내기, 제안 적용을 눌러.' }
    },
    snapshot: () => ({ open: !sheet.hidden, draft: $('dm-text').value, conversation: setupState(app.world?.setup), messages: detail?.messages.slice(-6) ?? [], artSetup: app.world?.rpg?.dm.art?.setup ?? '' }),
    get isOpen() { return !sheet.hidden },
    /** Each village poll: the corner button follows the DM, an open sheet refreshes when the conversation changed. */
    update(world) { renderCall(); if (!sheet.hidden && world.setup && world.setup.revision !== detail?.revision) void fetch().catch(() => {}) },
    render,
  }
}
