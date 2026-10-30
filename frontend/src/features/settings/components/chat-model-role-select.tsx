import { Select } from '@/components/ui/select'
import type { ChatProfileFolderFields } from '@conai/shared'
import { ChatProfileOptions } from '@/features/codex-chat/chat-profile-groups'
import { useI18n } from '@/i18n'
import { ROUTE_NO_CEILING, type ModelRole, type ModelRouteKey, type ModelSlot } from '@/lib/api-codex-chat'
import type { Draft } from './chat-profile-editor-fields'
import { useRouteName } from './llm-connection-models'

/**
 * What a role's select shows: `off` (the role is disabled), `inherit` (summary / suggestions borrow the chat model),
 * `slot:{id}` (a connection's model) or, for suggestions only, `profile:{id}` (a chat profile, this one too, writes them
 * with its own model and prompt) or `user:{id}` (a user profile writes them with its own model and description).
 */
export type RoleChoice = 'off' | 'inherit' | `slot:${number}` | `profile:${number}` | `user:${number}`

/** A profile that can write reply suggestions; `ready` false (no model, or a connection that cannot be used) greys it out. */
export type SuggestWriter = ChatProfileFolderFields & { id: number; name: string; ready: boolean }

/** The chat profiles and the editor's own user profiles that can write suggestions (undefined until loaded). */
export type SuggestWriters = { profiles?: SuggestWriter[]; users?: SuggestWriter[] }

/** Suggestions borrow the chat model on Codex profiles too (a one-shot Codex run); summaries only on API LLM ones. */
const inheritsFor = (role: ModelRole, canInherit: boolean) => role === 'suggest' || (role === 'summary' && canInherit)

/** Rows chat roles can use: representative models and models that reach an LLM connection (TypeSafe models only judge). */
export const chatModelRows = (slots: ModelSlot[]) => slots.filter((slot) => slot.providerType !== 'decision_typesafe')

/** The content rating ceiling a row applies: a representative model's own, else the one of the model it reaches. */
export function slotCeiling(slot: ModelSlot | undefined, slots: ModelSlot[]): number | null {
  if (!slot) return null
  if (slot.kind !== 'route') return slot.contentRatingTierId
  if (slot.contentRatingTierId === ROUTE_NO_CEILING) return null
  if (slot.contentRatingTierId !== null) return slot.contentRatingTierId
  const reached = slot.followsChat ? slots.find((entry) => entry.routeKey === 'chat')?.targetSlotId : slot.targetSlotId
  return slots.find((entry) => entry.id === reached)?.contentRatingTierId ?? null
}

/** A representative model as an option: `대표 · 대화 (strata-auto)`, with what it reaches now. */
export function useRouteOptionLabel() {
  const { t } = useI18n()
  const routeName = useRouteName()
  return (slot: ModelSlot) => {
    const reaches = slot.followsChat ? t({ ko: '대화 따라감', en: 'follows chat' }) : slot.model || t({ ko: '비어 있음', en: 'empty' })
    return `${t({ ko: '대표', en: 'Rep.' })} · ${routeName(slot)} (${reaches})`
  }
}

/**
 * The rows as options, values `slot:{id}`: the representative models first (`part`'s own on top), a separator, then one
 * optgroup per connection in list order (`connection · model`: a closed select shows only the option, so it names the
 * connection too). Rows that cannot be used are greyed out.
 */
export function ModelRowOptions({ slots, part }: { slots: ModelSlot[]; part?: ModelRouteKey }) {
  const { t } = useI18n()
  const routeLabel = useRouteOptionLabel()
  const routes = slots.filter((slot) => slot.kind === 'route').sort((a, b) => Number(b.routeKey === part) - Number(a.routeKey === part))
  const groups: Array<{ key: string; label: string; rows: ModelSlot[] }> = []
  for (const slot of slots) {
    if (slot.kind === 'route') continue
    const group = groups.find((entry) => entry.key === slot.providerName)
    if (group) group.rows.push(slot)
    else groups.push({ key: slot.providerName, label: slot.providerLabel, rows: [slot] })
  }
  return (
    <>
      {routes.length > 0 ? (
        <optgroup label={t({ ko: '대표모델', en: 'Representative models' })}>
          {routes.map((slot) => <option key={slot.id} value={`slot:${slot.id}`} disabled={slot.ready === false}>{routeLabel(slot)}</option>)}
        </optgroup>
      ) : null}
      {routes.length > 0 && groups.length > 0 ? <option value="__separator" disabled>──────────</option> : null}
      {groups.map((group) => (
        <optgroup key={group.key} label={group.label}>
          {group.rows.map((slot) => <option key={slot.id} value={`slot:${slot.id}`} disabled={slot.ready === false}>{slot.label}</option>)}
        </optgroup>
      ))}
    </>
  )
}

type RoleView = { slotId: number | null; enabled: boolean }

/** The role's row and on/off flag, read out of the draft. */
function roleView(draft: Draft, role: ModelRole): RoleView {
  switch (role) {
    case 'chat': return { slotId: draft.modelSlotId, enabled: true }
    case 'summary': return { slotId: draft.summarySlotId, enabled: draft.summaryEnabled }
    case 'translation': return { slotId: draft.translationSlotId, enabled: true }
    case 'suggest': return { slotId: draft.suggestSlotId, enabled: draft.suggestEnabled }
  }
}

/** Patch that sets the role's row. */
function roleSlotPatch(role: ModelRole, slotId: number | null): Partial<Draft> {
  switch (role) {
    case 'chat': return { modelSlotId: slotId }
    case 'summary': return { summarySlotId: slotId }
    case 'translation': return { translationSlotId: slotId }
    case 'suggest': return { suggestSlotId: slotId }
  }
}

/** Patch for the role's on/off flag; only summary and suggestions have one. */
function roleEnabledPatch(role: ModelRole, enabled: boolean): Partial<Draft> {
  if (role === 'summary') return { summaryEnabled: enabled }
  if (role === 'suggest') return { suggestEnabled: enabled }
  return {}
}

/**
 * Draft -> select value. Off first; then a writer (suggestions: a chat or user profile); then the role's row; with none,
 * `inherit` (suggestions, or a summary on an API LLM profile), `off` (translation, a Codex summary) or, for the chat
 * role, the default row it falls back to.
 * A row id whose row was deleted (list loaded, id absent) counts as unset, so the next save clears it.
 */
export function roleChoice(draft: Draft, role: ModelRole, slots: ModelSlot[], canInherit: boolean, slotsReady: boolean): RoleChoice {
  const view = roleView(draft, role)
  if (!view.enabled) return 'off'
  // A writer wins; one that went missing still shows (greyed out) so it can be replaced.
  if (role === 'suggest' && draft.suggestProfileId !== null) return `profile:${draft.suggestProfileId}`
  if (role === 'suggest' && draft.suggestUserProfileId !== null) return `user:${draft.suggestUserProfileId}`
  // Until the list has loaded, a set id is trusted as is; only a known list can show it as stale.
  if (view.slotId !== null && (!slotsReady || slots.some((slot) => slot.id === view.slotId))) return `slot:${view.slotId}`
  if (role === 'chat') {
    const fallback = slots.find((slot) => slot.isDefault)
    return fallback ? `slot:${fallback.id}` : 'off'
  }
  if (role === 'translation') return 'off'
  return inheritsFor(role, canInherit) ? 'inherit' : 'off'
}

/** Select value -> draft patch. */
export function applyRoleChoice(role: ModelRole, choice: RoleChoice): Partial<Draft> {
  if (choice.startsWith('profile:')) return { ...roleSlotPatch(role, null), ...roleEnabledPatch(role, true), suggestProfileId: Number(choice.slice(8)), suggestUserProfileId: null }
  if (choice.startsWith('user:')) return { ...roleSlotPatch(role, null), ...roleEnabledPatch(role, true), suggestProfileId: null, suggestUserProfileId: Number(choice.slice(5)) }
  // Any other source drops the writer (off keeps it, like the row, so switching back on restores it).
  const noWriter: Partial<Draft> = role === 'suggest' ? { suggestProfileId: null, suggestUserProfileId: null } : {}
  if (choice.startsWith('slot:')) return { ...roleSlotPatch(role, Number(choice.slice(5))), ...roleEnabledPatch(role, true), ...noWriter }
  if (choice === 'inherit') return { ...roleSlotPatch(role, null), ...roleEnabledPatch(role, true), ...noWriter }
  // Off keeps a summary / suggestion row so switching it back on restores it; translation has no flag, so it is cleared.
  return role === 'translation' ? roleSlotPatch(role, null) : roleEnabledPatch(role, false)
}

/** One select that picks where a role's model comes from. */
export function ModelRoleSelect({ role, value, slots, slotsReady, canInherit, writers, onChange, ariaLabel }: {
  role: ModelRole
  value: RoleChoice
  slots: ModelSlot[]
  /** False until the model list has loaded; the select is disabled so a click cannot overwrite a row it cannot show yet. */
  slotsReady: boolean
  canInherit: boolean
  /** Suggestions: the profiles that can write them. */
  writers?: SuggestWriters
  onChange: (choice: RoleChoice) => void
  ariaLabel: string
}) {
  const { t } = useI18n()
  // The chat role never picks a representative model that follows the chat model (it would point back at itself).
  const rows = chatModelRows(slots).filter((slot) => role !== 'chat' || !slot.followsChat)
  // An empty summary / suggestion uses its part's representative model, which follows the chat model unless pointed elsewhere.
  const partRoute = slots.find((slot) => slot.routeKey === role)
  const inheritLabel = partRoute && !partRoute.followsChat && partRoute.model
    ? t({ ko: '기본 · {model}', en: 'Default · {model}' }, { model: partRoute.model })
    : t({ ko: '대화 모델 그대로', en: 'Same as chat' })
  return (
    <Select variant="settings" value={value} aria-label={ariaLabel} disabled={!slotsReady} onChange={(event) => onChange(event.target.value as RoleChoice)}>
      {role === 'chat' && value === 'off' ? <option value="off" disabled>{t({ ko: '모델 없음', en: 'No model' })}</option> : null}
      {role === 'translation' ? <option value="off">{t({ ko: '안 함', en: 'None' })}</option> : null}
      {role === 'summary' || role === 'suggest' ? <option value="off">{t({ ko: '끔', en: 'Off' })}</option> : null}
      {inheritsFor(role, canInherit) ? <option value="inherit">{inheritLabel}</option> : null}
      <ModelRowOptions slots={rows} part={role} />
      {value.startsWith('slot:') && !rows.some((slot) => value === `slot:${slot.id}`)
        ? <option value={value} disabled>{t({ ko: '모델 #{id}', en: 'Model #{id}' }, { id: value.slice(5) })}</option>
        : null}
      {role === 'suggest' && writers?.profiles?.length ? (
        <ChatProfileOptions profiles={writers.profiles} prefix="profile:" disabled={(writer) => !writer.ready} />
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
    </Select>
  )
}
