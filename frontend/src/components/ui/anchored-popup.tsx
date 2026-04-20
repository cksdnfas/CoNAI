import { type ComponentPropsWithoutRef, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { useOverlayBackClose } from './use-overlay-back-close'

export type AnchoredPopupSide = 'top' | 'bottom'
export type AnchoredPopupAlign = 'start' | 'center' | 'end'

interface AnchoredPopupPosition {
  top: number
  left: number
  maxHeight: number
  placement: AnchoredPopupSide
}

interface AnchoredPopupProps {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  onClose?: () => void
  side?: AnchoredPopupSide
  align?: AnchoredPopupAlign
  sideOffset?: number
  viewportPadding?: number
  className?: string
  closeOnBack?: boolean
  surfaceProps?: Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'className'>
  children: ReactNode
}

export const anchoredPopupSurfaceClassName = 'theme-floating-panel rounded-sm border border-border/85 bg-background/96 shadow-[0_20px_60px_rgba(0,0,0,0.4)] backdrop-blur-sm'
export const anchoredPopupHeaderClassName = 'border-b border-border/70 px-3 py-2.5'
export const anchoredPopupBodyClassName = 'p-3'
export const anchoredPopupLabelClassName = 'text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'

/** Render one reusable anchored popup that avoids parent clipping and stays inside the viewport. */
export function AnchoredPopup({
  open,
  anchorRef,
  onClose,
  side = 'bottom',
  align = 'end',
  sideOffset = 8,
  viewportPadding = 12,
  className,
  closeOnBack = false,
  surfaceProps,
  children,
}: AnchoredPopupProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<AnchoredPopupPosition | null>(null)

  useOverlayBackClose({ open, onClose: onClose ?? (() => undefined), enabled: closeOnBack && Boolean(onClose) })

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = anchorRef.current
      const panel = panelRef.current
      if (!anchor || !panel) {
        return
      }

      const anchorRect = anchor.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const availableBelow = window.innerHeight - anchorRect.bottom - sideOffset - viewportPadding
      const availableAbove = anchorRect.top - sideOffset - viewportPadding
      const preferredBottom = side === 'bottom'
      const shouldOpenAbove = preferredBottom
        ? availableBelow < panelRect.height && availableAbove > availableBelow
        : !(availableAbove >= panelRect.height || availableAbove >= availableBelow)

      let left = anchorRect.left
      if (align === 'center') {
        left = anchorRect.left + anchorRect.width / 2 - panelRect.width / 2
      } else if (align === 'end') {
        left = anchorRect.right - panelRect.width
      }
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - viewportPadding - panelRect.width))

      const placement: AnchoredPopupSide = shouldOpenAbove ? 'top' : 'bottom'
      const top = shouldOpenAbove
        ? Math.max(viewportPadding, anchorRect.top - sideOffset - panelRect.height)
        : Math.min(window.innerHeight - viewportPadding - panelRect.height, anchorRect.bottom + sideOffset)

      setPosition({
        top,
        left,
        maxHeight: Math.max(160, window.innerHeight - viewportPadding * 2),
        placement,
      })
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) {
        return
      }
      if (anchorRef.current?.contains(target)) {
        return
      }
      if (panelRef.current?.contains(target)) {
        return
      }
      onClose?.()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose?.()
      }
    }

    updatePosition()
    const rafId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [align, anchorRef, onClose, open, side, sideOffset, viewportPadding])

  if (!open || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      ref={panelRef}
      className={cn(anchoredPopupSurfaceClassName, 'z-[140] overflow-y-auto overscroll-contain', className)}
      style={{
        position: 'fixed',
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        maxHeight: position?.maxHeight,
        visibility: position ? 'visible' : 'hidden',
      }}
      {...surfaceProps}
    >
      {children}
    </div>,
    document.body,
  )
}
