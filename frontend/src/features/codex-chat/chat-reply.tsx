import type { ChatMessageRouting, ChatReplyQuote } from '@conai/shared'
import { CornerUpLeft } from 'lucide-react'
import { Panel } from '@/components/ui/panel'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-url'
import { cn } from '@/lib/utils'
import { useCodexChatReference } from './codex-chat-context'

/** Same compact quote in the composer, a saved bubble and a streaming reply. */
export function ChatReplyPreview({ quote, recipientLabel, onOpen, className }: {
  quote?: ChatReplyQuote | null
  recipientLabel?: string
  onOpen?: () => void
  className?: string
}) {
  const { t } = useI18n()
  const reference = useCodexChatReference()
  if (!quote && !recipientLabel) return null
  if (!quote) return <p className={cn('flex items-center gap-1 text-xs text-muted-foreground', className)}><CornerUpLeft className="size-3 shrink-0" />{t({ ko: '받는 사람: {name}', en: 'To: {name}' }, { name: recipientLabel! })}</p>
  // Quote look: a tinted block with a primary bar on the left. A deleted original is a plain block, not a dead button.
  const frameClassName = cn('mb-2 flex w-full min-w-0 gap-2', className)
  const content = (
    <>
      <span aria-hidden className="w-0.5 shrink-0 self-stretch rounded-full bg-primary/50" />
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1 text-xs font-medium"><CornerUpLeft className="size-3 shrink-0" />{t({ ko: '{name}에게 답장', en: 'Reply to {name}' }, { name: quote.speakerName })}</span>
        <span className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">{quote.unavailable ? t({ ko: '삭제된 메시지', en: 'Deleted message' }) : quote.excerpt}</span>
        {recipientLabel && recipientLabel !== quote.speakerName ? <span className="mt-1 block text-xs text-muted-foreground">{t({ ko: '받는 사람: {name}', en: 'To: {name}' }, { name: recipientLabel })}</span> : null}
      </span>
      {!quote.unavailable && quote.media ? <img src={buildApiUrl(`/api/images/${encodeURIComponent(quote.media.compositeHash)}/thumbnail`)} alt="" loading="lazy" className="size-10 shrink-0 rounded-sm object-cover" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}
    </>
  )
  if (quote.unavailable) return <Panel tone="low" padding="sm" className={frameClassName}>{content}</Panel>
  return (
    <Panel asChild interactive tone="low" padding="sm" className={frameClassName}>
      <button type="button" onClick={onOpen ?? (() => reference?.focusMessage(quote.messageId))} aria-label={t({ ko: '{name}의 원문으로 이동', en: 'Go to {name}’s message' }, { name: quote.speakerName })}>
        {content}
      </button>
    </Panel>
  )
}

export function ChatMessageReply({ routing, recipientLabel }: { routing?: ChatMessageRouting | null; recipientLabel?: string }) {
  return routing ? <ChatReplyPreview quote={routing.replyTo} recipientLabel={recipientLabel} /> : null
}
