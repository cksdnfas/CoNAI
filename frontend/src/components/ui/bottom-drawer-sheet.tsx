import { forwardRef, useEffect, type ComponentProps, type ReactNode } from 'react'
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
  surfaceVariant?: 'default' | 'controller'
  className?: string
  bodyClassName?: string
  headerClassName?: string
  headerPortalClassName?: string
  footer?: ReactNode
  closeLabel?: string
  hideHandle?: boolean
}

type BottomDrawerSectionProps = ComponentProps<'section'> & {
  heading?: ReactNode
  actions?: ReactNode
  children: ReactNode
  bodyClassName?: string
  headerClassName?: string
}

/** Render one shared minimal content section inside drawer shells. */
export const BottomDrawerSection = forwardRef<HTMLElement, BottomDrawerSectionProps>(function BottomDrawerSection(
  { heading, actions, children, className, bodyClassName, headerClassName, ...props },
  ref,
) {
  const hasHeader = heading !== undefined || actions !== undefined

  return (
    <section ref={ref} className={cn('overflow-hidden rounded-sm border border-border/80 bg-surface-container/30', className)} {...props}>
      {hasHeader ? (
        <div className={cn('flex items-center justify-between gap-3 border-b border-border/80 px-4 py-3', headerClassName)}>
          {heading !== undefined ? <div className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{heading}</div> : <div className="flex-1" />}
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn('px-4 py-4', bodyClassName)}>
        {children}
      </div>
    </section>
  )
})

type BottomDrawerNoticeProps = ComponentProps<'div'> & {
  children: ReactNode
}

/** Render one shared low-emphasis notice block inside drawer shells. */
export function BottomDrawerNotice({ children, className, ...props }: BottomDrawerNoticeProps) {
  return (
    <div className={cn('rounded-sm border border-border/70 bg-surface-low/45 px-4 py-4 text-sm text-muted-foreground', className)} {...props}>
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
        className={open ? 'fixed inset-0 z-[84] bg-black/56 transition-opacity duration-200' : 'pointer-events-none fixed inset-0 z-[84] bg-black/0 transition-opacity duration-200'}
        onClick={onClose}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          open
            ? 'theme-floating-panel theme-bottom-drawer fixed inset-x-0 bottom-0 z-[85] flex h-[min(82vh,calc(100vh-1rem))] flex-col overflow-hidden transition-transform duration-300'
            : 'theme-floating-panel theme-bottom-drawer pointer-events-none fixed inset-x-0 bottom-0 z-[85] flex h-[min(82vh,calc(100vh-1rem))] translate-y-full flex-col overflow-hidden transition-transform duration-300',
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
            useControllerSurface ? 'border-b-0 bg-background/92 px-4 py-3' : 'border-b border-border/80 bg-background/40',
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
            {headerContentId ? <div id={headerContentId} className={cn((title !== null || subtitle || headerActions) ? 'mt-3 border-t border-border/80 pt-3' : '', headerPortalClassName)} /> : null}
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
