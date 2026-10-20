import { Suspense, lazy, useSyncExternalStore } from 'react'
import { hasOpenDialog, useHotkey } from '@/lib/keyboard-shortcut'

// The palette loads on first use, so it never weighs on the shell's first load.
const CommandPaletteLazy = lazy(() => import('./command-palette').then((module) => ({ default: module.CommandPalette })))

let isOpen = false
/** Stays mounted after the first open, so closing goes through the dialog and focus returns to where it was. */
let isLoaded = false
const listeners = new Set<() => void>()

function setOpen(next: boolean) {
  if (isOpen === next) return
  isOpen = next
  isLoaded ||= next
  listeners.forEach((listener) => listener())
}

/** Open the command palette from a menu (touch screens have no Ctrl/⌘+K). */
export function openCommandPalette() {
  setOpen(true)
}

const closeCommandPalette = () => setOpen(false)

/**
 * Ctrl/⌘+K opens the palette. Text fields and editor surfaces keep the key (`isTypingTarget`), and an open dialog,
 * viewer or full-screen editor (the image editor) owns the keyboard, so the palette does not open over it.
 */
export function CommandPaletteLauncher() {
  const open = useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => isOpen)

  useHotkey('Mod+K', (event) => {
    if (hasOpenDialog()) return
    event.preventDefault()
    setOpen(true)
  }, !open)

  return isLoaded ? (
    <Suspense fallback={null}>
      <CommandPaletteLazy open={open} onClose={closeCommandPalette} />
    </Suspense>
  ) : null
}
