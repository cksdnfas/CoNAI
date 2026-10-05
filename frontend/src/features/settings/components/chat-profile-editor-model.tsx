import { SegmentedControl } from '@/components/common/segmented-control'
import { Field } from '@/components/ui/field'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CodexModelSelect } from '@/features/image-generation/components/codex-model-select'
import { CodexReasoningSelect } from '@/features/image-generation/components/codex-reasoning-select'
import { useI18n } from '@/i18n'
import type { ChatProfileDefaults, ChatProfileInput } from '@/lib/api-codex-chat'
import type { ExternalApiProviderRecord } from '@/lib/api-external-api'
import type { CodexModelOption } from '@/lib/api-image-generation-queue'
import { cn } from '@/lib/utils'
import { ConnectionModelSelect, EditorGroup, numberOrNull, SwitchLine, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { CollapsibleRow } from './chat-profile-sections'

/** What a connection lists for a model field. */
export type ConnectionModels = { models: string[]; defaultModel: string | null }

/** The engine and its knobs: connection, model, sampling, reasoning; then how much of the chat and the lore it is sent. */
export function ChatProfileModelPanel({ draft, patch, defaults, llmProviders, providersLoaded, connectionModels, summaryModels, codexModels }: {
  draft: Draft
  patch: PatchDraft
  defaults: ChatProfileDefaults | undefined
  llmProviders: ExternalApiProviderRecord[]
  providersLoaded: boolean
  connectionModels: ConnectionModels | undefined
  summaryModels: ConnectionModels | undefined
  codexModels: CodexModelOption[] | undefined
}) {
  const { t } = useI18n()
  const isLlm = draft.engine === 'llm'
  const serverDefault = t({ ko: '서버 기본값', en: 'Server default' })
  const models = connectionModels?.models ?? []
  const extraParamsError = (() => {
    if (!isLlm || !draft.extraParams.trim()) return null
    try {
      const parsed: unknown = JSON.parse(draft.extraParams)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? null : t({ ko: 'JSON 객체여야 해.', en: 'Must be a JSON object.' })
    } catch {
      return t({ ko: 'JSON 형식이 아니야.', en: 'Not valid JSON.' })
    }
  })()

  const loreFields = (
    <>
      <Field label={t({ ko: '로어북 · 최근 메시지 수', en: 'Lorebook · recent messages' })}>
        <NumberStepperInput variant="settings" min={1} max={100} value={draft.loreScanDepth} onValueCommit={(value) => patch({ loreScanDepth: numberOrNull(value) ?? 4 })} />
      </Field>
      <Field label={t({ ko: '로어북 · 토큰 상한', en: 'Lorebook · token budget' })}>
        <NumberStepperInput variant="settings" min={0} max={32768} step={128} value={draft.loreTokenBudget} onValueCommit={(value) => patch({ loreTokenBudget: numberOrNull(value) ?? 1024 })} />
      </Field>
      {isLlm ? (
        <Field label={t({ ko: '로어북 · 삽입 위치 (끝에서 몇 턴 앞)', en: 'Lorebook · insert depth (turns from the end)' })}>
          <NumberStepperInput variant="settings" min={0} max={20} value={draft.loreDepth} onValueCommit={(value) => patch({ loreDepth: numberOrNull(value) ?? 4 })} />
        </Field>
      ) : null}
    </>
  )

  return (
    <div className="space-y-4">
      <EditorGroup>
        <SegmentedControl
          size="sm"
          value={draft.engine}
          onChange={(engine) => patch({ engine: engine === 'codex' ? 'codex' : 'llm', model: '', reasoningEffort: '', reasoningBudgetTokens: null })}
          items={[
            { value: 'llm', label: t({ ko: 'API LLM', en: 'API LLM' }) },
            { value: 'codex', label: 'Codex' },
          ]}
          ariaLabel={t({ ko: '엔진', en: 'Engine' })}
        />
        {isLlm ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t({ ko: 'LLM 연결', en: 'LLM connection' })}>
                <Select variant="settings" value={draft.providerName} disabled={llmProviders.length === 0} onChange={(event) => patch({ providerName: event.target.value, model: '' })}>
                  {llmProviders.length === 0 && providersLoaded ? <option value="">{t({ ko: 'LLM 연결 없음', en: 'No LLM connections' })}</option> : null}
                  {draft.providerName && !llmProviders.some((provider) => provider.provider_name === draft.providerName) && providersLoaded
                    ? <option value={draft.providerName}>{draft.providerName}</option>
                    : null}
                  {llmProviders.map((provider) => <option key={provider.provider_name} value={provider.provider_name}>{provider.display_name}</option>)}
                </Select>
              </Field>
              <Field label={t({ ko: '모델', en: 'Model' })}>
                <ConnectionModelSelect value={draft.model} models={models} defaultModel={connectionModels?.defaultModel ?? null} onChange={(model) => patch({ model })} />
              </Field>
              <Field label={t({ ko: '온도', en: 'Temperature' })}>
                <NumberStepperInput variant="settings" allowEmpty step={0.1} min={0} max={2} value={draft.temperature} placeholder={serverDefault} onValueCommit={(value) => patch({ temperature: numberOrNull(value) })} />
              </Field>
              <Field label={t({ ko: '최대 출력 토큰 (추론 포함)', en: 'Max output tokens (incl. reasoning)' })}>
                <NumberStepperInput variant="settings" allowEmpty step={1024} min={1} value={draft.maxTokens} placeholder={serverDefault} onValueCommit={(value) => patch({ maxTokens: numberOrNull(value) })} />
              </Field>
              <Field label={t({ ko: '추론 강도', en: 'Reasoning effort' })}>
                <Select variant="settings" value={draft.reasoningEffort} onChange={(event) => patch({ reasoningEffort: event.target.value as ChatProfileInput['reasoningEffort'] ?? '' })}>
                  <option value="">{serverDefault}</option>
                  <option value="none">{t({ ko: '끔 (none)', en: 'Off (none)' })}</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </Select>
              </Field>
              <Field label={t({ ko: '추론 토큰 예산', en: 'Reasoning token budget' })}>
                <NumberStepperInput variant="settings" allowEmpty step={1024} min={1} value={draft.reasoningBudgetTokens} placeholder={serverDefault} onValueCommit={(value) => patch({ reasoningBudgetTokens: numberOrNull(value) })} />
              </Field>
            </div>
            <SwitchLine label={t({ ko: '이미지를 볼 수 있는 모델', en: 'Model can see images' })} checked={draft.visionEnabled} onCheckedChange={(visionEnabled) => patch({ visionEnabled })} />
            <div className="border-t border-line">
              <CollapsibleRow title={t({ ko: '고급', en: 'Advanced' })} meta={draft.extraParams.trim() ? t({ ko: '추가 파라미터 있음', en: 'extra parameters set' }) : null}>
                <Field label={t({ ko: '추가 파라미터 (JSON)', en: 'Extra parameters (JSON)' })}>
                  <Textarea
                    variant="settings"
                    rows={4}
                    className={cn('font-mono text-xs', extraParamsError && 'border-destructive')}
                    value={draft.extraParams}
                    placeholder={'{\n  "chat_template_kwargs": { "enable_thinking": true }\n}'}
                    onChange={(event) => patch({ extraParams: event.target.value })}
                    aria-invalid={Boolean(extraParamsError)}
                  />
                </Field>
                {extraParamsError ? <p className="text-xs text-destructive">{extraParamsError}</p> : null}
              </CollapsibleRow>
            </div>
          </>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t({ ko: 'Codex 모델', en: 'Codex model' })}>
              <CodexModelSelect variant="settings" value={draft.model} models={codexModels} onChange={(model) => patch({ model })} aria-label={t({ ko: 'Codex 모델', en: 'Codex model' })} />
            </Field>
            <Field label={t({ ko: '추론 강도', en: 'Reasoning effort' })}>
              <CodexReasoningSelect variant="settings" value={draft.reasoningEffort} model={draft.model} models={codexModels} onChange={(reasoningEffort) => patch({ reasoningEffort })} />
            </Field>
          </div>
        )}
      </EditorGroup>

      <EditorGroup label={t({ ko: '컨텍스트', en: 'Context' })}>
        {isLlm ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t({ ko: '참고할 최근 턴 수', en: 'Recent turns sent' })}>
                <NumberStepperInput variant="settings" step={1} min={1} max={200} value={draft.contextTurns} onValueCommit={(value) => patch({ contextTurns: numberOrNull(value) ?? draft.contextTurns })} />
              </Field>
              <Field label={t({ ko: '컨텍스트 길이 (토큰)', en: 'Context length (tokens)' })}>
                <NumberStepperInput variant="settings" allowEmpty step={1024} min={1024} value={draft.contextTokens} placeholder={t({ ko: '제한 없음', en: 'No limit' })} onValueCommit={(value) => patch({ contextTokens: numberOrNull(value) })} />
              </Field>
              {loreFields}
            </div>
            <SwitchLine label={t({ ko: '대화 요약', en: 'Conversation summary' })} checked={draft.summaryEnabled} onCheckedChange={(summaryEnabled) => patch({ summaryEnabled })} />
            {draft.summaryEnabled ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t({ ko: '한 번에 요약할 턴 수', en: 'Turns per summary' })}>
                    <NumberStepperInput variant="settings" step={1} min={1} max={200} value={draft.summaryTriggerTurns} onValueCommit={(value) => patch({ summaryTriggerTurns: numberOrNull(value) ?? draft.summaryTriggerTurns })} />
                  </Field>
                  <Field label={t({ ko: '요약 연결', en: 'Summary connection' })}>
                    <Select variant="settings" value={draft.summaryProviderName ?? ''} onChange={(event) => patch({ summaryProviderName: event.target.value || null, summaryModel: '' })}>
                      <option value="">{t({ ko: '대화 모델 그대로', en: 'Same as chat' })}</option>
                      {llmProviders.map((provider) => <option key={provider.provider_name} value={provider.provider_name}>{provider.display_name}</option>)}
                    </Select>
                  </Field>
                  <Field label={t({ ko: '요약 모델', en: 'Summary model' })}>
                    <ConnectionModelSelect
                      value={draft.summaryModel}
                      models={summaryModels?.models ?? []}
                      defaultModel={draft.summaryProviderName ? summaryModels?.defaultModel ?? null : null}
                      emptyLabel={draft.summaryProviderName ? undefined : t({ ko: '대화 모델 그대로', en: 'Same as chat' })}
                      onChange={(summaryModel) => patch({ summaryModel })}
                    />
                  </Field>
                </div>
                <Field label={t({ ko: '요약 프롬프트', en: 'Summary prompt' })}>
                  <Textarea variant="settings" rows={4} value={draft.summaryPrompt} placeholder={defaults?.summaryPrompt} onChange={(event) => patch({ summaryPrompt: event.target.value })} />
                </Field>
              </>
            ) : null}
          </>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t({ ko: '압축 기준 (토큰)', en: 'Compact at (tokens)' })}>
              <NumberStepperInput
                variant="settings"
                allowEmpty
                step={8000}
                min={defaults?.codexCompactTokens.min ?? 48_000}
                value={draft.contextTokens}
                placeholder={`${t({ ko: '기본', en: 'Default' })} (${(defaults?.codexCompactTokens.default ?? 64_000).toLocaleString()})`}
                onValueCommit={(value) => patch({ contextTokens: numberOrNull(value) })}
              />
            </Field>
            {loreFields}
          </div>
        )}
      </EditorGroup>
    </div>
  )
}
