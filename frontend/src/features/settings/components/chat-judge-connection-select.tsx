import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { getExternalApiProviders, type ExternalApiProviderRecord } from '@/lib/api-external-api'

const LLM_TYPES = new Set(['llm_openai_compatible', 'llm_ollama'])

/** Connections a judge can ask: TypeSafe decision models first, then LLM connections (asked for JSON). */
export function useJudgeConnections(enabled: boolean) {
  const query = useQuery({ queryKey: ['external-api-providers', 'chat-judge'], queryFn: getExternalApiProviders, enabled })
  const providers = query.data ?? []
  return {
    decision: providers.filter((provider) => provider.provider_type === 'decision_typesafe'),
    llm: providers.filter((provider) => LLM_TYPES.has(provider.provider_type)),
    all: providers,
    isPending: query.isPending,
  }
}

function defaultModelOf(provider: ExternalApiProviderRecord | undefined) {
  const value = provider?.additional_config?.default_model ?? provider?.additional_config?.model
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * A judge connection + model: a select of decision and LLM connections (`llmOnly` hides the decision ones), and the
 * model as free text (empty: the connection's default). `emptyLabel` names what no connection means here.
 */
export function JudgeConnectionSelect({ enabled, providerName, model, emptyLabel, llmOnly = false, onChange, ariaLabel }: {
  enabled: boolean
  providerName: string | null
  model: string
  emptyLabel: string
  llmOnly?: boolean
  onChange: (next: { providerName: string | null; model: string }) => void
  ariaLabel: string
}) {
  const { t } = useI18n()
  const { decision, llm, all } = useJudgeConnections(enabled)
  const selected = all.find((provider) => provider.provider_name === providerName)
  const label = (provider: ExternalApiProviderRecord) => `${provider.display_name || provider.provider_name}${provider.is_enabled ? '' : ` (${t({ ko: '꺼짐', en: 'off' })})`}`

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)] gap-2">
      <Select variant="settings" aria-label={ariaLabel} value={providerName ?? ''} onChange={(event) => onChange({ providerName: event.target.value || null, model: '' })}>
        <option value="">{emptyLabel}</option>
        {!llmOnly && decision.length > 0 ? (
          <optgroup label={t({ ko: '판단 모델', en: 'Judge models' })}>
            {decision.map((provider) => <option key={provider.provider_name} value={provider.provider_name}>{label(provider)}</option>)}
          </optgroup>
        ) : null}
        {llm.length > 0 ? (
          <optgroup label={t({ ko: 'LLM 연결', en: 'LLM connections' })}>
            {llm.map((provider) => <option key={provider.provider_name} value={provider.provider_name}>{label(provider)}</option>)}
          </optgroup>
        ) : null}
        {providerName && !selected ? <option value={providerName} disabled>{providerName}</option> : null}
      </Select>
      <Input
        variant="settings"
        aria-label={t({ ko: '모델', en: 'Model' })}
        value={model}
        disabled={!providerName}
        placeholder={defaultModelOf(selected) ?? t({ ko: '기본 모델', en: 'Default model' })}
        onChange={(event) => onChange({ providerName, model: event.target.value })}
        className="font-mono"
      />
    </div>
  )
}
