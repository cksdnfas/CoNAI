import { useState, type ReactNode } from 'react'
import type { ChatJudgeItem, ChatJudgeTestTurn, ChatJudgeUncertain } from '@conai/shared'
import { ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Chip, ToggleChip } from '@/components/ui/chip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { GROW_TEXTAREA } from './chat-profile-editor-fields'
import { formatProbability, JudgeProbabilityBar, JudgeVerdictChip } from './chat-judge-parts'

/** Tools a before-reply item usually steers; any other tool name (or `prefix*`) can be typed. */
const TOOL_SUGGESTIONS = ['save_lore', 'generate_image*', 'generate_nai', 'generate_comfyui*', 'submit_generation_job', 'chat_reply_to', 'view_images', 'read_lore_file']
const TOOL_PATTERN = /^[a-z0-9_]{1,64}\*?$/

/** The verdict an answer gets under the item's current thresholds (so moving them re-reads the test at once). */
export function verdictUnder(item: Pick<ChatJudgeItem, 'yesThreshold' | 'noThreshold'>, probability: number | null) {
  if (probability === null) return null
  return probability >= item.yesThreshold ? 'yes' : probability <= item.noThreshold ? 'no' : 'uncertain'
}

function ToolPatterns({ tools, onChange }: { tools: string[]; onChange: (tools: string[]) => void }) {
  const { t } = useI18n()
  const [typed, setTyped] = useState('')
  const add = (name: string) => {
    const value = name.trim()
    if (!TOOL_PATTERN.test(value) || tools.includes(value)) return
    onChange([...tools, value])
    setTyped('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tools.map((tool) => (
        <Chip key={tool} size="sm" tone="success" className="font-mono">
          {tool}
          <IconButton size="icon-xs" variant="ghost" className="-mr-1 size-4" onClick={() => onChange(tools.filter((entry) => entry !== tool))} label={t({ ko: '빼기', en: 'Remove' })}><X /></IconButton>
        </Chip>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '도구 추가', en: 'Add tool' })}><Plus /></IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          {TOOL_SUGGESTIONS.filter((tool) => !tools.includes(tool)).map((tool) => (
            <DropdownMenuItem key={tool} onSelect={() => add(tool)}><span className="font-mono text-xs">{tool}</span></DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Input
        variant="settings"
        value={typed}
        aria-label={t({ ko: '도구 이름', en: 'Tool name' })}
        placeholder="tool_name*"
        className="h-8 w-36 font-mono text-xs"
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          add(typed)
        }}
      />
    </div>
  )
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
  const rows = turns.flatMap((turn) => {
    const result = turn.items.find((entry) => entry.itemId === item.id)
    return result ? [{ turn, result }] : []
  })
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
 * One judgment item as a hairline row that unfolds in place: name, question, thresholds, what a yes / no does, and
 * the test results for it.
 */
export function ChatJudgeItemRow({ item, open, onToggle, onChange, onRemove, test, testTurns }: {
  item: ChatJudgeItem
  open: boolean
  onToggle: () => void
  onChange: (patch: Partial<ChatJudgeItem>) => void
  onRemove: () => void
  /** The test controls (chat + run), shown inside the open item. */
  test: ReactNode
  testTurns: ChatJudgeTestTurn[] | null
}) {
  const { t } = useI18n()
  const before = item.stage === 'before'
  const uncertainOptions: Array<{ value: ChatJudgeUncertain; label: string }> = [
    { value: 'default', label: t({ ko: '지금 방식대로', en: 'As usual' }) },
    { value: 'yes', label: t({ ko: '예로', en: 'As yes' }) },
    { value: 'no', label: t({ ko: '아니오로', en: 'As no' }) },
    { value: 'llm', label: t({ ko: 'LLM에게 다시', en: 'Ask an LLM' }) },
  ]

  return (
    <div className="border-t border-line first:border-t-0">
      <div className="flex min-h-11 items-center gap-2">
        {/* eslint-disable-next-line no-restricted-syntax -- a full-width disclosure row; Button would pad and centre it */}
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className={cn('shrink-0 font-medium', !item.enabled && 'text-muted-foreground')}>{item.name || t({ ko: '이름 없음', en: 'Untitled' })}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{item.instructions}</span>
        </button>
        <span className="shrink-0 text-xs text-muted-foreground">{before ? t({ ko: '답변 전', en: 'Before' }) : t({ ko: '답변 후', en: 'After' })}</span>
        {before ? (item.tools[0] ? <Chip size="sm" tone="muted" className="font-mono">{item.tools.length > 1 ? `${item.tools[0]} +${item.tools.length - 1}` : item.tools[0]}</Chip> : item.directive ? <Chip size="sm" tone="muted">{t({ ko: '지시문', en: 'Directive' })}</Chip> : null)
          : <Chip size="sm" tone="muted">{t({ ko: '후속', en: 'Follow-up' })}</Chip>}
        <Switch checked={item.enabled} onCheckedChange={(enabled) => onChange({ enabled })} aria-label={t({ ko: '켜기', en: 'Enabled' })} />
      </div>
      {open ? (
        <div className="space-y-4 pb-4 pl-6">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={t({ ko: '이름', en: 'Name' })}>
              <Input variant="settings" value={item.name} maxLength={40} onChange={(event) => onChange({ name: event.target.value })} />
            </Field>
            <Field label={t({ ko: '시점', en: 'When' })}>
              <SegmentedControl
                value={item.stage}
                onChange={(stage) => onChange({ stage: stage as ChatJudgeItem['stage'] })}
                items={[{ value: 'before', label: t({ ko: '답변 전', en: 'Before reply' }) }, { value: 'after', label: t({ ko: '답변 후', en: 'After reply' }) }]}
                fullWidth
                size="sm"
              />
            </Field>
            <Field label={t({ ko: '종류', en: 'Kind' })}>
              <SegmentedControl
                value={item.kind}
                onChange={(kind) => onChange({ kind: kind as ChatJudgeItem['kind'], ...(kind === 'choice' && item.options.length === 0 ? { options: [{ label: 'yes', description: '', yes: true }, { label: 'no', description: '', yes: false }] } : {}) })}
                items={[{ value: 'noul', label: t({ ko: '예/아니오', en: 'Yes/no' }) }, { value: 'choice', label: t({ ko: '선택', en: 'Choice' }) }]}
                fullWidth
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
          <div className="grid items-end gap-3 md:grid-cols-[8rem_minmax(0,1fr)_12rem]">
            <Field label={t({ ko: '대화 범위', en: 'Messages read' })}>
              <NumberStepperInput variant="settings" min={1} max={30} step={1} value={item.window} onValueCommit={(value) => onChange({ window: Number(value) || 1 })} aria-label={t({ ko: '대화 범위', en: 'Messages read' })} />
            </Field>
            <Field label={t({ ko: '기준값', en: 'Thresholds' })}>
              <div className="space-y-1.5 pt-1">
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
            </Field>
            <Field label={t({ ko: '애매할 때', en: 'When unsure' })}>
              <Select variant="settings" value={item.uncertain} onChange={(event) => onChange({ uncertain: event.target.value as ChatJudgeUncertain })}>
                {uncertainOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>
            </Field>
          </div>
          {before ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t({ ko: '예일 때', en: 'On yes' })}>
                <div className="space-y-2">
                  <ToolPatterns tools={item.tools} onChange={(tools) => onChange({ tools })} />
                  <Textarea variant="settings" className={GROW_TEXTAREA} value={item.directive} maxLength={2000} placeholder={t({ ko: '대화 모델에게 붙일 지시문', en: 'Directive for the chat model' })} onChange={(event) => onChange({ directive: event.target.value })} />
                </div>
              </Field>
              <Field label={t({ ko: '아니오일 때', en: 'On no' })}>
                <div className="flex min-h-10 flex-wrap items-center gap-1.5">
                  {item.tools.length > 0
                    ? item.tools.map((tool) => <Chip key={tool} size="sm" tone="muted" className="font-mono line-through">{tool}</Chip>)
                    : <span className="text-xs text-muted-foreground">{t({ ko: '동작 없음', en: 'Nothing' })}</span>}
                </div>
              </Field>
            </div>
          ) : (
            <Field label={t({ ko: '예일 때', en: 'On yes' })}>
              <Chip size="sm" tone="success" className="w-fit">{t({ ko: '후속 메시지 보내기', en: 'Send a follow-up' })}</Chip>
            </Field>
          )}
          <div className="space-y-1 border-t border-line pt-3">
            {test}
            {testTurns ? <ItemTestRows item={item} turns={testTurns} /> : null}
          </div>
          <div className="flex justify-end">
            <IconButton size="icon-sm" variant="destructive" onClick={onRemove} label={t({ ko: '항목 삭제', en: 'Remove item' })}><Trash2 /></IconButton>
          </div>
        </div>
      ) : null}
    </div>
  )
}
