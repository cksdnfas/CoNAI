import { currentLlmUsageContext } from '../llmUsage'
import { CodexChatStore } from './codexChatStore'
import type { ChatCompletionMessage, ChatCompletionTarget } from './llmChatCompletion'
import { serverContextLimit, summaryContextRoom } from './serverContextLimit'

/** Auxiliary requests share the chat's override, otherwise the executing profile's output allowance. */
export function auxiliaryMaxTokens(profile: { maxTokens?: number | null } | null | undefined, threadId?: number | null) {
  const id = threadId ?? currentLlmUsageContext().threadId
  return id == null ? profile?.maxTokens ?? null : CodexChatStore.outputTokenLimit(id, profile?.maxTokens)
}

/** Keep complete input; fit the output allowance to the real model context, or reject an input that cannot fit. */
export async function fitAuxiliaryTarget(target: ChatCompletionTarget, messages: ChatCompletionMessage[]): Promise<ChatCompletionTarget> {
  return (await fitAuxiliaryHistory(target, [], () => messages)).target
}

/** Drop only oldest complete history turns; build keeps mandatory instructions, the newest turn and current reply intact. */
export async function fitAuxiliaryHistory<T>(target: ChatCompletionTarget, turns: readonly T[], build: (turns: readonly T[]) => ChatCompletionMessage[]) {
  const limit = await serverContextLimit(target)
  for (let first = 0; ; first++) {
    const messages = build(turns.slice(first))
    const room = summaryContextRoom(limit, messages)
    if (room !== false) {
      const maxTokens = target.generation.maxTokens
      return { messages, target: { ...target, generation: { ...target.generation, maxTokens: room === null ? maxTokens : Math.min(maxTokens ?? room, room) } } }
    }
    if (turns.length - first <= 1) throw new Error('최신 턴과 필수 입력이 모델의 컨텍스트 한도를 넘었어. 입력을 줄이거나 더 큰 컨텍스트의 모델을 골라줘.')
  }
}
