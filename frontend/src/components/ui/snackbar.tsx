import { useEffect, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface SnackbarProps {
  message: string
  tone?: 'info' | 'error'
  onClose: () => void
  durationMs?: number
  /** Changes whenever the same message is re-announced so the auto-close timer restarts. */
  nonce?: number
  /** How many times this exact message arrived in a row. */
  repeatCount?: number
}

const snackbarSurfaceStyleByTone: Record<NonNullable<SnackbarProps['tone']>, CSSProperties> = {
  info: {
    backgroundColor: 'color-mix(in srgb, var(--surface-highest) 94%, var(--primary) 6%)',
    borderColor: 'color-mix(in srgb, var(--primary) 34%, var(--border))',
    boxShadow: '0 18px 56px color-mix(in srgb, black 42%, transparent), inset 0 1px 0 color-mix(in srgb, white 7%, transparent)',
  },
  error: {
    backgroundColor: 'color-mix(in srgb, var(--surface-highest) 88%, var(--destructive) 12%)',
    borderColor: 'color-mix(in srgb, var(--destructive) 46%, var(--border))',
    boxShadow: '0 18px 56px color-mix(in srgb, black 44%, transparent), inset 0 1px 0 color-mix(in srgb, white 7%, transparent)',
  },
}

/** Render one snackbar card; the provider owns stacking and positioning. Hovering pauses auto-close. */
export function Snackbar({ message, tone = 'info', onClose, durationMs = 2800, nonce = 0, repeatCount = 1 }: SnackbarProps) {
  const { t } = useI18n()
  const [isPaused, setIsPaused] = useState(false)

  useEffect(() => {
    if (isPaused) return

    const timeoutId = window.setTimeout(() => {
      onClose()
    }, durationMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [durationMs, isPaused, nonce, onClose])

  return (
    <div
      className="pointer-events-auto w-full max-w-md min-w-[240px] rounded-sm border px-4 py-3 text-sm text-foreground backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-200"
      style={snackbarSurfaceStyleByTone[tone]}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 break-words">
          {message}
          {repeatCount > 1 ? <span className="ml-2 text-xs font-semibold text-muted-foreground">×{repeatCount}</span> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className={cn('-mr-1 shrink-0 rounded-sm p-0.5 text-muted-foreground transition hover:text-foreground', 'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35')}
          aria-label={t({ ko: '닫기', en: 'Close' })}
          title={t({ ko: '닫기', en: 'Close' })}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
