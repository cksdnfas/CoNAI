import type { PropsWithChildren } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { Snackbar } from './snackbar'
import { SnackbarContext, type ShowSnackbarOptions, type SnackbarTone } from './snackbar-context'

const INFO_DURATION_MS = 2800
/** Errors stay visible long enough to read (and hover pauses them further); they can always be closed by hand. */
const MIN_ERROR_DURATION_MS = 8000
const MAX_VISIBLE_SNACKBARS = 3

interface SnackbarItem {
  id: number
  message: string
  tone: SnackbarTone
  durationMs: number
  nonce: number
  repeatCount: number
}

export function SnackbarProvider({ children }: PropsWithChildren) {
  const [items, setItems] = useState<SnackbarItem[]>([])
  const nextIdRef = useRef(0)

  const dismissSnackbar = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const closeSnackbar = useCallback(() => {
    setItems([])
  }, [])

  const showSnackbar = useCallback(({ message, tone = 'info', durationMs }: ShowSnackbarOptions) => {
    const resolvedDurationMs = tone === 'error'
      ? Math.max(durationMs ?? MIN_ERROR_DURATION_MS, MIN_ERROR_DURATION_MS)
      : durationMs ?? INFO_DURATION_MS

    setItems((current) => {
      const newest = current[current.length - 1]
      if (newest && newest.message === message && newest.tone === tone) {
        // Same message again: refresh the existing card instead of stacking a duplicate.
        return [
          ...current.slice(0, -1),
          { ...newest, durationMs: resolvedDurationMs, nonce: newest.nonce + 1, repeatCount: newest.repeatCount + 1 },
        ]
      }

      nextIdRef.current += 1
      const nextItem: SnackbarItem = { id: nextIdRef.current, message, tone, durationMs: resolvedDurationMs, nonce: 0, repeatCount: 1 }
      return [...current, nextItem].slice(-MAX_VISIBLE_SNACKBARS)
    })
  }, [])

  const value = useMemo(
    () => ({
      showSnackbar,
      closeSnackbar,
    }),
    [closeSnackbar, showSnackbar],
  )

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      {/* Bottom-right stack: newest card sits at the bottom, closest to the corner. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[7000] flex flex-col items-end gap-2 p-4 sm:p-6">
        {items.map((item) => (
          <SnackbarStackItem key={item.id} item={item} onDismiss={dismissSnackbar} />
        ))}
      </div>
    </SnackbarContext.Provider>
  )
}

function SnackbarStackItem({ item, onDismiss }: { item: SnackbarItem; onDismiss: (id: number) => void }) {
  const { id } = item
  const handleClose = useCallback(() => onDismiss(id), [id, onDismiss])

  return (
    <Snackbar
      message={item.message}
      tone={item.tone}
      durationMs={item.durationMs}
      nonce={item.nonce}
      repeatCount={item.repeatCount}
      onClose={handleClose}
    />
  )
}
