/*
 * Tooltips for every [data-tip]: one floating element on top of the page, placed from the target's box and kept
 * inside the viewport. A pseudo-element tooltip is clipped by any scrolling box it sits in (dialogs, chat, lists).
 * Below the target by default; `.up` opens above, the zoom column opens to the left. It flips when there is no room.
 */
export function installTips(root = document) {
  const tip = document.createElement('div')
  tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true
  document.body.append(tip)
  let target = null
  const GAP = 6, EDGE = 8
  function place() {
    if (!target?.isConnected || !target.dataset.tip) { hide(); return }
    tip.textContent = target.dataset.tip; tip.hidden = false
    const at = target.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, vw = innerWidth, vh = innerHeight
    const clampX = x => Math.max(EDGE, Math.min(vw - w - EDGE, x)), clampY = y => Math.max(EDGE, Math.min(vh - h - EDGE, y))
    let x, y
    if (target.closest('.zoom')) {
      x = at.left - w - GAP; y = clampY(at.top + at.height / 2 - h / 2)
      if (x < EDGE) x = at.right + GAP
    } else {
      const below = at.bottom + GAP, above = at.top - h - GAP
      const up = target.classList.contains('up') || target.classList.contains('place-hit')
      y = up ? (above >= EDGE ? above : below) : (below + h <= vh - EDGE ? below : above)
      x = clampX(at.left + at.width / 2 - w / 2)
    }
    tip.style.left = `${Math.round(x)}px`; tip.style.top = `${Math.round(clampY(y))}px`
  }
  function hide() { target = null; tip.hidden = true }
  root.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return
    const next = event.target.closest?.('[data-tip]')
    if (next === target) return
    target = next
    if (target) place(); else hide()
  })
  root.documentElement.addEventListener('pointerleave', hide)
  for (const type of ['pointerdown', 'wheel', 'keydown']) root.addEventListener(type, hide, { capture: true, passive: true })
  root.addEventListener('scroll', hide, { capture: true, passive: true })
  // A button that changes its own tip while hovered (play ↔ pause) updates in place.
  new MutationObserver(() => { if (target) place() }).observe(root, { subtree: true, attributes: true, attributeFilter: ['data-tip'] })
}
