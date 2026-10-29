import type { PropsWithChildren } from 'react'
import { CodexChatLiveStateContext, type CodexChatLiveTurn } from './codex-chat-context'

/** A compiler-compatible boundary: the streaming transport itself contains unsupported try/finally callbacks. */
export function ChatLiveStateProvider({ turn, children }: PropsWithChildren<{ turn: CodexChatLiveTurn | null }>) {
  const threadId = turn?.threadId ?? null
  const replacingMessageId = turn?.replacingMessageId
  const speakerIds = turn?.replies?.map((reply) => reply.profileId).join(',') ?? ''
  const queueIds = turn?.queue?.join(',') ?? ''
  const portraitProfileId = turn?.replies?.reduce<number | null>((last, reply) => reply.text ? reply.profileId : last, null) ?? null
  const hasText = Boolean(turn?.text)
  const state = threadId === null ? null : { threadId, replacingMessageId, speakerIds, queueIds, portraitProfileId, hasText }
  return <CodexChatLiveStateContext.Provider value={state}>{children}</CodexChatLiveStateContext.Provider>
}
