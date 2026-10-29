import { useEffect, useLayoutEffect, useRef } from 'react'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

/**
 * The key press belongs to a text field or an editor surface (CodeMirror, rich text and any other contenteditable
 * root), so page shortcuts leave it alone.
 */
export function isTypingTarget(event: { target: EventTarget | null }) {
  const target = event.target
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
}

/** Any open dialog, drawer, viewer or full-screen editor owns the keyboard while it is up. */
export function hasOpenDialog() {
  // Closed bottom drawers stay mounted with pointer-events off, so skip anything inert.
  for (const element of document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
    if (element.dataset.state === 'closed' || window.getComputedStyle(element).pointerEvents === 'none') {
      continue
    }
    return true
  }
  return false
}

/** Does the key press match a "Mod+Shift+K" chord? Mod is ⌘ on Apple devices and Ctrl elsewhere. */
function matchesShortcut(event: KeyboardEvent, keys: string) {
  const parts = keys.split('+')
  const key = parts[parts.length - 1].toLowerCase()
  const mod = parts.includes('Mod')
  const ctrl = parts.includes('Ctrl') || (mod && !isMac)
  const meta = mod && isMac
  // Letters also match by physical key, so a Korean IME layout still reaches the shortcut.
  const keyMatches = event.key.toLowerCase() === key || (/^[a-z]$/.test(key) && event.code === `Key${key.toUpperCase()}`)
  return keyMatches && event.ctrlKey === ctrl && event.metaKey === meta && event.altKey === parts.includes('Alt') && event.shiftKey === parts.includes('Shift')
}

/**
 * One document keydown listener for a "Mod+K"-style chord while `enabled`. The handler always sees its latest closure.
 * Typing in a field (`isTypingTarget`), IME composition, auto-repeat and events already handled are skipped.
 */
export function useHotkey(keys: string, handler: (event: KeyboardEvent) => void, enabled = true) {
  const handlerRef = useRef(handler)
  useLayoutEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!enabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || isTypingTarget(event) || !matchesShortcut(event, keys)) return
      handlerRef.current(event)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled, keys])
}

/** Save a page after the focused field commits; dialogs and the chat dock own their own shortcuts. */
export function usePageSaveShortcut(onSave: (() => void) | undefined, saving = false) {
  const saveRef = useRef(onSave)
  const savingRef = useRef(saving)
  const timerRef = useRef<number | null>(null)
  const enabled = Boolean(onSave)

  useLayoutEffect(() => {
    saveRef.current = onSave
    savingRef.current = saving
  }, [onSave, saving])

  useEffect(() => {
    if (!enabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || (event.key.toLowerCase() !== 's' && event.code !== 'KeyS')) return
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-chat-dock]')) || hasOpenDialog()) return
      event.preventDefault()
      if (event.repeat || savingRef.current || timerRef.current !== null) return
      const active = document.activeElement
      const typing = active instanceof HTMLElement && isTypingTarget({ target: active }) ? active : null
      typing?.blur()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (!savingRef.current && !hasOpenDialog()) saveRef.current?.()
        // The blur only commits the field: typing continues there unless something else took focus.
        if (typing?.isConnected && (!document.activeElement || document.activeElement === document.body)) typing.focus({ preventScroll: true })
      }, 0)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [enabled])
}

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
