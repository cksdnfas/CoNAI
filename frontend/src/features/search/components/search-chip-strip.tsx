import { X } from 'lucide-react'
import { SEARCH_OPERATOR_CYCLE_HINT, SEARCH_OPERATOR_DESCRIPTIONS, SEARCH_OPERATOR_LABELS, SEARCH_SCOPE_LABEL_KEYS } from '@/features/search/search-constants'
import type { SearchChip } from '@/features/search/search-types'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
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
            <Chip tone={chip.operator === 'NOT' ? 'destructive' : 'primary'} className="h-7 gap-0.5 py-0 pr-0.5 pl-0.5">
              <Tip content={[operatorDescription, t(SEARCH_OPERATOR_CYCLE_HINT)].join('\n')} className="whitespace-pre-line">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="px-1.5 font-bold text-current hover:text-current"
                  onClick={() => onCycleOperator(chip.id)}
                  aria-label={t(
                    { ko: '{label}: {operator}. {hint}', en: '{label}: {operator}. {hint}' },
                    { label: chip.label, operator: operatorDescription, hint: t(SEARCH_OPERATOR_CYCLE_HINT) },
                  )}
                >
                  {t(SEARCH_OPERATOR_LABELS[chip.operator])}
                </Button>
              </Tip>
              <span className="min-w-0 max-w-64 truncate" title={`${scopeLabel} · ${chip.label}`}>
                <span className="opacity-70">{scopeLabel}</span>
                <span className="px-1 opacity-50">·</span>
                <span className="text-foreground" style={chip.color ? { color: chip.color } : undefined}>{chip.label}</span>
              </span>
              <IconButton
                size="icon-xs"
                variant="ghost"
                className="text-current hover:text-current"
                onClick={() => onRemove(chip.id)}
                label={t({ ko: '{label} 삭제', en: 'Delete {label}' }, { label: chip.label })}
              >
                <X />
              </IconButton>
            </Chip>
          </li>
        )
      })}
    </ul>
  )
}
