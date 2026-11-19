import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/i18n'
import { stopAtPortalEdge } from '@/lib/portal-events'
import { cn } from '@/lib/utils'
import { useOverlayBackClose } from './use-overlay-back-close'
import { Button } from './button'
import { lockBodyScroll } from '@/lib/body-scroll-lock'

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
  closeLabel,
  hideHandle = false,
}: BottomDrawerSheetProps) {
  const { t } = useI18n()
  const resolvedCloseLabel = closeLabel ?? t({ ko: '접기', en: 'Close' })
  const drawerRef = useRef<HTMLElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  useOverlayBackClose({ open, onClose })

  useEffect(() => {
    if (!open) {
      const target = returnFocusRef.current
      returnFocusRef.current = null
      // `inert` on close can already have dropped focus to <body>; that still counts as focus left behind in the drawer.
      if (target?.isConnected && (!document.activeElement || document.activeElement === document.body || drawerRef.current?.contains(document.activeElement))) {
        target.focus({ preventScroll: true })
      }
      return
    }

    if (document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement
    }
    const rafId = window.requestAnimationFrame(() => {
      if (drawerRef.current && !drawerRef.current.contains(document.activeElement)) {
        drawerRef.current.focus({ preventScroll: true })
      }
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onClose()
      }
    }

    const releaseScroll = lockBodyScroll()
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(rafId)
      releaseScroll()
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
        aria-hidden={!open}
        className={open ? 'fixed inset-0 z-drawer bg-backdrop/70 transition-opacity duration-200 motion-reduce:transition-none' : 'pointer-events-none fixed inset-0 z-drawer bg-transparent transition-opacity duration-200 motion-reduce:transition-none'}
        onClick={stopAtPortalEdge(onClose)}
      />

      <aside
        ref={drawerRef}
        tabIndex={open ? -1 : undefined}
        inert={!open}
        aria-hidden={!open}
        role="dialog"
        aria-modal={open ? 'true' : undefined}
        aria-label={ariaLabel}
        onClick={stopAtPortalEdge()}
        className={cn(
          open
            ? 'theme-floating-panel theme-bottom-drawer fixed inset-x-0 bottom-0 z-drawer-panel flex h-[min(82dvh,calc(100dvh-1rem))] flex-col overflow-hidden outline-none transition-transform duration-300 motion-reduce:transition-none'
            : 'theme-floating-panel theme-bottom-drawer pointer-events-none fixed inset-x-0 bottom-0 z-drawer-panel flex h-[min(82dvh,calc(100dvh-1rem))] translate-y-full flex-col overflow-hidden outline-none transition-transform duration-300 motion-reduce:transition-none',
          useControllerSurface && 'border-x-0 border-b-0 bg-background/96 shadow-elevation-3 backdrop-blur-md',
          className,
        )}
      >
        {!hideHandle ? (
          <div className="flex justify-center px-4 pt-3">
            <div className="h-1.5 w-14 rounded-full bg-foreground/20" />
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
                {resolvedCloseLabel}
              </Button>
            )}
          </div>
        ) : null}
      </aside>
    </>,
    document.body,
  )
}
