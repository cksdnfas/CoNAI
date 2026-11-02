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
  image: { task: 'Draw the scene of that reply with the image generation tool. Put the people, clothing, place and mood of that reply into the prompt.', done: (call) => drawsImage(call.tool) },
  redraw: { task: 'Redraw the image attached to that reply with the image generation tool: the same scene with a different composition or expression.', done: (call) => drawsImage(call.tool) },
  audio: { task: 'Make the spoken lines of that reply, or the sound of that scene, with order_audio.', done: (call) => call.tool === 'order_audio' },
  lore: { task: 'Pick the facts in that reply worth remembering later and save them as lore entries with save_lore.', done: (call) => call.tool === 'save_lore' },
  choices: { task: 'Offer a few next actions the user could choose in the situation of that reply, with offer_choices.', done: (call) => call.tool === 'offer_choices' },
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
    `[User instructions: a job on your reply right above (message_id=${messageId})]`,
    `- ${ORDERS[kind].task}`,
    'This is not a new turn of the conversation. Do not write new reply text; call only the tools the job needs. Their results attach to that reply.',
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
