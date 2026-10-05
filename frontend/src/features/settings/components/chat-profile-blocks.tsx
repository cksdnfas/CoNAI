import { Fragment, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
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

const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/

/** A status card to start from: shows each slot kind (value, bar width, list, condition). */
function starterBlock(existingKeys: string[]): ChatDisplayBlock {
  let key = 'status'
  for (let index = 2; existingKeys.includes(key); index += 1) key = `status${index}`
  return {
    id: `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    key,
    instruction: '장면이 바뀌거나 상태가 변할 때 답변 끝에 바뀐 값만 써.',
    example: JSON.stringify({ name: '캐릭터', place: '작업실', mood: '설렘', hp: 80, items: ['스케치북', '연필'] }, null, 2),
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

const EMPTY_FIELD: ChatBlockField = { name: '', min: null, max: null, step: null, values: [], readonly: false }

function numberOrNull(text: string): number | null {
  const trimmed = text.trim()
  return trimmed === '' || !Number.isFinite(Number(trimmed)) ? null : Number(trimmed)
}

/** Per-field rules the server enforces on the model's updates: range, step per reply, allowed values, read-only. */
function BlockFieldsEditor({ fields, onChange }: { fields: ChatBlockField[]; onChange: (fields: ChatBlockField[]) => void }) {
  const { t } = useI18n()
  const update = (index: number, patch: Partial<ChatBlockField>) => onChange(fields.map((field, at) => (at === index ? { ...field, ...patch } : field)))
  const head = 'text-2xs font-semibold text-muted-foreground'
  return (
    <div className="space-y-1.5">
      {fields.length > 0 ? (
        <div className="grid grid-cols-[minmax(0,1.2fr)_4rem_4rem_4rem_minmax(0,1.6fr)_auto_auto] items-center gap-x-2 gap-y-1.5">
          <span className={head}>{t({ ko: '필드', en: 'Field' })}</span>
          <span className={head}>{t({ ko: '최소', en: 'Min' })}</span>
          <span className={head}>{t({ ko: '최대', en: 'Max' })}</span>
          <span className={head}>{t({ ko: '턴당', en: 'Per turn' })}</span>
          <span className={head}>{t({ ko: '허용 값 (쉼표)', en: 'Allowed values (comma)' })}</span>
          <span className={head}>{t({ ko: '고정', en: 'Fixed' })}</span>
          <span />
          {fields.map((field, index) => (
            <Fragment key={index}>
              <Input variant="settings" value={field.name} maxLength={60} className="font-mono" aria-label={t({ ko: '필드', en: 'Field' })} onChange={(event) => update(index, { name: event.target.value })} />
              <Input variant="settings" inputMode="decimal" value={field.min ?? ''} disabled={field.readonly} aria-label={t({ ko: '최소', en: 'Min' })} onChange={(event) => update(index, { min: numberOrNull(event.target.value) })} />
              <Input variant="settings" inputMode="decimal" value={field.max ?? ''} disabled={field.readonly} aria-label={t({ ko: '최대', en: 'Max' })} onChange={(event) => update(index, { max: numberOrNull(event.target.value) })} />
              <Input variant="settings" inputMode="decimal" value={field.step ?? ''} disabled={field.readonly} aria-label={t({ ko: '턴당 변화', en: 'Per turn' })} onChange={(event) => update(index, { step: numberOrNull(event.target.value) })} />
              <Input variant="settings" value={field.values.join(', ')} disabled={field.readonly} aria-label={t({ ko: '허용 값', en: 'Allowed values' })} onChange={(event) => update(index, { values: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} />
              <Switch checked={field.readonly} onCheckedChange={(readonly) => update(index, { readonly })} aria-label={t({ ko: '고정', en: 'Fixed' })} />
              <IconButton size="icon-sm" variant="ghost" onClick={() => onChange(fields.filter((_entry, at) => at !== index))} label={t({ ko: '규칙 삭제', en: 'Delete rule' })}><Trash2 /></IconButton>
            </Fragment>
          ))}
        </div>
      ) : null}
      <Button variant="ghost" size="xs" onClick={() => onChange([...fields, EMPTY_FIELD])}><Plus />{t({ ko: '필드 규칙 추가', en: 'Add field rule' })}</Button>
    </div>
  )
}

function BlockPreview({ block, characterName }: { block: ChatDisplayBlock; characterName: string }) {
  const { t } = useI18n()
  const data = parseBlockPayload(block.example.replaceAll('{{char}}', characterName || '{{char}}'))
  if (!block.template.trim()) return null
  if (!data) {
    return <p className="text-xs text-destructive">{t({ ko: '예시 값이 올바른 JSON이 아니야.', en: 'The example values are not valid JSON.' })}</p>
  }
  return (
    <div className="rounded-md border border-dashed border-line px-3 py-1">
      <ChatDisplayBlockView block={block} data={data} />
    </div>
  )
}

/** Display blocks of a profile: name the model writes, when to use it, example values, HTML template and CSS. */
export function ChatDisplayBlocksEditor({ blocks, characterName, onChange }: { blocks: ChatDisplayBlock[]; characterName: string; onChange: (blocks: ChatDisplayBlock[]) => void }) {
  const { t } = useI18n()
  const [openId, setOpenId] = useState<string | null>(null)
  const update = (id: string, patch: Partial<ChatDisplayBlock>) => onChange(blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)))
  const keyCount = (key: string) => blocks.filter((block) => block.key === key).length

  return (
    <div className="space-y-2">
      {blocks.length > 0 ? (
        <div>
          {blocks.map((block) => {
            const keyInvalid = !KEY_PATTERN.test(block.key) || keyCount(block.key) > 1
            return (
              <CollapsibleRow
                key={block.id}
                open={openId === block.id}
                onOpenChange={(open) => setOpenId(open ? block.id : null)}
                title={<span className={cn('font-mono', !block.enabled && 'text-muted-foreground line-through')}>{block.key || t({ ko: '이름 없음', en: 'Unnamed' })}</span>}
                meta={block.instruction ? <span className="block max-w-80 truncate">{block.instruction}</span> : null}
                actions={(
                  <>
                    <Switch checked={block.enabled} onCheckedChange={(enabled) => update(block.id, { enabled })} aria-label={t({ ko: '사용', en: 'On' })} />
                    <IconButton size="icon-sm" variant="ghost" onClick={() => onChange(blocks.filter((entry) => entry.id !== block.id))} label={t({ ko: '블록 삭제', en: 'Delete block' })}>
                      <Trash2 />
                    </IconButton>
                  </>
                )}
              >
                <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
                  <Field label={t({ ko: '이름 (```이름)', en: 'Name (```name)' })}>
                    <Input
                      variant="settings"
                      value={block.key}
                      maxLength={32}
                      aria-invalid={keyInvalid}
                      className={cn('font-mono', keyInvalid && 'border-destructive')}
                      onChange={(event) => update(block.id, { key: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                    />
                  </Field>
                  <Field label={t({ ko: '언제 쓰는지', en: 'When to use' })}>
                    <Input variant="settings" value={block.instruction} maxLength={2000} onChange={(event) => update(block.id, { instruction: event.target.value })} />
                  </Field>
                </div>
                <Field label={t({ ko: '시작 값 (JSON)', en: 'Starting values (JSON)' })}>
                  <Textarea variant="settings" rows={5} className="font-mono text-xs" value={block.example} onChange={(event) => update(block.id, { example: event.target.value })} />
                </Field>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
                  <Field label={t({ ko: '갱신 규칙', en: 'Update rules' })}>
                    <Input variant="settings" value={block.rules} maxLength={2000} onChange={(event) => update(block.id, { rules: event.target.value })} />
                  </Field>
                  <Field label={t({ ko: '한 줄 요약 (접힌 상태창)', en: 'One-line summary (folded panel)' })}>
                    <Input variant="settings" value={block.summary} maxLength={300} className="font-mono" onChange={(event) => update(block.id, { summary: event.target.value })} />
                  </Field>
                </div>
                <Field label={t({ ko: '필드 규칙 (서버가 강제)', en: 'Field rules (enforced by the server)' })}>
                  <BlockFieldsEditor fields={block.fields} onChange={(fields) => update(block.id, { fields })} />
                </Field>
                <div className="grid gap-3 lg:grid-cols-2">
                  <Field label={t({ ko: 'HTML 템플릿', en: 'HTML template' })}>
                    <Textarea variant="settings" rows={9} className="font-mono text-xs" value={block.template} onChange={(event) => update(block.id, { template: event.target.value })} />
                  </Field>
                  <Field label="CSS">
                    <Textarea variant="settings" rows={9} className="font-mono text-xs" value={block.css} onChange={(event) => update(block.id, { css: event.target.value })} />
                  </Field>
                </div>
                <BlockPreview block={block} characterName={characterName} />
              </CollapsibleRow>
            )
          })}
        </div>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          const block = starterBlock(blocks.map((entry) => entry.key))
          onChange([...blocks, block])
          setOpenId(block.id)
        }}
      >
        <Plus />
        {t({ ko: '표시 블록 추가', en: 'Add display block' })}
      </Button>
    </div>
  )
}
