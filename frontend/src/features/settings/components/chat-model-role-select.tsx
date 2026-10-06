import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import type { ModelRole, ModelSlot } from '@/lib/api-codex-chat'
import type { Draft } from './chat-profile-editor-fields'

/**
 * What a role's select shows: `off` (the role is disabled), `inherit` (summary / suggestions borrow the chat role),
 * `direct` (the role's own connection + model) or `slot:{id}` (a named model slot).
 */
export type RoleChoice = 'off' | 'inherit' | 'direct' | `slot:${number}`

type RoleView = { slotId: number | null; provider: string; model: string; enabled: boolean }

/** The role's slot, direct pair and on/off flag, read out of the draft. */
function roleView(draft: Draft, role: ModelRole): RoleView {
  switch (role) {
    case 'chat': return { slotId: draft.modelSlotId, provider: draft.providerName, model: draft.model, enabled: true }
    case 'summary': return { slotId: draft.summarySlotId, provider: draft.summaryProviderName ?? '', model: draft.summaryModel, enabled: draft.summaryEnabled }
    case 'translation': return { slotId: draft.translationSlotId, provider: draft.translationProviderName ?? '', model: draft.translationModel, enabled: true }
    case 'suggest': return { slotId: draft.suggestSlotId, provider: draft.suggestProviderName ?? '', model: draft.suggestModel, enabled: draft.suggestEnabled }
  }
}

/** The role's own connection + model (what the "direct" fields edit). */
export function roleDirect(draft: Draft, role: ModelRole) {
  const { provider, model } = roleView(draft, role)
  return { provider, model }
}

/** Patch that sets the role's connection (clearing its model). */
export function roleProviderPatch(role: ModelRole, provider: string): Partial<Draft> {
  switch (role) {
    case 'chat': return { providerName: provider, model: '' }
    case 'summary': return { summaryProviderName: provider || null, summaryModel: '' }
    case 'translation': return { translationProviderName: provider || null, translationModel: '' }
    case 'suggest': return { suggestProviderName: provider || null, suggestModel: '' }
  }
}

/** Patch that sets the role's model. */
export function roleModelPatch(role: ModelRole, model: string): Partial<Draft> {
  switch (role) {
    case 'chat': return { model }
    case 'summary': return { summaryModel: model }
    case 'translation': return { translationModel: model }
    case 'suggest': return { suggestModel: model }
  }
}

/** Patch that sets the role's slot and direct connection + model together. */
function rolePairPatch(role: ModelRole, slotId: number | null, provider: string, model: string): Partial<Draft> {
  switch (role) {
    case 'chat': return { modelSlotId: slotId, providerName: provider, model }
    case 'summary': return { summarySlotId: slotId, summaryProviderName: provider || null, summaryModel: model }
    case 'translation': return { translationSlotId: slotId, translationProviderName: provider || null, translationModel: model }
    case 'suggest': return { suggestSlotId: slotId, suggestProviderName: provider || null, suggestModel: model }
  }
}

/** Patch for the role's on/off flag; only summary and suggestions have one. */
function roleEnabledPatch(role: ModelRole, enabled: boolean): Partial<Draft> {
  if (role === 'summary') return { summaryEnabled: enabled }
  if (role === 'suggest') return { suggestEnabled: enabled }
  return {}
}

/**
 * Draft -> select value. Off first; then an existing slot; then a direct connection; with neither, `inherit` (summary /
 * suggestions on an API LLM profile) or `direct` with empty fields (chat, or a Codex profile that cannot inherit).
 * A slot id whose slot was deleted counts as unset, so it shows as direct / inherit and the next save clears it.
 */
export function roleChoice(draft: Draft, role: ModelRole, slots: ModelSlot[], canInherit: boolean): RoleChoice {
  const view = roleView(draft, role)
  if (!view.enabled) return 'off'
  if (view.slotId !== null && slots.some((slot) => slot.id === view.slotId)) return `slot:${view.slotId}`
  if (view.provider) return 'direct'
  if (role === 'translation') return 'off'
  return role === 'chat' || !canInherit ? 'direct' : 'inherit'
}

/** Select value -> draft patch. `firstProvider` seeds "direct" when the role has no connection of its own yet. */
export function applyRoleChoice(draft: Draft, role: ModelRole, choice: RoleChoice, firstProvider: string): Partial<Draft> {
  if (choice.startsWith('slot:')) return { ...rolePairPatch(role, Number(choice.slice(5)), '', ''), ...roleEnabledPatch(role, true) }
  switch (choice) {
    case 'direct': return { ...rolePairPatch(role, null, roleView(draft, role).provider || firstProvider, ''), ...roleEnabledPatch(role, true) }
    case 'inherit': return { ...rolePairPatch(role, null, '', ''), ...roleEnabledPatch(role, true) }
    default:
      // Off keeps a summary / suggestion pair so switching it back on restores it; translation has no flag, so it is cleared.
      return role === 'translation' ? rolePairPatch(role, null, '', '') : roleEnabledPatch(role, false)
  }
}

/** One select that picks where a role's model comes from. */
export function ModelRoleSelect({ role, value, slots, canInherit, onChange, ariaLabel }: {
  role: ModelRole
  value: RoleChoice
  slots: ModelSlot[]
  canInherit: boolean
  onChange: (choice: RoleChoice) => void
  ariaLabel: string
}) {
  const { t } = useI18n()
  return (
    <Select variant="settings" value={value} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value as RoleChoice)}>
      {role === 'translation' ? <option value="off">{t({ ko: '안 함', en: 'None' })}</option> : null}
      {role === 'summary' || role === 'suggest' ? <option value="off">{t({ ko: '끔', en: 'Off' })}</option> : null}
      {(role === 'summary' || role === 'suggest') && canInherit ? <option value="inherit">{t({ ko: '대화 모델 그대로', en: 'Same as chat' })}</option> : null}
      {slots.length > 0 ? (
        <optgroup label={t({ ko: '모델', en: 'Models' })}>
          {slots.map((slot) => <option key={slot.id} value={`slot:${slot.id}`}>{`${slot.isDefault ? '★ ' : ''}${slot.name} · ${slot.model}`}</option>)}
        </optgroup>
      ) : null}
      <option value="direct">{t({ ko: '직접 지정…', en: 'Custom…' })}</option>
    </Select>
  )
}
