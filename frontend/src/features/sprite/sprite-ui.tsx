import type { ReactNode } from 'react'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

/** Text tabs with an underline, the same look as Settings › Chat. */
export const TEXT_TAB_LIST_CLASS = 'flex w-full flex-nowrap gap-5 rounded-none border-b border-line bg-transparent p-0'
export const TEXT_TAB_TRIGGER_CLASS = 'relative rounded-none px-0 pb-2 pt-0 text-sm font-semibold text-muted-foreground hover:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100'

/** One settings section: a heading row and its controls, separated from the next by a hairline. */
export function SpriteSection({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3 border-t border-line py-4 first:border-t-0 first:pt-0', className)}>
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions ? <div className="flex items-center gap-0.5">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Label, slider and the value: one line. */
export function SliderLine({ label, value, min, max, step = 1, format, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step?: number; format?: (value: number) => string; onChange: (value: number) => void; disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_3.25rem] items-center gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Slider value={[value]} min={min} max={max} step={step} aria-label={label} disabled={disabled} onValueChange={(next) => onChange(next[0] ?? value)} />
      <span className="text-right font-mono text-xs tabular-nums">{format ? format(value) : value}</span>
    </div>
  )
}

/** A label with a switch on the right; `extra` sits just before the switch (e.g. the threshold it guards). */
export function SwitchLine({ label, checked, onChange, extra, disabled, muted }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; extra?: ReactNode; disabled?: boolean; muted?: boolean
}) {
  return (
    <label className="flex min-h-8 cursor-pointer items-center justify-between gap-3 text-sm">
      <span className={cn(muted && 'text-muted-foreground')}>{label}</span>
      <span className="flex items-center gap-2">
        {extra}
        <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
      </span>
    </label>
  )
}

/** A compact labelled number input used inside rows (start/end, sizes, grid). */
export function MiniField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
