import { ArrowDownWideNarrow, ArrowUpNarrowWide, Sparkles } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import type { HomeSortOrder } from '../home-search-url'

interface HomeSortMenuProps {
  value: HomeSortOrder
  onChange: (value: HomeSortOrder) => void
  /** A description search is ordered by meaning; newest/oldest wait until it is removed. */
  meaningOrder?: boolean
}

/** Pick the Home feed/search order (kept in the `sort` URL parameter). */
export function HomeSortMenu({ value, onChange, meaningOrder = false }: HomeSortMenuProps) {
  const { t } = useI18n()
  const options: Array<{ value: HomeSortOrder; label: string }> = [
    { value: 'newest', label: t({ ko: '최신순', en: 'Newest first' }) },
    { value: 'oldest', label: t({ ko: '오래된순', en: 'Oldest first' }) },
  ]
  const meaningLabel = t({ ko: '뜻이 가까운 순', en: 'Closest meaning' })
  const activeLabel = meaningOrder ? meaningLabel : options.find((option) => option.value === value)?.label ?? options[0].label

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="icon-sm" variant="ghost" label={t({ ko: '정렬: {order}', en: 'Sort: {order}' }, { order: activeLabel })}>
          {meaningOrder ? <Sparkles className="size-4" /> : value === 'oldest' ? <ArrowUpNarrowWide className="size-4" /> : <ArrowDownWideNarrow className="size-4" />}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>{t({ ko: '정렬', en: 'Sort' })}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={meaningOrder ? 'meaning' : value} onValueChange={(nextValue) => onChange(nextValue === 'oldest' ? 'oldest' : 'newest')}>
          {meaningOrder ? <DropdownMenuRadioItem value="meaning">{meaningLabel}</DropdownMenuRadioItem> : null}
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} disabled={meaningOrder}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
