import { X } from 'lucide-react'
import { SEARCH_SCOPE_LABELS } from '@/features/search/search-constants'
import { getSearchScopeStyle } from '@/features/search/search-utils'
import type { SearchChip } from '@/features/search/search-types'

interface SearchChipListProps {
  chips: SearchChip[]
  title?: string
  emptyMessage?: string
  onCycleOperator: (chipId: string) => void
  onRemove: (chipId: string) => void
}

/** Render the shared current-filter chip list used across search UIs. */
export function SearchChipList({
  chips,
  title = 'Current filters',
  emptyMessage = '아직 추가된 조건 칩이 없어.',
  onCycleOperator,
  onRemove,
}: SearchChipListProps) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      {chips.length === 0 ? <div className="rounded-sm border border-border/70 bg-background/60 px-4 py-4 text-sm text-muted-foreground">{emptyMessage}</div> : null}
      {chips.length > 0 ? (
        <div className="space-y-2">
          {chips.map((chip) => (
            <div key={chip.id} className="flex items-center gap-2 rounded-sm border border-border bg-background px-3 py-3">
              <span className="rounded-sm px-2 py-1 text-[11px] font-semibold tracking-[0.08em]" style={getSearchScopeStyle(chip.scope)}>
                {chip.scopeLabel ?? SEARCH_SCOPE_LABELS[chip.scope]}
              </span>
              <button
                type="button"
                onClick={() => onCycleOperator(chip.id)}
                className="rounded-sm border border-primary/35 bg-primary/10 px-2.5 py-1 text-[11px] font-bold tracking-[0.16em] text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_8%,transparent)] transition hover:border-primary/55 hover:bg-primary/18 active:scale-[0.98]"
                aria-label={`${chip.label} 연산자 변경`}
                title="클릭해서 OR / AND / NOT 전환"
              >
                {chip.operator}
              </button>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground" style={chip.color ? { color: chip.color } : undefined}>
                {chip.label}
              </span>
              <button
                type="button"
                onClick={() => onRemove(chip.id)}
                className="text-muted-foreground transition hover:text-foreground"
                aria-label={`${chip.label} 삭제`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
