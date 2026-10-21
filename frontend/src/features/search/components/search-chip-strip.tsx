import { SEARCH_OPERATOR_CYCLE_HINT, SEARCH_OPERATOR_DESCRIPTIONS, SEARCH_OPERATOR_LABELS, SEARCH_SCOPE_LABEL_KEYS } from '@/features/search/search-constants'
import type { SearchChip } from '@/features/search/search-types'
import { isFixedOperatorChip } from '@/features/search/search-utils'
import { Chip, ChipAction } from '@/components/ui/chip'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface SearchChipStripProps {
  chips: SearchChip[]
  onCycleOperator: (chipId: string) => void
  onRemove: (chipId: string) => void
  className?: string
}

/**
 * Inline, removable filter chips for a toolbar row. Each chip reads "operator · value": the operator cycles on click
 * (포함 → 또는 → 제외) and the × removes the filter. The scope (긍정, 모델…) prefixes the value in muted text.
 */
export function SearchChipStrip({ chips, onCycleOperator, onRemove, className }: SearchChipStripProps) {
  const { t } = useI18n()

  if (chips.length === 0) {
    return null
  }

  return (
    <ul className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)} aria-label={t({ ko: '적용된 필터', en: 'Applied filters' })}>
      {chips.map((chip) => {
        const scopeLabel = t(SEARCH_SCOPE_LABEL_KEYS[chip.scope])
        const operatorDescription = t(SEARCH_OPERATOR_DESCRIPTIONS[chip.operator])

        return (
          <li key={chip.id} className="min-w-0">
            <Chip
              tone={chip.operator === 'NOT' ? 'destructive' : 'primary'}
              onRemove={() => onRemove(chip.id)}
              removeLabel={t({ ko: '{label} 삭제', en: 'Delete {label}' }, { label: chip.label })}
            >
              {isFixedOperatorChip(chip) ? (
                <span className="px-1.5 text-xs font-bold">{t(SEARCH_OPERATOR_LABELS[chip.operator])}</span>
              ) : (
                <Tip content={[operatorDescription, t(SEARCH_OPERATOR_CYCLE_HINT)].join('\n')} className="whitespace-pre-line">
                  <ChipAction
                    onClick={() => onCycleOperator(chip.id)}
                    aria-label={t(
                      { ko: '{label}: {operator}. {hint}', en: '{label}: {operator}. {hint}' },
                      { label: chip.label, operator: operatorDescription, hint: t(SEARCH_OPERATOR_CYCLE_HINT) },
                    )}
                  >
                    {t(SEARCH_OPERATOR_LABELS[chip.operator])}
                  </ChipAction>
                </Tip>
              )}
              <span className="min-w-0 max-w-64 truncate" title={`${scopeLabel} · ${chip.label}`}>
                <span className="opacity-70">{scopeLabel}</span>
                <span className="px-1 opacity-50">·</span>
                <span className="text-foreground" style={chip.color ? { color: chip.color } : undefined}>{chip.label}</span>
              </span>
            </Chip>
          </li>
        )
      })}
    </ul>
  )
}
