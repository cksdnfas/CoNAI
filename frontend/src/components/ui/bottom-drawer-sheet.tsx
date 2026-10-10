import { useEffect, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { stopAtPortalEdge } from '@/lib/portal-events'
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
  surfaceVariant?: 'default' | 'controller'
  className?: string
  bodyClassName?: string
  headerClassName?: string
  headerPortalClassName?: string
  footer?: ReactNode
  closeLabel?: string
  hideHandle?: boolean
}

type BottomDrawerNoticeProps = ComponentProps<'div'> & {
  children: ReactNode
}

/** Render one shared low-emphasis notice block inside drawer shells. */
export function BottomDrawerNotice({ children, className, ...props }: BottomDrawerNoticeProps) {
  return (
    <div className={cn('rounded-sm bg-surface-lowest/70 px-4 py-4 text-sm text-muted-foreground', className)} {...props}>
      {children}
    </div>
  )
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
  surfaceVariant = 'default',
  className,
  bodyClassName,
  headerClassName,
  headerPortalClassName,
  footer,
  closeLabel = '접기',
  hideHandle = false,
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

  const hasHeader = title !== null || subtitle || headerActions || headerContentId
  const useControllerSurface = surfaceVariant === 'controller'

  return createPortal(
    <>
      <div
        className={open ? 'fixed inset-0 z-drawer bg-backdrop/70 transition-opacity duration-200' : 'pointer-events-none fixed inset-0 z-drawer bg-transparent transition-opacity duration-200'}
        onClick={stopAtPortalEdge(onClose)}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={stopAtPortalEdge()}
        data-surface={useControllerSurface ? undefined : 'raised'}
        className={cn(
          open
            ? 'theme-floating-panel theme-bottom-drawer fixed inset-x-0 bottom-0 z-drawer-panel flex h-[min(82vh,calc(100vh-1rem))] flex-col overflow-hidden transition-transform duration-300'
            : 'theme-floating-panel theme-bottom-drawer pointer-events-none fixed inset-x-0 bottom-0 z-drawer-panel flex h-[min(82vh,calc(100vh-1rem))] translate-y-full flex-col overflow-hidden transition-transform duration-300',
          useControllerSurface && 'border-x-0 border-b-0 bg-background/96 shadow-[0_-24px_64px_rgba(0,0,0,0.42)] backdrop-blur-md',
          className,
        )}
      >
        {!hideHandle ? (
          <div className="flex justify-center px-4 pt-3">
            <div className="h-1.5 w-14 rounded-full bg-white/15" />
          </div>
        ) : null}

        {hasHeader ? (
          <div className={cn(
            'theme-drawer-header',
            useControllerSurface ? 'bg-background/92 px-4 py-3' : 'bg-background/40',
            headerClassName,
          )}>
            {title !== null || subtitle || headerActions ? (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  {title !== null ? <div className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">{title}</div> : null}
                  {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
                </div>
                {headerActions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{headerActions}</div> : null}
              </div>
            ) : null}
            {headerContentId ? <div id={headerContentId} className={cn((title !== null || subtitle || headerActions) ? 'mt-3' : '', headerPortalClassName)} /> : null}
          </div>
        ) : null}

        <div className={cn(
          'theme-drawer-body min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+5rem)]',
          useControllerSurface && 'bg-background/92',
          bodyClassName,
        )}>
          {children}
        </div>

        {footer !== null ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            {footer !== undefined ? footer : (
              <Button type="button" size="sm" className="pointer-events-auto w-[30vw] min-w-[112px] max-w-[180px]" onClick={onClose}>
                <ChevronDown className="h-4 w-4" />
                {closeLabel}
              </Button>
            )}
          </div>
        ) : null}
      </aside>
    </>,
    document.body,
  )
}
