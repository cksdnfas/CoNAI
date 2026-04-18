import { useRef, useState } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Search } from 'lucide-react'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PromptSortBy, PromptSortOrder } from '@/types/prompt'

interface PromptToolbarProps {
  searchInput: string
  sortBy: PromptSortBy
  sortOrder: PromptSortOrder
  onSearchInputChange: (value: string) => void
  onApplySearch: () => void
  onChangeSortBy: (value: PromptSortBy) => void
  onChangeSortOrder: (value: PromptSortOrder) => void
}

const PROMPT_SORT_OPTIONS: Array<{ value: PromptSortBy; label: string }> = [
  { value: 'usage_count', label: '사용량' },
  { value: 'created_at', label: '생성순' },
  { value: 'prompt', label: '이름순' },
]

/** Render one prompt-sort dropdown with the shared anchored popup styling. */
function PromptSortSelect({
  value,
  onChange,
}: {
  value: PromptSortBy
  onChange: (value: PromptSortBy) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const selectedOption = PROMPT_SORT_OPTIONS.find((option) => option.value === value) ?? PROMPT_SORT_OPTIONS[0]

  return (
    <div ref={containerRef} className="shrink-0">
      <AnchoredPopup open={isOpen} anchorRef={containerRef} onClose={() => setIsOpen(false)} align="end" side="bottom" closeOnBack className="min-w-[148px] p-1">
        <div className="space-y-1" role="listbox" aria-label="정렬 기준">
          {PROMPT_SORT_OPTIONS.map((option) => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={cn(
                  'flex w-full items-center rounded-sm px-3 py-2 text-left text-sm transition-colors',
                  isSelected ? 'bg-surface-high text-foreground' : 'text-muted-foreground hover:bg-surface-high/70 hover:text-foreground',
                )}
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </AnchoredPopup>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 min-w-[92px] justify-between border-border/70 bg-surface-low/45 px-2 text-xs"
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="정렬 기준"
        title="정렬 기준"
      >
        <span>{selectedOption.label}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
      </Button>
    </div>
  )
}

export function PromptToolbar({
  searchInput,
  sortBy,
  sortOrder,
  onSearchInputChange,
  onApplySearch,
  onChangeSortBy,
  onChangeSortOrder,
}: PromptToolbarProps) {
  const SortOrderIcon = sortOrder === 'DESC' ? ArrowDownWideNarrow : ArrowUpNarrowWide

  return (
    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
      <div className="flex w-full min-w-0 items-center gap-1 rounded-sm border border-border/70 bg-surface-low/45 px-2 py-1.5 sm:min-w-[300px] sm:flex-1 lg:min-w-[360px]">
        <input
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onApplySearch()
            }
          }}
          placeholder="프롬프트 검색"
          className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <Button type="button" size="icon-xs" variant="secondary" onClick={onApplySearch} aria-label="검색" title="검색">
          <Search className="h-3.5 w-3.5" />
        </Button>
      </div>

      <PromptSortSelect value={sortBy} onChange={onChangeSortBy} />

      <Button
        type="button"
        size="icon-xs"
        variant="outline"
        className="border-border/70 bg-surface-low/45"
        onClick={() => onChangeSortOrder(sortOrder === 'DESC' ? 'ASC' : 'DESC')}
        aria-label={sortOrder === 'DESC' ? '내림차순' : '오름차순'}
        title={sortOrder === 'DESC' ? '내림차순' : '오름차순'}
      >
        <SortOrderIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
