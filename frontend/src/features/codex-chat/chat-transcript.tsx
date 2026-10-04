import { memo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Pencil, RotateCcw, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { CodexChatMediaInfo, CodexChatMessage } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import type { ChatAvatarSize } from './chat-appearance'
import { ChatFileLinks } from './chat-attachments'
import type { CodexChatLiveTurn } from './codex-chat-context'
import { CodexChatAssistantMessage, CodexChatUserMessage, type ChatSpeaker } from './codex-chat-message'

type MessageLook = { speaker: ChatSpeaker | null; avatarSize: ChatAvatarSize; largeThumbnails: boolean }

type MessageActions = {
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
  const save = () => { if (!busy && (content.trim() || message.attachments?.length)) void onSave(message.id, content).then((accepted) => { if (accepted) onCancel() }) }
  return <div className="ml-auto w-full max-w-[85%] space-y-1">
    <Textarea autoFocus value={content} disabled={busy} rows={4} aria-label={t({ ko: '메시지 수정', en: 'Edit message' })} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); save() }
    }} />
    <div className="flex justify-end gap-1">
      <IconButton size="icon-xs" variant="ghost" label={t({ ko: '취소', en: 'Cancel' })} disabled={busy} onClick={onCancel}><X /></IconButton>
      <IconButton size="icon-xs" variant="ghost" label={t({ ko: '저장하고 다시 생성', en: 'Save and regenerate' })} disabled={busy || (!content.trim() && !message.attachments?.length)} onClick={save}><Check /></IconButton>
    </div>
  </div>
}

const ChatMessageRow = memo(function ChatMessageRow({ message, flash, media, actions, ...look }: MessageLook & {
  message: CodexChatMessage; flash: boolean; media?: Record<string, CodexChatMediaInfo>; actions: MessageActions
}) {
  const { t } = useI18n()
  const [tapped, setTapped] = useState(false)
  const isUser = message.role === 'user'
  const lastReply = message.id === actions.lastReplyId
  const alternatives = message.alternatives ?? []
  return <div data-message-id={message.id} onPointerDown={(event) => { if (event.pointerType !== 'mouse') setTapped(true) }} className={cn('group/message -mx-2 rounded-md px-2 transition-colors duration-500', flash && 'bg-primary/10')}>
    {isUser
      ? <>{actions.editingId === message.id
        ? <ChatMessageEditor message={message} busy={actions.busy} onSave={actions.onEdit} onCancel={() => actions.onEditingChange(null)} />
        : message.content && <CodexChatUserMessage content={message.content} />}<ChatFileLinks files={message.attachments} /></>
      : <CodexChatAssistantMessage content={message.content} toolCalls={message.tool_calls} status={message.status} error={message.error} media={media} {...look} />}
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
export const ChatSavedMessages = memo(function ChatSavedMessages({ messages, flashMessageId, media, actions, ...look }: MessageLook & {
  messages: CodexChatMessage[]
  flashMessageId: number | null
  media?: Record<string, CodexChatMediaInfo>
  actions: MessageActions
}) {
  return messages.map((message) => (
    <ChatMessageRow key={message.id} message={message} flash={flashMessageId === message.id} media={media} actions={actions} {...look} />
  ))
})

export const ChatLiveMessage = memo(function ChatLiveMessage({ turn, ...look }: MessageLook & { turn: CodexChatLiveTurn }) {
  return <>
    {turn.userText && <CodexChatUserMessage content={turn.userText} />}
    <ChatFileLinks files={turn.attachments} />
    <CodexChatAssistantMessage content={turn.text} toolCalls={[...turn.toolCalls.values()]} reasoning={turn.reasoning} streaming {...look} />
  </>
})
