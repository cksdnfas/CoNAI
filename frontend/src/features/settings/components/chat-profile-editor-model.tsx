import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Scale, TriangleAlert } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Field } from '@/components/ui/field'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { CodexModelSelect } from '@/features/image-generation/components/codex-model-select'
import { CodexReasoningSelect } from '@/features/image-generation/components/codex-reasoning-select'
import { useI18n } from '@/i18n'
import { CHAT_JUDGE_PRESETS_QUERY_KEY, listChatJudgePresets } from '@/lib/api-chat-judge'
import { thinkingMayFillCap, type ChatProfileDefaults, type ChatProfileInput, type ModelRole, type ModelSlot } from '@/lib/api-codex-chat'
import type { CodexModelOption } from '@/lib/api-image-generation-queue'
import { cn } from '@/lib/utils'
import type { ClaudeModelOption } from '@conai/shared'
import { ClaudeEffortSelect, ClaudeModelSelect } from './claude-model-select'
import { JudgeModelSelect, useModelLabel } from './chat-judge-connection-select'
import { applyRoleChoice, ModelRoleSelect, roleChoice, type SuggestWriters } from './chat-model-role-select'
import { GROW_TEXTAREA, numberOrNull, SwitchLine, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { ContentRatingSelect, useCeilingLabel } from './content-rating-select'
import { EditorGroup } from '@/components/ui/editor-group'

/**
 * One role: its name on the left (with a fold toggle when it has settings of its own), its model on the right, and
 * those settings underneath while unfolded.
 */
function RoleRow({ label, icon, select, children }: { label: string; icon?: ReactNode; select: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
        {children ? (
          // eslint-disable-next-line no-restricted-syntax -- a text row toggle; Button padding would misalign the labels
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-10 cursor-pointer items-center gap-1.5 rounded-sm text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')} />
            {icon}
            {label}
          </button>
        ) : (
          <span className="flex min-h-10 items-center gap-1.5 pl-5.5 text-sm">{icon}{label}</span>
        )}
        <div className="md:w-3/5">{select}</div>
      </div>
      {children && open ? <div className="space-y-3 pt-2 pb-1 md:pl-5.5">{children}</div> : null}
    </div>
  )
}

/** The judge preset (none: chat as without a judge) and, unfolded, a judge model of this profile's own. */
function JudgeRole({ draft, patch }: { draft: Draft; patch: PatchDraft }) {
  const { t } = useI18n()
  const presetsQuery = useQuery({ queryKey: CHAT_JUDGE_PRESETS_QUERY_KEY, queryFn: listChatJudgePresets })
  const presets = presetsQuery.data ?? []
  const preset = presets.find((item) => item.id === draft.judgePresetId)
  const presetModel = useModelLabel(true, preset?.modelSlotId ?? null)
  const label = t({ ko: '판단', en: 'Judge' })
  const select = (
    <Select
      variant="settings"
      aria-label={t({ ko: '판단 프리셋', en: 'Judge preset' })}
      value={draft.judgePresetId !== null ? String(draft.judgePresetId) : ''}
      onChange={(event) => patch(event.target.value ? { judgePresetId: Number(event.target.value) } : { judgePresetId: null, judgeSlotId: null })}
    >
      <option value="">{t({ ko: '없음', en: 'None' })}</option>
      {presets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      {draft.judgePresetId !== null && !preset && presetsQuery.isSuccess ? <option value={draft.judgePresetId} disabled>{t({ ko: '프리셋 #{id}', en: 'Preset #{id}' }, { id: draft.judgePresetId })}</option> : null}
    </Select>
  )
  return (
    <RoleRow label={label} icon={<Scale className="size-4 text-resource-judge" aria-hidden="true" />} select={select}>
      {draft.judgePresetId !== null ? (
        <Field label={t({ ko: '판단 모델', en: 'Judge model' })}>
          <JudgeModelSelect
            enabled
            ariaLabel={t({ ko: '판단 모델', en: 'Judge model' })}
            slotId={draft.judgeSlotId}
            emptyLabel={presetModel ? t({ ko: '프리셋 따름 · {name}', en: 'Preset’s · {name}' }, { name: presetModel }) : t({ ko: '프리셋 따름', en: 'Preset’s' })}
            onChange={(judgeSlotId) => patch({ judgeSlotId })}
          />
        </Field>
      ) : null}
    </RoleRow>
  )
}

/**
 * The highest rating tier of media the model is shown, for a model that sees images. An API LLM profile can follow
 * its chat model row's ceiling; Codex and Claude Code have no row, so they set their own.
 */
function ContentRatingField({ draft, patch, slots }: { draft: Draft; patch: PatchDraft; slots: ModelSlot[] }) {
  const { t } = useI18n()
  const { label } = useCeilingLabel()
  const isLlm = draft.engine === 'llm'
  const chatSlot = slots.find((slot) => slot.id === draft.modelSlotId) ?? slots.find((slot) => slot.isDefault)
  return (
    <Field className="md:w-1/2" label={t({ ko: '허용 등급', en: 'Content rating' })} info={t({ ko: '이 등급을 넘는 이미지·영상은 모델에 보내지 않아.', en: 'Images and videos above this rating are never sent to the model.' })}>
      <ContentRatingSelect
        ariaLabel={t({ ko: '허용 등급', en: 'Content rating' })}
        value={isLlm && draft.contentRatingMode === 'model' ? 'model' : draft.contentRatingTierId}
        followLabel={isLlm ? t({ ko: '모델 설정 따름 · {ceiling}', en: 'Model’s · {ceiling}' }, { ceiling: label(chatSlot?.contentRatingTierId ?? null) }) : undefined}
        onChange={(choice) => patch(choice === 'model' ? { contentRatingMode: 'model' } : { contentRatingMode: 'custom', contentRatingTierId: choice })}
      />
    </Field>
  )
}

/** The engine and its model, then the roles other models play (summary, translation, suggestions, judge). */
export function ChatProfileModelPanel({ draft, patch, defaults, slots, slotsReady, suggestWriters, codexModels, claudeModels, advanced }: {
  draft: Draft
  patch: PatchDraft
  defaults: ChatProfileDefaults | undefined
  /** The connections' models (Settings → LLM). */
  slots: ModelSlot[]
  slotsReady: boolean
  /** The profiles that can write this one's reply suggestions. */
  suggestWriters: SuggestWriters
  codexModels: CodexModelOption[] | undefined
  claudeModels: ClaudeModelOption[] | undefined
  advanced: boolean
}) {
  const { t } = useI18n()
  const isLlm = draft.engine === 'llm'
  const hasLlmContext = draft.engine !== 'codex'
  const serverDefault = t({ ko: '서버 기본값', en: 'Server default' })
  const summaryOn = roleChoice(draft, 'summary', slots, hasLlmContext, slotsReady) !== 'off'
  const translationOn = roleChoice(draft, 'translation', slots, isLlm, slotsReady) !== 'off'
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
      value={roleChoice(draft, role, slots, hasLlmContext, slotsReady)}
      slots={slots}
      slotsReady={slotsReady}
      canInherit={hasLlmContext}
      writers={role === 'suggest' ? suggestWriters : undefined}
      ariaLabel={ariaLabel}
      onChange={(choice) => patch(applyRoleChoice(role, choice))}
    />
  )

  return (
    <div className="space-y-4">
      <EditorGroup>
        <SegmentedControl
          size="sm"
          value={draft.engine}
          onChange={(engine) => patch(engine === 'codex' || engine === 'claude'
            ? { engine, modelSlotId: null, model: engine === 'claude' ? 'sonnet' : '', reasoningEffort: '', reasoningBudgetTokens: null, visionEnabled: engine === 'claude' || draft.visionEnabled }
            : { engine: 'llm', model: '', reasoningEffort: '', reasoningBudgetTokens: null })}
          items={[
            { value: 'llm', label: t({ ko: 'API LLM', en: 'API LLM' }) },
            { value: 'codex', label: 'Codex' },
            { value: 'claude', label: 'Claude Code' },
          ]}
          ariaLabel={t({ ko: '엔진', en: 'Engine' })}
        />
        {isLlm ? (
          <>
            <Field label={t({ ko: '대화 모델', en: 'Chat model' })}>
              {roleSelect('chat', t({ ko: '대화 모델', en: 'Chat model' }))}
            </Field>
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
              {advanced ? (
                <Field label={t({ ko: '추론 토큰 예산', en: 'Reasoning token budget' })} info={t({ ko: 'reasoning_budget_tokens. 비우면 보내지 않아.', en: 'reasoning_budget_tokens. Not sent when empty.' })}>
                  <NumberStepperInput variant="settings" allowEmpty step={1024} min={1} value={draft.reasoningBudgetTokens} placeholder={serverDefault} onValueCommit={(value) => patch({ reasoningBudgetTokens: numberOrNull(value) })} />
                </Field>
              ) : null}
            </div>
            <SwitchLine label={t({ ko: '이미지를 볼 수 있는 모델', en: 'Model can see images' })} checked={draft.visionEnabled} onCheckedChange={(visionEnabled) => patch({ visionEnabled })} />
            {draft.visionEnabled ? <ContentRatingField draft={draft} patch={patch} slots={slots} /> : null}
            {advanced ? (
              <Field label={t({ ko: '추가 파라미터 (JSON)', en: 'Extra parameters (JSON)' })}>
                <Textarea
                  variant="settings"
                  rows={4}
                  className={cn('font-mono text-xs', GROW_TEXTAREA, extraParamsError && 'border-destructive')}
                  value={draft.extraParams}
                  placeholder={'{\n  "chat_template_kwargs": { "enable_thinking": true }\n}'}
                  onChange={(event) => patch({ extraParams: event.target.value })}
                  aria-invalid={Boolean(extraParamsError)}
                />
                {extraParamsError ? <p className="text-xs text-destructive">{extraParamsError}</p> : null}
              </Field>
            ) : extraParamsError ? <p className="text-xs text-destructive">{t({ ko: '추가 파라미터(고급)에 오류가 있어: {error}', en: 'Extra parameters (advanced) have an error: {error}' }, { error: extraParamsError })}</p> : null}
          </>
        ) : draft.engine === 'claude' ? (<>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t({ ko: 'Claude 모델', en: 'Claude model' })}>
              <ClaudeModelSelect value={draft.model} models={claudeModels} onChange={(model) => {
                // A level the new model doesn't take falls back to its default instead of staying as unsupported.
                const levels = claudeModels?.find((entry) => entry.id === model)?.supportedEffortLevels
                patch({ model, ...(draft.reasoningEffort && levels && !levels.includes(draft.reasoningEffort) ? { reasoningEffort: '' } : {}) })
              }} aria-label={t({ ko: 'Claude 모델', en: 'Claude model' })} />
            </Field>
            <Field label={t({ ko: '추론 강도', en: 'Reasoning effort' })}>
              <ClaudeEffortSelect value={draft.reasoningEffort} model={draft.model} models={claudeModels} onChange={(reasoningEffort) => patch({ reasoningEffort })} />
            </Field>
            <Field label={t({ ko: '최대 출력 토큰', en: 'Max output tokens' })}>
              <NumberStepperInput variant="settings" allowEmpty step={1024} min={1} value={draft.maxTokens} placeholder={serverDefault} onValueCommit={(value) => patch({ maxTokens: numberOrNull(value) })} />
            </Field>
          </div>
          <SwitchLine label={t({ ko: '이미지 첨부와 조회', en: 'Image attachments and viewing' })} checked={draft.visionEnabled} onCheckedChange={(visionEnabled) => patch({ visionEnabled })} />
          {draft.visionEnabled ? <ContentRatingField draft={draft} patch={patch} slots={slots} /> : null}
        </>
        ) : (<>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t({ ko: 'Codex 모델', en: 'Codex model' })}>
              <CodexModelSelect variant="settings" value={draft.model} models={codexModels} onChange={(model) => patch({ model })} aria-label={t({ ko: 'Codex 모델', en: 'Codex model' })} />
            </Field>
            <Field label={t({ ko: '추론 강도', en: 'Reasoning effort' })}>
              <CodexReasoningSelect variant="settings" value={draft.reasoningEffort} model={draft.model} models={codexModels} onChange={(reasoningEffort) => patch({ reasoningEffort })} />
            </Field>
          </div>
          {/* Codex models always see images. */}
          <ContentRatingField draft={draft} patch={patch} slots={slots} />
        </>
        )}
      </EditorGroup>

      <EditorGroup label={t({ ko: '역할', en: 'Roles' })}>
        <div>
          {draft.engine !== 'codex' ? (
            <RoleRow label={t({ ko: '요약', en: 'Summary' })} select={roleSelect('summary', t({ ko: '요약 모델', en: 'Summary model' }))}>
              {summaryOn ? (
                <>
                  <Field label={t({ ko: '한 번에 요약할 턴 수', en: 'Turns per summary' })} className="md:w-1/2">
                    <NumberStepperInput variant="settings" step={1} min={1} max={200} value={draft.summaryTriggerTurns} onValueCommit={(value) => patch({ summaryTriggerTurns: numberOrNull(value) ?? draft.summaryTriggerTurns })} />
                  </Field>
                  <Field label={t({ ko: '요약 프롬프트', en: 'Summary prompt' })}>
                    <Textarea variant="settings" rows={4} className={GROW_TEXTAREA} value={draft.summaryPrompt} placeholder={defaults?.summaryPrompt} onChange={(event) => patch({ summaryPrompt: event.target.value })} />
                  </Field>
                </>
              ) : null}
            </RoleRow>
          ) : null}
          <RoleRow label={t({ ko: '번역', en: 'Translation' })} select={roleSelect('translation', t({ ko: '번역 모델', en: 'Translation model' }))}>
            {translationOn ? (
              <Field
                label={t({ ko: '번역 지시', en: 'Translation notes' })}
                info={t({ ko: '답변을 한국어로 옮길 때 번역 모델이 따르는 메모. 말투, 호칭, 고유명사 번역표 등. {{char}}·{{user}}는 이름으로 바뀌어. 캐릭터 이름은 비워도 알려 줘. 내 메시지 번역에는 쓰지 않아.', en: 'Notes the translation model follows when it puts replies into Korean: voice, forms of address, a glossary. {{char}} and {{user}} become the names. The character’s name is passed even when empty. Not used for your own messages.' })}
              >
                <Textarea variant="settings" rows={3} className={GROW_TEXTAREA} maxLength={4000} value={draft.translationInstructions} placeholder={t({ ko: '말투 · 호칭 · 고유명사', en: 'Voice · address · names' })} onChange={(event) => patch({ translationInstructions: event.target.value })} />
              </Field>
            ) : null}
          </RoleRow>
          <RoleRow label={t({ ko: '답장 추천', en: 'Reply suggestions' })} select={roleSelect('suggest', t({ ko: '답장 추천 모델', en: 'Reply suggestion model' }))} />
          <JudgeRole draft={draft} patch={patch} />
        </div>
      </EditorGroup>
    </div>
  )
}
