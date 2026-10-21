import type { PluginResearchInput, PluginResearchResult } from '@conai/shared'
import type { ChatProfile } from './chatProfiles'
import { resolveProfileModel } from './chatModelRoles'
import { resolveChatCompletionTarget } from './llmChatCompletion'

/** Internal execution capability. Never constructed from model arguments or HTTP MCP context. */
export class ChatResearchExecution {
  readonly allowedPostIds: number[]
  readonly maxModelCalls: number
  readonly maxToolCalls: number
  readonly result: PluginResearchResult

  constructor(input: PluginResearchInput) {
    this.allowedPostIds = [...input.allowedPostIds]
    this.maxModelCalls = input.maxModelCalls ?? 4
    this.maxToolCalls = input.maxToolCalls ?? 8
    this.result = { slotId: input.slotId, activityId: input.activityId, modelCalls: 0, toolCalls: 0, stopReason: 'completed', evidence: [] }
  }

  allowsTool(name: string) { return name === 'posts_search' || name === 'posts_read' }

  takeTool() {
    if (this.result.toolCalls >= this.maxToolCalls) { this.result.stopReason = 'tool_limit'; return false }
    this.result.toolCalls++
    return true
  }

  canCallModel() {
    if (this.result.modelCalls < this.maxModelCalls) return true
    this.result.stopReason = 'model_limit'
    return false
  }

  /** Called immediately before each actual provider request, including native compatibility retries. */
  takeModel() {
    if (!this.canCallModel()) throw new Error('Research model call limit reached.')
    this.result.modelCalls++
  }
}

export function requireResearchProfile(profile: ChatProfile) {
  if (profile.engine !== 'llm' || profile.llmRuntime !== 'direct') throw new Error('Research requires a direct API LLM profile; Codex, Claude and Pi are unsupported.')
  const model = resolveProfileModel(profile, 'chat')
  if (!model || resolveChatCompletionTarget(model.providerName, { model: model.model }).transport) {
    throw new Error('Research requires a direct API LLM connection.')
  }
}
