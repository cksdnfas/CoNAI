import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import type { PromptSortBy, PromptSortOrder } from '@/types/prompt'
import { useI18n } from '@/i18n'

interface PromptSortMenuProps {
  sortBy: PromptSortBy
  sortOrder: PromptSortOrder
  onChangeSortBy: (value: PromptSortBy) => void
  onChangeSortOrder: (value: PromptSortOrder) => void
}

const PROMPT_SORT_OPTIONS: Array<{ value: PromptSortBy; labelKey: string }> = [
  { value: 'usage_count', labelKey: 'prompts.components.prompt.toolbar.usage' },
  { value: 'created_at', labelKey: 'prompts.components.prompt.toolbar.created' },
  { value: 'prompt', labelKey: 'prompts.components.prompt.toolbar.name' },
]

/** Sort key for the prompt list toolbar: one icon that opens the field and direction choices. */
export function PromptSortMenu({ sortBy, sortOrder, onChangeSortBy, onChangeSortOrder }: PromptSortMenuProps) {
  const { t } = useI18n()
  const SortOrderIcon = sortOrder === 'DESC' ? ArrowDownWideNarrow : ArrowUpNarrowWide
  const label = t('prompts.components.prompt.toolbar.sort.by')

  return (
    <DropdownMenu>
      <Tip content={label}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={label}>
            <SortOrderIcon />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sortBy} onValueChange={(value) => onChangeSortBy(value as PromptSortBy)}>
          {PROMPT_SORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {t(option.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={sortOrder} onValueChange={(value) => onChangeSortOrder(value as PromptSortOrder)}>
          <DropdownMenuRadioItem value="DESC">{t('prompts.components.prompt.toolbar.descending')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="ASC">{t('prompts.components.prompt.toolbar.ascending')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
