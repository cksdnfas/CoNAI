/**
 * Field wrappers (FormField, SettingsField, inline `<label>` rows) wrap whole controls in `<label>`.
 * A click anywhere on such a label — its caption, hint, or padding — is forwarded by the browser to the
 * label's first labelable descendant. When that is a button (e.g. the "−" of NumberStepperInput or an
 * image picker button), stray clicks around the field press it. This guard cancels only that forwarding
 * and moves focus to the field's first editable control instead, so caption-click-to-focus still works.
 */

const INTERACTIVE_SELECTOR = 'a[href], button, details, summary, embed, iframe, input, select, textarea, label, [contenteditable]:not([contenteditable="false"])'
const FOCUS_TARGET_SELECTOR = [
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]):not([type="file"]):not(:disabled)',
  'textarea:not(:disabled)',
  'select:not(:disabled)',
].join(', ')
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image'])

function isButtonLikeControl(control: HTMLElement | null) {
  if (control instanceof HTMLButtonElement) return true
  return control instanceof HTMLInputElement && BUTTON_INPUT_TYPES.has(control.type)
}

function handleLabelClick(event: MouseEvent) {
  if (event.defaultPrevented || !(event.target instanceof Element)) return

  const label = event.target.closest('label')
  if (!label || !isButtonLikeControl(label.control)) return

  // Clicks that land on a real control inside the label never trigger label forwarding; leave them alone.
  const interactive = event.target.closest(INTERACTIVE_SELECTOR)
  if (interactive && interactive !== label && label.contains(interactive)) return

  event.preventDefault()
  label.querySelector<HTMLElement>(FOCUS_TARGET_SELECTOR)?.focus()
}

let installed = false

/** Install once at startup; capture phase so stopPropagation inside the tree cannot bypass it. */
export function installLabelClickGuard() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('click', handleLabelClick, true)
}
