import type { ComponentProps, KeyboardEvent } from 'react'
import { Search, X, type LucideIcon } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

type IconInputFieldProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'className' | 'placeholder'> & {
  /** The leading icon that names the field in place of a label. */
  icon: LucideIcon
  value: string
  placeholder: string
  onChange: (value: string) => void
  /** Tooltip and accessible name of the X shown while there is text. */
  clearLabel: string
  /** What the X does. Defaults to emptying the field. */
  onClear?: () => void
  /** The wrapper; size the field with it. */
  className?: string
  /** The wrapper's landmark role (`search` for SearchField). */
  wrapperRole?: 'search'
}

/**
 * A filled text input named by a leading icon instead of a label, with an inline clear key while it has text.
 * SearchField is this with the search icon and keys. Never hand-roll an icon absolutely placed over an Input;
 * size the field with `className` on the wrapper.
 */
export function IconInputField({ icon: Icon, value, placeholder, onChange, clearLabel, onClear, className, wrapperRole, ...inputProps }: IconInputFieldProps) {
  return (
    <div role={wrapperRole} className={cn('relative w-full min-w-0', className)}>
      <Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        {...inputProps}
        value={value}
        onChange={(event) => onChange(event.target.value)}
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
          label={clearLabel}
        >
          <X />
        </IconButton>
      ) : null}
    </div>
  )
}

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
 */
export function SearchField({ onSubmit, onKeyDown, ...props }: SearchFieldProps) {
  const { t } = useI18n()

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    onSubmit?.()
  }

  return (
    <IconInputField
      {...props}
      icon={Search}
      wrapperRole="search"
      type="search"
      enterKeyHint="search"
      onKeyDown={handleKeyDown}
      clearLabel={t({ ko: '검색어 지우기', en: 'Clear search' })}
    />
  )
}

/** SearchField in a PageToolbar middle slot: pushed to the end, capped width on wider screens. */
export function ToolbarSearchField({ className, ...props }: SearchFieldProps) {
  return <SearchField {...props} className={cn('ml-auto sm:max-w-80', className)} />
}
