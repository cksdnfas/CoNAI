import { useId, type ReactNode } from 'react'
import { FieldInfo } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ChatProfileInput } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'

/** `background` stays undefined until the image is changed or removed, so saving does not resend it. */
export type Draft = Required<Omit<ChatProfileInput, 'sortOrder' | 'background' | 'toolPresetName'>> & { sortOrder: number; background?: string | null }
export type PatchDraft = (next: Partial<Draft>) => void

export function numberOrNull(value: string) {
  const number = Number(value)
  return value.trim() === '' || !Number.isFinite(number) ? null : number
}

/** A hairline-separated group of fields inside an editor tab; the overline names it, `actions` sit at its right. */
export function EditorGroup({ label, info, actions, children }: { label?: string; info?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      {label || actions ? (
        <div className={cn('flex min-h-7 items-center gap-3', label ? 'justify-between' : 'justify-end')}>
          {label ? (
            <h3 className="flex items-center gap-1 text-2xs font-semibold tracking-overline text-muted-foreground uppercase">
              {label}
              {info ? <FieldInfo>{info}</FieldInfo> : null}
            </h3>
          ) : null}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function SwitchLine({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 text-sm">
      <label htmlFor={id} className="flex-1 cursor-pointer">{label}</label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

/**
 * A model of a connection: its listed models, or free text when the server lists none. `emptyLabel` offers an empty
 * choice with that meaning; without it the field always holds a real model.
 */
export function ConnectionModelSelect({ value, models, defaultModel, emptyLabel, onChange }: {
  value: string
  models: string[]
  defaultModel: string | null
  emptyLabel?: string
  onChange: (value: string) => void
}) {
  if (models.length === 0) {
    return <Input variant="settings" value={value} placeholder={emptyLabel ?? defaultModel ?? undefined} onChange={(event) => onChange(event.target.value)} />
  }
  return (
    <Select variant="settings" value={value} onChange={(event) => onChange(event.target.value)}>
      {emptyLabel ? <option value="">{emptyLabel}</option> : null}
      {models.map((model) => <option key={model} value={model}>{model}</option>)}
      {value && !models.includes(value) ? <option value={value}>{value}</option> : null}
    </Select>
  )
}
