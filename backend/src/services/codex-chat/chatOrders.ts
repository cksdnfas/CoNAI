import { isCodexChatCreationTool, type ChatToolCall } from '@conai/shared'
import { resolveChatProfileToolGrant, type ChatAccess } from './codexChatAccess'
import type { ChatProfile } from './chatProfiles'
import { ChatFlagError } from './chatFlags'

/**
 * Orders: one tool job the user asks a character for from its reply's ⋯ bar ("draw this scene"). The job is done in
 * that reply's name, as if the reply had done it (see chatOrderRunner): its results land in that reply and no new
 * message is written.
 */

export const CHAT_ORDER_KINDS = ['image', 'redraw', 'audio', 'lore', 'choices'] as const
export type ChatOrderKind = (typeof CHAT_ORDER_KINDS)[number]

/** What the model is asked to do about the reply, and the call that does it. */
const ORDERS: Record<ChatOrderKind, { task: string; done: (call: Pick<ChatToolCall, 'tool'>) => boolean }> = {
  image: { task: '그 답변의 장면을 이미지 생성 도구로 그려. 그 답변의 인물·옷차림·장소·분위기를 프롬프트에 담아.', done: (call) => drawsImage(call.tool) },
  redraw: { task: '그 답변에 붙은 이미지를 이미지 생성 도구로 다시 그려. 같은 장면을 다른 구도나 표정으로 그려.', done: (call) => drawsImage(call.tool) },
  audio: { task: '그 답변의 대사나 그 장면의 소리를 order_audio로 만들어.', done: (call) => call.tool === 'order_audio' },
  lore: { task: '그 답변에서 나중에도 기억해 둘 사실을 골라 save_lore로 로어 항목을 남겨.', done: (call) => call.tool === 'save_lore' },
  choices: { task: '그 답변의 상황에서 사용자가 고를 다음 행동 몇 가지를 offer_choices로 내.', done: (call) => call.tool === 'offer_choices' },
}

const AUDIO_TOOLS = new Set(['order_audio', 'retry_audio_order_job'])

function drawsImage(tool: string) {
  return isCodexChatCreationTool(tool) && !AUDIO_TOOLS.has(tool)
}

export function parseChatOrderKind(value: unknown): ChatOrderKind {
  if (typeof value !== 'string' || !(CHAT_ORDER_KINDS as readonly string[]).includes(value)) throw new ChatFlagError('알 수 없는 지시야.')
  return value as ChatOrderKind
}

/**
 * The order as the model reads it, after the conversation up to the reply (`messageId`, the last message it sees):
 * a job on that reply, not a new turn of the conversation.
 */
export function chatOrderDirective(kind: ChatOrderKind, messageId: number) {
  return [
    `[사용자 지시: 바로 위 네 답변(message_id=${messageId})에 덧붙일 작업]`,
    `- ${ORDERS[kind].task}`,
    '이건 대화의 새 차례가 아니야. 답변 글은 새로 쓰지 말고 필요한 도구만 불러. 도구 결과는 그 답변에 바로 붙어.',
  ].join('\n')
}

/** Whether a call that went through did the job of the order. */
export function chatOrderDone(kind: ChatOrderKind, call: Pick<ChatToolCall, 'tool'>) {
  return ORDERS[kind].done(call)
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
