import type { ChatJudgeItem, ChatJudgeTestTurn, ChatJudgeUncertain } from '@conai/shared'
import { Plus, Trash2 } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Chip, ToggleChip } from '@/components/ui/chip'
import { EditorPaneHeader } from '@/components/ui/editor-split'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { GROW_TEXTAREA } from './chat-profile-editor-fields'
import { EditorGroup } from '@/components/ui/editor-group'
import { formatProbability, JudgeProbabilityBar, JudgeVerdictChip } from './chat-judge-parts'
import { JudgeToolPicker, JudgeWithheldTools } from './chat-judge-tool-picker'

/** The verdict an answer gets under the item's current thresholds (so moving them re-reads the test at once). */
export function verdictUnder(item: Pick<ChatJudgeItem, 'yesThreshold' | 'noThreshold'>, probability: number | null) {
  if (probability === null) return null
  return probability >= item.yesThreshold ? 'yes' : probability <= item.noThreshold ? 'no' : 'uncertain'
}

/** The item's tested turns with their result. */
function testRowsOf(item: ChatJudgeItem, turns: ChatJudgeTestTurn[]) {
  return turns.flatMap((turn) => {
    const result = turn.items.find((entry) => entry.itemId === item.id)
    return result ? [{ turn, result }] : []
  })
}

/** How a test went for one item under its current thresholds, or null when it judged no turn. */
export function itemTestSummary(item: ChatJudgeItem, turns: ChatJudgeTestTurn[]) {
  const rows = testRowsOf(item, turns)
  if (rows.length === 0) return null
  const verdicts = rows.map(({ result }) => verdictUnder(item, result.probability))
  return {
    total: rows.length,
    yes: verdicts.filter((verdict) => verdict === 'yes').length,
    no: verdicts.filter((verdict) => verdict === 'no').length,
    unsure: verdicts.filter((verdict) => verdict === 'uncertain').length,
  }
}

function ChoiceOptions({ item, onChange }: { item: ChatJudgeItem; onChange: (patch: Partial<ChatJudgeItem>) => void }) {
  const { t } = useI18n()
  const update = (index: number, patch: Partial<ChatJudgeItem['options'][number]>) => onChange({ options: item.options.map((option, at) => (at === index ? { ...option, ...patch } : option)) })
  return (
    <div className="space-y-1.5">
      {item.options.map((option, index) => (
        <div key={index} className="grid grid-cols-[8rem_minmax(0,1fr)_auto_auto] items-center gap-2">
          <Input variant="settings" className="font-mono" aria-label={t({ ko: '선택지 이름', en: 'Option label' })} value={option.label} maxLength={40} onChange={(event) => update(index, { label: event.target.value })} />
          <Input variant="settings" aria-label={t({ ko: '선택지 설명', en: 'Option description' })} value={option.description} onChange={(event) => update(index, { description: event.target.value })} />
          <ToggleChip size="sm" pressed={option.yes} onClick={() => update(index, { yes: !option.yes })}>{t({ ko: '예로 셈', en: 'Counts as yes' })}</ToggleChip>
          <IconButton size="icon-sm" variant="ghost" onClick={() => onChange({ options: item.options.filter((_, at) => at !== index) })} label={t({ ko: '선택지 삭제', en: 'Remove option' })}><Trash2 /></IconButton>
        </div>
      ))}
      <IconButton size="icon-sm" variant="ghost" disabled={item.options.length >= 12} onClick={() => onChange({ options: [...item.options, { label: `option_${item.options.length + 1}`, description: '', yes: false }] })} label={t({ ko: '선택지 추가', en: 'Add option' })}><Plus /></IconButton>
    </div>
  )
}

/** The test results of one item: each tested turn with its probability, read under the current thresholds. */
function ItemTestRows({ item, turns }: { item: ChatJudgeItem; turns: ChatJudgeTestTurn[] }) {
  const { t } = useI18n()
  const rows = testRowsOf(item, turns)
  if (rows.length === 0) return <p className="py-2 text-xs text-muted-foreground">{t({ ko: '이 항목이 판단할 턴이 없어.', en: 'No turns for this item.' })}</p>
  return (
    <div className="divide-y divide-line">
      {rows.map(({ turn, result }) => {
        const verdict = verdictUnder(item, result.probability)
        return (
          <div key={turn.messageId} className="grid grid-cols-[2rem_minmax(0,1fr)_6rem_2.5rem_auto] items-center gap-2 py-1.5 text-xs">
            <span className="text-muted-foreground">{turn.role === 'user' ? t({ ko: '나', en: 'Me' }) : t({ ko: '봇', en: 'Bot' })}</span>
            <span className="truncate" title={turn.excerpt}>{turn.excerpt}</span>
            <JudgeProbabilityBar probability={result.probability} yesThreshold={item.yesThreshold} noThreshold={item.noThreshold} />
            <span className="text-right tabular-nums">{formatProbability(result.probability)}</span>
            <JudgeVerdictChip result={{ verdict: verdict ?? 'uncertain', decidedBy: verdict === null ? 'fallback' : 'judge' }} className="justify-self-end" />
          </div>
        )
      })}
    </div>
  )
}

/**
 * One judgment item as the right side of the judge preset editor: name, question, thresholds, what a yes / no does,
 * and the last test's results for it.
 */
export function ChatJudgeItemPane({ item, onChange, onRemove, testTurns }: {
  item: ChatJudgeItem
  onChange: (patch: Partial<ChatJudgeItem>) => void
  onRemove: () => void
  testTurns: ChatJudgeTestTurn[] | null
}) {
  const { t } = useI18n()
  const before = item.stage === 'before'
  const summary = testTurns ? itemTestSummary(item, testTurns) : null
  const uncertainOptions: Array<{ value: ChatJudgeUncertain; label: string }> = [
    { value: 'default', label: t({ ko: '지금 방식대로', en: 'As usual' }) },
    { value: 'yes', label: t({ ko: '예로', en: 'As yes' }) },
    { value: 'no', label: t({ ko: '아니오로', en: 'As no' }) },
    { value: 'llm', label: t({ ko: 'LLM에게 다시', en: 'Ask an LLM' }) },
  ]

  return (
    <div>
      <EditorPaneHeader
        title={<span className={cn(!item.enabled && 'text-muted-foreground')}>{item.name || t({ ko: '이름 없음', en: 'Untitled' })}</span>}
        actions={(
          <>
            <Switch checked={item.enabled} onCheckedChange={(enabled) => onChange({ enabled })} aria-label={t({ ko: '사용', en: 'On' })} />
            <IconButton size="icon-sm" variant="destructive-ghost" onClick={onRemove} label={t({ ko: '항목 삭제', en: 'Remove item' })}><Trash2 /></IconButton>
          </>
        )}
      />
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
          <Field label={t({ ko: '이름', en: 'Name' })}>
            <Input variant="settings" value={item.name} maxLength={40} onChange={(event) => onChange({ name: event.target.value })} />
          </Field>
          <Field label={t({ ko: '시점', en: 'When' })}>
            <SegmentedControl
              value={item.stage}
              onChange={(stage) => onChange({ stage: stage as ChatJudgeItem['stage'] })}
              items={[{ value: 'before', label: t({ ko: '답변 전', en: 'Before reply' }) }, { value: 'after', label: t({ ko: '답변 후', en: 'After reply' }) }]}
              size="sm"
            />
          </Field>
          <Field label={t({ ko: '종류', en: 'Kind' })}>
            <SegmentedControl
              value={item.kind}
              onChange={(kind) => onChange({ kind: kind as ChatJudgeItem['kind'], ...(kind === 'choice' && item.options.length === 0 ? { options: [{ label: 'yes', description: '', yes: true }, { label: 'no', description: '', yes: false }] } : {}) })}
              items={[{ value: 'noul', label: t({ ko: '예/아니오', en: 'Yes/no' }) }, { value: 'choice', label: t({ ko: '선택', en: 'Choice' }) }]}
              size="sm"
            />
          </Field>
        </div>
        <Field label={t({ ko: '질문', en: 'Question' })}>
          <Textarea variant="settings" className={cn(GROW_TEXTAREA, 'font-mono text-xs')} value={item.instructions} maxLength={2000} placeholder="Did the user …?" onChange={(event) => onChange({ instructions: event.target.value })} />
        </Field>
        {item.kind === 'noul' ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t({ ko: '예 기준', en: 'Yes looks like' })}>
              <Textarea variant="settings" className={GROW_TEXTAREA} value={item.criteria.yes} maxLength={600} onChange={(event) => onChange({ criteria: { ...item.criteria, yes: event.target.value } })} />
            </Field>
            <Field label={t({ ko: '아니오 기준', en: 'No looks like' })}>
              <Textarea variant="settings" className={GROW_TEXTAREA} value={item.criteria.no} maxLength={600} onChange={(event) => onChange({ criteria: { ...item.criteria, no: event.target.value } })} />
            </Field>
          </div>
        ) : (
          <Field label={t({ ko: '선택지', en: 'Options' })}>
            <ChoiceOptions item={item} onChange={onChange} />
          </Field>
        )}

        <div className="border-t border-line">
          <SettingRow label={t({ ko: '읽을 메시지', en: 'Messages read' })}>
            <NumberStepperInput variant="settings" className="w-32" min={1} max={30} step={1} value={item.window} onValueCommit={(value) => onChange({ window: Number(value) || 1 })} aria-label={t({ ko: '읽을 메시지', en: 'Messages read' })} />
          </SettingRow>
          <SettingRow label={t({ ko: '기준값', en: 'Thresholds' })} controlClassName="w-full sm:w-72">
            <div className="w-full space-y-1.5">
              <div className="flex justify-between text-2xs">
                <span className="text-warning">{t({ ko: '아니오 ≤ {value}', en: 'No ≤ {value}' }, { value: item.noThreshold.toFixed(2) })}</span>
                <span className="text-muted-foreground">{t({ ko: '애매', en: 'Unsure' })}</span>
                <span className="text-success">{t({ ko: '예 ≥ {value}', en: 'Yes ≥ {value}' }, { value: item.yesThreshold.toFixed(2) })}</span>
              </div>
              <Slider
                min={0}
                max={1}
                step={0.01}
                minStepsBetweenThumbs={0}
                value={[item.noThreshold, item.yesThreshold]}
                thumbLabels={[t({ ko: '아니오 기준값', en: 'No threshold' }), t({ ko: '예 기준값', en: 'Yes threshold' })]}
                onValueChange={([no, yes]) => onChange({ noThreshold: Math.round(no * 100) / 100, yesThreshold: Math.round(yes * 100) / 100 })}
              />
            </div>
          </SettingRow>
          <SettingRow label={t({ ko: '애매할 때', en: 'When unsure' })}>
            <Select variant="settings" className="w-44" aria-label={t({ ko: '애매할 때', en: 'When unsure' })} value={item.uncertain} onChange={(event) => onChange({ uncertain: event.target.value as ChatJudgeUncertain })}>
              {uncertainOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </SettingRow>
          {before ? (
            <>
              <SettingRow label={t({ ko: '예일 때', en: 'On yes' })} align="start" controlClassName="w-full sm:w-80 flex-col items-stretch">
                <JudgeToolPicker tools={item.tools} onChange={(tools) => onChange({ tools })} />
                <Textarea variant="settings" className={GROW_TEXTAREA} value={item.directive} maxLength={2000} aria-label={t({ ko: '지시문', en: 'Directive' })} placeholder={t({ ko: '대화 모델에게 붙일 지시문', en: 'Directive for the chat model' })} onChange={(event) => onChange({ directive: event.target.value })} />
              </SettingRow>
              <SettingRow label={t({ ko: '아니오일 때', en: 'On no' })}>
                {item.tools.length > 0
                  ? <div className="flex flex-wrap gap-1.5"><JudgeWithheldTools tools={item.tools} /></div>
                  : <span className="text-xs text-muted-foreground">{t({ ko: '동작 없음', en: 'Nothing' })}</span>}
              </SettingRow>
            </>
          ) : (
            <SettingRow label={t({ ko: '예일 때', en: 'On yes' })}>
              <Chip size="sm" tone="success">{t({ ko: '후속 메시지 보내기', en: 'Send a follow-up' })}</Chip>
            </SettingRow>
          )}
        </div>

        {testTurns ? (
          <EditorGroup
            label={t({ ko: '테스트 결과', en: 'Test results' })}
            actions={summary ? (
              <span className="flex gap-2 text-2xs tabular-nums">
                <span className="text-success">{t({ ko: '예 {n}', en: 'Yes {n}' }, { n: summary.yes })}</span>
                <span className="text-warning">{t({ ko: '아니오 {n}', en: 'No {n}' }, { n: summary.no })}</span>
                <span className="text-muted-foreground">{t({ ko: '애매 {n}', en: 'Unsure {n}' }, { n: summary.unsure })}</span>
              </span>
            ) : undefined}
          >
            <ItemTestRows item={item} turns={testTurns} />
          </EditorGroup>
        ) : null}
      </div>
    </div>
  )
}
