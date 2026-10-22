import { useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Braces, Plus, Trash2 } from 'lucide-react'
import { bothSidesSpeak, joinExampleDialogue, splitExampleDialogue, type ExampleDialogueTurn } from '@conai/shared'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { SwitchLine } from '@/components/ui/switch-line'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { ChatEngine, ChatPromptSection } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'

/** The same character identity is used for examples and the saved first greeting. */
export function PromptCharacterBubble({ avatar, name, badge, children, onClick, muted = false }: {
  avatar: ReactNode
  name: string
  badge: ReactNode
  children: ReactNode
  onClick: () => void
  muted?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={cn('shrink-0', muted && 'rounded-full border border-dashed border-line opacity-50')}>{avatar}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{name}</span>
          {badge}
        </div>
        <div className={cn('w-fit max-w-full overflow-hidden rounded-lg', muted ? 'border border-dashed border-line text-muted-foreground' : 'bg-surface-high')}>
          <Button variant="ghost" size="content" onClick={onClick} className="max-w-full">
            <span className={cn('whitespace-pre-wrap break-words text-left text-sm', muted ? 'text-muted-foreground' : 'text-foreground')}>{children}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

/** An open bubble edits a snapshot of the turns, so a speaker label typed into it cannot re-split them mid-edit. */
type OpenTurn = { turns: ExampleDialogueTurn[]; index: number; written: string }

/** Text remains the source of truth; every bubble edit goes through the shared card reader/writer. */
export function ChatProfileDialogueEditor({ section, name, avatar, engine, history, onChange }: {
  section: ChatPromptSection
  name: string
  avatar: ReactNode
  engine: ChatEngine
  history: boolean
  onChange: (patch: Partial<ChatPromptSection>) => void
}) {
  const { t } = useI18n()
  const parsed = splitExampleDialogue(section.content, name)
  const { leading } = parsed
  const speaks = bothSidesSpeak(parsed.turns)
  const [view, setView] = useState(() => !section.content.trim() || (speaks && !leading) ? 'bubbles' : 'text')
  const [open, setOpen] = useState<OpenTurn | null>(null)
  // Content changed elsewhere (text view, the page assistant) closes the open bubble instead of being overwritten.
  const active = open && open.written === section.content ? open : null
  const turns = active ? active.turns : parsed.turns
  const textarea = useRef<HTMLTextAreaElement>(null)
  const nonLlm = engine !== 'llm'
  const textFallback = Boolean(section.content.trim()) && !speaks
  const badge = <Badge variant="secondary" size="xs">{history ? t({ ko: '미리 넣은 기록', en: 'Seeded history' }) : t({ ko: '예시', en: 'Example' })}</Badge>

  /** Writes the turns; the reader merges same-speaker neighbours only once the bubble is closed and the text re-read. */
  const write = (next: ExampleDialogueTurn[], index: number | null) => {
    const content = joinExampleDialogue(next, leading)
    onChange({ content })
    setOpen(index === null ? null : { turns: next, index, written: content })
  }
  const editTurn = (index: number) => setOpen({ turns, index, written: section.content })
  const updateTurn = (patch: Partial<ExampleDialogueTurn>) => {
    if (active) write(active.turns.map((turn, i) => (i === active.index ? { ...turn, ...patch } : turn)), active.index)
  }
  /** The nearest turn by the same speaker: swapping with it keeps the speaker order, so nothing merges. */
  const sameSpeaker = (index: number, step: -1 | 1) => {
    for (let i = index + step; i >= 0 && i < turns.length; i += step) if (turns[i].role === turns[index].role) return i
    return -1
  }
  const moveTurn = (step: -1 | 1) => {
    if (!active) return
    const target = sameSpeaker(active.index, step)
    const next = [...active.turns]
    ;[next[active.index], next[target]] = [next[target], next[active.index]]
    write(next, target)
  }
  const addTurn = (role: ExampleDialogueTurn['role']) => write([...turns, { role, text: '' }], turns.length)
  const insert = (macro: string) => {
    const element = textarea.current
    const source = view === 'text' ? section.content : active?.turns[active.index].text
    if (source === undefined) return
    const start = element?.selectionStart ?? source.length
    const end = element?.selectionEnd ?? start
    const text = source.slice(0, start) + macro + source.slice(end)
    if (view === 'text') onChange({ content: text })
    else updateTurn({ text })
    setTimeout(() => { element?.focus(); element?.setSelectionRange(start + macro.length, start + macro.length) }, 0)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl size="xs" value={view} onChange={(value) => { setView(value); setOpen(null) }} ariaLabel={t({ ko: '보기 방식', en: 'View' })} items={[
          { value: 'bubbles', label: t({ ko: '말풍선', en: 'Bubbles' }) },
          { value: 'text', label: t({ ko: '텍스트', en: 'Text' }) },
        ]} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild><IconButton size="icon-sm" variant="ghost" disabled={view === 'bubbles' && !active} label={t({ ko: '변수 넣기', en: 'Insert variable' })}><Braces /></IconButton></DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
            <DropdownMenuItem onSelect={() => insert('{{char}}')}>{'{{char}}'} {t({ ko: '캐릭터', en: 'Character' })}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => insert('{{user}}')}>{'{{user}}'} {t({ ko: '사용자', en: 'User' })}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Only switching on is blocked where it would not apply; a set flag can always be cleared. */}
      <SwitchLine label={t({ ko: '실제 기록으로 취급', en: 'Treat as actual history' })} checked={section.asHistory === true} disabled={(nonLlm || textFallback) && section.asHistory !== true} onCheckedChange={(asHistory) => onChange({ asHistory })} />
      {nonLlm ? (
        <Text variant="caption" tone="warning">{t({ ko: '이 엔진은 대화 예시도 지시문 텍스트로 보내. 1 지시문의 섹션들 바로 뒤에 글로 붙어.', en: 'This engine sends example dialogue as instruction text, right after the zone 1 sections.' })}</Text>
      ) : textFallback ? (
        <Text variant="caption" tone="warning">{t({ ko: '화자 표시가 없거나 한쪽 말만 있어서 대화가 아니라 1 지시문의 섹션들 바로 뒤에 글로 붙어. 줄 앞에 사용자: 또는 {{char}}:를 붙여 양쪽 말을 적으면 말풍선으로 보낼 수 있어.', en: 'Without both speakers, this goes as text right after the zone 1 sections, not as dialogue. Start lines with 사용자: and {{char}}: for both sides.' })}</Text>
      ) : (
        <Text variant="caption">{history
          ? t({ ko: '안내문 없이 보내서, 모델은 이 대화를 실제로 나눈 대화로 받아들여.', en: 'Sent without the example notice, so the model treats this as an actual conversation.' })
          : t({ ko: '모델은 "말투를 보여주는 예시일 뿐 실제 대화가 아니야"라는 안내를 함께 받아.', en: 'The model also receives a notice that this only demonstrates the voice, not an actual conversation.' })}</Text>
      )}
      {leading && turns.length > 0 ? <Text variant="caption" tone="warning">{t({ ko: '첫 화자 앞의 글은 대화로 보낼 때 빠져. 텍스트 보기에서 확인하고 고칠 수 있어.', en: 'Text before the first speaker is omitted when sent as dialogue. Check and edit it in text view.' })}</Text> : null}
      {view === 'text' ? (
        <Textarea ref={textarea} variant="settings" autoGrow rows={6} value={section.content} aria-label={t({ ko: '대화 예시 내용', en: 'Example dialogue content' })} onChange={(event) => onChange({ content: event.target.value })} placeholder={t({ ko: '사용자: 오늘 뭐 그릴까?\n{{char}}: 노을 지는 바닷가 어때?', en: '사용자: What should we draw today?\n{{char}}: How about a beach at sunset?' })} />
      ) : (
        <div className="space-y-3">
          {turns.map((turn, index) => active?.index === index ? (
            <div key={index} className={cn('flex flex-col gap-2', turn.role === 'user' ? 'items-end' : 'items-start')}>
              <Textarea ref={textarea} variant="settings" autoGrow autoFocus rows={3} className="w-4/5" value={turn.text} aria-label={t({ ko: '말 수정', en: 'Edit turn' })} onChange={(event) => updateTurn({ text: event.target.value })} />
              <div className="flex flex-wrap items-center justify-end gap-1">
                <SegmentedControl size="xs" value={turn.role} onChange={(role) => updateTurn({ role: role === 'user' ? 'user' : 'assistant' })} ariaLabel={t({ ko: '말한 사람', en: 'Speaker' })} items={[
                  { value: 'user', label: t({ ko: '사용자', en: 'User' }) },
                  { value: 'assistant', label: t({ ko: '캐릭터', en: 'Character' }) },
                ]} />
                <IconButton size="icon-sm" variant="ghost" disabled={sameSpeaker(index, -1) < 0} onClick={() => moveTurn(-1)} label={t({ ko: '같은 사람의 앞 말과 자리 바꾸기', en: 'Swap with the same speaker’s previous turn' })}><ArrowUp /></IconButton>
                <IconButton size="icon-sm" variant="ghost" disabled={sameSpeaker(index, 1) < 0} onClick={() => moveTurn(1)} label={t({ ko: '같은 사람의 뒤 말과 자리 바꾸기', en: 'Swap with the same speaker’s next turn' })}><ArrowDown /></IconButton>
                <IconButton size="icon-sm" variant="ghost" onClick={() => write(turns.filter((_, i) => i !== index), null)} label={t({ ko: '이 말 삭제', en: 'Delete turn' })}><Trash2 /></IconButton>
                <Button size="compact" onClick={() => setOpen(null)}>{t({ ko: '완료', en: 'Done' })}</Button>
              </div>
            </div>
          ) : turn.role === 'user' ? (
            <div key={index} className="flex justify-end">
              <div className={cn('max-w-4/5 overflow-hidden rounded-lg', history ? 'bg-surface-high' : 'border border-dashed border-line text-muted-foreground')}>
                <Button variant="ghost" size="content" className="max-w-full" onClick={() => editTurn(index)}>
                  <span className={cn('whitespace-pre-wrap break-words text-left text-sm', history ? 'text-foreground' : 'text-muted-foreground')}>{badge} {turn.text || t({ ko: '눌러서 말 적기', en: 'Click to write' })}</span>
                </Button>
              </div>
            </div>
          ) : (
            <PromptCharacterBubble key={index} avatar={avatar} name={name} badge={badge} muted={!history} onClick={() => editTurn(index)}>
              {turn.text || t({ ko: '눌러서 말 적기', en: 'Click to write' })}
            </PromptCharacterBubble>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="compact" disabled={turns.at(-1)?.role === 'user'} onClick={() => addTurn('user')}><Plus />{t({ ko: '사용자 말', en: 'User turn' })}</Button>
            <Button variant="secondary" size="compact" disabled={turns.at(-1)?.role === 'assistant'} onClick={() => addTurn('assistant')}><Plus />{t({ ko: '캐릭터 말', en: 'Character turn' })}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
