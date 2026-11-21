import { $, esc, icon } from './util.mjs'
import { toast } from './toast.mjs'

let items = [], trigger = null, closedFrom = null
/** Closes the menu; `restore` puts the focus back on the control that opened it (a pointer press elsewhere keeps the focus where it lands). */
export function hideMenu(restore = false) {
  const menu = $('menu'), opener = trigger
  menu.hidden = true; menu.innerHTML = ''; items = []; trigger = null
  if (opener?.hasAttribute?.('aria-haspopup')) opener.setAttribute('aria-expanded', 'false')
  if (restore && opener?.isConnected) opener.focus({ preventScroll: true })
}
/** Floating menu at a viewport point. Items: { label, meta, run, danger, disabled, checked } or { sep: true }; falsy entries are skipped.
 *  `meta` is a muted second line under the label. A menu with a `checked` item is a choice: its items are radio items and the chosen one carries the check mark.
 *  `opener` (the focused control by default) gets the focus back when the menu closes by Escape, Tab or a chosen item. */
export function showMenu(x, y, list, opener = document.activeElement) {
  hideMenu()
  items = list.filter(Boolean)
  trigger = opener && opener !== document.body && opener.focus ? opener : null
  if (trigger?.hasAttribute?.('aria-haspopup')) trigger.setAttribute('aria-expanded', 'true')
  const menu = $('menu'), choice = items.some(item => item.checked !== undefined)
  menu.setAttribute('aria-label', trigger?.getAttribute?.('aria-label') || '메뉴')
  menu.innerHTML = items.map((item, index) => item.sep ? '<hr>' : `<button role="${item.checked === undefined ? 'menuitem' : 'menuitemradio'}" ${item.checked === undefined ? '' : `aria-checked="${item.checked}"`} class="ghost${item.danger ? ' danger' : ''}" data-i="${index}" tabindex="-1" ${item.disabled ? 'disabled' : ''}>${choice ? `<span class="vc-menu-mark">${item.checked ? icon('check', 14) : ''}</span>` : ''}${item.meta ? `<span class="conai-row-main"><span>${esc(item.label)}</span><span class="conai-row-meta">${esc(item.meta)}</span></span>` : esc(item.label)}</button>`).join('')
  menu.hidden = false
  const width = menu.offsetWidth || 190, height = menu.offsetHeight || 40 * items.length
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`
  menu.querySelector('button:not(:disabled)')?.focus()
}
/** Opens a menu under a control (the inspector's and the cards' ⋯ buttons). */
export function menuAt(button, list) {
  // A press on the control whose menu is open closes it (the pointerdown did) instead of opening it again.
  const again = closedFrom === button
  closedFrom = null
  if (again) return
  const rect = button.getBoundingClientRect()
  showMenu(rect.left, rect.bottom + 4, list, button)
}
// Arrow keys move between the enabled items (wrapping), Home and End go to the ends; Escape and Tab close the menu back to its control.
function onMenuKey(event) {
  if ($('menu').hidden) return
  if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); hideMenu(true); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const buttons = [...$('menu').querySelectorAll('button:not(:disabled)')]
  if (!buttons.length) return
  event.preventDefault(); event.stopPropagation()
  const at = buttons.indexOf(document.activeElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[at < 0 && event.key === 'ArrowUp' ? buttons.length - 1 : next].focus()
}
export function initMenu() {
  $('menu').addEventListener('click', event => {
    const index = event.target.closest('[data-i]')?.dataset.i
    if (index === undefined) return
    const item = items[Number(index)]
    hideMenu(true)
    Promise.resolve().then(() => item.run?.()).catch(error => toast(error.message, { error: true }))
  })
  document.addEventListener('pointerdown', event => {
    closedFrom = null
    if ($('menu').hidden || event.target.closest('#menu')) return
    if (trigger?.contains(event.target)) closedFrom = trigger
    hideMenu()
  }, true)
  // Capture: the canvas reads Escape as "clear the selection", which must not happen while a menu takes it.
  document.addEventListener('keydown', onMenuKey, true)
  window.addEventListener('blur', () => hideMenu())
}
