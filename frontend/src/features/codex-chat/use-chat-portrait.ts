import { resolveChatPortrait, type ChatPortraitMessage, type ChatPortraitProfile } from '@conai/shared'
import { useCodexChatLiveTurn } from './codex-chat-context'

/** Stored history is independent of streamed frames; the compiler caches it on messages/profiles/default id. */
export function useChatPortrait(threadId: number | null, messages: readonly ChatPortraitMessage[], fallback: readonly ChatPortraitMessage[], profiles: readonly ChatPortraitProfile[], defaultProfileId: number | null) {
  const turn = useCodexChatLiveTurn()
  const active = turn?.threadId === threadId ? turn : null
  const live = active?.replies
    ? active.replies.filter((reply) => reply.text).map((reply) => ({ role: 'assistant', content: reply.text, speaker_profile_id: reply.profileId }))
    : active?.text ? [{ role: 'assistant', content: active.text, speaker_profile_id: defaultProfileId }] : fallback
  const stored = profiles.map((profile) => resolveChatPortrait(
    messages.filter((message) => message.role === 'assistant' && (message.speaker_profile_id ?? defaultProfileId) === profile.id),
    [profile], profile.id,
  ))
  const latest = live.reduce<ChatPortraitMessage | undefined>((last, message) => message.role === 'assistant' ? message : last, undefined)
  if (!latest) {
    const profileId = messages.reduce<number | null>((last, message) => message.role === 'assistant' ? message.speaker_profile_id ?? defaultProfileId : last, defaultProfileId)
    return stored.find((signal) => signal?.profileId === profileId) ?? null
  }
  const current = resolveChatPortrait(live, profiles.map((profile) => ({ ...profile, emotion: null })), defaultProfileId)
  if (!current || current.source === 'expression') return current
  return stored.find((signal) => signal?.profileId === current.profileId) ?? current
}
