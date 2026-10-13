import { PencilLine, Zap } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** Mark a section whose controls apply immediately instead of waiting for the page save bar. */
export function InstantApplyHint({ className }: { className?: string }) {
  const { t } = useI18n()

  return (
    <Tip content={t({ ko: '즉시 적용: 저장 버튼 없이 바로 반영돼.', en: 'Applies instantly, without the save bar.' })}>
      <span
        tabIndex={0}
        aria-label={t({ ko: '즉시 적용', en: 'Applies instantly' })}
        className={cn('inline-flex items-center rounded-sm p-0.5 text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40', className)}
      >
        <Zap className="h-3.5 w-3.5" />
      </span>
    </Tip>
  )
}

/** Small header badge for a section that has unsaved edits waiting in the save bar. */
export function SectionDirtyBadge({ dirty }: { dirty: boolean }) {
  const { t } = useI18n()

  if (!dirty) {
    return null
  }

  return (
    <Chip size="sm" tone="primary" className="gap-1 font-medium">
      <PencilLine />
      {t({ ko: '변경됨', en: 'Edited' })}
    </Chip>
  )
}
