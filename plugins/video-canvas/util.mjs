import { appUrl } from './conai-plugin.js'
export const $ = id => document.getElementById(id)
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export const names = { image: '이미지', video: '비디오', audio: '오디오', bundle: '레퍼런스 번들', cut: '영상 컷', frame: '프레임', gen: '생성 노드' }
export const ports = { start: '시작 프레임', end: '끝 프레임', ref_image: '참조 이미지', ref_video: '참조 영상', ref_audio: '참조 오디오', refmod: '번들', image: '입력 이미지' }
/** What a generation node makes (a profile's output kind). */
export const outputNames = { video: '영상', image: '이미지', audio: '오디오' }
export const reviewNames = { pending: '대기', pass: '통과', redo: '다시' }
export const statusNames = { preparing: '준비 중', submitting: '제출 중', starting: '시작 중', pending: '대기', queued: '대기', running: '진행 중', processing: '처리 중', completed: '완료', failed: '실패', cancelled: '취소됨', proposed: '제안', discarded: '폐기됨' }
export const assetStates = { ready: ['확인됨', 'ok'], changed: ['변경됨', 'warn'], 'no-permission': ['권한 없음', 'destructive'], missing: ['없음', 'destructive'], unverified: ['확인 실패', 'warn'] }
export const badge = (label, cls = '') => `<span class="badge ${cls}">${esc(label)}</span>`
export const statusBadge = status => badge(statusNames[status] ?? status, status === 'completed' ? 'ok' : status === 'failed' ? 'destructive' : '')
export const assetBadge = check => check ? badge(...(assetStates[check.status] ?? [check.status])) : ''
export const progressText = progress => progress?.total ? `${progress.processed}/${progress.total}` : ''
export const seconds = value => `${Number(Number(value).toFixed(1))}초`
export const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
export const isTerminal = status => ['completed', 'failed', 'cancelled'].includes(status)
/** 0..1 from a progress that may be a ratio, a percentage or { processed, total }; null while unknown. */
export const fraction = progress => typeof progress === 'number' ? (progress > 1 ? progress / 100 : progress) : progress?.total ? progress.processed / progress.total : null
// 16px line icons (24-box paths, currentColor) for the icon buttons; a text glyph is never used as an icon.
const ICONS = {
  play: '<path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor"/>',
  pause: '<path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
  volume: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>',
  mute: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>',
  down: '<path d="M6 9l6 6 6-6"/>', up: '<path d="M6 15l6-6 6 6"/>', left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>',
  maximize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  link: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  fit: '<path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/>',
  arrange: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  edges: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 10.9l7.4-3.8M8.3 13.1l7.4 3.8"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  refresh: '<path d="M20 12a8 8 0 11-2.3-5.7L20 8.6"/><path d="M20 3.5v5.1h-5.1"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  upscale: '<rect x="3" y="11" width="10" height="10" rx="1.5"/><path d="M13 3h8v8M21 3l-8.5 8.5"/>',
  frame: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 16l-5-5-9 8"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  move: '<path d="M4 12h14M13 6l6 6-6 6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  wand: '<path d="M4 20L15 9M17 3v4M15 5h4M20 10v3M18.5 11.5h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
}
/** A square icon-only button: the label is its name for assistive technology and its tooltip. */
export const iconButton = (name, label, attrs = '', cls = '') => `<button type="button" class="conai-icon-button${cls ? ` ${cls}` : ''}" ${attrs} aria-label="${esc(label)}" title="${esc(label)}">${icon(name)}</button>`
export const icon = (name, size = 16) => `<svg class="vc-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
/** Fills every `[data-icon]` control of the static page with its icon. */
export function fillIcons() { document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon) }) }
// appUrl names this window, so a shared page serves media to viewers without the library permission.
export const fileUrl = hash => appUrl(`/api/images/${encodeURIComponent(hash)}/file`)
export const thumbUrl = hash => appUrl(`/api/images/${encodeURIComponent(hash)}/thumbnail`)
export const audioUrl = id => appUrl(`/api/audio/candidates/${encodeURIComponent(id)}/file`)
const rendered = new WeakMap()
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'
/**
 * Sets el's content only when it changed. The focused field, its typed text, caret and scroll, and the open `details[data-keep]`
 * sections survive the redraw, so a background refresh never costs the user their place. With `neighbour`, a focused control the
 * new content no longer has hands the focus to the control now in its place (the nearest one that survived), not to the page.
 */
export function patch(el, html, { neighbour = false } = {}) {
  if (rendered.get(el) === html) return false
  rendered.set(el, html)
  const active = document.activeElement
  const field = active && active !== el && el.contains(active) ? active : null
  const snap = field && {
    selector: field.tagName.toLowerCase() + [...field.attributes].filter(attr => attr.name.startsWith('data-')).map(attr => `[${attr.name}="${CSS.escape(attr.value)}"]`).join(''),
    value: field.value, start: field.selectionStart, end: field.selectionEnd, scroll: field.scrollTop,
    index: neighbour ? [...el.querySelectorAll(FOCUSABLE)].indexOf(field) : -1,
  }
  const open = new Set([...el.querySelectorAll('details[open][data-keep]')].map(item => item.dataset.keep))
  el.innerHTML = html
  el.querySelectorAll('details[data-keep]').forEach(item => { if (open.has(item.dataset.keep)) item.open = true })
  const found = snap && el.querySelector(snap.selector)
  if (snap && !found && snap.index >= 0) {
    const all = [...el.querySelectorAll(FOCUSABLE)]
    all[Math.min(snap.index, all.length - 1)]?.focus({ preventScroll: true })
    return true
  }
  const next = found
  if (next) {
    if (snap.value !== undefined && next.value !== snap.value) {
      // Text typed while an earlier edit was saving is kept and saved on leaving the field, even if nothing more is typed.
      next.value = snap.value
      let saved = false
      next.addEventListener('change', () => { saved = true }, { once: true })
      next.addEventListener('blur', () => { if (!saved && next.isConnected) next.dispatchEvent(new Event('change', { bubbles: true })) }, { once: true })
    }
    next.focus({ preventScroll: true })
    try { if (snap.start !== null && snap.start !== undefined) next.setSelectionRange(snap.start, snap.end) } catch { /* not a text field */ }
    if (snap.scroll) next.scrollTop = snap.scroll
  }
  return true
}
export function ago(value) {
  // SQLite timestamps are UTC without a zone marker.
  const time = new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? `${value.replace(' ', 'T')}Z` : value).getTime()
  if (!Number.isFinite(time)) return ''
  const diff = Math.max(0, Date.now() - time) / 1000
  if (diff < 60) return '방금 전'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}일 전`
  return new Date(time).toLocaleDateString('ko-KR')
}
/** A v4 UUID that also works on HTTP LAN origins, where crypto.randomUUID is missing. */
export const uuid = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, digit => (digit ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> digit / 4).toString(16))
