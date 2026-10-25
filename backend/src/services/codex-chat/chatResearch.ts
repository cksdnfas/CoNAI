import type { PluginResearchInput, PluginResearchResult } from '@conai/shared'
import type { ChatProfile } from './chatProfiles'
import { resolveProfileModel } from './chatModelRoles'
import { resolveChatCompletionTarget } from './llmChatCompletion'
import type { McpRequester } from '../../mcp/context'
import { actorFromRequester } from '../posts/postActor'
import { PostStore } from '../posts/postStore'
import { chatToolRoundLimit } from './chatSettings'

/** Internal execution capability. Never constructed from model arguments or HTTP MCP context. */
export class ChatResearchExecution {
  readonly allowedPostIds: number[]
  readonly maxModelCalls: number
  /** Null: no per-call cap, as in a chat (rounds bound the run); a summary has no tools. */
  readonly maxToolCalls: number | null
  readonly maxTurns: number
  readonly summary: boolean
  readonly result: PluginResearchResult

  /**
   * The app-wide tool round limit, counted as in a chat reply: that many tool rounds, then one answer without tools.
   * A caller's own maxModelCalls/maxTurns/maxToolCalls are accepted for older plugins and ignored.
   */
  constructor(input: PluginResearchInput, runtime: PluginResearchResult['limits']['runtime'] = 'direct', toolRounds = chatToolRoundLimit()) {
    this.allowedPostIds = [...input.allowedPostIds]
    this.summary = input.purpose === 'summary'
    this.maxModelCalls = this.summary ? 1 : toolRounds + 1
    this.maxToolCalls = this.summary ? 0 : null
    this.maxTurns = this.summary ? 1 : toolRounds + 1
    this.result = { slotId: input.slotId, activityId: input.activityId, modelCalls: runtime === 'direct' ? 0 : null,
      turns: runtime === 'claude' || runtime === 'pi' ? 0 : null, toolCalls: 0, stopReason: 'completed', evidence: [],
      limits: { runtime, maxModelCalls: runtime === 'direct' ? this.maxModelCalls : null,
        maxTurns: runtime === 'claude' || runtime === 'pi' ? this.maxTurns : null, maxToolCalls: this.maxToolCalls } }
  }

  allowsTool(name: string) { return !this.summary && (name === 'posts_search' || name === 'posts_read') }

  recordEvidence(evidence: PluginResearchResult['evidence'][number]) {
    this.result.evidence.push(evidence)
  }

  takeTurn() {
    if (this.result.turns !== null) this.result.turns++
  }

  finalNativeTurn(continuationNeeded = false) {
    if (this.summary) return true
    if (this.result.turns !== null && this.result.turns >= this.maxTurns - 1) {
      if (this.result.turns > 0 && continuationNeeded) this.result.stopReason = 'turn_limit'
      return true
    }
    return false
  }

  validateSources(requester: McpRequester, profileId: number) {
    const sources = PostStore.publishedSources(actorFromRequester(requester, profileId), this.allowedPostIds)
    if (sources.length !== new Set(this.allowedPostIds).size) throw new Error('Research source access changed: every allowed post must still be published and accessible.')
  }

  finalModelRound() {
    if (this.summary) return true
    if (this.result.modelCalls === null) return this.finalNativeTurn()
    if (this.result.modelCalls >= this.maxModelCalls - 1) {
      if (this.result.modelCalls > 0) this.result.stopReason = 'model_limit'
      return true
    }
    return false
  }

  /** Counts a dispatched tool call; a summary has none to dispatch. */
  takeTool() {
    if (this.summary) return false
    this.result.toolCalls++
    return true
  }

  canCallModel() {
    if (this.result.modelCalls === null) return true
    if (this.result.modelCalls < this.maxModelCalls) return true
    this.result.stopReason = 'model_limit'
    return false
  }

  /** Called immediately before each actual provider request, including native compatibility retries. */
  takeModel() {
    if (this.result.modelCalls === null) return
    if (!this.canCallModel()) throw new Error('Research model call limit reached.')
    this.result.modelCalls++
  }
}

export function requireResearchProfile(profile: ChatProfile) {
  if (profile.engine === 'codex') return 'codex' as const
  const model = resolveProfileModel(profile, 'chat')
  if (!model) throw new Error('Research profile has no model connection.')
  const target = resolveChatCompletionTarget(model.providerName, { model: model.model })
  if (target.transport === 'claude-code') return 'claude' as const
  return profile.llmRuntime === 'pi' ? 'pi' as const : 'direct' as const
}
