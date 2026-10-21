import type { ReactNode } from 'react'
import { FieldGroup } from '@/components/ui/field'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type FieldTabItem<T extends string> = { value: T; label: ReactNode }

/**
 * A labelled field whose control is a frame holding several controls (tabs, a picker, inputs). Unlike `Field` it is
 * not a `<label>`: a click on the frame's empty space must not press the first button inside it.
 */
export function FramedField({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <FieldGroup label={label} className={className}>
      <div className="theme-input-surface min-w-0 rounded-sm border">{children}</div>
    </FieldGroup>
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
      <TabsList aria-label={ariaLabel} variant="field" bare={bare}>
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value} disabled={disabled} variant="field" bare={bare}>{item.label}</TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
