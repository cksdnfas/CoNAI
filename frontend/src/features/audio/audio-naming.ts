// Mirrors the server's label rules (backend audioNaming.validateAudioLabel): no path/control characters, one [00] slot.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[<>:"/\\|?*\x00-\x1f[\]]/g
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

/** The file-name stem an effect name turns into: unsafe characters become `_`, no trailing dots or spaces. */
function labelStem(name: string) {
  const stem = name.trim().replace(FORBIDDEN, '_').replace(/[.\s]+$/u, '').slice(0, 100)
  if (!stem) return 'sfx'
  return RESERVED.test(stem) ? `${stem}_sfx` : stem
}

/** `발소리 · 돌` → `발소리 · 돌_[00]`; `_2`, `_3`… when a sibling effect already uses that file name. */
export function autoAudioLabel(name: string, taken: Iterable<string | null> = []) {
  const used = new Set([...taken].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase()))
  const stem = labelStem(name)
  for (let index = 1; ; index += 1) {
    const label = index === 1 ? `${stem}_[00]` : `${stem}_${index}_[00]`
    if (!used.has(label.toLowerCase())) return label
  }
}

/** True while a label still follows its effect name (an auto label, possibly with a `_2` suffix). */
export function followsAudioName(label: string, name: string) {
  const stem = labelStem(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${stem}(_\\d+)?_\\[00\\]$`, 'i').test(label)
}
