import { LayoutGrid, Minus, Plus, RotateCcw } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface ImageListColumnControlProps {
  value: number
  defaultValue?: number
  min?: number
  max?: number
  className?: string
  onChange: (value: number) => void
  onReset?: () => void
}

/**
 * Inline "cards per row" stepper for a gallery toolbar. Home and Groups both place it at the end of
 * their list toolbar, so nothing floats over the list or under the selection bar on phones.
 */
export function ImageListColumnControl({ value, defaultValue, min = 1, max = 8, className, onChange, onReset }: ImageListColumnControlProps) {
  const { t, formatNumber } = useI18n()

  return (
    <div
      role="group"
      aria-label={t({ ko: '한 줄 카드 수', en: 'Cards per row' })}
      className={cn('inline-flex items-center gap-0.5 rounded-sm bg-surface-container px-1 py-0.5', className)}
    >
      <LayoutGrid className="mx-1 h-4 w-4 text-muted-foreground" aria-hidden />
      <IconButton
        label={t({ ko: '열 수 줄이기', en: 'Fewer columns' })}
        size="icon-xs"
        variant="ghost"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        <Minus className="h-3.5 w-3.5" />
      </IconButton>
      <span className="min-w-6 text-center text-xs font-semibold tabular-nums text-foreground" aria-live="polite">{formatNumber(value)}</span>
      <IconButton
        label={t({ ko: '열 수 늘리기', en: 'More columns' })}
        size="icon-xs"
        variant="ghost"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        <Plus className="h-3.5 w-3.5" />
      </IconButton>
      {onReset && defaultValue !== undefined && value !== defaultValue ? (
        <IconButton
          label={t({ ko: '기본값 {count}개로 되돌리기', en: 'Reset to default {count}' }, { count: formatNumber(defaultValue) })}
          size="icon-xs"
          variant="ghost"
          onClick={onReset}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </IconButton>
      ) : null}
    </div>
  )
}
