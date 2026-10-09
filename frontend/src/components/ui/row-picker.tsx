import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

export type RowPickerItem = {
  id: string
  /** The face on the row's start (avatar, avatar stack, thumbnail). */
  media: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  /** On the row's end in the list (a time, a count). */
  trailing?: ReactNode
  /** What the search box matches, lower-cased by the picker. */
  searchText: string
}

function PickerRow({ item, compact = false }: { item: RowPickerItem; compact?: boolean }) {
  return (
    <>
      <span className="flex shrink-0">{item.media}</span>
      <span className="grid min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-foreground">{item.title}</span>
        {item.subtitle ? <span className="truncate text-xs text-muted-foreground">{item.subtitle}</span> : null}
      </span>
      {!compact && item.trailing ? <span className="shrink-0 self-start pt-0.5 text-2xs tabular-nums text-muted-foreground">{item.trailing}</span> : null}
    </>
  )
}

/**
 * A field that picks one row out of a list of faces (rooms, characters, workflows). Closed it shows the picked row;
 * open, a search box over the list. Arrow keys move, Enter picks. Sits inside a field frame, so it has no surface of its own.
 */
export function RowPicker({ items, value, onChange, placeholder, searchPlaceholder, emptyLabel, disabled, ariaLabel }: {
  items: RowPickerItem[]
  value: string
  onChange: (id: string) => void
  placeholder: string
  searchPlaceholder: string
  emptyLabel: string
  disabled?: boolean
  ariaLabel: string
}) {
  const { t } = useI18n()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const picked = items.find((item) => item.id === value)
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? items.filter((item) => item.searchText.toLowerCase().includes(needle)) : items
  }, [items, query])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next)
      setQuery('')
      // Opening starts on the picked row.
      if (next) setActive(Math.max(0, items.findIndex((item) => item.id === value)))
    }}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          className="flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {picked ? <PickerRow item={picked} compact /> : <span className="flex-1 text-sm text-muted-foreground">{placeholder}</span>}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) min-w-72 flex-col overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).querySelector('input')?.focus()
        }}
      >
        <label className="flex shrink-0 items-center gap-2 border-b border-line px-3 text-muted-foreground">
          <Search className="size-3.5 shrink-0" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((current) => Math.min(shown.length - 1, current + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((current) => Math.max(0, current - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                if (shown[active]) pick(shown[active].id)
              }
            }}
          />
        </label>
        <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {shown.length === 0 ? <div className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyLabel}</div> : shown.map((item, index) => {
            const selected = item.id === value
            return (
              <div
                key={item.id}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={selected}
                onPointerMove={() => setActive(index)}
                onClick={() => pick(item.id)}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5',
                  index === active && 'bg-surface-highest',
                  selected && index !== active && 'bg-primary/12',
                )}
              >
                <PickerRow item={item} />
                {selected ? <Check className="size-4 shrink-0 text-primary" aria-label={t({ ko: '선택됨', en: 'Selected' })} /> : null}
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
