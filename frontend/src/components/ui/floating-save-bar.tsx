import type { ReactNode } from 'react'
import { CircleDot, LoaderCircle } from 'lucide-react'
import { useI18n } from '@/i18n'
import { formatShortcut } from '@/lib/keyboard-shortcut'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { floatingSurfaceClassName } from './floating-surface'

/**
 * The page-wide bar that floats up while something is unsaved (the one surface with a shadow on the page): what is
 * unsaved and the save shortcut on the left, Revert and Save in words on the right. Settings and editor pages share it;
 * the caller renders it only while there are changes (or a save is running) and confirms a revert itself.
 */
export function FloatingSaveBar({ label, saving, canSave = true, onSave, onDiscard, saveLabel, ariaLabel, children }: {
  /** What is unsaved, e.g. "저장 안 한 변경" or "변경 2건". */
  label: ReactNode
  saving: boolean
  canSave?: boolean
  onSave: () => void
  onDiscard?: () => void
  saveLabel?: string
  ariaLabel?: string
  /** Shortcuts to the changed places (chips). */
  children?: ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="sticky bottom-[calc(var(--shell-float-bottom)+1rem)] z-30 mt-8" role="region" aria-label={ariaLabel ?? t({ ko: '저장', en: 'Save' })}>
      <div className={cn('theme-floating-panel', floatingSurfaceClassName, 'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg py-2 pr-2 pl-4')}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5" aria-live="polite">
          <div className="flex shrink-0 items-center gap-2 text-sm font-semibold text-foreground">
            <CircleDot className="size-4 text-primary" aria-hidden />
            {label}
          </div>
          <kbd className="hidden rounded-xs border border-line px-1.5 font-sans text-2xs text-muted-foreground sm:inline">{formatShortcut('Mod+S')}</kbd>
          {children ? <div className="flex min-w-0 flex-wrap gap-1.5">{children}</div> : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {onDiscard ? <Button size="sm" variant="ghost" disabled={saving} onClick={onDiscard}>{t({ ko: '되돌리기', en: 'Revert' })}</Button> : null}
          <Button size="sm" disabled={saving || !canSave} aria-busy={saving || undefined} onClick={onSave}>
            {saving ? <LoaderCircle className="animate-spin" /> : null}
            {saveLabel ?? t({ ko: '저장', en: 'Save' })}
          </Button>
        </div>
      </div>
    </div>
  )
}
