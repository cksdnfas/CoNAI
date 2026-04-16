import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOverlayBackClose } from './use-overlay-back-close'
import { Button } from './button'

type BottomDrawerSheetProps = {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  headerActions?: ReactNode
  headerContentId?: string
  children: ReactNode
  onClose: () => void
  ariaLabel?: string
  className?: string
  bodyClassName?: string
  footer?: ReactNode
  closeLabel?: string
}

export function BottomDrawerSheet({
  open,
  title,
  subtitle,
  headerActions,
  headerContentId,
  children,
  onClose,
  ariaLabel,
  className,
  bodyClassName,
  footer,
  closeLabel = '접기',
}: BottomDrawerSheetProps) {
  useOverlayBackClose({ open, onClose })

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <>
      <div
        className={open ? 'fixed inset-0 z-[84] bg-black/50 transition-opacity' : 'pointer-events-none fixed inset-0 z-[84] bg-black/0 transition-opacity'}
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          open
            ? 'theme-floating-panel theme-bottom-drawer fixed inset-x-0 bottom-0 z-[85] flex h-[min(82vh,calc(100vh-1rem))] flex-col transition-transform duration-300'
            : 'theme-floating-panel theme-bottom-drawer pointer-events-none fixed inset-x-0 bottom-0 z-[85] flex h-[min(82vh,calc(100vh-1rem))] translate-y-full flex-col transition-transform duration-300',
          className,
        )}
      >
        <div className="flex justify-center px-4 pt-3">
          <div className="h-1.5 w-14 rounded-full bg-white/15" />
        </div>

        <div className="theme-drawer-header border-b border-white/5">
          {title !== null || subtitle || headerActions ? (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</div>
                {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
              </div>
              {headerActions ? <div className="flex shrink-0 flex-wrap gap-2">{headerActions}</div> : null}
            </div>
          ) : null}
          {headerContentId ? <div id={headerContentId} className={cn((title !== null || subtitle || headerActions) ? 'mt-4 border-t border-white/5 pt-4' : 'pt-4')} /> : null}
        </div>

        <div className={cn('theme-drawer-body min-h-0 flex-1 overflow-y-auto pb-20', bodyClassName)}>
          {children}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
          {footer ?? (
            <Button type="button" size="sm" className="pointer-events-auto w-[30vw] min-w-[112px] max-w-[180px]" onClick={onClose}>
              <ChevronDown className="h-4 w-4" />
              {closeLabel}
            </Button>
          )}
        </div>
      </aside>
    </>,
    document.body,
  )
}
