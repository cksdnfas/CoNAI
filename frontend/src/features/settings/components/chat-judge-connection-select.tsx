import { useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { MODEL_SLOTS_QUERY_KEY, listModelSlots } from '@/lib/api-codex-chat'
import { chatModelRows, ModelRowOptions } from './chat-model-role-select'

/**
 * A judge model: one select of the connections' models, TypeSafe decision models first, then the LLM ones (asked for
 * JSON); `llmOnly` hides the decision ones. `emptyLabel` names what no model means here.
 */
export function JudgeModelSelect({ enabled, slotId, emptyLabel, llmOnly = false, onChange, ariaLabel }: {
  enabled: boolean
  slotId: number | null
  emptyLabel: string
  llmOnly?: boolean
  onChange: (slotId: number | null) => void
  ariaLabel: string
}) {
  const { t } = useI18n()
  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots, enabled })
  const slots = slotsQuery.data ?? []
  const decision = llmOnly ? [] : slots.filter((slot) => slot.providerType === 'decision_typesafe')
  const llm = chatModelRows(slots)
  const value = slotId !== null ? `slot:${slotId}` : ''
  const known = [...decision, ...llm].some((slot) => slot.id === slotId)

  return (
    <Select variant="settings" aria-label={ariaLabel} value={value} disabled={!slotsQuery.isSuccess && slotId !== null} onChange={(event) => onChange(event.target.value ? Number(event.target.value.slice(5)) : null)}>
      <option value="">{emptyLabel}</option>
      <ModelRowOptions slots={decision} />
      <ModelRowOptions slots={llm} />
      {slotId !== null && !known && slotsQuery.isSuccess ? <option value={value} disabled>{t({ ko: '모델 #{id}', en: 'Model #{id}' }, { id: slotId })}</option> : null}
    </Select>
  )
}

/** `connection · model` of a row, for a line that names the model in use (undefined until the list loads). */
export function useModelLabel(enabled: boolean, slotId: number | null) {
  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots, enabled: enabled && slotId !== null })
  return slotId === null ? null : slotsQuery.data?.find((slot) => slot.id === slotId)?.label
}
