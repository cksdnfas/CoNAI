import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'

export const detailSettingsLabelClassName = 'text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase'

interface DetailSettingsFlyoutProps {
  isOpen: boolean
  onToggle: () => void
  triggerLabel: string
  triggerTitle: string
  panelWidthClassName: string
  children: ReactNode
  icon: ReactNode
}

interface FlyoutPosition {
  top: number
  left: number
  placement: 'top' | 'bottom'
}

/** Render a reusable icon-triggered flyout for image detail settings. */
export function DetailSettingsFlyout({
  isOpen,
  onToggle,
  triggerLabel,
  triggerTitle,
  panelWidthClassName,
  children,
  icon,
}: DetailSettingsFlyoutProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<FlyoutPosition | null>(null)

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (!trigger || !panel) {
        return
      }

      const rect = trigger.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const viewportPadding = 12
      const gap = 10
      const availableBelow = window.innerHeight - rect.bottom - gap - viewportPadding
      const availableAbove = rect.top - gap - viewportPadding
      const shouldOpenAbove = availableBelow < panelRect.height && availableAbove > availableBelow

      let left = rect.right - panelRect.width
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - viewportPadding - panelRect.width))

      const top = shouldOpenAbove
        ? Math.max(viewportPadding, rect.top - gap - panelRect.height)
        : Math.min(window.innerHeight - viewportPadding - panelRect.height, rect.bottom + gap)

      setPosition({
        top,
        left,
        placement: shouldOpenAbove ? 'top' : 'bottom',
      })
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      onToggle()
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onToggle()
      }
    }

    updatePosition()
    const rafId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onToggle])

  const popup = isOpen && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={panelRef}
        className={`z-[135] max-h-[min(78vh,calc(100vh-3rem))] overflow-y-auto rounded-sm border border-border bg-background/98 shadow-[0_20px_44px_rgba(0,0,0,0.36)] backdrop-blur-sm ${panelWidthClassName}`}
        style={{
          position: 'fixed',
          top: position?.top ?? -9999,
          left: position?.left ?? -9999,
          visibility: position ? 'visible' : 'hidden',
        }}
      >
        <div className="border-b border-border/70 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">옵션</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{triggerTitle}</div>
        </div>
        <div className="p-4">
          {children}
        </div>
      </div>,
      document.body,
    )
    : null

  return (
    <>
      <Button ref={triggerRef} size="icon-sm" variant="outline" className="bg-surface-container hover:bg-surface-high" onClick={onToggle} aria-label={triggerLabel} title={triggerTitle}>
        {icon}
      </Button>
      {popup}
    </>
  )
}
