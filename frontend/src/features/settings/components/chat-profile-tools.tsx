import { Field } from '@/components/ui/field'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { useI18n } from '@/i18n'
import { CHAT_PROFILE_LIMITS } from '@conai/shared'
import { numberOrNull } from './chat-profile-editor-fields'

/**
 * API LLM profiles: how much of one tool result the model sees. How many tool rounds a reply may take is app-wide
 * (Settings › 채팅 › 자원 › 도구 사용).
 */
export function ChatProfileToolLimits({ toolOutputLimit, onChange }: {
  toolOutputLimit: number
  onChange: (patch: { toolOutputLimit?: number }) => void
}) {
  const { t } = useI18n()
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field label={t({ ko: '도구 결과 최대 길이 (글자)', en: 'Tool result limit (chars)' })}>
        <NumberStepperInput variant="settings" step={1000} {...CHAT_PROFILE_LIMITS.toolOutputLimit} value={toolOutputLimit} onValueCommit={(value) => onChange({ toolOutputLimit: numberOrNull(value) ?? toolOutputLimit })} />
      </Field>
    </div>
  )
}
