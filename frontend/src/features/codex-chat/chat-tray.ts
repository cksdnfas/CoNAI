import { useEffect, useEffectEvent, useState, type CSSProperties, type RefObject } from 'react'

/*
 * What the composer's trays share: the pop chips' spring-in and drop-back motion, and how a tray is dismissed.
 * The flag tray rises over the composer as pop chips (see chat-pop-chip.ts); the + stack and the other trays are panels.
 */

export const POP_STAGGER_MS = 45
const DROP_STAGGER_MS = 18
const DROP_MS = 180

type TrayPhase = 'open' | 'closing' | 'closed'

/**
 * The life of a tray of `count` pop chips: each springs up a beat after the one before it, and on close they drop
 * back in reverse order before the tray is gone (`shown` false).
 */
export function usePopTray(open: boolean, count: number) {
  const [phase, setPhase] = useState<TrayPhase>(open ? 'open' : 'closed')

  useEffect(() => {
    if (open) {
      setPhase('open')
      return
    }
    setPhase((current) => (current === 'open' ? 'closing' : current))
    const timer = window.setTimeout(() => setPhase('closed'), DROP_MS + count * DROP_STAGGER_MS + 40)
    return () => window.clearTimeout(timer)
  }, [open, count])

  const closing = phase === 'closing'
  const motion = (index: number): { className: string; style: CSSProperties } => closing
    ? { className: 'animate-chat-flag-drop motion-reduce:animate-none motion-reduce:opacity-0', style: { animationDelay: `${(count - 1 - index) * DROP_STAGGER_MS}ms` } }
    : { className: 'animate-chat-flag-pop motion-reduce:animate-chat-flag-fade', style: { animationDelay: `${index * POP_STAGGER_MS}ms` } }
  return { shown: phase !== 'closed', closing, motion }
}

/**
 * Close an open tray on Esc (focus returns to its key) or a click elsewhere. A click on the key itself is the key's
 * own toggle, so it does not count as outside; tooltips, menus and dialogs live in portals and do not either.
 */
export function useTrayDismiss({ open, trayRef, buttonRef, onClose }: {
  open: boolean
  trayRef: RefObject<HTMLElement | null>
  buttonRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  // Callers pass a fresh closure each render; the listeners follow the latest one without being re-attached.
  const close = useEffectEvent(onClose)
  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (trayRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      if ((target as Element).closest?.('[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"]')) return
      close()
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [buttonRef, open, trayRef])
}
