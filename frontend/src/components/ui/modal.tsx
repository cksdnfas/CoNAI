import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent, type PropsWithChildren, type ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'
import { Button } from './button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { useOverlayBackClose } from './use-overlay-back-close'

interface ModalProps extends PropsWithChildren {
  open: boolean
  title: ReactNode
  description?: ReactNode
  headerContent?: ReactNode
  onClose: () => void
  widthClassName?: string
  closeOnBack?: boolean
}

const TABBABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/**
 * Hide one Esc keydown from Radix's own dismiss check without marking it handled.
 * Radix reads `defaultPrevented` right after `onEscapeKeyDown`; the one-shot getter answers `true` once and removes
 * itself, so content handlers that run later in the bubble phase still see (and can set) the real flag.
 */
function hideEscapeFromRadixDismiss(event: KeyboardEvent) {
  const removeShadow = () => {
    if (Object.prototype.hasOwnProperty.call(event, 'defaultPrevented')) {
      delete (event as { defaultPrevented?: boolean }).defaultPrevented
    }
  }

  Object.defineProperty(event, 'defaultPrevented', {
    configurable: true,
    get() {
      removeShadow()
      return true
    },
  })
  queueMicrotask(removeShadow)
}

/**
 * Remember the element focused when the modal opens, so it can get focus back on close.
 * Rendered before the dialog so its layout effect runs before `autoFocus` fields inside the dialog take focus.
 */
function ModalOpenerCapture({ open, targetRef }: { open: boolean; targetRef: { current: HTMLElement | null } }) {
  useLayoutEffect(() => {
    if (!open) {
      return
    }

    const activeElement = document.activeElement
    targetRef.current = activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null
  }, [open, targetRef])

  return null
}

/** Stop Radix from treating clicks/focus on body-portaled popups (or the backdrop) as a dismiss; the backdrop closes explicitly. */
function preventOutsideDismiss(event: Event) {
  event.preventDefault()
}

/**
 * Render a portal-mounted modal dialog on Radix Dialog with a sticky header, Esc/backdrop/back close and body scroll lock.
 *
 * Radix runs in non-modal mode on purpose: modal mode sets `pointer-events: none` on body and traps focus inside the
 * content, which breaks the app's own body-portaled popups (AnchoredPopup, path/wildcard pickers, snackbar) shown above
 * modals. The full-screen backdrop blocks the page instead, Tab/Shift+Tab loop inside the dialog, and focus moves to the
 * dialog on open and back to the opener on close.
 *
 * Esc closes only the top-most dialog, and only when nothing handled the keydown first (`defaultPrevented`), whether in
 * the capture phase (image editor) or in content bubble handlers (inputs that revert their draft on Esc).
 */
function Modal({ open, title, description, headerContent, onClose, widthClassName = 'max-w-4xl', closeOnBack = true, children }: ModalProps) {
  const { t } = useI18n()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const pendingEscapeRef = useRef<KeyboardEvent | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useOverlayBackClose({ open, onClose, enabled: closeOnBack })

  useEffect(() => {
    if (!open) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Decide on Esc after content bubble handlers ran (React dispatches portal events at body), but before window
    // listeners of overlays underneath (image view) so closing this dialog does not also close them.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || pendingEscapeRef.current !== event) {
        return
      }

      pendingEscapeRef.current = null
      if (event.defaultPrevented) {
        return
      }

      event.preventDefault()
      onCloseRef.current()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      pendingEscapeRef.current = null
    }
  }, [open])

  const handleEscapeKeyDown = useCallback((event: KeyboardEvent) => {
    // Already consumed earlier in the capture phase (e.g. the image editor clearing a selection): Radix will not dismiss either.
    if (event.defaultPrevented) {
      return
    }

    pendingEscapeRef.current = event
    hideEscapeFromRadixDismiss(event)
  }, [])

  const handleOpenAutoFocus = useCallback((event: Event) => {
    // Keep a field that focused itself (autoFocus); otherwise focus the dialog itself so mobile keyboards stay closed.
    event.preventDefault()
    const content = contentRef.current
    if (content && !content.contains(document.activeElement)) {
      content.focus({ preventScroll: true })
    }
  }, [])

  const handleCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault()
    const target = returnFocusRef.current
    returnFocusRef.current = null
    if (target?.isConnected) {
      target.focus({ preventScroll: true })
    }
  }, [])

  const handleContentKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Radix loops Tab between the first/last tabbable; Shift+Tab from the dialog container itself would otherwise leave it.
    if (event.key !== 'Tab' || !event.shiftKey || event.target !== event.currentTarget) {
      return
    }

    const tabbables = event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)
    const last = tabbables[tabbables.length - 1]
    event.preventDefault()
    last?.focus()
  }, [])

  const hasTitle = title !== null && title !== undefined && title !== false && title !== ''

  return (
    <>
      <ModalOpenerCapture open={open} targetRef={returnFocusRef} />
      <DialogPrimitive.Root
        open={open}
        modal={false}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            onClose()
          }
        }}
      >
        <DialogPrimitive.Portal>
          <div data-slot="modal" className="fixed inset-0 z-modal bg-backdrop p-3 sm:p-4 md:p-6" onMouseDown={onClose}>
            <DialogPrimitive.Content
              ref={contentRef}
              aria-modal="true"
              aria-label={hasTitle ? undefined : t({ ko: '대화 상자', en: 'Dialog' })}
              {...(description ? {} : { 'aria-describedby': undefined })}
              className={cn('mx-auto flex max-h-full w-full flex-col overflow-y-auto rounded-sm border border-border/85 bg-background shadow-elevation-3 outline-none', widthClassName)}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={handleContentKeyDown}
              onEscapeKeyDown={handleEscapeKeyDown}
              onInteractOutside={preventOutsideDismiss}
              onOpenAutoFocus={handleOpenAutoFocus}
              onCloseAutoFocus={handleCloseAutoFocus}
            >
              <div className="sticky top-0 z-10 border-b border-border/70 bg-background/96 px-4 py-3 backdrop-blur md:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <DialogPrimitive.Title className="text-base font-semibold tracking-tight text-foreground sm:text-lg">{title}</DialogPrimitive.Title>
                    {description ? (
                      <DialogPrimitive.Description asChild>
                        <div className="text-sm text-muted-foreground">{description}</div>
                      </DialogPrimitive.Description>
                    ) : null}
                  </div>

                  <Button type="button" size="icon-sm" variant="secondary" className="shrink-0" onClick={onClose} aria-label={t({ ko: '닫기', en: 'Close' })} title={t({ ko: '닫기', en: 'Close' })}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {headerContent ? <div className="mt-3 border-t border-border/70 pt-3">{headerContent}</div> : null}
              </div>

              <div className="px-4 py-4 md:px-5 md:py-5">{children}</div>
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}

/** Render the compact vertical stack used for dense modal content. */
function ModalBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="modal-body" className={cn('space-y-4', className)} {...props} />
}

/** Render the modal footer row for primary and secondary actions. */
function ModalFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="modal-footer" className={cn('flex flex-wrap items-center justify-end gap-2 border-t border-border/70 pt-4', className)} {...props} />
}

export { Modal, ModalBody, ModalFooter }
