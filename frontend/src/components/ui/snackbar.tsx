import { useEffect, type CSSProperties } from 'react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface SnackbarProps {
  open: boolean
  message: string | null
  tone?: 'info' | 'error'
  onClose: () => void
  durationMs?: number
  nonce?: number
}

const snackbarSurfaceStyleByTone: Record<NonNullable<SnackbarProps['tone']>, CSSProperties> = {
  info: {
    backgroundColor: 'color-mix(in srgb, var(--surface-highest) 94%, var(--primary) 6%)',
    borderColor: 'color-mix(in srgb, var(--primary) 34%, var(--border))',
    boxShadow: '0 18px 56px color-mix(in srgb, black 42%, transparent), inset 0 1px 0 color-mix(in srgb, white 7%, transparent)',
  },
  error: {
    backgroundColor: 'color-mix(in srgb, var(--surface-highest) 88%, var(--theme-badge-negative) 12%)',
    borderColor: 'color-mix(in srgb, var(--theme-badge-negative) 46%, var(--border))',
    boxShadow: '0 18px 56px color-mix(in srgb, black 44%, transparent), inset 0 1px 0 color-mix(in srgb, white 7%, transparent)',
  },
}

export function Snackbar({ open, message, tone = 'info', onClose, durationMs = 2800, nonce = 0 }: SnackbarProps) {
  const { t } = useI18n()

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
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[7000] flex justify-end p-4 sm:p-6">
      <div
        className={cn(
          'max-w-md min-w-[240px] rounded-sm border px-4 py-3 text-sm text-foreground backdrop-blur-sm transition-all duration-200',
          open && message ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        )}
        style={snackbarSurfaceStyleByTone[tone]}
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
            aria-label={t({ ko: '닫기', en: 'Close' })}
          >
            {t({ ko: '닫기', en: 'Close' })}
          </button>
        </div>
      </div>
    </div>
  )
}
