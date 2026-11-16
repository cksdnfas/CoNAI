import { $, esc, icon } from './util.mjs'
import { toast } from './toast.mjs'

let items = []
export function hideMenu() { const menu = $('menu'); menu.hidden = true; menu.innerHTML = ''; items = [] }
/** Floating menu at a viewport point. Items: { label, meta, run, danger, disabled, checked } or { sep: true }; falsy entries are skipped.
 *  `meta` is a muted second line under the label. A menu with a `checked` item is a choice: its items are radio items and the chosen one carries the check mark. */
export function showMenu(x, y, list) {
  items = list.filter(Boolean)
  const menu = $('menu'), choice = items.some(item => item.checked !== undefined)
  menu.innerHTML = items.map((item, index) => item.sep ? '<hr>' : `<button role="${item.checked === undefined ? 'menuitem' : 'menuitemradio'}" ${item.checked === undefined ? '' : `aria-checked="${item.checked}"`} class="ghost${item.danger ? ' danger' : ''}" data-i="${index}" ${item.disabled ? 'disabled' : ''}>${choice ? `<span class="vc-menu-mark">${item.checked ? icon('check', 14) : ''}</span>` : ''}${item.meta ? `<span class="conai-row-main"><span>${esc(item.label)}</span><span class="conai-row-meta">${esc(item.meta)}</span></span>` : esc(item.label)}</button>`).join('')
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
