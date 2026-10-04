import { useId, useState } from 'react'
import { BookPlus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { ChatLoreEntry } from '@/lib/api-codex-chat'
import { CollapsibleRow } from './chat-profile-sections'

function LoreFields({ entry, onChange }: { entry: ChatLoreEntry; onChange: (patch: Partial<ChatLoreEntry>) => void }) {
  const { t } = useI18n()
  const id = useId()
  const [keyword, setKeyword] = useState('')
  const addKey = () => {
    const key = keyword.trim().slice(0, 100)
    if (key && entry.keys.length < 20 && !entry.keys.includes(key)) onChange({ keys: [...entry.keys, key] })
    setKeyword('')
  }
  return <>
    <Field label={t({ ko: '키워드', en: 'Keywords' })}>
      <div className="flex flex-wrap items-center gap-1.5">
        {entry.keys.map((key) => <Chip key={key}>{key}<IconButton size="icon-xs" variant="ghost" label={t({ ko: '키워드 삭제', en: 'Remove keyword' })} onClick={() => onChange({ keys: entry.keys.filter((value) => value !== key) })}><X /></IconButton></Chip>)}
        <Input variant="settings" className="min-w-32 flex-1" maxLength={100} value={keyword} onChange={(event) => setKeyword(event.target.value)} onBlur={addKey} onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addKey() }
        }} aria-label={t({ ko: '키워드 추가', en: 'Add keyword' })} />
      </div>
    </Field>
    <Field label={t({ ko: '내용', en: 'Content' })}>
      <Textarea variant="settings" rows={5} value={entry.content} maxLength={20000} onChange={(event) => onChange({ content: event.target.value })} />
    </Field>
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
      <div className="flex items-center gap-2"><Switch id={`${id}-constant`} checked={entry.constant} onCheckedChange={(constant) => onChange({ constant })} /><label htmlFor={`${id}-constant`} className="cursor-pointer">{t({ ko: '항상 넣기', en: 'Always include' })}</label></div>
      <div className="flex items-center gap-2"><Switch id={`${id}-case`} checked={entry.caseSensitive} onCheckedChange={(caseSensitive) => onChange({ caseSensitive })} /><label htmlFor={`${id}-case`} className="cursor-pointer">{t({ ko: '대소문자 구분', en: 'Case sensitive' })}</label></div>
      <Field label={t({ ko: '순서', en: 'Order' })} className="w-28"><NumberStepperInput variant="settings" min={-10000} max={10000} value={entry.order} onValueCommit={(value) => onChange({ order: Number(value) || 0 })} /></Field>
    </div>
  </>
}

export function ChatLorebookEditor({ entries, onChange }: { entries: ChatLoreEntry[]; onChange: (entries: ChatLoreEntry[]) => void }) {
  const { t } = useI18n()
  const [openId, setOpenId] = useState<string | null>(null)
  const update = (id: string, patch: Partial<ChatLoreEntry>) => onChange(entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry))
  return <div className="space-y-2">
    {entries.map((entry) => <CollapsibleRow key={entry.id} title={entry.keys.join(', ') || entry.content.slice(0, 40) || t({ ko: '새 설정', en: 'New entry' })} meta={entry.constant ? t({ ko: '항상', en: 'Always' }) : undefined} open={openId === entry.id} onOpenChange={(open) => setOpenId(open ? entry.id : null)} actions={<>
      <Switch checked={entry.enabled} onCheckedChange={(enabled) => update(entry.id, { enabled })} aria-label={t({ ko: '로어 사용', en: 'Enable lore' })} />
      <IconButton size="icon-sm" variant="ghost" label={t({ ko: '로어 삭제', en: 'Delete lore' })} onClick={() => onChange(entries.filter((item) => item.id !== entry.id))}><Trash2 /></IconButton>
    </>}><LoreFields entry={entry} onChange={(patch) => update(entry.id, patch)} /></CollapsibleRow>)}
    <Button variant="secondary" size="sm" disabled={entries.length >= 100} onClick={() => {
      const entry: ChatLoreEntry = { id: crypto.randomUUID(), keys: [], content: '', enabled: true, constant: false, order: entries.length, caseSensitive: false }
      onChange([...entries, entry]); setOpenId(entry.id)
    }}><BookPlus />{t({ ko: '설정 추가', en: 'Add entry' })}</Button>
  </div>
}
