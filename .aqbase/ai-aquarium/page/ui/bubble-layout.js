/*
 * Speech bubbles must not cover each other. Bubbles are placed nearest speaker first; one that would overlap a placed
 * bubble moves beside or above it (never below, where the speakers stand), kept inside the view. When no spot is free (a zoomed camera, a crowd) it takes the
 * spot that covers the least, so at most an edge is hidden instead of the whole line.
 * Returns the position and whether it left its own spot (then the caller decides if the tail still reaches the head).
 */
export function placeBubble(placed, box, view, gap = 8) {
  const { w, h } = box
  const clampX = x => Math.max(view.x, Math.min(view.x + view.w - w, x)), clampY = y => Math.max(view.y, Math.min(view.y + view.h - h, y))
  const covered = (x, y) => placed.reduce((sum, o) => sum + Math.max(0, Math.min(x + w + gap, o.x + o.w) - Math.max(x - gap, o.x)) * Math.max(0, Math.min(y + h + gap, o.y + o.h) - Math.max(y - gap, o.y)), 0)
  const tries = [[box.x, box.y]]
  for (const o of placed) tries.push([o.x + o.w + gap, box.y], [o.x - w - gap, box.y], [box.x, o.y - h - gap], [o.x + o.w + gap, o.y], [o.x - w - gap, o.y])
  let best = null
  for (const [tx, ty] of tries) {
    const x = clampX(tx), y = clampY(ty), score = covered(x, y), far = Math.hypot(x - box.x, (y - box.y) * 2) // sideways first: a bubble far below or above loses its speaker
    if (!best || score < best.score || (score === best.score && far < best.far)) best = { x, y, score, far }
    if (best.score === 0 && best.far === 0) break
  }
  placed.push({ x: best.x, y: best.y, w, h })
  return { x: best.x, y: best.y, moved: best.x !== box.x || best.y !== box.y }
}
