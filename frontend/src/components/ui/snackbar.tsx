import { useEffect } from 'react'
import { cn } from '@/lib/utils'

interface SnackbarProps {
  open: boolean
  message: string | null
  tone?: 'info' | 'error'
  onClose: () => void
  durationMs?: number
  nonce?: number
}

export function Snackbar({ open, message, tone = 'info', onClose, durationMs = 2800, nonce = 0 }: SnackbarProps) {
  useEffect(() => {
    if (!open || !message) return

    const timeoutId = window.setTimeout(() => {
      onClose()
    }, durationMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [durationMs, message, nonce, onClose, open])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex justify-end p-4 sm:p-6">
      <div
        className={cn(
          'pointer-events-auto max-w-md min-w-[240px] rounded-sm border px-4 py-3 text-sm shadow-2xl transition-all duration-200',
          open && message ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
          tone === 'error'
            ? 'border-destructive/30 bg-destructive/12 text-destructive'
            : 'border-primary/20 bg-surface-high text-foreground',
        )}
        role="status"
        aria-live={tone === 'error' ? 'assertive' : 'polite'}
        aria-hidden={!open || !message}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 break-words">{message}</div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-xs text-muted-foreground transition hover:text-foreground"
            aria-label="닫기"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
