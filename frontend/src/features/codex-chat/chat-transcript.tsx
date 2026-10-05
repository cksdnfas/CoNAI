import { Fragment, memo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Pencil, Reply, RotateCcw, X } from 'lucide-react'
import type { ChatMessageRouting } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { CodexChatMediaInfo, CodexChatMessage } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import type { ChatAppearance } from './chat-appearance'
import { ChatFileLinks } from './chat-attachments'
import { ChatReferenceChips } from './chat-reference'
import { ChatMessageFlags } from './chat-flags'
import type { CodexChatLiveTurn } from './codex-chat-context'
import { ChatMessageIdContext } from './chat-display-block'
import { CodexChatAssistantMessage, CodexChatUserMessage, type ChatSpeaker, type ChatUserSpeaker } from './codex-chat-message'

type MessageLook = {
  speaker: ChatSpeaker | null
  /** The chat's user profile, shown on the user's own messages (null: no name or picture). */
  userSpeaker?: ChatUserSpeaker | null
  /** The reader's chat appearance (sizes, bubbles, names, time…). */
  appearance: ChatAppearance
  /** Group rooms: who wrote a reply (its speaker), instead of the chat's one speaker. */
  speakerOf?: (profileId: number | null) => ChatSpeaker | null
  /** Group rooms: member names, so `@name` mentions are highlighted. */
  mentions?: readonly string[]
}

type MessageActions = {
  onReply: (message: CodexChatMessage) => void
  busy: boolean
  canRewrite: boolean
  lastReplyId: number | null
  editingId: number | null
  onEditingChange: (id: number | null) => void
  onEdit: (id: number, content: string) => Promise<boolean>
  onRegenerate: (id: number) => void
  onAlternative: (id: number, index: number) => void
}

function ChatMessageEditor({ message, busy, onSave, onCancel }: {
  message: CodexChatMessage; busy: boolean; onSave: (id: number, content: string) => Promise<boolean>; onCancel: () => void
}) {
  const { t } = useI18n()
  const [content, setContent] = useState(message.content)
  const save = () => { if (!busy && (content.trim() || message.attachments?.length || message.mediaAttachments?.length)) void onSave(message.id, content).then((accepted) => { if (accepted) onCancel() }) }
  return <div className="ml-auto w-full max-w-[85%] space-y-1">
    <Textarea autoFocus value={content} disabled={busy} rows={4} aria-label={t({ ko: '메시지 수정', en: 'Edit message' })} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); save() }
    }} />
    <div className="flex justify-end gap-1">
      <IconButton size="icon-xs" variant="ghost" label={t({ ko: '취소', en: 'Cancel' })} disabled={busy} onClick={onCancel}><X /></IconButton>
      <IconButton size="icon-xs" variant="ghost" label={t({ ko: '저장하고 다시 생성', en: 'Save and regenerate' })} disabled={busy || (!content.trim() && !message.attachments?.length && !message.mediaAttachments?.length)} onClick={save}><Check /></IconButton>
    </div>
  </div>
}

const ChatMessageRow = memo(function ChatMessageRow({ message, flash, media, actions, speakerOf, mentions, userSpeaker = null, ...look }: MessageLook & {
  message: CodexChatMessage; flash: boolean; media?: Record<string, CodexChatMediaInfo>; actions: MessageActions
}) {
  const { t } = useI18n()
  const [tapped, setTapped] = useState(false)
  const isUser = message.role === 'user'
  const lastReply = message.id === actions.lastReplyId
  const alternatives = message.alternatives ?? []
  const recipientLabel = message.routing?.recipients.map((id) => typeof id === 'number' ? (speakerOf?.(id)?.name ?? look.speaker?.name ?? '') : id === 'user' ? userSpeaker?.name ?? t({ ko: '사용자', en: 'User' }) : t({ ko: '방 전체', en: 'Room' })).filter(Boolean).join(', ')
  return <div data-message-id={message.id} onPointerDown={(event) => { if (event.pointerType !== 'mouse') setTapped(true) }} className={cn('group/message -mx-2 rounded-md px-2 transition-colors duration-500', flash && 'bg-primary/10')}>
    {isUser
      ? <>{actions.editingId === message.id
        ? <ChatMessageEditor message={message} busy={actions.busy} onSave={actions.onEdit} onCancel={() => actions.onEditingChange(null)} />
        : (message.content || message.routing?.replyTo) && <CodexChatUserMessage content={message.content} routing={message.routing} recipientLabel={recipientLabel} mentions={mentions} appearance={look.appearance} createdAt={message.created_date} speaker={userSpeaker} />}<ChatFileLinks files={message.attachments} /><ChatReferenceChips items={message.mediaAttachments} threadId={message.thread_id} /><ChatMessageFlags flags={message.flags} /></>
      : <ChatMessageIdContext.Provider value={message.id}><CodexChatAssistantMessage content={message.content} routing={message.routing} recipientLabel={recipientLabel} toolCalls={message.tool_calls} status={message.status} error={message.error} finishReason={message.finish_reason ?? null} media={media} {...look} createdAt={message.created_date} speaker={speakerOf ? speakerOf(message.speaker_profile_id) : look.speaker} /></ChatMessageIdContext.Provider>}
    <div className={cn('mt-1 flex opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100', isUser && 'justify-end', tapped && 'opacity-100')}>
      <IconButton size="icon-xs" variant="ghost" label={t({ ko: '답장', en: 'Reply' })} onClick={() => actions.onReply(message)}><Reply /></IconButton>
    </div>
    {actions.canRewrite && (isUser || lastReply) && actions.editingId !== message.id ? (
      <div className={cn('mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100', isUser && 'justify-end', tapped && 'opacity-100')}>
        {isUser
          ? <IconButton size="icon-xs" variant="ghost" disabled={actions.busy} label={t({ ko: '메시지 수정', en: 'Edit message' })} onClick={() => actions.onEditingChange(message.id)}><Pencil /></IconButton>
          : <>
            <IconButton size="icon-xs" variant="ghost" disabled={actions.busy} label={t({ ko: '다시 생성', en: 'Regenerate' })} onClick={() => actions.onRegenerate(message.id)}><RotateCcw /></IconButton>
            {alternatives.length > 1 ? <>
              <IconButton size="icon-xs" variant="ghost" disabled={actions.busy || message.active_alternative <= 0} label={t({ ko: '이전 답변', en: 'Previous answer' })} onClick={() => actions.onAlternative(message.id, message.active_alternative - 1)}><ChevronLeft /></IconButton>
              <span className="text-xs tabular-nums text-muted-foreground">{message.active_alternative + 1}/{alternatives.length}</span>
              <IconButton size="icon-xs" variant="ghost" disabled={actions.busy || message.active_alternative >= alternatives.length - 1} label={t({ ko: '다음 답변', en: 'Next answer' })} onClick={() => actions.onAlternative(message.id, message.active_alternative + 1)}><ChevronRight /></IconButton>
            </> : null}
          </>}
      </div>
    ) : null}
  </div>
})

/** Stored rows stay untouched while a live turn streams or the composer changes. */
export const ChatSavedMessages = memo(function ChatSavedMessages({ messages, flashMessageId, summaryUntilId, media, actions, ...look }: MessageLook & {
  messages: CodexChatMessage[]
  flashMessageId: number | null
  media?: Record<string, CodexChatMediaInfo>
  actions: MessageActions
  summaryUntilId: number | null
}) {
  const { t } = useI18n()
  const divider = <div role="separator" className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-line" />{t({ ko: '여기까지 요약됨', en: 'Summarized up to here' })}<span className="h-px flex-1 bg-line" /></div>
  return <>
    {summaryUntilId !== null && messages[0]?.id > summaryUntilId ? divider : null}
    {messages.map((message) => <Fragment key={message.id}>
      <ChatMessageRow message={message} flash={flashMessageId === message.id} media={media} actions={actions} {...look} />
      {message.id === summaryUntilId ? divider : null}
    </Fragment>)}
  </>
})

export const ChatLiveMessage = memo(function ChatLiveMessage({ turn, speakerOf, mentions, userSpeaker = null, ...look }: MessageLook & { turn: CodexChatLiveTurn }) {
  const { t } = useI18n()
  const recipients = (routing?: ChatMessageRouting) => routing?.recipients.map((id) => typeof id === 'number' ? (speakerOf?.(id)?.name ?? look.speaker?.name ?? '') : id === 'user' ? userSpeaker?.name ?? t({ ko: '사용자', en: 'User' }) : t({ ko: '방 전체', en: 'Room' })).filter(Boolean).join(', ')
  return <>
    {(turn.userText || turn.userRouting?.replyTo) && <CodexChatUserMessage content={turn.userText} routing={turn.userRouting} mentions={mentions} appearance={look.appearance} speaker={userSpeaker} />}
    <ChatFileLinks files={turn.attachments} />
    <ChatReferenceChips items={turn.mediaAttachments} threadId={turn.threadId} />
    <ChatMessageFlags flags={turn.flags} />
    {/* Group rooms: one bubble per member answering now; none between members. */}
    {turn.replies
      ? turn.replies.map((reply) => <CodexChatAssistantMessage key={reply.routing?.replyId ?? reply.profileId} content={reply.text} routing={reply.routing} recipientLabel={recipients(reply.routing)} toolCalls={[...reply.toolCalls.values()]} reasoning={reply.reasoning} streaming {...look} speaker={speakerOf ? speakerOf(reply.profileId) : look.speaker} />)
      : <CodexChatAssistantMessage content={turn.text} routing={turn.routing} recipientLabel={recipients(turn.routing)} toolCalls={[...turn.toolCalls.values()]} reasoning={turn.reasoning} streaming {...look} />}
  </>
})
