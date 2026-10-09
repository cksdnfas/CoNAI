import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ChatProfileAssetFields, ChatProfileInput } from '@/lib/api-codex-chat'

/** `background` stays undefined until the image is changed or removed, so saving does not resend it. */
export type Draft = Required<Omit<ChatProfileInput, 'sortOrder' | 'background' | 'toolPresetName' | keyof ChatProfileAssetFields>> & Omit<ChatProfileAssetFields, 'assetVersion' | 'avatarThumbnailUrl'> & { sortOrder: number; background?: string | null }
export type PatchDraft = (next: Partial<Draft>) => void

/** Long profile fields grow with their text (or their hint when empty) up to a cap, instead of scrolling inside a few rows. */
export const GROW_TEXTAREA = 'max-h-96 min-h-16 [field-sizing:content]'

export function numberOrNull(value: string) {
  const number = Number(value)
  return value.trim() === '' || !Number.isFinite(number) ? null : number
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
