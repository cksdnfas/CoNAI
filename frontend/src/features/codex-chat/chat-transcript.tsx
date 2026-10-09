import { Fragment, memo, useMemo, useState, type MouseEvent } from 'react'
import { Check, ChevronLeft, ChevronRight, Ellipsis, GitBranch, Languages, Pencil, Reply, RotateCcw, StepForward, X } from 'lucide-react'
import type { ChatMessageRouting } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { ChatContextMeta, ChatSummarySegment, CodexChatMediaInfo, CodexChatMessage } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import type { ChatAppearance } from './chat-appearance'
import { ChatFileLinks } from './chat-attachments'
import { ChatContextInfo, parseContextMeta } from './chat-context-info'
import { ChatReferenceChips } from './chat-reference'
import { ChatMessageFlags } from './chat-flags'
import type { CodexChatLiveTurn } from './codex-chat-context'
import { ChatMessageIdContext } from './chat-display-block'
import { CodexChatAssistantMessage, CodexChatUserMessage, type ChatSpeaker, type ChatUserSpeaker } from './codex-chat-message'
import { ChatTaskEventLine } from './chat-task-ui'

const EMPTY_SEGMENTS: ChatSummarySegment[] = []

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
  /** Whether this reply can be rewritten by hand (API LLM replies; in a room, an API LLM member's). */
  canEditReply: (message: CodexChatMessage) => boolean
  onEditReply: (id: number, content: string) => Promise<boolean>
  /** API LLM direct chats: carry on a cut last reply. */
  canContinue: boolean
  onContinue: (id: number) => void
  /** Start a new chat holding this one up to a message. */
  canBranch: boolean
  onBranch: (id: number) => void
}

/** A user message is saved and answered again; a reply (`reply`) is only saved. */
function ChatMessageEditor({ message, busy, onSave, onCancel, reply = false }: {
  message: CodexChatMessage; busy: boolean; onSave: (id: number, content: string) => Promise<boolean>; onCancel: () => void; reply?: boolean
}) {
  const { t } = useI18n()
  const [content, setContent] = useState(message.display_content ?? message.content)
  const save = () => { if (!busy && (content.trim() || message.attachments?.length || message.mediaAttachments?.length)) void onSave(message.id, content).then((accepted) => { if (accepted) onCancel() }) }
  return <div className={cn('w-full space-y-1', reply ? '' : 'ml-auto max-w-[85%]')}>
    <Textarea autoFocus value={content} disabled={busy} rows={4} aria-label={t({ ko: '메시지 수정', en: 'Edit message' })} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); save() }
    }} />
    <div className="flex justify-end gap-1">
      <IconButton size="icon-xs" variant="ghost" label={t({ ko: '취소', en: 'Cancel' })} disabled={busy} onClick={onCancel}><X /></IconButton>
      <IconButton size="icon-xs" variant="ghost" label={reply ? t({ ko: '저장', en: 'Save' }) : t({ ko: '저장하고 다시 생성', en: 'Save and regenerate' })} disabled={busy || (!content.trim() && !message.attachments?.length && !message.mediaAttachments?.length)} onClick={save}><Check /></IconButton>
    </div>
  </div>
}

/** Clicks on these inside a message do their own thing and never fold its action bar. */
const MESSAGE_CONTROLS = 'button, a, input, textarea, select, summary, label, video, audio, [role="button"], [data-message-bar]'

const ChatMessageRow = memo(function ChatMessageRow({ message, last, previousContext, segments, flash, media, actions, speakerOf, mentions, userSpeaker = null, ...look }: MessageLook & {
  message: CodexChatMessage; last: boolean; previousContext: ChatContextMeta | null; segments: ChatSummarySegment[]; flash: boolean; media?: Record<string, CodexChatMediaInfo>; actions: MessageActions
}) {
  const { t } = useI18n()
  // The last message keeps its action bar; an earlier one opens it with a click or tap on the message.
  const [barOpen, setBarOpen] = useState(false)
  // Chats with a translation model keep both texts; the reader's (display_content) shows first.
  const [showOriginal, setShowOriginal] = useState(false)
  const translated = typeof message.display_content === 'string' && message.display_content.length > 0
  const content = translated && !showOriginal ? (message.display_content as string) : message.content
  const isUser = message.role === 'user'
  const lastReply = message.id === actions.lastReplyId
  const alternatives = message.alternatives ?? []
  const contextMeta = look.appearance.showDiagnostics ? parseContextMeta(message.context_meta) : null
  const editableReply = !isUser && actions.canEditReply(message)
  // Reply and the original text stay in view; the rest folds behind one "more" toggle.
  const [moreOpen, setMoreOpen] = useState(false)
  const showRewriteTools = actions.canRewrite && (isUser || lastReply || editableReply || alternatives.length > 1) && actions.editingId !== message.id
  const hasMore = (!isUser && Boolean(contextMeta)) || actions.canBranch || showRewriteTools
  // 1:1 chats show only a quote the user picked; addressing and the reply's automatic quote are room-only.
  const routing = speakerOf ? message.routing : isUser && message.routing?.replyTo ? { ...message.routing, recipients: [] } : null
  const recipientLabel = routing?.recipients.map((id) => typeof id === 'number' ? (speakerOf?.(id)?.name ?? look.speaker?.name ?? '') : id === 'user' ? userSpeaker?.name ?? t({ ko: '사용자', en: 'User' }) : t({ ko: '방 전체', en: 'Room' })).filter(Boolean).join(', ')
  const showBar = last || barOpen || moreOpen
  const toggleBar = (event: MouseEvent<HTMLDivElement>) => {
    if (last || actions.editingId === message.id || (event.target as HTMLElement).closest(MESSAGE_CONTROLS)) return
    // Display blocks live in a shadow root; their pick / set targets only show up in the composed path.
    if (event.nativeEvent.composedPath().some((node) => node instanceof HTMLElement && (node.dataset.pick !== undefined || node.dataset.set !== undefined))) return
    // Selecting text ends in a click too; that must not fold or open the bar.
    if (window.getSelection()?.toString()) return
    setBarOpen(!showBar)
    if (showBar) setMoreOpen(false)
  }
  if (isUser && message.routing?.task) return <div data-message-id={message.id}><ChatTaskEventLine routing={message.routing.task} /></div>
  return <div data-message-id={message.id} onClick={toggleBar} className={cn('group/message -mx-2 rounded-md px-2 transition-colors duration-500', flash && 'bg-primary/10')}>
    {isUser
      ? <>{actions.editingId === message.id
        ? <ChatMessageEditor message={message} busy={actions.busy} onSave={actions.onEdit} onCancel={() => actions.onEditingChange(null)} />
        : (content || message.routing?.replyTo) && <CodexChatUserMessage content={content} routing={routing} recipientLabel={recipientLabel} mentions={mentions} appearance={look.appearance} createdAt={message.created_date} speaker={userSpeaker} />}<ChatFileLinks files={message.attachments} /><ChatReferenceChips items={message.mediaAttachments} threadId={message.thread_id} /><ChatMessageFlags flags={message.flags} /></>
      : actions.editingId === message.id
        ? <ChatMessageEditor message={message} busy={actions.busy} onSave={actions.onEditReply} onCancel={() => actions.onEditingChange(null)} reply />
        : <ChatMessageIdContext.Provider value={message.id}><CodexChatAssistantMessage content={content} routing={routing} recipientLabel={recipientLabel} toolCalls={message.tool_calls} threadId={message.thread_id} status={message.status} error={message.error} finishReason={message.finish_reason ?? null} media={media} {...look} createdAt={message.created_date} speaker={speakerOf ? speakerOf(message.speaker_profile_id) : look.speaker} /></ChatMessageIdContext.Provider>}
    {/* A folded bar takes no room but stays in the tab order, and shows while a key lands on one of its buttons. */}
    <div data-message-bar className={cn('mt-1 flex flex-wrap items-center gap-x-1', isUser && 'justify-end', !showBar && 'sr-only focus-within:not-sr-only')}>
      <IconButton size="icon-xs" variant="ghost" label={t({ ko: '답장', en: 'Reply' })} onClick={() => actions.onReply(message)}><Reply /></IconButton>
      {translated ? <IconButton size="icon-xs" variant="ghost" aria-pressed={showOriginal} className={cn(showOriginal && 'text-primary')} label={showOriginal ? t({ ko: '번역 보기', en: 'Show translation' }) : t({ ko: '원문 보기', en: 'Show original' })} onClick={() => setShowOriginal((current) => !current)}><Languages /></IconButton> : null}
      {hasMore ? <IconButton size="icon-xs" variant="ghost" aria-expanded={moreOpen} className={cn(moreOpen && 'text-primary')} label={moreOpen ? t({ ko: '접기', en: 'Less' }) : t({ ko: '더 보기', en: 'More' })} onClick={() => setMoreOpen((current) => !current)}><Ellipsis /></IconButton> : null}
      {moreOpen && !isUser && contextMeta ? <ChatContextInfo key={message.active_alternative} meta={contextMeta} previous={previousContext} threadId={message.thread_id} messageId={message.id} alternative={message.active_alternative} segments={segments} /> : null}
      {moreOpen && actions.canBranch ? <IconButton size="icon-xs" variant="ghost" disabled={actions.busy} label={t({ ko: '여기까지로 새 채팅 분기', en: 'Branch a new chat up to here' })} onClick={() => actions.onBranch(message.id)}><GitBranch /></IconButton> : null}
      {moreOpen && showRewriteTools ? <>
        {isUser
          ? <IconButton size="icon-xs" variant="ghost" disabled={actions.busy} label={t({ ko: '메시지 수정', en: 'Edit message' })} onClick={() => actions.onEditingChange(message.id)}><Pencil /></IconButton>
          : <>
            {editableReply ? <IconButton size="icon-xs" variant="ghost" disabled={actions.busy} label={t({ ko: '답변 수정', en: 'Edit reply' })} onClick={() => actions.onEditingChange(message.id)}><Pencil /></IconButton> : null}
            {lastReply ? <IconButton size="icon-xs" variant="ghost" disabled={actions.busy} label={t({ ko: '다시 생성', en: 'Regenerate' })} onClick={() => actions.onRegenerate(message.id)}><RotateCcw /></IconButton> : null}
            {lastReply && actions.canContinue && message.finish_reason === 'length' ? <IconButton size="icon-xs" variant="ghost" disabled={actions.busy} label={t({ ko: '이어서 쓰기', en: 'Continue' })} onClick={() => actions.onContinue(message.id)}><StepForward /></IconButton> : null}
            {alternatives.length > 1 ? <>
              <IconButton size="icon-xs" variant="ghost" disabled={actions.busy || message.active_alternative <= 0} label={t({ ko: '이전 답변', en: 'Previous answer' })} onClick={() => actions.onAlternative(message.id, message.active_alternative - 1)}><ChevronLeft /></IconButton>
              <span className="text-xs tabular-nums text-muted-foreground">{message.active_alternative + 1}/{alternatives.length}</span>
              <IconButton size="icon-xs" variant="ghost" disabled={actions.busy || message.active_alternative >= alternatives.length - 1} label={t({ ko: '다음 답변', en: 'Next answer' })} onClick={() => actions.onAlternative(message.id, message.active_alternative + 1)}><ChevronRight /></IconButton>
            </> : null}
          </>}
      </> : null}
    </div>
  </div>
})

/** Stored rows stay untouched while a live turn streams or the composer changes. */
export const ChatSavedMessages = memo(function ChatSavedMessages({ messages, contextMessages, segments = EMPTY_SEGMENTS, flashMessageId, summaryUntilId, media, actions, ...look }: MessageLook & {
  messages: CodexChatMessage[]
  contextMessages: CodexChatMessage[]
  segments?: ChatSummarySegment[]
  flashMessageId: number | null
  media?: Record<string, CodexChatMediaInfo>
  actions: MessageActions
  summaryUntilId: number | null
}) {
  const { t } = useI18n()
  const previousContexts = useMemo(() => {
    const result = new Map<number, ChatContextMeta | null>()
    let previous: ChatContextMeta | null = null
    if (look.appearance.showDiagnostics) for (const message of contextMessages) {
      if (message.role !== 'assistant') continue
      result.set(message.id, previous)
      previous = parseContextMeta(message.context_meta)
    }
    return result
  }, [contextMessages, look.appearance.showDiagnostics])
  const divider = <div role="separator" className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-line" />{t({ ko: '여기까지 요약됨', en: 'Summarized up to here' })}<span className="h-px flex-1 bg-line" /></div>
  return <>
    {summaryUntilId !== null && messages[0]?.id > summaryUntilId ? divider : null}
    {messages.map((message, index) => <Fragment key={message.id}>
      <ChatMessageRow message={message} last={index === messages.length - 1} previousContext={previousContexts.get(message.id) ?? null} segments={segments} flash={flashMessageId === message.id} media={media} actions={actions} {...look} />
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
      ? turn.replies.map((reply) => <CodexChatAssistantMessage key={reply.routing?.replyId ?? reply.profileId} content={reply.text} routing={reply.routing} recipientLabel={recipients(reply.routing)} toolCalls={[...reply.toolCalls.values()]} reasoning={reply.reasoning} streaming translating={reply.translating} {...look} speaker={speakerOf ? speakerOf(reply.profileId) : look.speaker} />)
      : <CodexChatAssistantMessage content={turn.text} toolCalls={[...turn.toolCalls.values()]} reasoning={turn.reasoning} streaming translating={turn.translating} {...look} />}
  </>
})
