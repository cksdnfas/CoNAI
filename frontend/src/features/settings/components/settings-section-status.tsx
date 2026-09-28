import { PencilLine, Zap } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** Mark a section whose controls apply immediately instead of waiting for the page save bar. */
export function InstantApplyHint({ className }: { className?: string }) {
  const { t } = useI18n()

  return (
    <Tip content={t({ ko: '여기서 바꾼 건 저장 버튼 없이 바로 반영돼.', en: 'Changes here take effect right away, without the save bar.' })}>
      <span
        tabIndex={0}
        className={cn('inline-flex items-center gap-1 rounded-sm bg-surface-high px-2 py-0.5 text-2xs font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40', className)}
      >
        <Zap className="h-3 w-3" />
        {t({ ko: '즉시 적용', en: 'Applies instantly' })}
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
    <span className="inline-flex items-center gap-1 rounded-sm bg-primary/14 px-2 py-0.5 text-2xs font-medium whitespace-nowrap text-primary">
      <PencilLine className="h-3 w-3" />
      {t({ ko: '변경됨', en: 'Edited' })}
    </span>
  )
}
