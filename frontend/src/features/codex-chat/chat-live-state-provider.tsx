import { useMemo, type PropsWithChildren } from 'react'
import { CodexChatLiveStateContext, type CodexChatLiveState, type CodexChatLiveTurn } from './codex-chat-context'

/** A compiler-compatible boundary: the streaming transport itself contains unsupported try/finally callbacks. */
export function ChatLiveStateProvider({ turns, children }: PropsWithChildren<{ turns: Readonly<Record<number, CodexChatLiveTurn>> }>) {
  const states = Object.values(turns).map((turn): CodexChatLiveState => ({
    threadId: turn.threadId,
    replacingMessageId: turn.replacingMessageId,
    speakerIds: turn.replies?.map((reply) => reply.profileId).join(',') ?? '',
    queueIds: turn.queue?.join(',') ?? '',
    portraitProfileId: turn.replies?.reduce<number | null>((last, reply) => reply.text ? reply.profileId : last, null) ?? null,
    hasText: Boolean(turn.text),
  }))
  // Text frames leave these fields unchanged, so the serialized form keeps the context value stable across them.
  const signature = JSON.stringify(states)
  const value = useMemo(() => Object.fromEntries((JSON.parse(signature) as CodexChatLiveState[]).map((state) => [state.threadId, state])), [signature])
  return <CodexChatLiveStateContext.Provider value={value}>{children}</CodexChatLiveStateContext.Provider>
}
