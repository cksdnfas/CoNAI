import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ExplorerSidebarProps extends PropsWithChildren {
  title: ReactNode
  badge?: ReactNode
  headerExtra?: ReactNode
  className?: string
  bodyClassName?: string
  floatingFrame?: boolean
  floatingLocked?: boolean
  onFloatingChange?: (isFloating: boolean) => void
}

/** Render a reusable sidebar shell for explorer-style navigation panels. */
export function ExplorerSidebar({
  title,
  badge,
  headerExtra,
  className,
  bodyClassName,
  floatingFrame = false,
  floatingLocked = false,
  onFloatingChange,
  children,
}: ExplorerSidebarProps) {
  const asideRef = useRef<HTMLElement | null>(null)
  const [isFloating, setIsFloating] = useState(false)

  useEffect(() => {
    if (!floatingFrame) {
      setIsFloating(false)
      onFloatingChange?.(false)
      return
    }

    const node = asideRef.current
    if (!node || typeof window === 'undefined') {
      onFloatingChange?.(false)
      return
    }

    let animationFrameId = 0

    const updateFloatingState = () => {
      animationFrameId = 0
      const computedStyle = window.getComputedStyle(node)
      const isSticky = computedStyle.position === 'sticky' || computedStyle.position === '-webkit-sticky'
      const topOffset = Number.parseFloat(computedStyle.top || '0') || 0
      const rect = node.getBoundingClientRect()
      const nextIsFloating = isSticky && rect.top <= topOffset + 1
      setIsFloating(nextIsFloating)
      onFloatingChange?.(nextIsFloating)
    }

    const scheduleUpdate = () => {
      if (animationFrameId !== 0) {
        return
      }
      animationFrameId = window.requestAnimationFrame(updateFloatingState)
    }

    updateFloatingState()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)

    return () => {
      if (animationFrameId !== 0) {
        window.cancelAnimationFrame(animationFrameId)
      }
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [floatingFrame, onFloatingChange])

  return (
    <aside ref={asideRef} className={cn('explorer-sidebar relative rounded-sm bg-surface-lowest p-4', className)} data-floating={!floatingLocked && isFloating ? 'true' : 'false'}>
      {floatingFrame ? <div className="explorer-sidebar-floating-frame pointer-events-none absolute inset-0 z-10 rounded-sm" /> : null}

      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">{title}</h2>
        {badge}
      </div>

      {headerExtra ? <div className="mb-4">{headerExtra}</div> : null}

      <div className={bodyClassName}>{children}</div>
    </aside>
  )
}
