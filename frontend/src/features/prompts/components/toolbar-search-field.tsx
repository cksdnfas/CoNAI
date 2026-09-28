import type { FormEvent } from 'react'
import { Search, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

interface ToolbarSearchFieldProps {
  value: string
  placeholder: string
  onChange: (value: string) => void
  /** Enter / the keyboard search key. Omit for live filtering. */
  onSubmit?: () => void
  /** Shown as an X while there is text. Defaults to clearing the text. */
  onClear?: () => void
  className?: string
}

/** Search field for a PageToolbar middle slot: one filled input with a leading icon and an inline clear button. */
export function ToolbarSearchField({ value, placeholder, onChange, onSubmit, onClear, className }: ToolbarSearchFieldProps) {
  const { t } = useI18n()

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit?.()
  }

  return (
    <form role="search" onSubmit={handleSubmit} className={cn('relative ml-auto w-full min-w-0 sm:max-w-80', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {value.length > 0 ? (
        <IconButton
          size="icon-xs"
          variant="ghost"
          className="absolute top-1/2 right-1.5 -translate-y-1/2"
          onClick={() => (onClear ? onClear() : onChange(''))}
          label={t({ ko: '검색어 지우기', en: 'Clear search' })}
        >
          <X />
        </IconButton>
      ) : null}
    </form>
  )
}
