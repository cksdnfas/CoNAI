import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Field } from '@/components/ui/field'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { CodexModelSelect } from '@/features/image-generation/components/codex-model-select'
import { CodexReasoningSelect } from '@/features/image-generation/components/codex-reasoning-select'
import { useI18n } from '@/i18n'
import { thinkingMayFillCap, type ChatProfileDefaults, type ChatProfileInput, type ModelRole, type ModelSlot } from '@/lib/api-codex-chat'
import type { ExternalApiProviderRecord } from '@/lib/api-external-api'
import type { CodexModelOption } from '@/lib/api-image-generation-queue'
import { cn } from '@/lib/utils'
import { applyRoleChoice, ModelRoleSelect, roleChoice, roleDirect, roleModelPatch, roleProviderPatch } from './chat-model-role-select'
import { ConnectionModelSelect, EditorGroup, numberOrNull, SwitchLine, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { CollapsibleRow } from './chat-profile-sections'

/** What a connection lists for a model field. */
export type ConnectionModels = { models: string[]; defaultModel: string | null }

/** One auxiliary role: its label on the left, its model select on the right, and (when custom) its own connection + model underneath. */
function AuxModelRow({ label, select, children }: { label: string; select: ReactNode; children?: ReactNode }) {
  return (
    <div className="space-y-2 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
        <span className="text-sm">{label}</span>
        <div className="md:w-3/5">{select}</div>
      </div>
      {children}
    </div>
  )
}

/** The engine and its knobs: model slots per role, sampling, reasoning; then how much of the chat and the lore it is sent. */
export function ChatProfileModelPanel({ draft, patch, defaults, llmProviders, providersLoaded, slots, slotsReady, connectionModels, summaryModels, translationModels, suggestModels, codexModels }: {
  draft: Draft
  patch: PatchDraft
  defaults: ChatProfileDefaults | undefined
  llmProviders: ExternalApiProviderRecord[]
  providersLoaded: boolean
  slots: ModelSlot[]
  slotsReady: boolean
  connectionModels: ConnectionModels | undefined
  summaryModels: ConnectionModels | undefined
  translationModels: ConnectionModels | undefined
  suggestModels: ConnectionModels | undefined
  codexModels: CodexModelOption[] | undefined
}) {
  const { t } = useI18n()
  const isLlm = draft.engine === 'llm'
  const serverDefault = t({ ko: '서버 기본값', en: 'Server default' })
  const firstProvider = llmProviders[0]?.provider_name ?? ''
  const modelsByRole: Record<ModelRole, ConnectionModels | undefined> = { chat: connectionModels, summary: summaryModels, translation: translationModels, suggest: suggestModels }
  const summaryChoice = roleChoice(draft, 'summary', slots, isLlm, slotsReady)
  const summaryOn = summaryChoice !== 'off'
  const extraParamsError = (() => {
    if (!isLlm || !draft.extraParams.trim()) return null
    try {
      const parsed: unknown = JSON.parse(draft.extraParams)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? null : t({ ko: 'JSON 객체여야 해.', en: 'Must be a JSON object.' })
    } catch {
      return t({ ko: 'JSON 형식이 아니야.', en: 'Not valid JSON.' })
    }
  })()

  /** The select for one role, wired to the draft. */
  const roleSelect = (role: ModelRole, ariaLabel: string) => (
    <ModelRoleSelect
      role={role}
      value={roleChoice(draft, role, slots, isLlm, slotsReady)}
      slots={slots}
      slotsReady={slotsReady}
      canInherit={isLlm}
      ariaLabel={ariaLabel}
      onChange={(choice) => patch(applyRoleChoice(draft, role, choice, firstProvider))}
    />
  )

  /** A role's own connection + model, shown only while that role is "direct". */
  const directFields = (role: ModelRole, indent: boolean) => {
    if (!slotsReady || roleChoice(draft, role, slots, isLlm, slotsReady) !== 'direct') return null
    const direct = roleDirect(draft, role)
    const models = modelsByRole[role]
    return (
      <div className={cn('grid gap-3 md:grid-cols-2', indent && 'md:pl-4')}>
        <Field label={role === 'chat' ? t({ ko: 'LLM 연결', en: 'LLM connection' }) : t({ ko: '연결', en: 'Connection' })}>
          <Select variant="settings" value={direct.provider} disabled={llmProviders.length === 0} onChange={(event) => patch(roleProviderPatch(role, event.target.value))}>
            {llmProviders.length === 0 && providersLoaded ? <option value="">{t({ ko: 'LLM 연결 없음', en: 'No LLM connections' })}</option> : null}
            {!direct.provider && llmProviders.length > 0 ? <option value="">{t({ ko: '연결 고르기', en: 'Choose a connection' })}</option> : null}
            {direct.provider && !llmProviders.some((provider) => provider.provider_name === direct.provider) && providersLoaded
              ? <option value={direct.provider}>{direct.provider}</option>
              : null}
            {llmProviders.map((provider) => <option key={provider.provider_name} value={provider.provider_name}>{provider.display_name}</option>)}
          </Select>
        </Field>
        <Field label={t({ ko: '모델', en: 'Model' })}>
          <ConnectionModelSelect value={direct.model} models={models?.models ?? []} defaultModel={models?.defaultModel ?? null} onChange={(model) => patch(roleModelPatch(role, model))} />
        </Field>
      </div>
    )
  }

  const loreFields = (
    <>
      <Field label={t({ ko: '로어북 최근 메시지', en: 'Lorebook recent messages' })}>
        <NumberStepperInput variant="settings" min={1} max={100} value={draft.loreScanDepth} onValueCommit={(value) => patch({ loreScanDepth: numberOrNull(value) ?? 4 })} />
      </Field>
      <Field label={t({ ko: '로어북 토큰 상한', en: 'Lorebook token budget' })}>
        <NumberStepperInput variant="settings" min={0} max={32768} step={128} value={draft.loreTokenBudget} onValueCommit={(value) => patch({ loreTokenBudget: numberOrNull(value) ?? 1024 })} />
      </Field>
      {isLlm ? (
        <Field label={t({ ko: '로어북 삽입 위치', en: 'Lorebook insert depth' })} info={t({ ko: '대화 끝에서 몇 턴 앞에 넣을지.', en: 'How many turns before the end of the chat to insert it.' })}>
          <NumberStepperInput variant="settings" min={0} max={20} value={draft.loreDepth} onValueCommit={(value) => patch({ loreDepth: numberOrNull(value) ?? 4 })} />
        </Field>
      ) : null}
    </>
  )

  const noteField = (
    <Field
      label={t({ ko: '기본 작가 노트', en: "Default author's note" })}
      info={t({
        ko: '모든 채팅에 매 요청 들어가는 장면 지시. 대화 끝쪽에 들어가. 채팅마다 ⋯ → 컨텍스트에서 따로 쓰면 그쪽이 우선이야.',
        en: "A scene instruction added to every request in every chat, near the end of the conversation. A note written per chat under ⋯ → Context takes precedence.",
      })}
    >
      <Textarea variant="settings" rows={3} value={draft.authorNote} onChange={(event) => patch({ authorNote: event.target.value })} />
    </Field>
  )

  return (
    <div className="space-y-4">
      <EditorGroup label={t({ ko: '모델', en: 'Model' })}>
        <SegmentedControl
          size="sm"
          value={draft.engine}
          onChange={(engine) => patch(engine === 'codex'
            ? { engine: 'codex', modelSlotId: null, model: '', reasoningEffort: '', reasoningBudgetTokens: null }
            : { engine: 'llm', model: '', reasoningEffort: '', reasoningBudgetTokens: null })}
          items={[
            { value: 'llm', label: t({ ko: 'API LLM', en: 'API LLM' }) },
            { value: 'codex', label: 'Codex' },
          ]}
          ariaLabel={t({ ko: '엔진', en: 'Engine' })}
        />
        {isLlm ? (
          <>
            <Field label={t({ ko: '대화 모델', en: 'Chat model' })}>
              {roleSelect('chat', t({ ko: '대화 모델', en: 'Chat model' }))}
            </Field>
            {directFields('chat', false)}
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t({ ko: '온도', en: 'Temperature' })}>
                <NumberStepperInput variant="settings" allowEmpty step={0.1} min={0} max={2} value={draft.temperature} placeholder={serverDefault} onValueCommit={(value) => patch({ temperature: numberOrNull(value) })} />
              </Field>
              <Field
                label={t({ ko: '최대 출력 토큰', en: 'Max output tokens' })}
                info={t({ ko: '추론과 답변을 합친 한도. 채팅의 ⋯ → 컨텍스트에서 따로 정하면 그쪽이 우선이야.', en: 'Limit for reasoning and answer combined. A value set per chat under ⋯ → Context takes precedence.' })}
              >
                <div className="flex items-center gap-2">
                  {thinkingMayFillCap(draft.reasoningEffort, draft.maxTokens) ? (
                    <Tip content={t({ ko: '추론이 켜진 채 최대 출력 토큰이 {n}이면 생각만 하다 끝날 수 있어', en: 'With reasoning on, a cap of {n} tokens may run out while still thinking' }, { n: draft.maxTokens ?? 0 })} side="top">
                      <span className="text-warning"><TriangleAlert className="size-4" aria-hidden /></span>
                    </Tip>
                  ) : null}
                  <NumberStepperInput variant="settings" allowEmpty step={1024} min={1} value={draft.maxTokens} placeholder={serverDefault} onValueCommit={(value) => patch({ maxTokens: numberOrNull(value) })} />
                </div>
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
              <Field label={t({ ko: '추론 토큰 예산', en: 'Reasoning token budget' })} info={t({ ko: 'reasoning_budget_tokens. 비우면 보내지 않아.', en: 'reasoning_budget_tokens. Not sent when empty.' })}>
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

      <EditorGroup label={t({ ko: '보조 모델', en: 'Helper models' })}>
        <div>
          {isLlm ? (
            <AuxModelRow label={t({ ko: '요약', en: 'Summary' })} select={roleSelect('summary', t({ ko: '요약 모델', en: 'Summary model' }))}>
              {directFields('summary', true)}
            </AuxModelRow>
          ) : null}
          <AuxModelRow label={t({ ko: '번역', en: 'Translation' })} select={roleSelect('translation', t({ ko: '번역 모델', en: 'Translation model' }))}>
            {directFields('translation', true)}
            {roleChoice(draft, 'translation', slots, isLlm, slotsReady) !== 'off' ? (
              <Field
                className="md:pl-4"
                label={t({ ko: '번역 지시', en: 'Translation notes' })}
                info={t({ ko: '답변을 한국어로 옮길 때 번역 모델이 따르는 메모. 말투, 호칭, 고유명사 번역표 등. {{char}}·{{user}}는 이름으로 바뀌어. 캐릭터 이름은 비워도 알려 줘. 내 메시지 번역에는 쓰지 않아.', en: 'Notes the translation model follows when it puts replies into Korean: voice, forms of address, a glossary. {{char}} and {{user}} become the names. The character’s name is passed even when empty. Not used for your own messages.' })}
              >
                <Textarea variant="settings" rows={3} maxLength={4000} value={draft.translationInstructions} placeholder={t({ ko: '{{char}}는 무뚝뚝한 반말, 문장 끝을 "…"로 자주 끊음. {{user}}를 "선배"라고 부름.', en: '{{char}} speaks in curt casual Korean and trails off with "…". Calls {{user}} "선배".' })} onChange={(event) => patch({ translationInstructions: event.target.value })} />
              </Field>
            ) : null}
          </AuxModelRow>
          <AuxModelRow label={t({ ko: '답장 추천', en: 'Reply suggestions' })} select={roleSelect('suggest', t({ ko: '답장 추천 모델', en: 'Reply suggestion model' }))}>
            {directFields('suggest', true)}
          </AuxModelRow>
        </div>
      </EditorGroup>

      <EditorGroup label={t({ ko: '컨텍스트', en: 'Context' })}>
        {isLlm ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t({ ko: '최근 턴 수', en: 'Recent turns' })} info={t({ ko: '요청마다 보내는 최근 대화. 사용자 메시지 하나와 그 답변이 한 턴.', en: 'The recent conversation sent with each request. One user message and its reply make a turn.' })}>
                <NumberStepperInput variant="settings" step={1} min={1} max={200} value={draft.contextTurns} onValueCommit={(value) => patch({ contextTurns: numberOrNull(value) ?? draft.contextTurns })} />
              </Field>
              <Field
                label={t({ ko: '컨텍스트 길이', en: 'Context length' })}
                info={t({ ko: '토큰. 비우면 제한 없음. 정하면 시스템 프롬프트·요약·도구 설명·답변 몫을 뺀 만큼만 최근 턴을 보내.', en: 'In tokens. Empty means no limit. When set, only as many recent turns are sent as fit after the system prompt, summary, tool descriptions and the reply allowance.' })}
              >
                <NumberStepperInput variant="settings" allowEmpty step={1024} min={1024} value={draft.contextTokens} placeholder={t({ ko: '제한 없음', en: 'No limit' })} onValueCommit={(value) => patch({ contextTokens: numberOrNull(value) })} />
              </Field>
              {loreFields}
              {summaryOn ? (
                <Field label={t({ ko: '한 번에 요약할 턴 수', en: 'Turns per summary' })}>
                  <NumberStepperInput variant="settings" step={1} min={1} max={200} value={draft.summaryTriggerTurns} onValueCommit={(value) => patch({ summaryTriggerTurns: numberOrNull(value) ?? draft.summaryTriggerTurns })} />
                </Field>
              ) : null}
            </div>
            {noteField}
            {summaryOn ? (
              <Field label={t({ ko: '요약 프롬프트', en: 'Summary prompt' })}>
                <Textarea variant="settings" rows={4} value={draft.summaryPrompt} placeholder={defaults?.summaryPrompt} onChange={(event) => patch({ summaryPrompt: event.target.value })} />
              </Field>
            ) : null}
          </>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t({ ko: '압축 기준', en: 'Compact at' })} info={t({ ko: '토큰. Codex가 대화를 압축하는 기준.', en: 'In tokens. The size at which Codex compacts the conversation.' })}>
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
            {noteField}
          </>
        )}
      </EditorGroup>
    </div>
  )
}
