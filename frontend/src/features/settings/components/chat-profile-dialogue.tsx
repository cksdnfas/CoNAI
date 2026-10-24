import { useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { ChatOpeningMessage } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { PromptEditFrame, PromptMacroMenu } from './chat-profile-sections'

type Speaker = {
  role: ChatOpeningMessage['role']
  avatar: ReactNode
  name: string
  /** Beside the character's name (the greeting's tag). */
  badge?: ReactNode
  /** `data-prompt-item`. */
  itemKey: string
}

/** A message's place: the character's on the left beside its picture, under its name; the user's on the right. */
function BubbleRow({ role, avatar, name, badge, itemKey, wide = false, children }: Speaker & { wide?: boolean; children: ReactNode }) {
  if (role === 'user') {
    return (
      <div data-prompt-item={itemKey} className="flex justify-end">
        <div className={cn('max-w-4/5', wide ? 'w-full' : 'flex justify-end')}>{children}</div>
      </div>
    )
  }
  return (
    <div data-prompt-item={itemKey} className="flex items-start gap-2">
      <span className="shrink-0">{avatar}</span>
      <div className={cn('min-w-0 space-y-1', wide ? 'flex-1' : 'max-w-4/5')}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="font-medium">{name}</span>{badge}</div>
        {children}
      </div>
    </div>
  )
}

/** One message of a new chat's opening as the chat will show it; clicking it edits it. */
export function PromptBubble({ onClick, children, ...speaker }: Speaker & { onClick: () => void; children: ReactNode }) {
  return (
    <BubbleRow {...speaker}>
      <div className="w-fit max-w-full overflow-hidden rounded-lg bg-surface-high">
        <Button variant="ghost" size="content" className="max-w-full" onClick={onClick}>
          <span className="whitespace-pre-wrap break-words text-left text-sm text-foreground">{children}</span>
        </Button>
      </div>
    </BubbleRow>
  )
}

/** A message edited in place on its speaker's side: its text, then `lead` on the left and `tools`, variables, `remove` and Done on the right. */
export function PromptBubbleEditor({ text, label, placeholder, assisted = false, lead, tools, remove, onTextChange, onClose, ...speaker }: Speaker & {
  text: string
  label: string
  placeholder: string
  assisted?: boolean
  lead?: ReactNode
  tools?: ReactNode
  remove?: ReactNode
  onTextChange: (text: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const textarea = useRef<HTMLTextAreaElement>(null)
  return (
    <BubbleRow {...speaker} wide>
      <PromptEditFrame onClose={onClose}>
        <div className="space-y-2">
          <Textarea ref={textarea} variant="settings" autoGrow autoFocus rows={2} assisted={assisted} value={text} placeholder={placeholder} aria-label={label} onChange={(event) => onTextChange(event.target.value)} />
          <div className="flex flex-wrap items-center gap-0.5">
            {lead}
            <span className="flex-1" />
            {tools}
            <PromptMacroMenu textarea={textarea} value={text} onChange={onTextChange} />
            {remove}
            <Button size="compact" onClick={onClose}>{t({ ko: '완료', en: 'Done' })}</Button>
          </div>
        </div>
      </PromptEditFrame>
    </BubbleRow>
  )
}

/** The greeting's tag, with ‹ n/m › through its versions when there are several. */
export function GreetingBadge({ index, count, onIndexChange }: { index: number; count: number; onIndexChange: (index: number) => void }) {
  const { t } = useI18n()
  return (
    <>
      <Badge variant="secondary" size="xs">{t({ ko: '인사말', en: 'Greeting' })}</Badge>
      {count > 1 ? (
        <span className="inline-flex items-center gap-0.5 tabular-nums">
          <IconButton size="icon-sm" variant="ghost" onClick={() => onIndexChange((index - 1 + count) % count)} label={t({ ko: '이전 인사말', en: 'Previous greeting' })}><ChevronLeft /></IconButton>
          {index + 1}/{count}
          <IconButton size="icon-sm" variant="ghost" onClick={() => onIndexChange((index + 1) % count)} label={t({ ko: '다음 인사말', en: 'Next greeting' })}><ChevronRight /></IconButton>
        </span>
      ) : null}
    </>
  )
}