import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import type { ModelRole, ModelSlot } from '@/lib/api-codex-chat'
import type { Draft } from './chat-profile-editor-fields'

/**
 * What a role's select shows: `off` (the role is disabled), `inherit` (summary / suggestions borrow the chat role),
 * `direct` (the role's own connection + model), `slot:{id}` (a named model slot) or, for suggestions only,
 * `profile:{id}` (a chat profile, this one too, writes them with its own model and prompt) or `user:{id}` (a user
 * profile writes them with its own model and description).
 */
export type RoleChoice = 'off' | 'inherit' | 'direct' | `slot:${number}` | `profile:${number}` | `user:${number}`

/** A profile that can write reply suggestions; `ready` false (no model, or a connection that cannot be used) greys it out. */
export type SuggestWriter = { id: number; name: string; ready: boolean }

/** The chat profiles and the editor's own user profiles that can write suggestions (undefined until loaded). */
export type SuggestWriters = { profiles?: SuggestWriter[]; users?: SuggestWriter[] }

/** Suggestions borrow the chat model on Codex profiles too (a one-shot Codex run); summaries only on API LLM ones. */
const inheritsFor = (role: ModelRole, canInherit: boolean) => role === 'suggest' || (role === 'summary' && canInherit)

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
 * Draft -> select value. Off first; then a writer (suggestions: a chat or user profile); then an existing slot; then a direct
 * connection; with neither, `inherit` (suggestions, or a summary on an API LLM profile) or `direct` with empty fields
 * (chat, or a Codex profile's summary).
 * A slot id whose slot was deleted (list loaded, id absent) counts as unset, so it shows as direct / inherit and the next save clears it.
 */
export function roleChoice(draft: Draft, role: ModelRole, slots: ModelSlot[], canInherit: boolean, slotsReady: boolean): RoleChoice {
  const view = roleView(draft, role)
  if (!view.enabled) return 'off'
  // A writer wins; one that went missing still shows (greyed out) so it can be replaced.
  if (role === 'suggest' && draft.suggestProfileId !== null) return `profile:${draft.suggestProfileId}`
  if (role === 'suggest' && draft.suggestUserProfileId !== null) return `user:${draft.suggestUserProfileId}`
  // Until the slot list has loaded, a set slot id is trusted as is; only a known list can show it as stale.
  if (view.slotId !== null && (!slotsReady || slots.some((slot) => slot.id === view.slotId))) return `slot:${view.slotId}`
  if (view.provider) return 'direct'
  if (role === 'translation') return 'off'
  return inheritsFor(role, canInherit) ? 'inherit' : 'direct'
}

/** Select value -> draft patch. `firstProvider` seeds "direct" when the role has no connection of its own yet. */
export function applyRoleChoice(draft: Draft, role: ModelRole, choice: RoleChoice, firstProvider: string): Partial<Draft> {
  if (choice.startsWith('profile:')) return { ...rolePairPatch(role, null, '', ''), ...roleEnabledPatch(role, true), suggestProfileId: Number(choice.slice(8)), suggestUserProfileId: null }
  if (choice.startsWith('user:')) return { ...rolePairPatch(role, null, '', ''), ...roleEnabledPatch(role, true), suggestProfileId: null, suggestUserProfileId: Number(choice.slice(5)) }
  // Any other source drops the writer (off keeps it, like the pair, so switching back on restores it).
  const noWriter: Partial<Draft> = role === 'suggest' ? { suggestProfileId: null, suggestUserProfileId: null } : {}
  if (choice.startsWith('slot:')) return { ...rolePairPatch(role, Number(choice.slice(5)), '', ''), ...roleEnabledPatch(role, true), ...noWriter }
  switch (choice) {
    case 'direct': return { ...rolePairPatch(role, null, roleView(draft, role).provider || firstProvider, ''), ...roleEnabledPatch(role, true), ...noWriter }
    case 'inherit': return { ...rolePairPatch(role, null, '', ''), ...roleEnabledPatch(role, true), ...noWriter }
    default:
      // Off keeps a summary / suggestion pair so switching it back on restores it; translation has no flag, so it is cleared.
      return role === 'translation' ? rolePairPatch(role, null, '', '') : roleEnabledPatch(role, false)
  }
}

/** One select that picks where a role's model comes from. */
export function ModelRoleSelect({ role, value, slots, slotsReady, canInherit, writers, onChange, ariaLabel }: {
  role: ModelRole
  value: RoleChoice
  slots: ModelSlot[]
  /** False until the slot list has loaded; the select is disabled so a click cannot overwrite a slot it cannot show yet. */
  slotsReady: boolean
  canInherit: boolean
  /** Suggestions: the profiles that can write them. */
  writers?: SuggestWriters
  onChange: (choice: RoleChoice) => void
  ariaLabel: string
}) {
  const { t } = useI18n()
  return (
    <Select variant="settings" value={value} aria-label={ariaLabel} disabled={!slotsReady} onChange={(event) => onChange(event.target.value as RoleChoice)}>
      {role === 'translation' ? <option value="off">{t({ ko: '안 함', en: 'None' })}</option> : null}
      {role === 'summary' || role === 'suggest' ? <option value="off">{t({ ko: '끔', en: 'Off' })}</option> : null}
      {inheritsFor(role, canInherit) ? <option value="inherit">{t({ ko: '대화 모델 그대로', en: 'Same as chat' })}</option> : null}
      {slots.length > 0 ? (
        <optgroup label={t({ ko: '모델', en: 'Models' })}>
          {/* Greyed out: the slot's connection cannot be used. */}
          {slots.map((slot) => <option key={slot.id} value={`slot:${slot.id}`} disabled={slot.ready === false}>{`${slot.isDefault ? '★ ' : ''}${slot.name} · ${slot.model}`}</option>)}
        </optgroup>
      ) : null}
      {value.startsWith('slot:') && !slots.some((slot) => value === `slot:${slot.id}`)
        ? <option value={value} disabled>{t({ ko: '모델 #{id}', en: 'Model #{id}' }, { id: value.slice(5) })}</option>
        : null}
      {role === 'suggest' && writers?.profiles?.length ? (
        <optgroup label={t({ ko: '프로필', en: 'Profiles' })}>
          {writers.profiles.map((writer) => <option key={writer.id} value={`profile:${writer.id}`} disabled={!writer.ready}>{writer.name}</option>)}
        </optgroup>
      ) : null}
      {role === 'suggest' && writers?.users?.length ? (
        <optgroup label={t({ ko: '사용자 프로필', en: 'User profiles' })}>
          {writers.users.map((writer) => <option key={writer.id} value={`user:${writer.id}`} disabled={!writer.ready}>{writer.name}</option>)}
        </optgroup>
      ) : null}
      {value.startsWith('profile:') && !writers?.profiles?.some((writer) => value === `profile:${writer.id}`)
        ? <option value={value} disabled>{t({ ko: '프로필 #{id}', en: 'Profile #{id}' }, { id: value.slice(8) })}</option>
        : null}
      {value.startsWith('user:') && !writers?.users?.some((writer) => value === `user:${writer.id}`)
        ? <option value={value} disabled>{t({ ko: '사용자 프로필 #{id}', en: 'User profile #{id}' }, { id: value.slice(5) })}</option>
        : null}
      <option value="direct">{t({ ko: '직접 지정…', en: 'Custom…' })}</option>
    </Select>
  )
}
