import { DEFAULT_LLM_THINKING_SWITCH, LLM_THINKING_SWITCHES, type LlmThinkingSwitch } from '../llmGenerationOptions'
import { resolveChatCompletionTarget, streamChatCompletion } from './llmChatCompletion'
import { primaryModelOf } from './modelSlots'

export type ThinkingSwitchCheck = {
  model: string
  /** The connection's saved way of turning thinking off. */
  current: LlmThinkingSwitch
  /** The way that turned it off on this model (the current one when it works); null when none could be confirmed. */
  found: LlmThinkingSwitch | null
}

const PROBE_TIMEOUT_MS = 30_000

/**
 * Whether the connection's way of turning thinking off works on its first model, and if not, which one does: a tiny
 * request per way, the saved one first. A way works when the request succeeds and the reply carries no reasoning
 * (a separate reasoning field or an inline <think> block). "Send nothing" is tried last, for servers that refuse both
 * fields. Nothing is saved here.
 */
export async function checkThinkingSwitch(providerName: string, current: LlmThinkingSwitch = DEFAULT_LLM_THINKING_SWITCH): Promise<ThinkingSwitchCheck | null> {
  const model = primaryModelOf(providerName)
  if (!model) return null
  const order: LlmThinkingSwitch[] = [current, ...LLM_THINKING_SWITCHES.filter((option) => option !== current && option !== 'none'), ...(current === 'none' ? [] : ['none' as const])]
  for (const thinkingSwitch of order) {
    try {
      const target = resolveChatCompletionTarget(providerName, { model, generation: { reasoningEffort: 'none', maxTokens: 48, temperature: 0 } })
      const result = await streamChatCompletion({
        target: { ...target, thinkingSwitch, promptCacheMarks: false },
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        allowCompatibilityFallback: false,
      })
      if (!result.reasoning.trim() && !/^\s*<think>/i.test(result.content)) return { model, current, found: thinkingSwitch }
    } catch {
      // This way was refused or failed: try the next one.
    }
  }
  return { model, current, found: null }
}
