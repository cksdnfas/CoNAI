import { useEffect, useRef, useState, type CSSProperties, type PropsWithChildren, type ReactNode } from 'react'
import { Pin, PinOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ExplorerSidebarProps extends PropsWithChildren {
  title: ReactNode
  badge?: ReactNode
  headerExtra?: ReactNode
  className?: string
  bodyClassName?: string
  floatingFrame?: boolean
  floatingLockStorageKey?: string
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
  floatingLockStorageKey,
  onFloatingChange,
  children,
}: ExplorerSidebarProps) {
  const asideRef = useRef<HTMLElement | null>(null)
  const [isFloating, setIsFloating] = useState(false)
  const [isFloatingLocked, setIsFloatingLocked] = useState(() => {
    if (typeof window === 'undefined' || !floatingLockStorageKey) {
      return false
    }

    return window.localStorage.getItem(floatingLockStorageKey) === 'true'
  })

  useEffect(() => {
    if (!floatingLockStorageKey || typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(floatingLockStorageKey, isFloatingLocked ? 'true' : 'false')
  }, [floatingLockStorageKey, isFloatingLocked])

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
      const nextIsFloating = !isFloatingLocked && isSticky && rect.top <= topOffset + 1
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
  }, [floatingFrame, isFloatingLocked, onFloatingChange])

  const sidebarStyle: CSSProperties | undefined = isFloatingLocked
    ? { position: 'relative', top: 'auto' }
    : undefined
  const shouldShowFloatingLockAction = floatingFrame && (isFloating || isFloatingLocked)

  return (
    <aside
      ref={asideRef}
      className={cn('explorer-sidebar relative flex min-h-0 flex-col rounded-sm bg-surface-lowest p-4', className)}
      style={sidebarStyle}
      data-floating={!isFloatingLocked && isFloating ? 'true' : 'false'}
    >
      {floatingFrame ? <div className="explorer-sidebar-floating-frame pointer-events-none absolute inset-0 z-10 rounded-sm" /> : null}

      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">{title}</h2>
        {badge}
      </div>

      {headerExtra ? <div className="mb-4">{headerExtra}</div> : null}

      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>

      {shouldShowFloatingLockAction ? (
        <div className="mt-4 border-t border-white/5 pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full bg-surface-low"
            onClick={() => setIsFloatingLocked((current) => !current)}
          >
            {isFloatingLocked ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {isFloatingLocked ? '사이드바 고정 해제' : '사이드바 고정'}
          </Button>
        </div>
      ) : null}
    </aside>
  )
}
