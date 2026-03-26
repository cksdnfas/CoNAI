import { Search } from 'lucide-react'
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
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="w-full max-w-xl space-y-2">
        <div className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">Search</div>
        <div className="flex items-center gap-2 rounded-sm bg-surface-lowest px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onApplySearch()
              }
            }}
            placeholder="프롬프트 검색"
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Button size="sm" onClick={onApplySearch}>
            적용
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={sortBy} onChange={(event) => onChangeSortBy(event.target.value as PromptSortBy)} className="border-0 bg-surface-lowest">
          <option value="usage_count">usage</option>
          <option value="created_at">created</option>
          <option value="prompt">prompt</option>
        </Select>
        <Select value={sortOrder} onChange={(event) => onChangeSortOrder(event.target.value as PromptSortOrder)} className="border-0 bg-surface-lowest">
          <option value="DESC">DESC</option>
          <option value="ASC">ASC</option>
        </Select>
      </div>
    </div>
  )
}
