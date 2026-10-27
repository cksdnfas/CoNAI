import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, type ComponentProps, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PropsWithChildren, type ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { X } from 'lucide-react'
import { useOptionalConfirm } from './confirm-dialog'
import { IconButton } from './icon-button'
import { Tip } from './tooltip'
import { useI18n } from '@/i18n'
import { stopAtPortalEdge } from '@/lib/portal-events'
import { cn } from '@/lib/utils'
import { useOverlayBackClose } from './use-overlay-back-close'
import { lockBodyScroll } from '@/lib/body-scroll-lock'

interface ModalProps extends PropsWithChildren {
  open: boolean
  /** What the dialog does ("새 외형 설정", "'기본' 설정을 삭제할까?"). */
  title: ReactNode
  /** One muted line under the title: where the thing lives and what the action affects. */
  description?: ReactNode
  /** A state chip after the title (linked, synced…). Controls never go in the header. */
  status?: ReactNode
  /** Tabs or a search under the title; stays in view while the body scrolls. */
  headerContent?: ReactNode
  /** Visual before the title, e.g. a cover thumbnail. */
  leading?: ReactNode
  onClose: () => void
  /**
   * `sm` (26rem) a question and two buttons · `md` (36rem) a form of one to six fields · `lg` (56rem) choosing from a
   * list or tree, one-column editors · `xl` (72rem) a work surface (viewer, media library). On phones `sm` / `md` rise
   * as a bottom sheet and `lg` / `xl` fill the screen. An editor with more than two sections is a page, not a dialog.
   */
  size: ModalSize
  closeOnBack?: boolean
  /**
   * Unsaved edits: a dot after the title, the footer status, and a close from the dialog itself (Esc, backdrop, back,
   * ✕, Cancel) asks before discarding them. Closing from code (after a save) never asks.
   */
  dirty?: boolean
  /** Ctrl/⌘+S inside the dialog calls it; leave it out while saving is not possible. */
  onSave?: () => void
  /**
   * `auto` (default) fits the content up to the screen. `medium` and `tall` open at a fixed height (up to 40rem /
   * 64rem) for a list that changes while open (pickers, the command palette, managers) or a body that switches tabs or
   * sections, so the frame does not jump. A short form stays `auto`.
   * In every case the body scrolls and a `ModalFooter` at its end (or at the end of a form wrapping it) stays pinned.
   */
  height?: 'auto' | 'medium' | 'tall'
  /** Reserve room for an existing desktop side panel so both surfaces remain interactive. */
  sidePanelInset?: string
  /** A full-height contextual panel entering from the right; keeps the same focus and dirty-close contract. */
  placement?: 'center' | 'right'
}

type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_CLASS: Record<ModalSize, string> = { sm: 'sm:max-w-[26rem]', md: 'sm:max-w-[36rem]', lg: 'sm:max-w-[56rem]', xl: 'sm:max-w-[72rem]' }

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

interface ModalContextValue {
  /** Close the way ✕ does: with unsaved edits it asks first. */
  requestClose: () => void
  dirty: boolean
}

const ModalContext = createContext<ModalContextValue | null>(null)

/** Close the surrounding modal the way ✕ does: with unsaved edits it asks first. For Cancel buttons in the body. */
function useModalRequestClose() {
  const modal = useContext(ModalContext)
  if (!modal) {
    throw new Error('useModalRequestClose must be used inside a Modal')
  }
  return modal.requestClose
}

/** The surrounding modal's close and unsaved state, or null outside a modal (a footer shared with pages). */
function useOptionalModal() {
  return useContext(ModalContext)
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
function Modal({ open, title, description, status, headerContent, leading, onClose, size, closeOnBack = true, height = 'auto', dirty = false, onSave, sidePanelInset, placement = 'center', children }: ModalProps) {
  const fixedHeight = height !== 'auto'
  // Phones: a short dialog rises as a bottom sheet; a picker or work surface takes the whole screen.
  const sheet = size === 'sm' || size === 'md'
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

    const releaseScroll = lockBodyScroll()

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
      releaseScroll()
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
    // A dialog opened as this one closed (a pick leading to its confirm step) keeps the focus it already took.
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[role="dialog"]')) return
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
  const body = <ModalContext.Provider value={{ requestClose, dirty }}>{children}</ModalContext.Provider>

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
          <div data-slot="modal" data-side-panel={sidePanelInset ? 'true' : undefined} className={cn('nokey fixed inset-0 z-modal flex bg-backdrop', placement === 'right' ? 'items-stretch justify-end' : 'justify-center sm:items-center sm:p-4 md:p-6', placement !== 'right' && (sheet ? 'items-end' : 'items-stretch'), sidePanelInset && 'lg:right-(--modal-side-inset)')} style={sidePanelInset ? { '--modal-side-inset': sidePanelInset } as CSSProperties : undefined} onMouseDown={requestClose} onClick={stopAtPortalEdge()} onDoubleClick={stopAtPortalEdge()} onContextMenu={stopAtPortalEdge()}>
            <DialogPrimitive.Content
              ref={contentRef}
              aria-modal={!sidePanelInset}
              aria-label={hasTitle ? undefined : t({ ko: '대화 상자', en: 'Dialog' })}
              {...(description ? {} : { 'aria-describedby': undefined })}
              data-size={size}
              data-height={height}
              className={cn(
                'flex w-full flex-col overflow-hidden border-line bg-surface-low shadow-elevation-3 outline-none',
                placement === 'right' ? 'h-full max-h-full border-l motion-safe:animate-in motion-safe:slide-in-from-right' : 'mx-auto sm:max-h-full sm:rounded-xl sm:border',
                placement !== 'right' && (sheet ? 'max-h-[92dvh] rounded-t-xl border-t' : 'h-full max-h-full sm:h-auto'),
                placement !== 'right' && sheet && fixedHeight && 'h-[85dvh]',
                placement !== 'right' && height === 'medium' && 'sm:h-full sm:max-h-[min(100%,40rem)]',
                placement !== 'right' && height === 'tall' && 'sm:h-full sm:max-h-[min(100%,64rem)]',
                SIZE_CLASS[size],
              )}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={handleContentKeyDown}
              onEscapeKeyDown={handleEscapeKeyDown}
              onInteractOutside={preventOutsideDismiss}
              onOpenAutoFocus={handleOpenAutoFocus}
              onCloseAutoFocus={handleCloseAutoFocus}
            >
              <div className="shrink-0 px-4 pt-4 pb-2 md:px-5">
                <div className="flex items-start justify-between gap-3">
                  {leading ? <div className="shrink-0">{leading}</div> : null}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <DialogPrimitive.Title className="text-base font-semibold tracking-tight text-foreground">
                        {title}
                        {dirty ? (
                          <Tip content={t({ ko: '저장 안 한 변경', en: 'Unsaved changes' })}>
                            <span role="img" aria-label={t({ ko: '저장 안 한 변경', en: 'Unsaved changes' })} className="ml-2 inline-block size-1.5 rounded-full bg-primary align-middle" />
                          </Tip>
                        ) : null}
                      </DialogPrimitive.Title>
                      {status}
                    </div>
                    {description ? (
                      <DialogPrimitive.Description asChild>
                        <div className="text-sm text-muted-foreground">{description}</div>
                      </DialogPrimitive.Description>
                    ) : null}
                  </div>
                  <IconButton size="icon-sm" variant="ghost" className="-mr-1 shrink-0" onClick={requestClose} label={t({ ko: '닫기', en: 'Close' })}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>

                {headerContent ? <div className="mt-3">{headerContent}</div> : null}
              </div>

              {/* The body scrolls under a fixed header; a footer at its end stays pinned (index.css, `[data-slot="modal-scroll"]`). */}
              <div data-slot="modal-scroll" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-4 md:px-5 md:pb-5">
                {body}
              </div>
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}

/** Render the compact vertical stack used for dense modal content. */
function ModalBody({ className, spacing = 'md', ...props }: ComponentProps<'div'> & { spacing?: 'none' | 'sm' | 'md' | 'lg' }) {
  return <div data-slot="modal-body" className={cn({ none: '', sm: 'space-y-3', md: 'space-y-4', lg: 'space-y-5' }[spacing], className)} {...props} />
}

/** Render the modal footer row for primary and secondary actions. */
function ModalFooter({ className, separated = false, ...props }: ComponentProps<'div'> & { separated?: boolean }) {
  return <div data-slot="modal-footer" className={cn('flex flex-wrap items-center justify-end gap-2', separated ? 'border-t border-line pt-3' : 'pt-2', className)} {...props} />
}

export { Modal, ModalBody, ModalFooter, useModalRequestClose, useOptionalModal }
export type { ModalSize }
