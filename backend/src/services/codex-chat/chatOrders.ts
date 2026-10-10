import type { ChatReplyQuote } from '@conai/shared'
import { resolveChatAccess, resolveChatProfileToolGrant, type ChatAccess } from './codexChatAccess'
import { ChatProfileStore, type ChatProfile } from './chatProfiles'
import { ChatFlagError, type ChatFlagSnapshot } from './chatFlags'

/**
 * Orders: one tool job the user asks a character for from its reply's ⋯ bar ("draw this scene"). An order rides on a
 * user message that quotes the reply, as a snapshot like a flag: the model reads it as the user's instruction for this
 * message (and so it comes before the judge, see JudgedTurn.userInstructed).
 */

export const CHAT_ORDER_KINDS = ['image', 'redraw', 'audio', 'lore', 'choices'] as const
export type ChatOrderKind = (typeof CHAT_ORDER_KINDS)[number]

/** `name` is what the message and its chip show; `content` what the model is told about the quoted reply. */
const ORDERS: Record<ChatOrderKind, { icon: string; name: string; content: (messageId: number) => string }> = {
  image: { icon: 'lucide:image', name: '장면 그리기', content: (id) => `message_id=${id} 메시지의 장면을 이미지 생성 도구로 그려. 그 메시지의 인물·옷차림·장소·분위기를 프롬프트에 담아.` },
  redraw: { icon: 'lucide:repeat', name: '다시 그리기', content: (id) => `message_id=${id} 메시지의 이미지를 이미지 생성 도구로 다시 그려. 같은 장면을 다른 구도나 표정으로 그려.` },
  audio: { icon: 'lucide:mic', name: '소리 만들기', content: (id) => `message_id=${id} 메시지의 대사나 그 장면의 소리를 order_audio로 만들어.` },
  lore: { icon: 'lucide:bookmark', name: '로어로 남기기', content: (id) => `message_id=${id} 메시지에서 나중에도 기억해 둘 사실을 골라 save_lore로 로어 항목을 남겨.` },
  choices: { icon: 'lucide:list-checks', name: '선택지 만들기', content: (id) => `message_id=${id} 메시지의 상황에서 사용자가 고를 다음 행동 몇 가지를 offer_choices로 내.` },
}

/** Free-form image tools a profile without generation presets may be allowed. */
const IMAGE_TOOLS = ['generate_nai', 'generate_comfyui', 'submit_generation_job']

/**
 * The orders this profile can carry out for this account: the tools each needs are in its grant. `choices` needs a
 * direct chat (offer_choices is not offered in rooms) and, like offer_choices itself, a profile with tools.
 */
export function chatOrdersOf(profile: ChatProfile, access: ChatAccess, kind: 'direct' | 'group'): ChatOrderKind[] {
  const grant = resolveChatProfileToolGrant(profile, access)
  const allows = (name: string) => grant.toolAllowlist === null || grant.toolAllowlist.includes(name)
  const generates = grant.scopes.includes('generate')
  const draws = generates && (profile.generationPresetIds.length > 0 || IMAGE_TOOLS.some(allows))
  return CHAT_ORDER_KINDS.filter((order) => {
    switch (order) {
      case 'image':
      case 'redraw': return draws
      case 'audio': return generates && allows('order_audio')
      case 'lore': return profile.allowLoreProposals
      case 'choices': return kind === 'direct' && grant.scopes.length > 0
    }
  })
}

/**
 * The order of a message being sent (`value` from the request), checked against the reply it quotes: a character's
 * reply that its speaker (in a direct chat, the chat's profile) can act on. Null when the message carries none.
 */
export function resolveChatOrder(accountId: number | null, value: unknown, replyTo: ChatReplyQuote | null, chat: { kind: 'direct' | 'group'; profileId: number | null }): ChatFlagSnapshot | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !(CHAT_ORDER_KINDS as readonly string[]).includes(value)) throw new ChatFlagError('알 수 없는 지시야.')
  const kind = value as ChatOrderKind
  if (!replyTo || replyTo.role !== 'assistant') throw new ChatFlagError('지시는 캐릭터 답변에만 내릴 수 있어.')
  if (kind === 'redraw' && !replyTo.media) throw new ChatFlagError('이 답변에는 다시 그릴 이미지가 없어.')
  const profileId = replyTo.speakerProfileId ?? chat.profileId
  const profile = profileId === null ? null : ChatProfileStore.find(profileId)
  if (!profile || !chatOrdersOf(profile, resolveChatAccess(accountId), chat.kind).includes(kind)) throw new ChatFlagError('이 캐릭터는 그 도구를 쓸 수 없어.', 403)
  const order = ORDERS[kind]
  return { id: 0, icon: order.icon, name: order.name, content: order.content(replyTo.messageId), order: kind }
}
