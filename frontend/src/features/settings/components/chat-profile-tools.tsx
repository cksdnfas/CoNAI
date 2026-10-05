import { Field } from '@/components/ui/field'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { useI18n } from '@/i18n'

function numberOrNull(value: string) {
  const number = Number(value)
  return value.trim() === '' || !Number.isFinite(number) ? null : number
}

/** API LLM profiles: how many model ↔ tool round trips a reply may take, and how much of one tool result the model sees. */
export function ChatProfileToolLimits({ maxToolRounds, toolOutputLimit, onChange }: {
  maxToolRounds: number
  toolOutputLimit: number
  onChange: (patch: { maxToolRounds?: number; toolOutputLimit?: number }) => void
}) {
  const { t } = useI18n()
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label={t({ ko: '도구 호출 반복 한도', en: 'Tool round limit' })}>
        <NumberStepperInput variant="settings" step={1} min={1} max={20} value={maxToolRounds} onValueCommit={(value) => onChange({ maxToolRounds: numberOrNull(value) ?? maxToolRounds })} />
      </Field>
      <Field label={t({ ko: '도구 결과 최대 길이 (글자)', en: 'Tool result limit (chars)' })}>
        <NumberStepperInput variant="settings" step={1000} min={500} max={100000} value={toolOutputLimit} onValueCommit={(value) => onChange({ toolOutputLimit: numberOrNull(value) ?? toolOutputLimit })} />
      </Field>
    </div>
  )
}
