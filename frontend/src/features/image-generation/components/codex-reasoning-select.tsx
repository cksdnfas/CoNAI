import { CODEX_REASONING_EFFORTS, type CodexModelOption, type CodexReasoningEffort } from '@conai/shared'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'

type Props = {
  value: CodexReasoningEffort | ''
  model: string
  models: CodexModelOption[] | undefined
  onChange: (value: CodexReasoningEffort | '') => void
  variant?: 'default' | 'settings'
  disabled?: boolean
  className?: string
}

/** Model capabilities come from the CLI; isDefault reflects its configured model when available. */
export function CodexReasoningSelect({ value, model, models, onChange, variant = 'default', disabled, className }: Props) {
  const { t } = useI18n()
  const selectedModel = models?.find((entry) => model ? entry.id === model : entry.isDefault)
  const efforts = selectedModel?.supportedReasoningEfforts ?? CODEX_REASONING_EFFORTS
  const labels: Record<CodexReasoningEffort, string> = {
    none: t({ ko: '없음', en: 'None' }),
    minimal: t({ ko: '최소', en: 'Minimal' }),
    low: t({ ko: '낮음', en: 'Low' }),
    medium: t({ ko: '보통', en: 'Medium' }),
    high: t({ ko: '높음', en: 'High' }),
    xhigh: t({ ko: '매우 높음', en: 'Extra high' }),
    max: t({ ko: '최대', en: 'Max' }),
    ultra: t({ ko: '울트라', en: 'Ultra' }),
  }

  return (
    <Select
      variant={variant}
      value={value}
      onChange={(event) => onChange(event.target.value as CodexReasoningEffort | '')}
      disabled={disabled}
      aria-label={t({ ko: '추론 강도', en: 'Reasoning effort' })}
      className={className}
    >
      <option value="">{t({ ko: '기본값', en: 'Default' })}</option>
      {efforts.map((effort) => <option key={effort} value={effort}>{labels[effort]}</option>)}
      {value && !efforts.includes(value) ? <option value={value} disabled>{labels[value]} · {t({ ko: '지원 안 함', en: 'Unsupported' })}</option> : null}
    </Select>
  )
}
