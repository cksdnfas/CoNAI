import { useSyncExternalStore } from 'react'

/** Review keys of the 음향 page (original SFX manager defaults). Stored per browser, like the original. */
export type AudioShortcutAction = 'next' | 'previous' | 'play' | 'select' | 'reject' | 'pending'

export const AUDIO_SHORTCUT_ACTIONS: readonly AudioShortcutAction[] = ['next', 'previous', 'play', 'select', 'reject', 'pending']
export const DEFAULT_AUDIO_SHORTCUTS: Record<AudioShortcutAction, string> = { next: 'j', previous: 'k', play: ' ', select: 'a', reject: 'r', pending: 'u' }

const STORAGE_KEY = 'conai:audio:review-shortcuts'
const listeners = new Set<() => void>()

/** A single letter, digit, arrow or Space. */
export function isValidShortcutKey(key: string): boolean {
  return /^[a-z0-9]$/.test(key) || key === ' ' || ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)
}

export function normalizeShortcutKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase()
}

export function shortcutLabel(key: string): string {
  if (key === ' ') return 'Space'
  if (key.startsWith('arrow')) return { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' }[key] ?? key
  return key.toUpperCase()
}

function read(): Record<AudioShortcutAction, string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Record<AudioShortcutAction, string>> | null
    if (!raw) return DEFAULT_AUDIO_SHORTCUTS
    const merged = { ...DEFAULT_AUDIO_SHORTCUTS }
    for (const action of AUDIO_SHORTCUT_ACTIONS) {
      const key = raw[action]
      if (typeof key === 'string' && isValidShortcutKey(key)) merged[action] = key
    }
    return new Set(Object.values(merged)).size === AUDIO_SHORTCUT_ACTIONS.length ? merged : DEFAULT_AUDIO_SHORTCUTS
  } catch {
    return DEFAULT_AUDIO_SHORTCUTS
  }
}

let current = typeof window === 'undefined' ? DEFAULT_AUDIO_SHORTCUTS : read()

export function saveAudioShortcuts(next: Record<AudioShortcutAction, string>) {
  current = next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: the keys still apply for this visit.
  }
  listeners.forEach((listener) => listener())
}

export function useAudioShortcuts(): Record<AudioShortcutAction, string> {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => current, () => current)
}

/** True when a key press must not drive the review: typing, an open dialog, a modifier or auto-repeat. */
export function shouldIgnoreReviewKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return true
  const target = event.target as HTMLElement | null
  if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return true
  if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]')) return true
  return false
}
