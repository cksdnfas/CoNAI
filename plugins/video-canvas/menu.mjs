import { $, esc } from './util.mjs'
import { toast } from './toast.mjs'

let items = []
export function hideMenu() { const menu = $('menu'); menu.hidden = true; menu.innerHTML = ''; items = [] }
/** Floating menu at a viewport point. Items: { label, run, danger, disabled } or { sep: true }; falsy entries are skipped. */
export function showMenu(x, y, list) {
  items = list.filter(Boolean)
  const menu = $('menu')
  menu.innerHTML = items.map((item, index) => item.sep ? '<hr>' : `<button role="menuitem" class="ghost${item.danger ? ' danger' : ''}" data-i="${index}" ${item.disabled ? 'disabled' : ''}>${esc(item.label)}</button>`).join('')
  menu.hidden = false
  const width = menu.offsetWidth || 190, height = menu.offsetHeight || 40 * items.length
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`
  menu.querySelector('button:not(:disabled)')?.focus()
}
export function initMenu() {
  $('menu').addEventListener('click', event => {
    const index = event.target.closest('[data-i]')?.dataset.i
    if (index === undefined) return
    const item = items[Number(index)]
    hideMenu()
    Promise.resolve().then(() => item.run?.()).catch(error => toast(error.message, { error: true }))
  })
  document.addEventListener('pointerdown', event => { if (!$('menu').hidden && !event.target.closest('#menu')) hideMenu() }, true)
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hideMenu() })
  window.addEventListener('blur', hideMenu)
}
