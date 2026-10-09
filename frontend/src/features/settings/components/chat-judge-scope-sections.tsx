import type { ReactNode } from 'react'
import type { ChatJudgeAssetSettings, ChatJudgeContextSettings, ChatJudgeFieldSettings, ChatJudgeRoomSettings } from '@conai/shared'
import { EditorPaneHeader } from '@/components/ui/editor-split'
import { Field } from '@/components/ui/field'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { SettingRow } from '@/components/ui/setting-row'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { GROW_TEXTAREA } from './chat-profile-editor-fields'

export type JudgeScopes = { room: ChatJudgeRoomSettings; context: ChatJudgeContextSettings; fields: ChatJudgeFieldSettings; assets: ChatJudgeAssetSettings }
type ScopePaneProps = { value: JudgeScopes; onChange: (patch: Partial<JudgeScopes>) => void }

/** Which of the preset's built-in judgments do anything (for the editor's list). */
export function judgeScopesOn({ room, context, fields, assets }: JudgeScopes) {
  return {
    room: room.route.enabled || room.next.enabled,
    context: context.lore.enabled || context.recall.enabled,
    fields: fields.enabled,
    assets: assets.enabled,
  }
}

/** One probability the judge's answer must reach, as a single-thumb slider. */
function ThresholdField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <Field label={`${label} ≥ ${value.toFixed(2)}`}>
      <div className="pt-2">
        <Slider min={0} max={1} step={0.01} value={[value]} thumbLabels={[label]} onValueChange={([next]) => onChange(Math.round(next * 100) / 100)} />
      </div>
    </Field>
  )
}

function WindowRow({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useI18n()
  return (
    <SettingRow label={t({ ko: '읽을 메시지', en: 'Messages read' })}>
      <NumberStepperInput variant="settings" className="w-32" min={1} max={30} step={1} value={value} onValueCommit={(next) => onChange(Number(next) || 1)} aria-label={t({ ko: '읽을 메시지', en: 'Messages read' })} />
    </SettingRow>
  )
}

/** A switch row; its settings show under it while it is on. */
function ScopeSwitch({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (checked: boolean) => void; children?: ReactNode }) {
  return (
    <div className="border-b border-line last:border-b-0">
      <SettingsSwitchRow className="border-b-0" label={label} checked={checked} onCheckedChange={onChange} />
      {checked && children ? <div className="space-y-3 pb-4">{children}</div> : null}
    </div>
  )
}

/** Group rooms: who answers a message that names no one, and whether the room goes on or waits for the user. */
export function JudgeRoomPane({ value, onChange }: ScopePaneProps) {
  const { t } = useI18n()
  const { room } = value
  const patchRoom = (patch: Partial<ChatJudgeRoomSettings>) => onChange({ room: { ...room, ...patch } })
  const defaultQuestion = t({ ko: '비우면 기본 질문', en: 'Empty: the default question' })
  return (
    <div>
      <EditorPaneHeader
        title={t({ ko: '그룹 대화', en: 'Group rooms' })}
        info={t({ ko: '이 프리셋을 고른 그룹 방에서, 아무도 부르지 않은 메시지에 누가 답할지와 대화를 이어갈지 멈출지를 판단해.', en: 'In group rooms using this preset: who answers a message that names no one, and whether the room goes on or waits for the user.' })}
      />
      <div className="border-t border-line">
        <ScopeSwitch label={t({ ko: '답할 사람 고르기', en: 'Pick who answers' })} checked={room.route.enabled} onChange={(enabled) => patchRoom({ route: { ...room.route, enabled } })}>
          <ThresholdField label={t({ ko: '고를 확률', en: 'Pick at' })} value={room.route.minProbability} onChange={(minProbability) => patchRoom({ route: { ...room.route, minProbability } })} />
          <Textarea variant="settings" className={GROW_TEXTAREA} value={room.route.instructions} maxLength={2000} aria-label={t({ ko: '답할 사람 질문', en: 'Who-answers question' })} placeholder={defaultQuestion} onChange={(event) => patchRoom({ route: { ...room.route, instructions: event.target.value } })} />
        </ScopeSwitch>
        <ScopeSwitch label={t({ ko: '이어 말하기 판단', en: 'Judge speaking on' })} checked={room.next.enabled} onChange={(enabled) => patchRoom({ next: { ...room.next, enabled } })}>
          <ThresholdField label={t({ ko: '이어갈 확률', en: 'Go on at' })} value={room.next.continueThreshold} onChange={(continueThreshold) => patchRoom({ next: { ...room.next, continueThreshold } })} />
          <Textarea variant="settings" className={GROW_TEXTAREA} value={room.next.instructions} maxLength={2000} aria-label={t({ ko: '이어 말하기 질문', en: 'Speaking-on question' })} placeholder={defaultQuestion} onChange={(event) => patchRoom({ next: { ...room.next, instructions: event.target.value } })} />
        </ScopeSwitch>
        {room.route.enabled || room.next.enabled ? <WindowRow value={room.window} onChange={(window) => patchRoom({ window })} /> : null}
      </div>
    </div>
  )
}

/** Lore entries the conversation is about without a keyword, and recalled episodes kept only when relevant. */
export function JudgeContextPane({ value, onChange }: ScopePaneProps) {
  const { t } = useI18n()
  const { context } = value
  const patchContext = (patch: Partial<ChatJudgeContextSettings>) => onChange({ context: { ...context, ...patch } })
  return (
    <div>
      <EditorPaneHeader
        title={t({ ko: '로어·회상', en: 'Lore & recall' })}
        info={t({ ko: '키워드가 안 나와도 지금 대화와 관련된 로어 항목을 넣고, 지난 일 회상은 관련 있는 것만 남겨. API·Claude 채팅에 적용돼.', en: 'Adds lore entries the conversation is about without a keyword, and keeps only relevant recalled episodes. API and Claude chats.' })}
      />
      <div className="border-t border-line">
        <ScopeSwitch label={t({ ko: '키워드 없이 로어 넣기', en: 'Lore without keywords' })} checked={context.lore.enabled} onChange={(enabled) => patchContext({ lore: { ...context.lore, enabled } })}>
          <div className="grid gap-3 md:grid-cols-[8rem_minmax(0,1fr)]">
            <Field label={t({ ko: '물어볼 항목 수', en: 'Entries asked' })}>
              <NumberStepperInput variant="settings" min={1} max={12} step={1} value={context.lore.candidates} onValueCommit={(next) => patchContext({ lore: { ...context.lore, candidates: Number(next) || 1 } })} aria-label={t({ ko: '물어볼 항목 수', en: 'Entries asked' })} />
            </Field>
            <ThresholdField label={t({ ko: '넣을 확률', en: 'Add at' })} value={context.lore.threshold} onChange={(threshold) => patchContext({ lore: { ...context.lore, threshold } })} />
          </div>
        </ScopeSwitch>
        <ScopeSwitch label={t({ ko: '회상 거르기', en: 'Filter recall' })} checked={context.recall.enabled} onChange={(enabled) => patchContext({ recall: { ...context.recall, enabled } })}>
          <ThresholdField label={t({ ko: '남길 확률', en: 'Keep at' })} value={context.recall.threshold} onChange={(threshold) => patchContext({ recall: { ...context.recall, threshold } })} />
        </ScopeSwitch>
        {context.lore.enabled || context.recall.enabled ? <WindowRow value={context.window} onChange={(window) => patchContext({ window })} /> : null}
      </div>
    </div>
  )
}

/** Status fields with a fixed value list (emotion, place…) the reply left alone, settled after it. */
export function JudgeFieldsPane({ value, onChange }: ScopePaneProps) {
  const { t } = useI18n()
  const { fields } = value
  return (
    <div>
      <EditorPaneHeader
        title={t({ ko: '상태 필드', en: 'Status fields' })}
        info={t({ ko: '답변이 안 건드린 선택형 상태 필드(감정, 장소 같은)를 답변 뒤에 판단해서 바꿔. 스프라이트도 같이 바뀌어.', en: 'After a reply, settles the status fields with a fixed value list (emotion, place…) the reply left alone. Sprites follow.' })}
        actions={<Switch checked={fields.enabled} onCheckedChange={(enabled) => onChange({ fields: { ...fields, enabled } })} aria-label={t({ ko: '상태 필드', en: 'Status fields' })} />}
      />
      {fields.enabled ? (
        <div className="space-y-3 border-t border-line">
          <WindowRow value={fields.window} onChange={(window) => onChange({ fields: { ...fields, window } })} />
          <ThresholdField label={t({ ko: '바꿀 확률', en: 'Change at' })} value={fields.threshold} onChange={(threshold) => onChange({ fields: { ...fields, threshold } })} />
        </div>
      ) : null}
    </div>
  )
}

/** Expression candidates in character asset batches, checked by their tags for the emotion they show. */
export function JudgeAssetsPane({ value, onChange }: ScopePaneProps) {
  const { t } = useI18n()
  return (
    <EditorPaneHeader
      title={t({ ko: '표정 검수', en: 'Expression review' })}
      info={t({ ko: '캐릭터 자산 묶음에서 표정 후보의 태그를 보고 어떤 감정인지 판단해. 직접 만든 감정도 검수되고, 태거가 켜져 있을 때만 동작해.', en: 'In character asset batches, reads each expression candidate’s tags for the emotion it shows, custom emotions too. Needs the tagger on.' })}
      actions={<Switch checked={value.assets.enabled} onCheckedChange={(enabled) => onChange({ assets: { enabled } })} aria-label={t({ ko: '표정 검수', en: 'Expression review' })} />}
    />
  )
}
