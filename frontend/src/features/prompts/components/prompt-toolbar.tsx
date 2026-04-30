import { useRef, useState } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Search, X } from 'lucide-react'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PromptSortBy, PromptSortOrder } from '@/types/prompt'
import { useI18n } from '@/i18n'

interface PromptToolbarProps {
  searchInput: string
  sortBy: PromptSortBy
  sortOrder: PromptSortOrder
  onSearchInputChange: (value: string) => void
  onApplySearch: () => void
  onClearSearch: () => void
  onChangeSortBy: (value: PromptSortBy) => void
  onChangeSortOrder: (value: PromptSortOrder) => void
}

const PROMPT_SORT_OPTION_LABEL_KEYS: Record<PromptSortBy, string> = {
  usage_count: 'prompts.components.prompt.toolbar.usage',
  created_at: 'prompts.components.prompt.toolbar.created',
  prompt: 'prompts.components.prompt.toolbar.name',
}

const PROMPT_SORT_OPTIONS: Array<{ value: PromptSortBy; labelKey: string }> = [
  { value: 'usage_count', labelKey: PROMPT_SORT_OPTION_LABEL_KEYS.usage_count },
  { value: 'created_at', labelKey: PROMPT_SORT_OPTION_LABEL_KEYS.created_at },
  { value: 'prompt', labelKey: PROMPT_SORT_OPTION_LABEL_KEYS.prompt },
]

/** Render one prompt-sort dropdown with the shared anchored popup styling. */
function PromptSortSelect({
  value,
  onChange,
}: {
  value: PromptSortBy
  onChange: (value: PromptSortBy) => void
}) {
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const selectedOption = PROMPT_SORT_OPTIONS.find((option) => option.value === value) ?? PROMPT_SORT_OPTIONS[0]

  return (
    <div ref={containerRef} className="shrink-0">
      <AnchoredPopup open={isOpen} anchorRef={containerRef} onClose={() => setIsOpen(false)} align="end" side="bottom" closeOnBack className="min-w-[148px] p-1">
        <div className="space-y-1" role="listbox" aria-label={t('prompts.components.prompt.toolbar.sort.by')}>
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
                {t(option.labelKey)}
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
        aria-label={t('prompts.components.prompt.toolbar.sort.by')}
        title={t('prompts.components.prompt.toolbar.sort.by')}
      >
        <span>{t(selectedOption.labelKey)}</span>
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
  onClearSearch,
  onChangeSortBy,
  onChangeSortOrder,
}: PromptToolbarProps) {
  const { t } = useI18n()
  const SortOrderIcon = sortOrder === 'DESC' ? ArrowDownWideNarrow : ArrowUpNarrowWide
  const sortOrderLabel = sortOrder === 'DESC' ? t('prompts.components.prompt.toolbar.descending') : t('prompts.components.prompt.toolbar.ascending')

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
          placeholder={t('prompts.components.prompt.toolbar.search.prompts')}
          className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {searchInput.length > 0 ? (
          <Button type="button" size="icon-xs" variant="ghost" onClick={onClearSearch} aria-label={t('prompts.components.prompt.toolbar.search.reset')} title={t('prompts.components.prompt.toolbar.search.reset')}>
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        <Button type="button" size="icon-xs" variant="secondary" onClick={onApplySearch} aria-label={t('prompts.components.prompt.toolbar.search')} title={t('prompts.components.prompt.toolbar.search')}>
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
        aria-label={sortOrderLabel}
        title={sortOrderLabel}
      >
        <SortOrderIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
