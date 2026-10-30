/**
 * 세이브 슬롯 tab: a grid of SLOT_LIMIT cards, each a whole village (residents, settings, chat, memories, world book,
 * guild, album). Empty cards create a slot in place. Deleting needs a second press, starting over the slot's name.
 */
import { createPortrait } from '../ui/portrait.js'

const $ = id => document.getElementById(id)
const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node }
const ago = ms => {
  const minutes = Math.round((Date.now() - ms) / 60_000)
  return minutes < 1 ? '방금' : minutes < 60 ? `${minutes}분 전` : minutes < 1440 ? `${Math.round(minutes / 60)}시간 전` : `${Math.round(minutes / 1440)}일 전`
}
const ICONS = { edit: '<path d="M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', plus: '<path d="M12 5v14M5 12h14"/>' }
function iconButton(icon, tip) {
  const b = el('button', { type: 'button', className: 'ib sm' })
  b.dataset.tip = tip; b.setAttribute('aria-label', tip)
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`
  return b
}
const textButton = (text, className, onClick) => { const b = el('button', { type: 'button', className, textContent: text }); b.addEventListener('click', onClick); return b }
const input = (keep, value, placeholder) => { const i = el('input', { value, placeholder, maxLength: 30, autocomplete: 'off' }); i.dataset.keep = keep; i.setAttribute('aria-label', placeholder || '슬롯 이름'); return i }

export function createSaves({ app, faces, request, toast, handle, onCreated = () => {} }) {
  // View state: which card is being renamed, created in, started over or armed for deletion; typed text survives redraws.
  let list = [], limit = 5, renaming = null, creating = null, resetting = false, armed = null, armTimer = null
  const typed = { rename: '', create: '', reset: '' }
  let mode = 'copy'
  function take(next) { if (next?.saves) { list = next.saves; limit = next.slotLimit ?? limit } render() }
  const run = (op, args, done) => handle(async () => { take(await request(op, args)); done?.() })()

  function filled(slot, index) {
    const card = el('article', { className: 'save-card' }); card.dataset.active = String(slot.active)
    const top = el('header', { className: 'save-top' }, el('span', { className: 'save-no num', textContent: String(index + 1) }))
    if (renaming === slot.id) {
      const name = input('rename', typed.rename, slot.name)
      name.addEventListener('input', () => { typed.rename = name.value })
      name.addEventListener('keydown', event => {
        if (event.key === 'Enter') run('save-rename', { id: slot.id, name: name.value }, () => { renaming = null; render() })
        if (event.key === 'Escape') { renaming = null; render() }
      })
      name.addEventListener('blur', () => setTimeout(() => { if (renaming === slot.id && document.activeElement !== name) { renaming = null; render() } }, 150))
      top.append(name)
    } else {
      top.append(el('b', { className: 'save-name', textContent: slot.name, title: slot.name }))
      if (slot.running) top.append(Object.assign(el('i', { className: 'save-live' }), { title: '깨어 있음' }))
      const tools = el('span', { className: 'save-tools' })
      const rename = iconButton('edit', '이름 바꾸기')
      rename.addEventListener('click', () => { renaming = slot.id; typed.rename = slot.name; render(); $('save-grid').querySelector('[data-keep=rename]')?.select() })
      tools.append(rename)
      if (!slot.active) {
        const remove = iconButton('trash', armed === slot.id ? '한 번 더 누르면 슬롯과 자동화 채팅방 삭제 · 직접 쓴 방은 일반 채팅으로 유지' : '삭제')
        if (armed === slot.id) remove.classList.add('armed')
        remove.disabled = app.working
        remove.addEventListener('click', () => {
          clearTimeout(armTimer)
          if (armed === slot.id) { armed = null; run('save-delete', { id: slot.id }, () => toast(`'${slot.name}' 삭제했어.`)); return }
          armed = slot.id; armTimer = setTimeout(() => { armed = null; render() }, 4000); render()
        })
        tools.append(remove)
      }
      top.append(tools)
    }
    const residents = el('div', { className: 'save-faces' })
    if (slot.residents.length) residents.append(...slot.residents.map(r => Object.assign(createPortrait(r.name, faces.get(r.profileId), r.color), { title: r.name })))
    else residents.append(el('span', { className: 'none', textContent: '주민 없음' }))
    const meta = el('div', { className: 'save-meta' }, el('span', { textContent: `${slot.day}일째` }), el('span', { textContent: ago(slot.playedAt) }))
    const foot = el('div', { className: 'save-foot' })
    if (!slot.active) {
      const load = textButton('불러오기', 'btn main', () => run('save-switch', { id: slot.id }, () => toast(`'${slot.name}' 불러왔어.`)))
      load.disabled = app.working; foot.append(load)
      if (armed === slot.id) {
        foot.classList.add('stack')
        foot.append(el('p', { className: 'lore-help', textContent: '슬롯과 자동화 채팅방을 지워. 네가 직접 쓴 방은 일반 채팅으로 남겨.' }))
      }
    } else if (resetting) {
      const name = input('reset', typed.reset, slot.name), go = textButton('초기화', 'btn danger', () => run('save-reset', { name: name.value }, () => { resetting = false; typed.reset = ''; render(); toast('처음부터 다시 시작했어.') }))
      go.disabled = app.working || name.value.trim() !== slot.name
      go.dataset.tip = '대화·기억·길드 진행·자동화 채팅방을 지워. 직접 쓴 방은 일반 채팅으로 남겨. 설정과 세계관은 남아.'
      name.addEventListener('input', () => { typed.reset = name.value; go.disabled = app.working || name.value.trim() !== slot.name })
      name.addEventListener('keydown', event => { if (event.key === 'Escape') { resetting = false; render() } })
      foot.classList.add('stack')
      foot.append(el('p', { className: 'lore-help', textContent: '자동화 채팅방도 정리해. 네가 직접 쓴 방은 일반 채팅으로 남겨.' }),
        name, el('div', { className: 'save-row' }, go, textButton('취소', 'btn', () => { resetting = false; typed.reset = ''; render() })))
    } else {
      foot.append(el('span', { className: 'save-playing', textContent: '플레이 중' }))
      const reset = textButton('처음부터', 'save-ghost', () => { resetting = true; render(); $('save-grid').querySelector('[data-keep=reset]')?.focus() })
      reset.dataset.tip = '설정은 두고 진행만 지워'
      foot.append(reset)
    }
    card.append(top, residents, meta, foot)
    return card
  }

  function empty(index, placeholder) {
    if (creating !== index) {
      const card = el('button', { type: 'button', className: 'save-card save-empty', disabled: app.working })
      card.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.plus}</svg>`
      card.append(el('span', { textContent: '새 마을' }))
      card.addEventListener('click', () => { creating = index; typed.create = ''; render(); $('save-grid').querySelector('[data-keep=create]')?.focus() })
      return card
    }
    const card = el('article', { className: 'save-card' })
    const name = input('create', typed.create, placeholder)
    const submit = () => {
      const value = name.value.trim() || placeholder
      const made = mode
      run('save-create', { mode, name: value }, () => { creating = null; typed.create = ''; render(); toast(`'${value}' 시작!`); onCreated(made) })
    }
    name.addEventListener('input', () => { typed.create = name.value })
    name.addEventListener('keydown', event => { if (event.key === 'Enter') submit(); if (event.key === 'Escape') { creating = null; render() } })
    const modes = el('div', { className: 'save-modes' }, ...[['copy', '지금 설정 복사', '주민·설정·세계관을 가져와'], ['empty', '빈 마을', '아무것도 없이 시작']].map(([id, label, tip]) => {
      const b = textButton(label, '', () => { mode = id; render() })
      b.dataset.tip = tip; b.setAttribute('aria-pressed', String(mode === id))
      return b
    }))
    const make = textButton('만들기', 'btn main', submit); make.disabled = app.working
    card.append(el('header', { className: 'save-top' }, el('span', { className: 'save-no num', textContent: String(index + 1) }), name), modes,
      el('div', { className: 'save-foot' }, make, textButton('취소', 'btn', () => { creating = null; render() })))
    return card
  }

  function render() {
    if ($('tab-saves').hidden) return
    const keep = document.activeElement?.dataset?.keep
    const placeholder = `마을 ${Math.max(0, ...list.map(s => s.id)) + 1}`
    $('save-grid').replaceChildren(...list.map(filled), ...Array.from({ length: Math.max(0, limit - list.length) }, (_, i) => empty(list.length + i, placeholder)))
    if (keep) $('save-grid').querySelector(`[data-keep=${keep}]`)?.focus()
  }

  return { load: () => handle(async () => take(await request('saves')))(), render }
}
