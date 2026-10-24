import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { ChatProfileAssetFields, ChatProfileInput } from '@/lib/api-codex-chat'

/** `background` stays undefined until the image is changed or removed, so saving does not resend it. */
export type Draft = Required<Omit<ChatProfileInput, 'sortOrder' | 'background' | keyof ChatProfileAssetFields>> & Omit<ChatProfileAssetFields, 'assetVersion' | 'hasAvatar' | 'avatarThumbnailUrl'> & { sortOrder: number; background?: string | null }
export type PatchDraft = (next: Partial<Draft>) => void

/** Switching engines clears options belonging to the previous engine in both the editor and assistant. */
export function enginePatch(engine: Draft['engine'], current: Draft): Partial<Draft> {
  if (engine === current.engine) return {}
  return engine === 'codex' || engine === 'claude'
    ? { engine, modelSlotId: null, model: engine === 'claude' ? 'sonnet' : '', reasoningEffort: '', reasoningBudgetTokens: null, visionEnabled: engine === 'claude' || current.visionEnabled }
    : { engine, model: '', reasoningEffort: '', reasoningBudgetTokens: null }
}

export function judgePresetPatch(judgePresetId: number | null): Partial<Draft> {
  return judgePresetId === null ? { judgePresetId, judgeSlotId: null } : { judgePresetId }
}

export function numberOrNull(value: string) {
  const number = Number(value)
  return value.trim() === '' || !Number.isFinite(number) ? null : number
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
