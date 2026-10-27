import type { ReactNode } from 'react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export type GenerationNarrowView = 'edit' | 'result'

/**
 * Narrow generation screens: edit first with an edit | result switch, and the generate bar pinned to the bottom
 * through `stickySlotId` (the controller portals its sticky bar there).
 */
export function GenerationNarrowSplit({ view, onViewChange, resultLabel, controller, result, stickySlotId, className }: {
  view: GenerationNarrowView
  onViewChange: (view: GenerationNarrowView) => void
  /** Result tab label, e.g. with the result count. */
  resultLabel?: string
  controller: ReactNode
  result: ReactNode
  stickySlotId: string
  className?: string
}) {
  const { t } = useI18n()
  return (
    <div className={cn('space-y-4', className)}>
      <SegmentedControl
        value={view}
        items={[
          { value: 'edit', label: t({ ko: '편집', en: 'Edit' }) },
          { value: 'result', label: resultLabel ?? t({ ko: '결과', en: 'Result' }) },
        ]}
        onChange={(next) => onViewChange(next as GenerationNarrowView)}
        size="sm"
        semantics="tabs"
        fullWidth
        ariaLabel={t({ ko: '편집 또는 결과', en: 'Edit or result' })}
      />

      {/* 결과를 보는 동안에도 컨트롤러는 마운트해 둬서 입력 중인 폼 상태가 사라지지 않게 한다. */}
      <div className={cn('min-w-0', view !== 'edit' && 'hidden')}>{controller}</div>
      {view === 'result' ? result : null}

      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-[calc(var(--shell-float-bottom)+0.75rem)] z-[86] flex justify-end px-3',
          view !== 'edit' && 'hidden',
        )}
      >
        <div id={stickySlotId} className="pointer-events-auto flex max-w-full justify-end" />
      </div>
    </div>
  )
}
