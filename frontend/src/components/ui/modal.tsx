import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentProps, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PropsWithChildren, type ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'
import { useOptionalConfirm } from './confirm-dialog'
import { IconButton } from './icon-button'
import { Tip } from './tooltip'
import { useI18n } from '@/i18n'
import { stopAtPortalEdge } from '@/lib/portal-events'
import { cn } from '@/lib/utils'
import { useOverlayBackClose } from './use-overlay-back-close'

interface ModalProps extends PropsWithChildren {
  open: boolean
  title: ReactNode
  description?: ReactNode
  headerContent?: ReactNode
  headerActions?: ReactNode
  onClose: () => void
  /**
   * Width step: `narrow` (35rem) for a few fields, `normal` (48rem) for one-column editors, `wide` (64rem) for editors
   * with a side list or a table. `widthClassName` overrides it.
   */
  size?: ModalSize
  widthClassName?: string
  closeOnBack?: boolean
  /**
   * Unsaved edits: a dot after the title, and a close from the dialog itself (Esc, backdrop, back, ✕) asks before
   * discarding them. Closing from code (after a save) never asks.
   */
  dirty?: boolean
  /** Ctrl/⌘+S inside the dialog calls it; leave it out while saving is not possible. */
  onSave?: () => void
  /**
   * `auto` fits the content. `medium` and `tall` open at a fixed height (up to 40rem / 64rem) for content that grows or
   * changes while open (sections, accordions, lists): the frame stays put, the body scrolls, and a `ModalFooter` at the
   * end of the body (or of a form wrapping it) stays pinned.
   */
  height?: 'auto' | 'medium' | 'tall'
  /** Reserve room for an existing desktop side panel so both surfaces remain interactive. */
  sidePanelInset?: string
}

type ModalSize = 'narrow' | 'normal' | 'wide'

const SIZE_CLASS: Record<ModalSize, string> = { narrow: 'max-w-[35rem]', normal: 'max-w-3xl', wide: 'max-w-5xl' }

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
function Modal({ open, title, description, headerContent, headerActions, onClose, size, widthClassName, closeOnBack = true, height = 'auto', dirty = false, onSave, sidePanelInset, children }: ModalProps) {
  const fixedHeight = height !== 'auto'
  const { t } = useI18n()
  const confirm = useOptionalConfirm()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const pendingEscapeRef = useRef<KeyboardEvent | null>(null)
  const onCloseRef = useRef(onClose)
  const dirtyRef = useRef(dirty)
  const onSaveRef = useRef(onSave)
  const askingRef = useRef(false)

  useEffect(() => {
    onCloseRef.current = onClose
    dirtyRef.current = dirty
    onSaveRef.current = onSave
  }, [onClose, dirty, onSave])

  /** A close the person asked for: with unsaved edits it waits for "discard" (and asks only once at a time). */
  const requestClose = useCallback(() => {
    if (!dirtyRef.current || !confirm) {
      onCloseRef.current()
      return
    }
    if (askingRef.current) return
    askingRef.current = true
    void confirm({
      title: t({ ko: '저장 안 한 변경이 있어', en: 'You have unsaved changes' }),
      confirmLabel: t({ ko: '버리기', en: 'Discard' }),
      cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
      tone: 'destructive',
    }).then((discard) => {
      askingRef.current = false
      if (discard) onCloseRef.current()
    })
  }, [confirm, t])

  // A declined back-close stays open; the hook re-pushes its history entry.
  useOverlayBackClose({ open, onClose: requestClose, enabled: closeOnBack })

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
      requestClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      pendingEscapeRef.current = null
    }
  }, [open, requestClose])

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
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
      // Always keep the browser's "save page" away from an open editor; save only when it can.
      event.preventDefault()
      if (!event.repeat) onSaveRef.current?.()
      return
    }

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
            requestClose()
          }
        }}
      >
        <DialogPrimitive.Portal>
          {/* Events still bubble up the React tree from here: clicks stop at this edge, and `nokey` keeps a modal opened inside a graph node from steering that node with its keys. */}
          <div data-slot="modal" data-side-panel={sidePanelInset ? 'true' : undefined} className={cn('nokey fixed inset-0 z-modal flex items-center justify-center bg-backdrop p-3 sm:p-4 md:p-6', sidePanelInset && 'lg:right-(--modal-side-inset)')} style={sidePanelInset ? { '--modal-side-inset': sidePanelInset } as CSSProperties : undefined} onMouseDown={requestClose} onClick={stopAtPortalEdge()} onDoubleClick={stopAtPortalEdge()} onContextMenu={stopAtPortalEdge()}>
            <DialogPrimitive.Content
              ref={contentRef}
              aria-modal={!sidePanelInset}
              aria-label={hasTitle ? undefined : t({ ko: '대화 상자', en: 'Dialog' })}
              {...(description ? {} : { 'aria-describedby': undefined })}
              data-height={height}
              className={cn('mx-auto flex max-h-full w-full flex-col rounded-sm bg-background shadow-elevation-3 outline-none', !fixedHeight && 'overflow-y-auto', height === 'medium' && 'h-full max-h-[min(100%,40rem)]', height === 'tall' && 'h-full max-h-[min(100%,64rem)]', widthClassName ?? (size ? SIZE_CLASS[size] : 'max-w-4xl'))}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={handleContentKeyDown}
              onEscapeKeyDown={handleEscapeKeyDown}
              onInteractOutside={preventOutsideDismiss}
              onOpenAutoFocus={handleOpenAutoFocus}
              onCloseAutoFocus={handleCloseAutoFocus}
            >
              <div className="sticky top-0 z-10 shrink-0 bg-background/96 px-4 pt-4 pb-2 backdrop-blur md:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <DialogPrimitive.Title className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                      {title}
                      {dirty ? (
                        <Tip content={t({ ko: '저장 안 한 변경', en: 'Unsaved changes' })}>
                          <span role="img" aria-label={t({ ko: '저장 안 한 변경', en: 'Unsaved changes' })} className="ml-2 inline-block size-1.5 rounded-full bg-primary align-middle" />
                        </Tip>
                      ) : null}
                    </DialogPrimitive.Title>
                    {description ? (
                      <DialogPrimitive.Description asChild>
                        <div className="text-sm text-muted-foreground">{description}</div>
                      </DialogPrimitive.Description>
                    ) : null}
                  </div>

                  {headerActions}
                  <IconButton size="icon-sm" variant="secondary" className="shrink-0" onClick={requestClose} label={t({ ko: '닫기', en: 'Close' })}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>

                {headerContent ? <div className="mt-3">{headerContent}</div> : null}
              </div>

              {fixedHeight ? (
                // Footer pinning lives in index.css (`[data-slot="modal-scroll"]`).
                <div data-slot="modal-scroll" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-4 md:px-5 md:pb-5">
                  {children}
                </div>
              ) : (
                <div className="px-4 pt-2 pb-4 md:px-5 md:pb-5">{children}</div>
              )}
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
  return <div data-slot="modal-footer" className={cn('flex flex-wrap items-center justify-end gap-2 pt-2', className)} {...props} />
}

export { Modal, ModalBody, ModalFooter }
