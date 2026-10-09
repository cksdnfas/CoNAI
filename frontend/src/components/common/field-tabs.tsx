import { useId, type ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export type FieldTabItem<T extends string> = { value: T; label: ReactNode }

const FIELD_TAB_LIST_CLASS = 'flex h-auto w-full justify-start gap-4 rounded-none border-b border-line bg-transparent px-3 pt-2 pb-0'
const FIELD_TAB_TRIGGER_CLASS = 'relative flex-none rounded-none px-0 pb-1.5 pt-0 text-xs font-semibold text-muted-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100'

/**
 * A labelled field whose control is a frame holding several controls (tabs, a picker, inputs). Unlike `Field` it is
 * not a `<label>`: a click on the frame's empty space must not press the first button inside it.
 */
export function FramedField({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className={cn('theme-settings-field flex min-w-0 flex-col text-sm', className)}>
      <span id={id} className="flex items-center gap-1 text-2xs font-semibold tracking-overline text-muted-foreground uppercase">
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <div className="theme-input-surface min-w-0 rounded-sm border">{children}</div>
    </div>
  )
}

/**
 * Text tabs in the header row of a field's frame: the field switches in place. `bare` drops the hairline under the
 * strip, for a frame that holds nothing but the tabs (a two-way choice).
 */
export function FieldTabs<T extends string>({ value, items, onChange, disabled, ariaLabel, bare = false }: {
  value: T
  items: Array<FieldTabItem<T>>
  onChange: (value: T) => void
  disabled?: boolean
  ariaLabel?: string
  bare?: boolean
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)}>
      <TabsList aria-label={ariaLabel} className={cn(FIELD_TAB_LIST_CLASS, bare && 'min-h-9 items-center border-b-0 py-0')}>
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value} disabled={disabled} className={cn(FIELD_TAB_TRIGGER_CLASS, bare && 'py-1')}>{item.label}</TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
