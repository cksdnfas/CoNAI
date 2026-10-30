/** Small DOM helpers: text elements, inline icons, tooltips and select options. */
export const node = (tag, text, cls) => Object.assign(document.createElement(tag), { textContent: text, ...(cls ? { className: cls } : {}) })
export const svgIcon = path => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', path); s.append(p); return s }
export const svg = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`
export const tip = (el, text) => { el.dataset.tip = text; if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', text); return el }
/** Replaces a select's options only when they changed, keeping the picked value when it still exists. */
export function setOptions(select, entries) {
  const value = select.value
  if (select.options.length !== entries.length || entries.some(([id, name], i) => select.options[i]?.value !== String(id) || select.options[i]?.textContent !== name)) {
    select.replaceChildren(...entries.map(([id, name]) => Object.assign(node('option', name), { value: String(id) })))
    if (entries.some(([id]) => String(id) === value)) select.value = value
  }
}
/** Writes `value` only when it differs, so an unchanged poll leaves the DOM (and its styles) alone. */
export const setText = (el, value) => { if (el.textContent !== value) el.textContent = value }
/** Puts `nodes` into `box` in order, touching the DOM only when the order changed. */
export function place(box, nodes) {
  if (nodes.length === box.children.length && nodes.every((n, i) => box.children[i] === n)) return
  box.replaceChildren(...nodes)
}
