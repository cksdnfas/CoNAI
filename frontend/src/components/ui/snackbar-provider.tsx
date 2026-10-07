import type { PropsWithChildren, ReactNode } from 'react'
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
  content?: ReactNode
  key?: string
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

  const showSnackbar = useCallback(({ message, content, key, tone = 'info', durationMs }: ShowSnackbarOptions) => {
    const resolvedDurationMs = tone === 'error'
      ? Math.max(durationMs ?? MIN_ERROR_DURATION_MS, MIN_ERROR_DURATION_MS)
      : durationMs ?? INFO_DURATION_MS

    setItems((current) => {
      const newest = current[current.length - 1]
      const matchIndex = key !== undefined
        ? current.findIndex((item) => item.key === key)
        : newest && newest.key === undefined && newest.message === message && newest.tone === tone ? current.length - 1 : -1
      if (matchIndex >= 0) {
        // Keyed results replace one reply's card; ordinary repeated messages keep their counter.
        return current.map((item, index) => index === matchIndex
          ? { ...item, message, content, tone, durationMs: resolvedDurationMs, nonce: item.nonce + 1, repeatCount: key !== undefined ? 1 : item.repeatCount + 1 }
          : item)
      }

      nextIdRef.current += 1
      const nextItem: SnackbarItem = { id: nextIdRef.current, message, content, key, tone, durationMs: resolvedDurationMs, nonce: 0, repeatCount: 1 }
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
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-end gap-2 p-4 sm:p-6">
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
      content={item.content}
      tone={item.tone}
      durationMs={item.durationMs}
      nonce={item.nonce}
      repeatCount={item.repeatCount}
      onClose={handleClose}
    />
  )
}
