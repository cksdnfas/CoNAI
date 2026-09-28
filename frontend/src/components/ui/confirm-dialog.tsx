import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from 'react'
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'
import { Button } from './button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export type ConfirmTone = 'default' | 'destructive'

export interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  /** Defaults to "확인" / "OK". Destructive actions should name the action ("삭제" / "Delete"). */
  confirmLabel?: ReactNode
  /** Defaults to "취소" / "Cancel". */
  cancelLabel?: ReactNode
  tone?: ConfirmTone
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean
  /** Called with `true` for the confirm action and `false` for cancel or Esc (the backdrop does not dismiss). */
  onResult: (confirmed: boolean) => void
  /** Focus target after close; Radix has no trigger here, so without it focus would fall back to body. */
  returnFocusRef?: { current: HTMLElement | null }
}

/** Render a blocking confirmation dialog (Radix AlertDialog) with cancel and confirm actions. */
function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, tone = 'default', onResult, returnFocusRef }: ConfirmDialogProps) {
  const { t } = useI18n()
  const actionRef = useRef<HTMLButtonElement | null>(null)

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onResult(false)
        }
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          data-slot="confirm-dialog-overlay"
          className="fixed inset-0 z-modal bg-backdrop data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
        />
        <AlertDialogPrimitive.Content
          data-slot="confirm-dialog"
          data-tone={tone}
          {...(description ? {} : { 'aria-describedby': undefined })}
          className="fixed top-1/2 left-1/2 z-modal w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-lg bg-surface-container p-5 text-foreground shadow-elevation-3 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none sm:p-6"
          onOpenAutoFocus={(event) => {
            // Radix focuses Cancel by default, which is right for destructive prompts; plain confirmations focus the action.
            if (tone !== 'destructive' && actionRef.current) {
              event.preventDefault()
              actionRef.current.focus()
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = returnFocusRef?.current
            if (target?.isConnected) {
              target.focus({ preventScroll: true })
            }
          }}
        >
          <div className="space-y-2">
            <AlertDialogPrimitive.Title className="text-base font-semibold tracking-tight text-foreground">{title}</AlertDialogPrimitive.Title>
            {description ? (
              <AlertDialogPrimitive.Description asChild>
                <div className="text-sm break-words whitespace-pre-line text-muted-foreground">{description}</div>
              </AlertDialogPrimitive.Description>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button type="button" variant="secondary">{cancelLabel ?? t({ ko: '취소', en: 'Cancel' })}</Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button
                ref={actionRef}
                type="button"
                variant={tone === 'destructive' ? 'destructive' : 'default'}
                className={cn(tone === 'destructive' && 'font-semibold')}
                onClick={(event) => {
                  // Resolve as confirmed before Radix closes (which would otherwise report a cancel via onOpenChange).
                  event.preventDefault()
                  onResult(true)
                }}
              >
                {confirmLabel ?? t({ ko: '확인', en: 'OK' })}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}

interface PendingConfirm {
  id: number
  options: ConfirmOptions
  resolve: (confirmed: boolean) => void
  returnFocus: HTMLElement | null
}

const ConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * Provide `useConfirm()`. Requests queue up and show one at a time.
 *
 * While a confirmation is open, keydowns are kept away from the page's own window/document shortcut listeners (image
 * editor, image view arrows) the way a native `window.confirm` would block them; Esc cancels and Tab keeps moving focus.
 */
function ConfirmProvider({ children }: PropsWithChildren) {
  const [queue, setQueue] = useState<PendingConfirm[]>([])
  const queueRef = useRef<PendingConfirm[]>([])
  const nextIdRef = useRef(0)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const current = queue[0] ?? null

  const replaceQueue = useCallback((next: PendingConfirm[]) => {
    queueRef.current = next
    if (next[0]) {
      returnFocusRef.current = next[0].returnFocus
    }
    setQueue(next)
  }, [])

  const settle = useCallback((id: number, confirmed: boolean) => {
    const item = queueRef.current.find((entry) => entry.id === id)
    if (!item) {
      return
    }

    replaceQueue(queueRef.current.filter((entry) => entry.id !== id))
    item.resolve(confirmed)
  }, [replaceQueue])

  const confirm = useCallback<ConfirmFn>((options) => new Promise<boolean>((resolve) => {
    nextIdRef.current += 1
    const activeElement = document.activeElement
    const returnFocus = activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null
    replaceQueue([...queueRef.current, { id: nextIdRef.current, options, resolve, returnFocus }])
  }), [replaceQueue])

  useEffect(() => {
    // Registered once at app start, so it runs before window capture listeners that features add later.
    const handleKeyDown = (event: KeyboardEvent) => {
      const pending = queueRef.current[0]
      if (!pending || event.key === 'Tab') {
        return
      }

      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        settle(pending.id, false)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [settle])

  useEffect(() => () => {
    // Unmounting with open requests (e.g. HMR): resolve them as cancelled so awaiting callers do not hang.
    const pending = queueRef.current
    queueRef.current = []
    pending.forEach((item) => item.resolve(false))
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        key={current?.id ?? 'idle'}
        open={current !== null}
        title={current?.options.title ?? ''}
        description={current?.options.description}
        confirmLabel={current?.options.confirmLabel}
        cancelLabel={current?.options.cancelLabel}
        tone={current?.options.tone}
        returnFocusRef={returnFocusRef}
        onResult={(confirmed) => {
          if (current) {
            settle(current.id, confirmed)
          }
        }}
      />
    </ConfirmContext.Provider>
  )
}

/** Ask for confirmation with the shared dialog; resolves `true` only when the confirm action is chosen. */
function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext)
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider')
  }
  return context
}

export { ConfirmDialog, ConfirmProvider, useConfirm }
