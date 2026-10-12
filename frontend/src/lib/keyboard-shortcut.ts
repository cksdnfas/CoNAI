const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

const MAC_KEYS: Record<string, string> = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }

/** "Mod+Alt+1" → "Ctrl+Alt+1", or "⌘⌥1" on Apple devices, for tooltips and menus. */
export function formatShortcut(keys: string) {
  const parts = keys.split('+')
  return isMac ? parts.map((part) => MAC_KEYS[part] ?? part).join('') : parts.map((part) => (part === 'Mod' ? 'Ctrl' : part)).join('+')
}

/** A label with its shortcut in parentheses: "굵게 (Ctrl+B)". */
export function withShortcut(label: string, keys: string) {
  return `${label} (${formatShortcut(keys)})`
}
