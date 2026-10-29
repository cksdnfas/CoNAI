import type { ComponentProps } from 'react'
import type { ChatPortraitMessage, ChatPortraitProfile } from '@conai/shared'
import type { ChatProfileSummary } from '@/lib/api-codex-chat'
import { useCodexChatLiveTurn } from './codex-chat-context'
import { ChatLiveMessage } from './chat-transcript'
import { ChatPortrait } from './chat-status-panel'
import { useChatPortrait } from './use-chat-portrait'

export function ChatStreamingMessage({ threadId, ...props }: Omit<ComponentProps<typeof ChatLiveMessage>, 'turn'> & { threadId: number | null }) {
  const turn = useCodexChatLiveTurn()
  return turn?.threadId === threadId ? <ChatLiveMessage {...props} turn={turn} /> : null
}

export function ChatStreamingPortrait({ threadId, messages, fallback, profiles, profilesById, defaultProfileId }: {
  threadId: number | null; messages: readonly ChatPortraitMessage[]; fallback: readonly ChatPortraitMessage[]
  profiles: readonly ChatPortraitProfile[]; profilesById: ReadonlyMap<number, ChatProfileSummary>; defaultProfileId: number | null
}) {
  const signal = useChatPortrait(threadId, messages, fallback, profiles, defaultProfileId)
  const profile = signal ? profilesById.get(signal.profileId) : null
  return signal && profile ? <ChatPortrait signal={signal} profile={profile} /> : null
}
