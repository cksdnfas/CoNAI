import { createPortrait } from '../ui/portrait.js'
import { budgetText } from '../../shared/village-settings.mjs'

/**
 * 세계 만들기: the player talks with a DM profile; the world card beside the chat fills from each DM answer and
 * 이대로 시작 saves it into the slot. The conversation stays on the server, so closing the window loses nothing.
 */
const $ = id => document.getElementById(id)
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node }

export function createSetupView({ app, faces, request, toast, handle, loadFace, openArt, onOpen = () => {}, onLive = () => {} }) {
  let detail = null, picking = false, seen = 0
  const layer = $('setup')
  const take = next => { if (next && 'setupDetail' in next) detail = next.setupDetail; render(); return next }
  const fetch = () => request('setup', {}, true).then(take)
  const send = handle(async () => {
    const text = $('setup-text').value.trim()
    if (!text || detail?.busy) return
    take(await request('setup-say', { text }))
    $('setup-text').value = ''
  })

  /** `pick` starts at choosing the DM, also for a village whose DM is already there. */
  function open(pick = false) {
    onOpen(); layer.hidden = false
    for (const p of app.profiles) loadFace(p)
    picking = pick || !app.world?.setup
    render()
    if (!picking) {
      const pending = fetch()
      pending.catch(error => toast(error.message))
      return pending
    }
  }
  function close() { layer.hidden = true }

  function pickDm() {
    $('setup-dms').replaceChildren(...app.profiles.map(p => {
      const b = el('button', { type: 'button', className: 'setup-dm' }, createPortrait(p.name, faces.get(p.id)), el('b', { textContent: p.name }), el('small', { textContent: p.tagline || '' }))
      b.setAttribute('aria-pressed', String(detail?.dm.id === p.id))
      b.addEventListener('click', handle(async () => {
        take(await request('setup-open', { dmProfileId: p.id })); picking = false
        // A village that already lives talks with its DM on the game screen.
        if (detail?.mode === 'live') { close(); onLive(); return }
        render(); $('setup-text').focus()
      }))
      return b
    }))
    if (!app.profiles.length) $('setup-dms').append(el('p', { className: 'set-empty', textContent: '쓸 수 있는 채팅 프로필이 없어.' }))
  }

  function chat() {
    const log = $('setup-log'), dm = detail.dm
    const lines = detail.messages.map(m => {
      const bubble = el('p', { className: 'sm-text', textContent: m.text })
      return m.from === 'dm' ? el('div', { className: 'sm-row dm' }, createPortrait(dm.name, faces.get(dm.id)), bubble) : el('div', { className: 'sm-row me' }, bubble)
    })
    const art = app.world?.rpg?.dm.art
    if (art?.setup && (art.needed || detail.messages.some(m => m.artSetup))) {
      const button = el('button', { type: 'button', className: 'btn', textContent: '게임 그림 설정 열기' })
      button.addEventListener('click', () => { close(); openArt() })
      lines.unshift(el('div', { className: 'sm-error' }, el('span', { textContent: art.setup }), button))
    }
    if (detail.busy) lines.push(el('div', { className: 'sm-row dm' }, createPortrait(dm.name, faces.get(dm.id)), el('p', { className: 'sm-text typing', ariaLabel: 'GM이 쓰는 중' }, el('i'), el('i'), el('i'))))
    if (detail.error) {
      const retry = el('button', { type: 'button', className: 'btn', textContent: '다시 보내기' })
      retry.addEventListener('click', handle(async () => take(await request('setup-retry'))))
      lines.push(el('div', { className: 'sm-error' }, el('span', { textContent: `${detail.error} ${budgetText(detail.budgetDiagnostic)}` }), retry))
    }
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 40
    log.replaceChildren(...lines)
    const count = detail.messages.length + (detail.busy ? 1 : 0)
    if (count !== seen || atEnd) log.scrollTop = log.scrollHeight
    seen = count
    $('setup-text').disabled = $('setup-send').disabled = detail.busy || app.working
  }

  function card() {
    const d = detail.draft, a = d.adventure
    $('sw-title').textContent = d.title || '이름 없음'; $('sw-title').dataset.empty = String(!d.title)
    $('sw-scene').textContent = d.scene || '마을 상황이 아직 없어.'; $('sw-scene').dataset.empty = String(!d.scene)
    $('sw-lore-count').textContent = d.lore.length ? String(d.lore.length) : ''
    $('sw-lore').replaceChildren(...(d.lore.length ? d.lore.map(e => el('li', { title: e.content }, el('b', { textContent: e.title }), el('span', { textContent: e.content })))
      : [el('li', { className: 'empty', textContent: '아직 없어.' })]))
    $('sw-adventure').replaceChildren(...(a.enabled
      ? [el('div', {}, el('small', { textContent: '1층' }), el('b', { textContent: a.floorName || '이름 없음' })), el('div', {}, el('small', { textContent: '테마' }), el('span', { textContent: a.theme || '—' })), el('div', {}, el('small', { textContent: '몬스터' }), el('span', { textContent: a.monster || '—' }))]
      : [el('span', { className: 'empty', textContent: '던전 모험 없이 마을만' })]))
    $('sw-missing').replaceChildren(...(detail.missing.length ? detail.missing.map(m => el('span', { className: 'chip', textContent: m })) : [el('span', { className: 'chip ok', textContent: '준비 완료' })]))
    const apply = $('setup-apply')
    apply.textContent = detail.appliedAt ? '바뀐 설정 적용' : '이대로 시작'
    apply.disabled = app.working || detail.busy || detail.missing.length > 0
  }

  function render() {
    if (layer.hidden) return
    $('setup-pick').hidden = !picking; $('setup-body').hidden = picking || !detail
    $('setup-dm').hidden = picking || !detail
    $('setup-face').replaceChildren(...(detail && !picking ? [createPortrait(detail.dm.name, faces.get(detail.dm.id))] : []))
    $('setup-title').textContent = picking ? 'GM 고르기' : detail ? `GM ${detail.dm.name}` : '세계 만들기'
    if (picking) pickDm()
    else if (detail) { chat(); card() }
  }

  $('setup-send').addEventListener('click', send)
  $('setup-text').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() } })
  $('setup-dm').addEventListener('click', () => { picking = true; render() })
  $('setup-close').addEventListener('click', close)
  layer.querySelector('.dim').addEventListener('click', close)
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !layer.hidden) close() })
  $('setup-apply').addEventListener('click', handle(async () => {
    const first = !detail.appliedAt
    take(await request('setup-apply'))
    if (first) { close(); toast(app.world?.residents.length ? '세계가 열렸어. 마을을 깨워 봐. GM은 오른쪽 아래에 있어.' : '세계가 열렸어. 이제 주민을 초대해줘. GM은 오른쪽 아래에 있어.') }
    else toast(detail.messages.findLast(m => m.from === 'dm')?.text || '바뀐 설정을 적용했어.')
  }))

  return {
    open, close,
    get isOpen() { return !layer.hidden },
    /** Each village poll: refresh the conversation when the DM answered or another window changed it. */
    update(world) { if (!layer.hidden && !picking && world.setup && world.setup.revision !== detail?.revision) void fetch().catch(() => {}) },
    render,
  }
}
