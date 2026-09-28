/** Scroll to the first element matching `selector` and move focus to its invalid control. */
export function revealFirstInvalidField(selector: string, root: ParentNode = document) {
  const target = root.querySelector<HTMLElement>(selector)
  if (!target) {
    return false
  }

  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  const focusTarget = target.matches('input, textarea, select')
    ? target
    : target.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?? target.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])')
      ?? target.querySelector<HTMLElement>('button:not([disabled])')
  focusTarget?.focus({ preventScroll: true })
  return true
}
