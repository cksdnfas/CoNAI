import { memo } from 'react'
import type { CodexChatMediaInfo, CodexChatMessage } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import type { ChatAvatarSize } from './chat-appearance'
import { ChatFileLinks } from './chat-attachments'
import type { CodexChatLiveTurn } from './codex-chat-context'
import { CodexChatAssistantMessage, CodexChatUserMessage, type ChatSpeaker } from './codex-chat-message'

type MessageLook = { speaker: ChatSpeaker | null; avatarSize: ChatAvatarSize; largeThumbnails: boolean }

/** Stored rows stay untouched while a live turn streams or the composer changes. */
export const ChatSavedMessages = memo(function ChatSavedMessages({ messages, flashMessageId, media, ...look }: MessageLook & {
  messages: CodexChatMessage[]
  flashMessageId: number | null
  media?: Record<string, CodexChatMediaInfo>
}) {
  return messages.map((message) => (
    <div key={message.id} data-message-id={message.id} className={cn('-mx-2 rounded-md px-2 transition-colors duration-500', flashMessageId === message.id && 'bg-primary/10')}>
      {message.role === 'user'
        ? <>{message.content && <CodexChatUserMessage content={message.content} />}<ChatFileLinks files={message.attachments} /></>
        : <CodexChatAssistantMessage content={message.content} toolCalls={message.tool_calls} status={message.status} error={message.error} media={media} {...look} />}
    </div>
  ))
})

export const ChatLiveMessage = memo(function ChatLiveMessage({ turn, ...look }: MessageLook & { turn: CodexChatLiveTurn }) {
  return <>
    {turn.userText && <CodexChatUserMessage content={turn.userText} />}
    <ChatFileLinks files={turn.attachments} />
    <CodexChatAssistantMessage content={turn.text} toolCalls={[...turn.toolCalls.values()]} reasoning={turn.reasoning} streaming {...look} />
  </>
})
