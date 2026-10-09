import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Braces, Plus, Trash2 } from 'lucide-react'
import { unknownChatMacros } from '@conai/shared'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { ChatPromptSection } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { GROW_TEXTAREA } from './chat-profile-editor-fields'

function newSection(): ChatPromptSection {
  return { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: '', content: '', kind: 'text', enabled: true }
}

/** User-defined prompt blocks (title + content), folded so a long character card stays readable. */
export function ChatPromptSectionsEditor({ sections, onChange }: { sections: ChatPromptSection[]; onChange: (sections: ChatPromptSection[]) => void }) {
  const { t } = useI18n()
  const [openId, setOpenId] = useState<string | null>(null)
  const textareas = useRef(new Map<string, HTMLTextAreaElement>())
  const [warnings, setWarnings] = useState(() => Object.fromEntries(sections.map((section) => [section.id, unknownChatMacros(section.content)])))
  useEffect(() => {
    const timer = setTimeout(() => setWarnings(Object.fromEntries(sections.map((section) => [section.id, unknownChatMacros(section.content)]))), 350)
    return () => clearTimeout(timer)
  }, [sections])
  const update = (id: string, patch: Partial<ChatPromptSection>) => onChange(sections.map((section) => (section.id === id ? { ...section, ...patch } : section)))
  const move = (index: number, offset: number) => {
    const next = [...sections]
    ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
    onChange(next)
  }
  const insert = (section: ChatPromptSection, macro: string) => {
    const textarea = textareas.current.get(section.id)
    const start = textarea?.selectionStart ?? section.content.length
    const end = textarea?.selectionEnd ?? start
    update(section.id, { content: section.content.slice(0, start) + macro + section.content.slice(end) })
    setTimeout(() => { textarea?.focus(); textarea?.setSelectionRange(start + macro.length, start + macro.length) }, 0)
  }
  const untitled = t({ ko: '제목 없음', en: 'Untitled' })

  return (
    <div className="space-y-2">
      {sections.length > 0 ? (
        <div>
          {sections.map((section, index) => (
            <CollapsibleRow
              key={section.id}
              open={openId === section.id}
              onOpenChange={(open) => setOpenId(open ? section.id : null)}
              title={<span className={cn(!section.enabled && 'text-muted-foreground line-through')}>{section.title || untitled}</span>}
              meta={section.kind === 'dialogue' ? t({ ko: '대화 예시', en: 'Example dialogue' }) : section.kind === 'post' ? t({ ko: '대화 뒤 지시', en: 'After the conversation' }) : null}
              actions={(
                <>
                  <IconButton size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => move(index, -1)} label={t({ ko: '위로', en: 'Move up' })}><ArrowUp /></IconButton>
                  <IconButton size="icon-sm" variant="ghost" disabled={index === sections.length - 1} onClick={() => move(index, 1)} label={t({ ko: '아래로', en: 'Move down' })}><ArrowDown /></IconButton>
                  {openId === section.id ? <DropdownMenu>
                    <DropdownMenuTrigger asChild><IconButton size="icon-sm" variant="ghost" label={t({ ko: '변수 넣기', en: 'Insert variable' })}><Braces /></IconButton></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                      <DropdownMenuItem onSelect={() => insert(section, '{{char}}')}>{'{{char}}'} {t({ ko: '캐릭터', en: 'Character' })}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => insert(section, '{{user}}')}>{'{{user}}'} {t({ ko: '사용자', en: 'User' })}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu> : null}
                  <Switch checked={section.enabled} onCheckedChange={(enabled) => update(section.id, { enabled })} aria-label={t({ ko: '사용', en: 'On' })} />
                  <IconButton size="icon-sm" variant="ghost" onClick={() => onChange(sections.filter((entry) => entry.id !== section.id))} label={t({ ko: '섹션 삭제', en: 'Delete section' })}>
                    <Trash2 />
                  </IconButton>
                </>
              )}
            >
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
                <Field label={t({ ko: '제목', en: 'Title' })}>
                  <Input variant="settings" value={section.title} maxLength={80} onChange={(event) => update(section.id, { title: event.target.value })} placeholder={t({ ko: '예: 캐릭터, 세계관, 말투', en: 'e.g. Character, World, Tone' })} />
                </Field>
                <Field label={t({ ko: '형식', en: 'Kind' })}>
                  <Select variant="settings" value={section.kind} onChange={(event) => update(section.id, { kind: event.target.value === 'dialogue' || event.target.value === 'post' ? event.target.value : 'text' })}>
                    <option value="text">{t({ ko: '일반 텍스트', en: 'Text' })}</option>
                    <option value="dialogue">{t({ ko: '대화 예시', en: 'Example dialogue' })}</option>
                    <option value="post">{t({ ko: '대화 뒤 지시', en: 'After the conversation' })}</option>
                  </Select>
                </Field>
              </div>
              <Field label={t({ ko: '내용', en: 'Content' })}>
                <Textarea
                  ref={(element) => { if (element) textareas.current.set(section.id, element); else textareas.current.delete(section.id) }}
                  variant="settings"
                  rows={section.kind === 'dialogue' ? 6 : 5}
                  className={GROW_TEXTAREA}
                  value={section.content}
                  onChange={(event) => update(section.id, { content: event.target.value })}
                  onBlur={() => setWarnings((current) => ({ ...current, [section.id]: unknownChatMacros(section.content) }))}
                  placeholder={section.kind === 'dialogue' ? '사용자: 오늘 뭐 그릴까?\n{{char}}: 노을 지는 바닷가 어때?' : undefined}
                />
                {warnings[section.id]?.length ? <p className="text-xs text-yellow-500">{t({ ko: '⚠ 모르는 변수 {variables}', en: '⚠ Unknown variables {variables}' }, { variables: warnings[section.id].join(', ') })}</p> : null}
              </Field>
            </CollapsibleRow>
          ))}
        </div>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          const section = newSection()
          onChange([...sections, section])
          setOpenId(section.id)
        }}
      >
        <Plus />
        {t({ ko: '섹션 추가', en: 'Add section' })}
      </Button>
    </div>
  )
}
