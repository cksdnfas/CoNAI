/*
 * Press and hold a −/+ button: after a short pause it keeps stepping, faster the longer it is held.
 * One listener for the whole page, so steppers added later (모험 설정) work too. A button can ask for a
 * fixed, slower pace with data-hold="ms" (zoom).
 */
export const HOLD_BUTTONS = '[data-step],[data-walk],[data-day],[data-reply],[data-num],[data-qcount],[data-hold]'
const FIRST_DELAY = 380, START_GAP = 110, MIN_GAP = 30

export function installHold(root = document) {
  let timer = 0, held = null, repeated = false, stepping = false
  const stop = () => { clearTimeout(timer); timer = 0; held = null }
  root.addEventListener('pointerdown', event => {
    repeated = false
    if (event.button !== 0) return
    const button = event.target.closest?.(HOLD_BUTTONS)
    if (!button || button.disabled) return
    stop(); held = button
    const pace = Number(button.dataset.hold) || 0
    let steps = 0
    const tick = () => {
      if (held !== button || button.disabled || !button.isConnected) { stop(); return }
      repeated = true; stepping = true; try { button.click() } finally { stepping = false }; steps++
      timer = setTimeout(tick, pace || Math.max(MIN_GAP, START_GAP - steps * 6))
    }
    timer = setTimeout(tick, FIRST_DELAY)
  })
  root.addEventListener('pointerup', stop)
  root.addEventListener('pointercancel', stop)
  root.addEventListener('pointerout', event => { if (held && !held.contains(event.relatedTarget)) stop() })
  root.addEventListener('keydown', () => { repeated = false })
  root.defaultView?.addEventListener('blur', stop)
  // Letting go after a hold is not one more step.
  root.addEventListener('click', event => {
    if (!repeated || stepping || !event.target.closest?.(HOLD_BUTTONS)) return
    repeated = false; event.stopImmediatePropagation(); event.preventDefault()
  }, true)
}
