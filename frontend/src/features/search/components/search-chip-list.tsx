import { X } from 'lucide-react'
import { SEARCH_OPERATOR_CYCLE_HINT, SEARCH_OPERATOR_DESCRIPTIONS, SEARCH_OPERATOR_LABELS, SEARCH_SCOPE_LABEL_KEYS } from '@/features/search/search-constants'
import { getSearchScopeStyle } from '@/features/search/search-utils'
import type { SearchChip } from '@/features/search/search-types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Inset } from '@/components/ui/inset'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'

interface SearchChipListProps {
  chips: SearchChip[]
  title?: string | null
  emptyMessage?: string
  onCycleOperator: (chipId: string) => void
  onRemove: (chipId: string) => void
}

/** Render the shared current-filter chip list used across search UIs. */
export function SearchChipList({
  chips,
  title,
  emptyMessage,
  onCycleOperator,
  onRemove,
}: SearchChipListProps) {
  const { t } = useI18n()
  const resolvedTitle = title === undefined ? t({ ko: '현재 필터', en: 'Current filters' }) : title
  const resolvedEmptyMessage = emptyMessage ?? t('search.components.search.chip.list.no.condition.chips.yet')

  return (
    <div className="space-y-2">
      {resolvedTitle ? <Text as="div" variant="overline" className="font-semibold">{resolvedTitle}</Text> : null}
      {chips.length === 0 ? <Inset className="text-sm text-muted-foreground">{resolvedEmptyMessage}</Inset> : null}
      {chips.length > 0 ? (
        <div className="space-y-2">
          {chips.map((chip) => (
            <Panel key={chip.id} padding="none" className="flex items-center gap-2 px-3 py-2.5">
              <span className="rounded-sm px-2 py-1 text-2xs font-semibold" style={getSearchScopeStyle(chip.scope)}>
                {t(SEARCH_SCOPE_LABEL_KEYS[chip.scope])}
              </span>
              <Button
                type="button"
                variant="subtle"
                size="xs"
                onClick={() => onCycleOperator(chip.id)}
                className="bg-primary/10 font-bold text-primary hover:bg-primary/18 hover:text-primary"
                aria-label={t(
                  { ko: '{label}: {operator}. {hint}', en: '{label}: {operator}. {hint}' },
                  { label: chip.label, operator: t(SEARCH_OPERATOR_DESCRIPTIONS[chip.operator]), hint: t(SEARCH_OPERATOR_CYCLE_HINT) },
                )}
                title={[t(SEARCH_OPERATOR_DESCRIPTIONS[chip.operator]), t(SEARCH_OPERATOR_CYCLE_HINT)].join('\n')}
              >
                {t(SEARCH_OPERATOR_LABELS[chip.operator])}
              </Button>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground" style={chip.color ? { color: chip.color } : undefined}>
                {chip.label}
              </span>
              <IconButton
                size="icon-xs"
                variant="ghost"
                onClick={() => onRemove(chip.id)}
                label={t({ ko: '{label} 삭제', en: 'Delete {label}' }, { label: chip.label })}
              >
                <X className="h-4 w-4" />
              </IconButton>
            </Panel>
          ))}
        </div>
      ) : null}
    </div>
  )
}
