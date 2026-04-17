import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
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

      <Select
        value={sortBy}
        onChange={(event) => onChangeSortBy(event.target.value as PromptSortBy)}
        className="h-8 w-[86px] border-border/70 bg-surface-low/45 px-1.5 text-xs"
        aria-label="정렬 기준"
        title="정렬 기준"
      >
        <option value="usage_count">사용량</option>
        <option value="created_at">생성순</option>
        <option value="prompt">이름순</option>
      </Select>

      <Button
        type="button"
        size="icon-xs"
        variant="outline"
        className=""
        onClick={() => onChangeSortOrder(sortOrder === 'DESC' ? 'ASC' : 'DESC')}
        aria-label={sortOrder === 'DESC' ? '내림차순' : '오름차순'}
        title={sortOrder === 'DESC' ? '내림차순' : '오름차순'}
      >
        <SortOrderIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
