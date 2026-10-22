import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowRightLeft, ArrowUp, Braces, Plus, Trash2 } from 'lucide-react'
import { unknownChatMacros } from '@conai/shared'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { ChatEngine, ChatPromptSection } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { ChatProfileDialogueEditor } from './chat-profile-dialogue'

/** A prompt section id; plain characters only, so it works without a secure context (no crypto.randomUUID). */
export function newPromptSectionId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function newSection(kind: ChatPromptSection['kind']): ChatPromptSection {
  return { id: newPromptSectionId(), title: '', content: '', kind, enabled: true }
}

export function RealConversationDivider() {
  const { t } = useI18n()
  const label = t({ ko: '여기부터 실제 대화', en: 'Actual conversation starts here' })
  return <div role="separator" aria-label={label} className="flex items-center gap-3 py-2"><Separator className="flex-1" /><Text as="span" variant="label">{label}</Text><Separator className="flex-1" /></div>
}

/** One zone edits the full array, swapping only the slots belonging to its kind. */
export function ChatPromptSectionsEditor({ sections, kind, onChange, name, avatar, engine, historyIds = new Set<string>(), children }: {
  sections: ChatPromptSection[]
  kind: ChatPromptSection['kind']
  onChange: (sections: ChatPromptSection[]) => void
  name: string
  avatar: ReactNode
  engine: ChatEngine
  historyIds?: Set<string>
  children?: ReactNode
}) {
  const { t } = useI18n()
  const [openId, setOpenId] = useState<string | null>(null)
  const textareas = useRef(new Map<string, HTMLTextAreaElement>())
  const [warnings, setWarnings] = useState(() => Object.fromEntries(sections.map((section) => [section.id, unknownChatMacros(section.content)])))
  useEffect(() => {
    const timer = setTimeout(() => setWarnings(Object.fromEntries(sections.map((section) => [section.id, unknownChatMacros(section.content)]))), 350)
    return () => clearTimeout(timer)
  }, [sections])
  const update = (id: string, patch: Partial<ChatPromptSection>) => onChange(sections.map((section) => (section.id === id ? { ...section, ...patch } : section)))
  const zone = sections.filter((section) => section.kind === kind)
  const ordered = kind === 'dialogue' ? [...zone.filter((section) => !historyIds.has(section.id)), ...zone.filter((section) => historyIds.has(section.id))] : zone
  const firstHistory = ordered.findIndex((section) => historyIds.has(section.id))
  const move = (section: ChatPromptSection, target: ChatPromptSection) => {
    const next = [...sections]
    const from = sections.indexOf(section)
    const to = sections.indexOf(target)
    ;[next[from], next[to]] = [next[to], next[from]]
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
      {ordered.length > 0 ? (
        <div>
          {ordered.map((section, index) => (
            <Fragment key={section.id}>
            {kind === 'dialogue' && index === firstHistory && index > 0 ? <RealConversationDivider /> : null}
            <CollapsibleRow
              open={openId === section.id}
              onOpenChange={(open) => setOpenId(open ? section.id : null)}
              title={<span className={cn(!section.enabled && 'text-muted-foreground line-through')}>{section.title || untitled}</span>}
              meta={historyIds.has(section.id) ? t({ ko: '미리 넣은 기록', en: 'Seeded history' }) : null}
              actions={(
                <>
                  <IconButton size="icon-sm" variant="ghost" disabled={index === 0 || historyIds.has(section.id) !== historyIds.has(ordered[index - 1]?.id)} onClick={() => move(section, ordered[index - 1])} label={t({ ko: '위로', en: 'Move up' })}><ArrowUp /></IconButton>
                  <IconButton size="icon-sm" variant="ghost" disabled={index === ordered.length - 1 || historyIds.has(section.id) !== historyIds.has(ordered[index + 1]?.id)} onClick={() => move(section, ordered[index + 1])} label={t({ ko: '아래로', en: 'Move down' })}><ArrowDown /></IconButton>
                  {openId === section.id && kind !== 'dialogue' ? <DropdownMenu>
                    <DropdownMenuTrigger asChild><IconButton size="icon-sm" variant="ghost" label={t({ ko: '변수 넣기', en: 'Insert variable' })}><Braces /></IconButton></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                      <DropdownMenuItem onSelect={() => insert(section, '{{char}}')}>{'{{char}}'} {t({ ko: '캐릭터', en: 'Character' })}</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => insert(section, '{{user}}')}>{'{{user}}'} {t({ ko: '사용자', en: 'User' })}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu> : null}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><IconButton size="icon-sm" variant="ghost" label={t({ ko: '다른 구역으로 옮기기', en: 'Move to another zone' })}><ArrowRightLeft /></IconButton></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {kind !== 'text' ? <DropdownMenuItem onSelect={() => update(section.id, { kind: 'text', asHistory: undefined })}>{t({ ko: '1 지시문', en: '1 Instructions' })}</DropdownMenuItem> : null}
                      {kind !== 'dialogue' ? <DropdownMenuItem onSelect={() => update(section.id, { kind: 'dialogue' })}>{t({ ko: '2 대화 예시', en: '2 Example dialogue' })}</DropdownMenuItem> : null}
                      {kind !== 'post' ? <DropdownMenuItem onSelect={() => update(section.id, { kind: 'post', asHistory: undefined })}>{t({ ko: '4 대화 뒤 지시', en: '4 Post-conversation instructions' })}</DropdownMenuItem> : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Switch checked={section.enabled} onCheckedChange={(enabled) => update(section.id, { enabled })} aria-label={t({ ko: '사용', en: 'On' })} />
                  <IconButton size="icon-sm" variant="ghost" onClick={() => onChange(sections.filter((entry) => entry.id !== section.id))} label={t({ ko: '섹션 삭제', en: 'Delete section' })}>
                    <Trash2 />
                  </IconButton>
                </>
              )}
            >
                <Field label={t({ ko: '제목', en: 'Title' })}>
                  <Input variant="settings" value={section.title} maxLength={80} onChange={(event) => update(section.id, { title: event.target.value })} placeholder={t({ ko: '예: 캐릭터, 세계관, 말투', en: 'e.g. Character, World, Tone' })} />
                </Field>
              {kind === 'dialogue' ? <ChatProfileDialogueEditor section={section} name={name} avatar={avatar} engine={engine} history={historyIds.has(section.id)} onChange={(patch) => update(section.id, patch)} /> : (
              <Field label={t({ ko: '내용', en: 'Content' })}>
                <Textarea
                  ref={(element) => { if (element) textareas.current.set(section.id, element); else textareas.current.delete(section.id) }}
                  variant="settings"
                  rows={5}
                  autoGrow
                  value={section.content}
                  onChange={(event) => update(section.id, { content: event.target.value })}
                  onBlur={() => setWarnings((current) => ({ ...current, [section.id]: unknownChatMacros(section.content) }))}
                />
              </Field>
              )}
              {warnings[section.id]?.length ? <p className="text-xs text-warning">{t({ ko: '⚠ 모르는 변수 {variables}', en: '⚠ Unknown variables {variables}' }, { variables: warnings[section.id].join(', ') })}</p> : null}
            </CollapsibleRow>
            </Fragment>
          ))}
        </div>
      ) : null}
      {children}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const section = newSection(kind)
          onChange([...sections, section])
          setOpenId(section.id)
        }}
      >
        <Plus />
        {kind === 'dialogue' ? t({ ko: '대화 예시 묶음 추가', en: 'Add example dialogue section' }) : kind === 'post' ? t({ ko: '대화 뒤 지시 추가', en: 'Add post-conversation instructions' }) : t({ ko: '섹션 추가', en: 'Add section' })}
      </Button>
    </div>
  )
}
