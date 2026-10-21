import type { ComponentProps, KeyboardEvent } from 'react'
import { Search, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type SearchFieldProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'onSubmit' | 'type' | 'className' | 'placeholder'> & {
  value: string
  placeholder: string
  onChange: (value: string) => void
  /** Enter / the keyboard search key. Omit for live filtering. */
  onSubmit?: () => void
  /** Shown as an X while there is text. Defaults to clearing the text. */
  onClear?: () => void
  /** The wrapper; size the field with it. */
  className?: string
}

/**
 * The app's one search input: a filled input with a leading search icon and an inline clear button.
 * No <form> of its own, so it can sit inside an editor form; Enter never submits the surrounding form.
 * Never hand-roll an icon absolutely placed over an Input; size the field with `className` on the wrapper.
 */
export function SearchField({ value, placeholder, onChange, onSubmit, onClear, onKeyDown, className, ...inputProps }: SearchFieldProps) {
  const { t } = useI18n()

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    onSubmit?.()
  }

  return (
    <div role="search" className={cn('relative w-full min-w-0', className)}>
      {/* eslint-disable-next-line no-restricted-syntax -- the one shared search field */}
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        {...inputProps}
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={inputProps['aria-label'] ?? placeholder}
        adornments="search"
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
    </div>
  )
}

/** SearchField in a PageToolbar middle slot: pushed to the end, capped width on wider screens. */
export function ToolbarSearchField({ className, ...props }: SearchFieldProps) {
  return <SearchField {...props} className={cn('ml-auto sm:max-w-80', className)} />
}
