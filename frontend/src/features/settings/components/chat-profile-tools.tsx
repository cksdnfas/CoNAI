import { Field } from '@/components/ui/field'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SwitchLine } from '@/components/ui/switch-line'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { CHAT_PROFILE_LIMITS, CHAT_PROFILE_TEXT_LIMITS } from '@conai/shared'
import { numberOrNull } from './chat-profile-editor-fields'
import { useProfileAssist } from './use-profile-editor-chat-page'

/** Agent use: other profiles may call this one during a chat to do work; the description tells them what it does and when. */
export function ChatProfileAgentSetting({ agentEnabled, agentDescription, onChange }: {
  agentEnabled: boolean
  agentDescription: string
  onChange: (patch: { agentEnabled?: boolean; agentDescription?: string }) => void
}) {
  const { t } = useI18n()
  const { filled } = useProfileAssist()
  return (
    <div className="space-y-2">
      <SwitchLine label={t({ ko: '에이전트로 사용', en: 'Use as an agent' })} checked={agentEnabled} onCheckedChange={(next) => onChange({ agentEnabled: next })} />      {agentEnabled || filled('agentDescription') ? (
        <Field label={t({ ko: '에이전트 설명', en: 'Agent description' })}>
          <Textarea
            variant="settings"
            autoGrow
            rows={3}
            assisted={filled('agentDescription')}
            maxLength={CHAT_PROFILE_TEXT_LIMITS.agentDescription}
            value={agentDescription}
            placeholder={t({ ko: '할 수 있는 일과 언제 부르면 좋은지', en: 'What it can do and when to call it' })}
            onChange={(event) => onChange({ agentDescription: event.target.value })}
          />
          <span aria-hidden className="self-end text-2xs tabular-nums text-muted-foreground">{agentDescription.length}/{CHAT_PROFILE_TEXT_LIMITS.agentDescription}</span>
        </Field>
      ) : null}
    </div>
  )
}

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
