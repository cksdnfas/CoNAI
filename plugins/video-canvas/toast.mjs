import { $, esc, icon } from './util.mjs'

let counter = 0
const actions = new Map(), timers = new Map()
const MANY = 3
const list = () => [...$('toasts').querySelectorAll('.vc-toast')]
/** The "모두 닫기" button shows up once more than a few toasts are open. */
function syncClear(host = $('toasts')) {
  const count = host.querySelectorAll('.vc-toast').length
  let clear = host.querySelector('[data-toast-clear]')
  if (count > MANY && !clear) { clear = document.createElement('button'); clear.dataset.toastClear = ''; clear.className = 'vc-toast-clear sm'; clear.textContent = '모두 닫기'; host.prepend(clear) }
  else if (count <= MANY) clear?.remove()
}
function closeToast(el) { clearTimeout(timers.get(el.dataset.toast)); timers.delete(el.dataset.toast); actions.delete(el.dataset.toast); const host = el.parentElement; el.remove(); if (host) syncClear(host) }
const arm = (el, action) => { clearTimeout(timers.get(el.dataset.toast)); timers.set(el.dataset.toast, setTimeout(() => closeToast(el), action ? 10000 : 4500)) }
/** Inside the workspace the toasts sit bottom-left on the canvas; on the project home they float over the page. */
export function dockToasts() {
  const host = $('toasts'), dock = document.querySelector('.vc-dock'), want = $('workspace').hidden ? document.body : dock
  if (host.parentElement !== want) want.prepend(host)
}
/** Non-blocking message near the canvas. Errors stay until dismissed; an error is also shown inside an open dialog. */
export function toast(message, { error = false, action } = {}) {
  if (!message) return
  dockToasts()
  const host = $('toasts'), same = list().find(el => el.classList.contains('error') === error && el.querySelector('.vc-toast-text').textContent === message)
  if (same) { if (!error) arm(same, actions.has(same.dataset.toast)); if (action) actions.set(same.dataset.toast, action.run) }
  else {
    const el = document.createElement('div'), id = `t${++counter}`
    el.className = `vc-toast${error ? ' error' : ''}`; el.dataset.toast = id; el.setAttribute('role', error ? 'alert' : 'status')
    el.innerHTML = `<span class="vc-toast-text">${esc(message)}</span>${action ? '<button data-toast-action>' + esc(action.label) + '</button>' : ''}<button class="conai-icon-button sm" data-toast-close aria-label="닫기">${icon('x', 14)}</button>`
    if (action) actions.set(id, action.run)
    host.append(el)
    while (list().length > 8) closeToast(list()[0])
    syncClear()
    if (!error) arm(el, Boolean(action))
  }
  if (error && $('modal').open) {
    const inDialog = $('dialog-message')
    if (inDialog) { inDialog.textContent = message; inDialog.hidden = false; inDialog.scrollIntoView?.({ block: 'nearest' }) }
  }
}
export const notice = (message, error = false) => toast(message, { error })
export function initToasts() {
  $('toasts').addEventListener('click', event => {
    if (event.target.closest('[data-toast-clear]')) { list().forEach(closeToast); return }
    const el = event.target.closest('[data-toast]')
    if (!el) return
    if (event.target.closest('[data-toast-action]')) actions.get(el.dataset.toast)?.()
    closeToast(el)
  })
}
/** Marks the pressed control busy while the work runs. */
export async function withBusy(el, fn) {
  if (!el) return fn()
  el.setAttribute('aria-busy', 'true'); el.disabled = true
  try { return await fn() } finally { el.removeAttribute('aria-busy'); el.disabled = false }
}
