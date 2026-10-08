import { Fragment, useState } from 'react'
import { MessageCircle, Plus, Trash2, X } from 'lucide-react'
import { chatBlockToneText } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ChatDisplayBlockView, parseBlockPayload } from '@/features/codex-chat/chat-display-block'
import { useI18n } from '@/i18n'
import type { ChatBlockField, ChatDisplayBlock } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { CollapsibleRow } from './chat-profile-sections'

export const BLOCK_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/

/** A status card to start from: shows each slot kind (value, bar width, list, condition). */
export function starterBlock(): ChatDisplayBlock {
  return {
    id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    key: 'status',
    instruction: '장면이 바뀌거나 상태가 변할 때 답변 끝에 바뀐 값만 써.',
    example: JSON.stringify({ name: '{{char}}', place: '작업실', mood: '설렘', hp: 80, items: ['스케치북', '연필'] }, null, 2),
    rules: 'items는 실제로 얻거나 잃은 것만 바꿔.',
    summary: '{{place}} · HP {{hp}} · {{mood}}',
    fields: [
      { name: 'hp', min: 0, max: 100, step: 20, values: [], readonly: false },
      { name: 'name', min: null, max: null, step: null, values: [], readonly: true },
    ],
    template: [
      '<div class="card">',
      '  <div class="head"><b>{{name}}</b><span class="tag">{{place}}</span></div>',
      '  <div class="bar"><i style="width: {{hp}}%"></i></div>',
      '  <div class="meta">HP {{hp}} · {{mood}}</div>',
      '  {{#if items}}<ul>{{#each items}}<li>{{.}}</li>{{/each}}</ul>{{/if}}',
      '</div>',
    ].join('\n'),
    css: [
      '.card { border: 1px solid rgba(255,255,255,.14); border-radius: 12px; padding: 10px 12px; background: rgba(0,0,0,.28); font-size: .9em; }',
      '.head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }',
      '.tag { font-size: .8em; opacity: .75; }',
      '.bar { height: 6px; margin: 8px 0 4px; border-radius: 99px; background: rgba(255,255,255,.12); overflow: hidden; }',
      '.bar i { display: block; height: 100%; background: linear-gradient(90deg, #f6a5c0, #f7d46b); }',
      '.meta { font-size: .8em; opacity: .8; }',
      'ul { margin: 6px 0 0; padding-left: 18px; font-size: .85em; }',
    ].join('\n'),
    enabled: true,
  }
}

const EMPTY_RULE: Omit<ChatBlockField, 'name'> = { min: null, max: null, step: null, values: [], readonly: false }

/** One row of the field table: the field's name, its starting value (as typed) and the rule the server enforces. */
type FieldRow = { id: string; name: string; start: string } & Omit<ChatBlockField, 'name'>

function rowId() {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** A starting value as it is typed: strings bare, everything else as JSON. */
function startText(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** What was typed, back to a value: JSON when it parses (numbers, lists, true/false/null), else the text itself. */
function startValue(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return text
  }
}

/** The table rows a block's example values and field rules make together (every name appears once). */
function rowsOf(block: ChatDisplayBlock): FieldRow[] | null {
  const data = block.example.trim() ? parseBlockPayload(block.example) : {}
  if (!data) return null
  const rules = new Map(block.fields.map((field) => [field.name, field]))
  const rows: FieldRow[] = Object.entries(data).map(([name, value]) => ({ id: rowId(), name, start: startText(value), ...(rules.get(name) ?? EMPTY_RULE) }))
  for (const field of block.fields) {
    if (!field.name || data[field.name] !== undefined) continue
    rows.push({ id: rowId(), ...field, start: '' })
  }
  return rows
}

/** The rows back to the block: example JSON of the starting values, and a rule for every named field. */
function blockOf(rows: FieldRow[]): Pick<ChatDisplayBlock, 'example' | 'fields'> {
  const named = rows.filter((row) => row.name.trim())
  return {
    example: JSON.stringify(Object.fromEntries(named.map((row) => [row.name.trim(), startValue(row.start)])), null, 2),
    fields: named.map((row) => ({ name: row.name.trim(), min: row.min, max: row.max, step: row.step, values: row.values, readonly: row.readonly, ...(row.tone ? { tone: row.tone } : {}) })),
  }
}

function numberOrNull(text: string): number | null {
  const trimmed = text.trim()
  return trimmed === '' || !Number.isFinite(Number(trimmed)) ? null : Number(trimmed)
}

/**
 * Fields, once: name, starting value and the rules the server enforces on the model's updates (range, step per
 * reply, allowed values, read-only). The block's example JSON and field rules are both written from this table.
 */
function BlockFieldsTable({ rows, onChange }: { rows: FieldRow[]; onChange: (rows: FieldRow[]) => void }) {
  const { t } = useI18n()
  const [toneOpen, setToneOpen] = useState<string | null>(null)
  const update = (id: string, patch: Partial<FieldRow>) => onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  const head = 'text-2xs font-semibold text-muted-foreground'
  const names = rows.map((row) => row.name.trim())
  return (
    <div className="space-y-1.5">
      {rows.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_3.5rem_3.5rem_3.5rem_minmax(0,1.2fr)_auto_auto_auto] items-center gap-x-2 gap-y-1.5">
          <span className={head}>{t({ ko: '필드', en: 'Field' })}</span>
          <span className={head}>{t({ ko: '시작 값', en: 'Start' })}</span>
          <span className={head}>{t({ ko: '최소', en: 'Min' })}</span>
          <span className={head}>{t({ ko: '최대', en: 'Max' })}</span>
          <span className={head}>{t({ ko: '턴당', en: 'Per turn' })}</span>
          <span className={head}>{t({ ko: '허용 값 (쉼표)', en: 'Allowed (comma)' })}</span>
          <span />
          <span className={head}>{t({ ko: '고정', en: 'Fixed' })}</span>
          <span />
          {rows.map((row, index) => {
            const duplicate = row.name.trim() !== '' && names.indexOf(row.name.trim()) !== index
            const count = Array.isArray(row.tone) ? row.tone.filter((range) => range.text.trim()).length : Object.values(row.tone ?? {}).filter((text) => text.trim()).length
            return (
              <Fragment key={row.id}>
                <Input variant="settings" value={row.name} maxLength={60} className={cn('font-mono', duplicate && 'border-destructive')} aria-invalid={duplicate} aria-label={t({ ko: '필드', en: 'Field' })} onChange={(event) => update(row.id, { name: event.target.value })} />
                <Input variant="settings" value={row.start} className="font-mono" aria-label={t({ ko: '시작 값', en: 'Start value' })} onChange={(event) => update(row.id, { start: event.target.value })} />
                <Input variant="settings" inputMode="decimal" value={row.min ?? ''} disabled={row.readonly} aria-label={t({ ko: '최소', en: 'Min' })} onChange={(event) => update(row.id, { min: numberOrNull(event.target.value) })} />
                <Input variant="settings" inputMode="decimal" value={row.max ?? ''} disabled={row.readonly} aria-label={t({ ko: '최대', en: 'Max' })} onChange={(event) => update(row.id, { max: numberOrNull(event.target.value) })} />
                <Input variant="settings" inputMode="decimal" value={row.step ?? ''} disabled={row.readonly} aria-label={t({ ko: '턴당 변화', en: 'Per turn' })} onChange={(event) => update(row.id, { step: numberOrNull(event.target.value) })} />
                <Input variant="settings" value={row.values.join(', ')} disabled={row.readonly} aria-label={t({ ko: '허용 값', en: 'Allowed values' })} onChange={(event) => update(row.id, { values: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} />
                <IconButton size="icon-sm" variant="ghost" className={cn('relative', count > 0 && 'text-primary')} disabled={row.values.length === 0 && row.min === null && row.max === null && typeof startValue(row.start) !== 'number' && !Array.isArray(row.tone)} aria-expanded={toneOpen === row.id} label={t({ ko: '말투', en: 'Tone' })} onClick={() => setToneOpen(toneOpen === row.id ? null : row.id)}><MessageCircle />{count > 0 ? <span className="absolute -top-1 -right-1 text-2xs">{count}</span> : null}</IconButton>
                <Switch checked={row.readonly} onCheckedChange={(readonly) => update(row.id, { readonly })} aria-label={t({ ko: '고정', en: 'Fixed' })} />
                <IconButton size="icon-sm" variant="ghost" onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))} label={t({ ko: '필드 삭제', en: 'Delete field' })}><Trash2 /></IconButton>
                {toneOpen === row.id ? <div className="col-span-9 ml-1 space-y-1 border-l border-primary/60 py-1 pl-3">
                  {row.values.length > 0 ? row.values.map((value) => <div key={value} className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-2">
                    <span className="truncate text-xs">{value}</span>
                    <Input variant="settings" value={!Array.isArray(row.tone) ? row.tone?.[value] ?? '' : ''} maxLength={2000} aria-label={t({ ko: '{value} 말투', en: '{value} tone' }, { value })} onChange={(event) => update(row.id, { tone: { ...(!Array.isArray(row.tone) ? row.tone : {}), [value]: event.target.value } })} />
                  </div>) : <>
                    {(Array.isArray(row.tone) ? row.tone : []).map((range, rangeIndex) => <div key={rangeIndex} className="grid grid-cols-[4rem_auto_4rem_minmax(0,1fr)_auto] items-center gap-2">
                      <Input variant="settings" type="number" value={range.min} aria-label={t({ ko: '구간 최소', en: 'Range min' })} onChange={(event) => update(row.id, { tone: (Array.isArray(row.tone) ? row.tone : []).map((item, index) => index === rangeIndex ? { ...item, min: Number(event.target.value) } : item) })} />
                      <span className="text-xs text-muted-foreground">–</span>
                      <Input variant="settings" type="number" value={range.max} aria-label={t({ ko: '구간 최대', en: 'Range max' })} onChange={(event) => update(row.id, { tone: (Array.isArray(row.tone) ? row.tone : []).map((item, index) => index === rangeIndex ? { ...item, max: Number(event.target.value) } : item) })} />
                      <Input variant="settings" value={range.text} maxLength={2000} aria-label={t({ ko: '말투 지시', en: 'Tone instruction' })} onChange={(event) => update(row.id, { tone: (Array.isArray(row.tone) ? row.tone : []).map((item, index) => index === rangeIndex ? { ...item, text: event.target.value } : item) })} />
                      <IconButton size="icon-xs" variant="ghost" label={t({ ko: '구간 삭제', en: 'Delete range' })} onClick={() => update(row.id, { tone: (Array.isArray(row.tone) ? row.tone : []).filter((_, index) => index !== rangeIndex) })}><X /></IconButton>
                    </div>)}
                    <Button size="xs" variant="ghost" disabled={Array.isArray(row.tone) && row.tone.length >= 40} onClick={() => update(row.id, { tone: [...(Array.isArray(row.tone) ? row.tone : []), { min: row.min ?? 0, max: row.max ?? 30, text: '' }] })}><Plus />{t({ ko: '구간', en: 'Range' })}</Button>
                  </>}
                </div> : null}
              </Fragment>
            )
          })}
        </div>
      ) : null}
      <Button variant="ghost" size="xs" onClick={() => onChange([...rows, { id: rowId(), name: '', start: '', ...EMPTY_RULE }])}><Plus />{t({ ko: '필드 추가', en: 'Add field' })}</Button>
    </div>
  )
}

function BlockPreview({ block }: { block: ChatDisplayBlock }) {
  const { t } = useI18n()
  const data = parseBlockPayload(block.example.trim() || '{}')
  if (!data) {
    return <p className="text-xs text-destructive">{t({ ko: '시작 값이 올바른 JSON이 아니야.', en: 'The starting values are not valid JSON.' })}</p>
  }
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-dashed border-line px-3 py-1"><ChatDisplayBlockView block={block} data={data} /></div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">{t({ ko: '모델에 가는 모양', en: 'Sent to the model' })}</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words font-mono">{`${block.key}: ${JSON.stringify(data)}\n말투: ${chatBlockToneText(block.fields, data) || '—'}`}</pre>
      </details>
    </div>
  )
}

/**
 * One shared display block: the fence name the model writes, when to use it, the fields (one table for starting
 * values and server-enforced rules), the update rules, and a folded design section (summary line, HTML template,
 * CSS) that is optional: without a template the chat shows the fields as a plain list. Mount with `key={block.id}`
 * so the field table restarts when another block is opened.
 */
export function ChatBlockEditor({ block, onChange }: { block: ChatDisplayBlock; onChange: (block: ChatDisplayBlock) => void }) {
  const { t } = useI18n()
  const [rows, setRows] = useState<FieldRow[] | null>(() => rowsOf(block))
  const update = (patch: Partial<ChatDisplayBlock>) => onChange({ ...block, ...patch })
  const changeRows = (next: FieldRow[]) => {
    setRows(next)
    update(blockOf(next))
  }
  const keyInvalid = !BLOCK_KEY_PATTERN.test(block.key)
  const designed = Boolean(block.summary.trim() || block.template.trim() || block.css.trim())

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label={t({ ko: '이름 (```이름)', en: 'Name (```name)' })}>
          <Input
            variant="settings"
            value={block.key}
            maxLength={32}
            aria-invalid={keyInvalid}
            className={cn('font-mono', keyInvalid && 'border-destructive')}
            onChange={(event) => update({ key: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
          />
        </Field>
        <Field label={t({ ko: '언제 쓰는지', en: 'When to use' })}>
          <Input variant="settings" value={block.instruction} maxLength={2000} onChange={(event) => update({ instruction: event.target.value })} />
        </Field>
      </div>
      {rows ? (
        <Field label={t({ ko: '필드', en: 'Fields' })} info={t({ ko: '시작 값은 글자 그대로, 숫자·목록은 JSON으로 적어.', en: 'Start: text as is, numbers and lists as JSON.' })}>
          <BlockFieldsTable rows={rows} onChange={changeRows} />
        </Field>
      ) : (
        <Field label={t({ ko: '시작 값 (JSON)', en: 'Starting values (JSON)' })} info={t({ ko: 'JSON 객체로 고치면 표로 바뀌어.', en: 'Becomes a table once it is a JSON object.' })}>
          <Textarea variant="settings" rows={5} className="font-mono text-xs" value={block.example} onChange={(event) => {
            update({ example: event.target.value })
            const next = rowsOf({ ...block, example: event.target.value })
            if (next) setRows(next)
          }} />
        </Field>
      )}
      <Field label={t({ ko: '갱신 규칙', en: 'Update rules' })}>
        <Input variant="settings" value={block.rules} maxLength={2000} onChange={(event) => update({ rules: event.target.value })} />
      </Field>
      <div className="border-t border-line">
        <CollapsibleRow title={t({ ko: '디자인', en: 'Design' })} info={t({ ko: '비우면 필드 목록으로 보여.', en: 'Empty shows the fields as a list.' })} defaultOpen={designed}>
          <Field label={t({ ko: '한 줄 요약 (접힌 상태창)', en: 'One-line summary (folded panel)' })}>
            <Input variant="settings" value={block.summary} maxLength={300} className="font-mono" onChange={(event) => update({ summary: event.target.value })} />
          </Field>
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label={t({ ko: 'HTML 템플릿', en: 'HTML template' })}>
              <Textarea variant="settings" rows={9} className="font-mono text-xs" value={block.template} onChange={(event) => update({ template: event.target.value })} />
            </Field>
            <Field label="CSS">
              <Textarea variant="settings" rows={9} className="font-mono text-xs" value={block.css} onChange={(event) => update({ css: event.target.value })} />
            </Field>
          </div>
        </CollapsibleRow>
      </div>
      <BlockPreview block={block} />
    </div>
  )
}
