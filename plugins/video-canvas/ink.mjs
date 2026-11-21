import { readPrompt } from './domain.mjs'
import { $, esc, ports } from './util.mjs'
import { s, nodeById, continues, frameLabel } from './state.mjs'

// References in a cut's prompt, marked like a highlighter by kind. A mirror under the field draws the same text with <mark>s; the
// textarea on top stays the real field (its value, caret and undo are never touched). Marks come from readPrompt, the reading
// resolvePrompt sends, so a mark never says something the request does not. A tip names what a mark is; the caret's mention is said too.
const kindOf = mark => mark.error ? 'error' : mark.rows[0].type
const sourceOf = row => { const node = nodeById(row.nodeId); return node?.kind === 'frame' ? frameLabel(node) : node?.data.name ?? row.name }
/** Where a reference goes in the request: its slot and place in it, a video's sound, the frame that continues the cut before. */
function placeOf(row) {
  const edge = s.project?.edges.find(item => item.id === row.edgeId)
  const place = row.port === 'refmod' ? `번들 슬롯 ${row.slot}` : ['start', 'end'].includes(row.port) ? ports[row.port]
    : `${ports[row.port]} ${(edge?.position ?? 0) + 1}${row.type === 'audio' && row.port === 'ref_video' ? '의 소리' : ''}`
  return edge && continues(edge) ? `${place} · 앞 컷에서 이어짐` : place
}
/** A mark in words: in the text the labels it is sent as, in the sent text the @name it came from; a failing one its error. */
export function tipOf(mark, sent = false) {
  if (mark.error) return mark.error
  const row = mark.rows[0], labels = mark.rows.map(item => item.label).join(' / ')
  if (sent) return `@${row.name} · ${placeOf(row)}`
  return mark.typed ? `${labels} · ${placeOf(row)} · @${row.name}` : `${labels} · ${placeOf(row)} · ${sourceOf(row)}`
}
/** `text` as HTML with its marks (readPrompt's `marks` for a field's text, `sent` for the text sent). */
export function markedHtml(text, marks, sent = false) {
  let html = '', at = 0
  for (const mark of marks) {
    if (mark.start < at) continue
    html += esc(text.slice(at, mark.start)) + `<mark class="vc-ref k-${kindOf(mark)}" data-tip="${esc(tipOf(mark, sent))}">${esc(text.slice(mark.start, mark.end))}</mark>`
    at = mark.end
  }
  return html + esc(text.slice(at))
}
/** A cut prompt field with its mirror; `line` names the element that says the caret's mention under it. */
export const inkHtml = (cut, textarea, line = '') => `<div class="vc-ink" data-ink="${esc(cut.id)}"${line ? ` data-line="${line}"` : ''}><div class="vc-ink-mirror" aria-hidden="true"></div>${textarea}</div>`

// The mirror lays text out as the field does: the field's own computed box and type, taken once per mirror element.
const MIRRORED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontKerning', 'fontFeatureSettings', 'fontVariantLigatures', 'letterSpacing', 'wordSpacing',
  'lineHeight', 'textIndent', 'textTransform', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth']
const drawn = new WeakMap()
const parts = field => {
  const box = field.closest?.('.vc-ink')
  return box && field.parentElement === box ? { box, mirror: box.querySelector('.vc-ink-mirror'), cut: nodeById(box.dataset.ink) } : null
}
/** Draws a field's mirror from what the field holds now (typed but unsaved text included) and keeps it scrolled with the field. */
export function inkField(field) {
  const found = parts(field)
  if (!found?.mirror || found.cut?.kind !== 'cut' || !s.project) return
  const { mirror, cut } = found
  if (!drawn.has(mirror)) { const style = window.getComputedStyle(field); for (const key of MIRRORED) mirror.style[key] = style[key] }
  // A last empty line still takes its height, as it does in the field.
  const text = field.value, html = markedHtml(text, readPrompt(s.project, cut, text).marks) + (!text || text.endsWith('\n') ? '\u200b' : '')
  if (drawn.get(mirror) !== html) { mirror.innerHTML = html; drawn.set(mirror, html) }
  if (mirror.scrollTop !== field.scrollTop) mirror.scrollTop = field.scrollTop
  snapMirror(field, mirror)
}
// On the scaled canvas a field paints its text from a whole pixel of the canvas (a card's field can sit at y = 534.625 there), the
// mirror from where it is: the mirror takes the same rounding, or the gap grows with the zoom.
function snapMirror(field, mirror) {
  const stage = field.closest('#stage')
  if (!stage) return
  const box = field.getBoundingClientRect(), origin = stage.getBoundingClientRect(), scale = box.width / field.offsetWidth || 1
  const x = (box.left - origin.left) / scale, y = (box.top - origin.top) / scale
  mirror.style.translate = `${Math.round(x) - x}px ${Math.round(y) - y}px`
}
/** Every marked field under `root`, after a redraw (which may have put typed text back into a field drawn from the saved one). */
export function inkAll(root) {
  for (const field of root.querySelectorAll('.vc-ink > textarea')) inkField(field)
  if (root.contains(document.activeElement)) caretInk(document.activeElement, false)
}

// ---- the caret's mention: a quiet line under the panel's field, and a polite announcement when the caret moves to another one ----
let spoken = null
export function caretInk(field, moved) {
  const found = parts(field)
  if (!found?.cut || !s.project) return
  const at = field.selectionStart, mark = at === field.selectionEnd ? readPrompt(s.project, found.cut, field.value).marks.find(item => item.start < at && at <= item.end) : null
  const text = mark ? tipOf(mark) : '', line = found.box.dataset.line && document.getElementById(found.box.dataset.line)
  if (line && line.textContent !== text) line.textContent = text
  // Typing changes a mention with every key; only a caret moved into another mention is said.
  const key = mark ? `${found.cut.id}:${mark.start}:${mark.end}` : null
  if (moved && key !== spoken && text) $('insp-live').textContent = text
  if (moved || !key) spoken = key
}

// ---- the tip: one floating line for the mark under the pointer (hit-tested on the mirror, which the field covers) ----
let tipFor = null, pending = null, frame = 0
const inside = (rect, event) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
export function hideTip() {
  if (!tipFor) return
  tipFor = null
  $('vc-tip').hidden = true
}
function showTip(mark, rect) {
  const tip = $('vc-tip')
  if (tipFor !== mark) { tip.textContent = mark.dataset.tip; tip.hidden = false; tipFor = mark }
  const box = tip.getBoundingClientRect(), width = document.documentElement.clientWidth, height = document.documentElement.clientHeight
  const below = rect.bottom + 6, top = below + box.height > height - 8 ? Math.max(8, rect.top - box.height - 6) : below
  tip.style.left = `${Math.max(8, Math.min(rect.left, width - box.width - 8))}px`
  tip.style.top = `${top}px`
}
function hitTest(event) {
  const target = event.target, sent = target?.closest?.('.vc-sent mark[data-tip], .label-table mark[data-tip]')
  if (sent) return showTip(sent, [...sent.getClientRects()].find(rect => inside(rect, event)) ?? sent.getBoundingClientRect())
  const found = target?.closest && parts(target)
  if (!found?.mirror || !inside(target.getBoundingClientRect(), event)) return hideTip()
  for (const mark of found.mirror.querySelectorAll('mark')) for (const rect of mark.getClientRects()) if (inside(rect, event)) return showTip(mark, rect)
  hideTip()
}
export function bindInk() {
  document.addEventListener('input', event => {
    if (!parts(event.target)) return
    hideTip()
    inkField(event.target)
    caretInk(event.target, false)
  })
  // Scrolling does not bubble: the field's own scroll moves its mirror, any scroll takes the tip away.
  document.addEventListener('scroll', event => {
    hideTip()
    const found = event.target?.closest && parts(event.target)
    if (found?.mirror) found.mirror.scrollTop = event.target.scrollTop
  }, true)
  // The caret moved by a click, a selection or a navigation key (a typed key moves it too, but is not announced).
  for (const type of ['keyup', 'pointerup', 'focusin', 'select']) document.addEventListener(type, event => {
    if (parts(event.target) && (type !== 'keyup' || /^(Arrow|Home|End|Page)/.test(event.key))) caretInk(event.target, true)
  })
  document.addEventListener('focusout', event => {
    const found = parts(event.target), line = found?.box.dataset.line && document.getElementById(found.box.dataset.line)
    if (line) line.textContent = ''
    if (found) spoken = null
  })
  document.addEventListener('pointermove', event => {
    pending = event
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; hitTest(pending) })
  })
  document.addEventListener('pointerdown', hideTip)
  document.documentElement.addEventListener('pointerleave', hideTip)
  window.addEventListener('blur', hideTip)
  // Esc closes the tip first, as the innermost popup.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !tipFor) return
    hideTip()
    event.preventDefault()
    event.stopPropagation()
  }, true)
}
