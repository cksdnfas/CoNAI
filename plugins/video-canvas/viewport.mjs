import { $, clamp } from './util.mjs'
import { s, nodeById, frameRole } from './state.mjs'
import { saveView } from './session.mjs'

export const ZOOM_MIN = 0.2, ZOOM_MAX = 2
/** Node size in stage pixels; without layout the CSS widths and a typical height stand in. */
export function nodeSize(node) {
  const el = document.querySelector(`[data-id="${CSS.escape(node.id)}"]`)
  const card = node.kind === 'cut' || node.kind === 'gen'
  return { w: el?.offsetWidth || (card ? 300 : 200), h: el?.offsetHeight || (card ? 370 : 190) }
}
const GAP = 24
const overlaps = (a, b) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP
/** Boxes of the nodes that are cards on the canvas; a frame folded into a link or parked in the tray takes no room. */
export const nodeBoxes = () => s.project.nodes.filter(node => frameRole(node) === 'card').map(node => ({ x: node.x, y: node.y, ...nodeSize(node) }))
/** First spot at or after `start` that overlaps nothing in `taken` (scanning along `dx`, then down); the answer joins `taken`. */
export function freeSpot(size, start, taken = nodeBoxes(), dx = 1, columns = 12) {
  for (let row = 0; row < 40; row++) for (let column = 0; column < columns; column++) {
    const spot = { x: Math.round(start.x + dx * column * (size.w + GAP)), y: Math.round(start.y + row * (size.h + GAP)), ...size }
    if (!taken.some(box => overlaps(spot, box))) { taken.push(spot); return { x: spot.x, y: spot.y } }
  }
  return start
}
export function transform() {
  $('stage').style.transform = `translate(${s.x}px,${s.y}px) scale(${s.zoom})`
  $('zoom').textContent = `${Math.round(s.zoom * 100)}%`
  saveView()
}
/** Zoom by a factor while the canvas point (cx, cy) stays under the pointer. */
export function zoomAt(factor, cx, cy) {
  const zoom = clamp(s.zoom * factor, ZOOM_MIN, ZOOM_MAX), ratio = zoom / s.zoom
  s.x = cx - (cx - s.x) * ratio; s.y = cy - (cy - s.y) * ratio; s.zoom = zoom
  transform()
}
/** Viewport (client) point to stage coordinates. */
export function toStage(clientX, clientY) {
  const rect = $('canvas').getBoundingClientRect()
  return { x: (clientX - rect.x - s.x) / s.zoom, y: (clientY - rect.y - s.y) / s.zoom }
}
export function fit(ids) {
  const nodes = (ids ? ids.map(nodeById) : s.project?.nodes ?? []).filter(Boolean)
  if (!nodes.length) return
  const boxes = nodes.map(node => ({ x: node.x, y: node.y, ...nodeSize(node) }))
  const minX = Math.min(...boxes.map(box => box.x)), minY = Math.min(...boxes.map(box => box.y))
  const width = Math.max(...boxes.map(box => box.x + box.w)) - minX, height = Math.max(...boxes.map(box => box.y + box.h)) - minY
  const viewWidth = $('canvas').clientWidth, viewHeight = $('canvas').clientHeight - 16
  s.zoom = clamp(Math.min(viewWidth / (width + 48), viewHeight / (height + 48), 1), ZOOM_MIN, ZOOM_MAX)
  s.x = (viewWidth - width * s.zoom) / 2 - minX * s.zoom; s.y = (viewHeight - height * s.zoom) / 2 - minY * s.zoom
  transform()
}
/** Positions for new nodes inside the visible canvas that do not cover an existing node or each other. */
export function freeSpots(count, kind) {
  const size = kind === 'cut' ? { w: 300, h: 370 } : { w: 200, h: 190 }, taken = nodeBoxes()
  const start = { x: (24 - s.x) / s.zoom, y: (24 - s.y) / s.zoom }
  const columns = Math.max(1, Math.floor($('canvas').clientWidth / s.zoom / (size.w + GAP)))
  return Array.from({ length: count }, () => freeSpot(size, start, taken, 1, columns))
}
/** Cascade of positions starting at a point the user picked (context menu on empty canvas). */
export const spotsAt = (at, count) => Array.from({ length: count }, (_, index) => ({ x: Math.round(at.x + index * 24), y: Math.round(at.y + index * 24) }))
/** Pans the least needed so the whole node is visible; a node larger than the canvas shows its top-left corner. */
export function reveal(id) {
  const node = nodeById(id)
  if (!node) return
  const { w, h } = nodeSize(node), view = $('canvas'), margin = 16, bottomMargin = 16
  const left = node.x * s.zoom + s.x, top = node.y * s.zoom + s.y
  const pan = (low, high, limit, highMargin) => {
    let delta = 0
    if (high > limit - highMargin) delta = limit - highMargin - high
    if (low + delta < margin) delta = margin - low
    return delta
  }
  const dx = pan(left, left + w * s.zoom, view.clientWidth, margin), dy = pan(top, top + h * s.zoom, view.clientHeight, bottomMargin)
  if (!dx && !dy) return
  s.x += dx; s.y += dy
  transform()
}
