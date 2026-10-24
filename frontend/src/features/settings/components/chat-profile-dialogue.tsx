import { Fragment, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Eye, EyeOff, Trash2 } from 'lucide-react'
import { joinExampleDialogue, type ExampleDialogueTurn } from '@conai/shared'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { ChatPromptSection } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { PromptCard, PromptEditFrame, PromptMacroMenu } from './chat-profile-sections'

/** A dialogue section read as speaker turns; `leading` is the text before the first speaker, left out of a dialogue reading. */
export type DialogueEntry = { section: ChatPromptSection; turns: ExampleDialogueTurn[]; leading: string; speaks: boolean }

/** `example`: a dashed outline, a demonstration only. `real`: filled like a message of the actual conversation. */
type BubbleLook = 'example' | 'real'

/** One speech bubble: the character's on the left under its name, the user's on the right. Clicking it edits it. */
export function PromptBubble({ role, look, avatar, name, badge, itemKey, flash = false, dimmed = false, onClick, children }: {
  role: ExampleDialogueTurn['role']
  look: BubbleLook
  avatar: ReactNode
  name: string
  badge?: ReactNode
  /** `data-prompt-item`, which the composer scrolls to after adding. */
  itemKey: string
  flash?: boolean
  dimmed?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const bubble = (
    <div className={cn('w-fit max-w-full overflow-hidden rounded-lg transition-shadow duration-500 motion-reduce:transition-none', look === 'example' ? 'border border-dashed border-line' : 'bg-surface-high', flash && 'ring-2 ring-primary/60')}>
      <Button variant="ghost" size="content" className="max-w-full" onClick={onClick}>
        <span className={cn('whitespace-pre-wrap break-words text-left text-sm', look === 'example' ? 'text-muted-foreground' : 'text-foreground')}>{children}</span>
      </Button>
    </div>
  )
  if (role === 'user') {
    return (
      <div data-prompt-item={itemKey} className={cn('flex flex-col items-end gap-1', dimmed && 'opacity-50')}>
        {badge ? <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{badge}</div> : null}
        <div className="flex max-w-4/5 justify-end">{bubble}</div>
      </div>
    )
  }
  return (
    <div data-prompt-item={itemKey} className={cn('flex items-start gap-2', dimmed && 'opacity-50')}>
      <span className="shrink-0">{avatar}</span>
      <div className="min-w-0 max-w-4/5 space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="font-medium">{name}</span>{badge}</div>
        {bubble}
      </div>
    </div>
  )
}

/** A bubble edited in place: its text on the speaker's side, then the caller's tools, variables and Done. */
function BubbleEditor({ role, text, label, assisted = false, onTextChange, onClose, children }: {
  role: ExampleDialogueTurn['role']
  text: string
  label: string
  assisted?: boolean
  onTextChange: (text: string) => void
  onClose: () => void
  children?: ReactNode
}) {
  const { t } = useI18n()
  const textarea = useRef<HTMLTextAreaElement>(null)
  return (
    <PromptEditFrame onClose={onClose}>
      <div className={cn('flex flex-col gap-2', role === 'user' ? 'items-end' : 'items-start')}>
        <Textarea ref={textarea} variant="settings" autoGrow autoFocus rows={3} assisted={assisted} className="w-4/5" value={text} aria-label={label} onChange={(event) => onTextChange(event.target.value)} />
        <div className="flex flex-wrap items-center justify-end gap-1">
          {children}
          <PromptMacroMenu textarea={textarea} value={text} onChange={onTextChange} />
          <Button size="compact" onClick={onClose}>{t({ ko: '완료', en: 'Done' })}</Button>
        </div>
      </div>
    </PromptEditFrame>
  )
}

/** An open bubble edits a snapshot of its section's turns, so a speaker label typed into it cannot re-split them mid-edit. */
type OpenTurn = { sectionId: string; turns: ExampleDialogueTurn[]; index: number; written: string }

/**
 * The bubbles of several dialogue sections as one conversation. The sections stay out of sight: switching off works on
 * a bubble's whole section, and a section with only one side says that it still goes as text.
 */
export function PromptDialogueZone({ entries, look, avatar, name, badge, flashKey, turnsAsMessages = false, onSectionChange, onSectionRemove }: {
  entries: DialogueEntry[]
  look: BubbleLook
  avatar: ReactNode
  name: string
  /** Shown over every bubble of the zone (seeded history). */
  badge?: ReactNode
  flashKey: string | null
  /** The engine sends sections where both sides speak as messages (API LLM); other engines send every example as text. */
  turnsAsMessages?: boolean
  onSectionChange: (id: string, patch: Partial<ChatPromptSection>) => void
  onSectionRemove: (id: string) => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState<OpenTurn | null>(null)
  /** The text before the first speaker, edited raw with the turns after it held as written when it opened. */
  const [leadingOpen, setLeadingOpen] = useState<{ sectionId: string; text: string; tail: string; written: string } | null>(null)
  const contentOf = (id: string) => entries.find((entry) => entry.section.id === id)?.section.content
  // Content changed elsewhere (the composer, the page assistant) closes the open item instead of being overwritten.
  const active = open && contentOf(open.sectionId) === open.written ? open : null
  const leadingActive = leadingOpen && contentOf(leadingOpen.sectionId) === leadingOpen.written ? leadingOpen : null

  return (
    <>
      {entries.map(({ section, turns: parsed, leading, speaks }) => {
        const editing = active?.sectionId === section.id ? active : null
        const turns = editing ? editing.turns : parsed
        /** Writes the turns; the reader merges same-speaker neighbours only once the bubble is closed and the text re-read. */
        const write = (next: ExampleDialogueTurn[], index: number | null) => {
          if (!next.length && !leading) {
            onSectionRemove(section.id)
            setOpen(null)
            return
          }
          const content = joinExampleDialogue(next, leading)
          onSectionChange(section.id, { content })
          setOpen(index === null ? null : { sectionId: section.id, turns: next, index, written: content })
        }
        /** The nearest turn by the same speaker: swapping with it keeps the speaker order, so nothing merges. */
        const sameSpeaker = (index: number, step: -1 | 1) => {
          for (let i = index + step; i >= 0 && i < turns.length; i += step) if (turns[i].role === turns[index].role) return i
          return -1
        }
        const swap = (index: number, target: number) => {
          const next = [...turns]
          ;[next[index], next[target]] = [next[target], next[index]]
          write(next, target)
        }
        return (
          <Fragment key={section.id}>
            {leadingActive?.sectionId === section.id || leading || !parsed.length ? (
              <PromptCard
                itemKey={`leading:${section.id}`}
                tone="example"
                title={turnsAsMessages && speaks ? t({ ko: '대화로 보낼 때 빠지는 글', en: 'Left out when sent as dialogue' }) : t({ ko: '예시 글', en: 'Example text' })}
                text={leadingActive?.sectionId === section.id ? leadingActive.text : leading}
                placeholder={t({ ko: '비어 있어 · 눌러서 쓰기', en: 'Empty · click to write' })}
                enabled={section.enabled}
                editing={leadingActive?.sectionId === section.id}
                onEditingChange={(next) => setLeadingOpen(next ? { sectionId: section.id, text: leading, tail: joinExampleDialogue(parsed), written: section.content } : null)}
                onTextChange={(text) => {
                  const tail = leadingActive?.sectionId === section.id ? leadingActive.tail : joinExampleDialogue(parsed)
                  const content = tail ? (text ? `${text}\n${tail}` : tail) : text
                  onSectionChange(section.id, { content })
                  setLeadingOpen({ sectionId: section.id, text, tail, written: content })
                }}
                tools={(
                  <>
                    <IconButton size="icon-sm" variant="ghost" onClick={() => onSectionChange(section.id, { enabled: !section.enabled })} label={section.enabled ? t({ ko: '끄기', en: 'Turn off' }) : t({ ko: '켜기', en: 'Turn on' })}>{section.enabled ? <EyeOff /> : <Eye />}</IconButton>
                    <IconButton size="icon-sm" variant="destructive-ghost" onClick={() => onSectionRemove(section.id)} label={t({ ko: '삭제', en: 'Delete' })}><Trash2 /></IconButton>
                  </>
                )}
              />
            ) : null}
            {turns.map((turn, index) => editing?.index === index ? (
              <BubbleEditor
                key={index}
                role={turn.role}
                text={turn.text}
                label={t({ ko: '말 수정', en: 'Edit turn' })}
                onTextChange={(text) => write(turns.map((entry, i) => (i === index ? { ...entry, text } : entry)), index)}
                onClose={() => setOpen(null)}
              >
                <SegmentedControl size="xs" value={turn.role} onChange={(role) => write(turns.map((entry, i) => (i === index ? { ...entry, role: role === 'user' ? 'user' : 'assistant' } : entry)), index)} ariaLabel={t({ ko: '말한 사람', en: 'Speaker' })} items={[
                  { value: 'user', label: t({ ko: '사용자', en: 'User' }) },
                  { value: 'assistant', label: t({ ko: '캐릭터', en: 'Character' }) },
                ]} />
                <IconButton size="icon-sm" variant="ghost" disabled={sameSpeaker(index, -1) < 0} onClick={() => swap(index, sameSpeaker(index, -1))} label={t({ ko: '같은 사람의 앞 말과 자리 바꾸기', en: 'Swap with the same speaker’s previous turn' })}><ArrowUp /></IconButton>
                <IconButton size="icon-sm" variant="ghost" disabled={sameSpeaker(index, 1) < 0} onClick={() => swap(index, sameSpeaker(index, 1))} label={t({ ko: '같은 사람의 뒤 말과 자리 바꾸기', en: 'Swap with the same speaker’s next turn' })}><ArrowDown /></IconButton>
                <IconButton size="icon-sm" variant="ghost" onClick={() => onSectionChange(section.id, { enabled: !section.enabled })} label={section.enabled ? t({ ko: '이 대화 묶음 끄기', en: 'Turn this dialogue group off' }) : t({ ko: '이 대화 묶음 켜기', en: 'Turn this dialogue group on' })}>{section.enabled ? <EyeOff /> : <Eye />}</IconButton>
                <IconButton size="icon-sm" variant="destructive-ghost" onClick={() => write(turns.filter((_, i) => i !== index), null)} label={t({ ko: '이 말 삭제', en: 'Delete turn' })}><Trash2 /></IconButton>
              </BubbleEditor>
            ) : (
              <PromptBubble
                key={index}
                role={turn.role}
                look={look}
                avatar={avatar}
                name={name}
                badge={badge}
                itemKey={`turn:${section.id}:${index}`}
                flash={flashKey === `turn:${section.id}:${index}`}
                dimmed={!section.enabled}
                onClick={() => setOpen({ sectionId: section.id, turns, index, written: section.content })}
              >
                {turn.text || t({ ko: '눌러서 말 적기', en: 'Click to write' })}
              </PromptBubble>
            ))}
            {turnsAsMessages && !speaks && section.content.trim() ? <Text variant="caption" tone="warning">{t({ ko: '양쪽 말이 다 있어야 대화로 보내져. 지금은 지시문 뒤에 글로 붙어.', en: 'Both sides must speak to send this as dialogue. For now it goes as text after the instructions.' })}</Text> : null}
          </Fragment>
        )
      })}
    </>
  )
}

/** The first-message candidates as one bubble, ‹ › between them; deleting the first greeting moves the next one up. */
export function PromptGreeting({ greetings, index, onIndexChange, onTextChange, onDelete, avatar, name, assisted, flash }: {
  /** The first greeting, then the alternates. */
  greetings: string[]
  index: number
  onIndexChange: (index: number) => void
  onTextChange: (index: number, text: string) => void
  onDelete: (index: number) => void
  avatar: ReactNode
  name: string
  assisted: boolean
  flash: boolean
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const text = greetings[index] ?? ''
  const count = greetings.length
  const badge = (
    <>
      <Badge variant="secondary" size="xs">{t({ ko: '첫 인사말', en: 'Greeting' })}</Badge>
      {count > 1 ? (
        <span className="inline-flex items-center gap-0.5 tabular-nums">
          <IconButton size="icon-xs" variant="ghost" onClick={() => onIndexChange((index - 1 + count) % count)} label={t({ ko: '이전 인사말', en: 'Previous greeting' })}><ChevronLeft /></IconButton>
          {index + 1}/{count}
          <IconButton size="icon-xs" variant="ghost" onClick={() => onIndexChange((index + 1) % count)} label={t({ ko: '다음 인사말', en: 'Next greeting' })}><ChevronRight /></IconButton>
        </span>
      ) : null}
    </>
  )

  if (editing) {
    return (
      <div data-prompt-item="greeting" className="space-y-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="font-medium">{name}</span>{badge}</div>
        <BubbleEditor role="assistant" text={text} label={t({ ko: '인사말 수정', en: 'Edit greeting' })} assisted={assisted} onTextChange={(next) => onTextChange(index, next)} onClose={() => setEditing(false)}>
          {text.trim() || count > 1 ? (
            <IconButton size="icon-sm" variant="destructive-ghost" onClick={() => { onDelete(index); setEditing(false) }} label={t({ ko: '이 인사말 삭제', en: 'Delete this greeting' })}><Trash2 /></IconButton>
          ) : null}
        </BubbleEditor>
      </div>
    )
  }
  return (
    <PromptBubble role="assistant" look="real" avatar={avatar} name={name} badge={badge} itemKey="greeting" flash={flash} onClick={() => setEditing(true)}>
      {text.trim() ? text : (
        <span className="text-muted-foreground">{count > 1
          ? t({ ko: '첫 인사말은 비어 있어. 추가 인사말 중 하나가 첫 메시지가 돼.', en: 'The first greeting is empty; one of the alternates becomes the first message.' })
          : t({ ko: '첫 인사말이 아직 없어 · 눌러서 쓰기', en: 'No greeting yet · click to write' })}</span>
      )}
    </PromptBubble>
  )
}
