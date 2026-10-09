import type { SystemOperationHandler } from './system-operation-handler'
import {
  executeChatProfileReplyNode,
  executeDraftAppearanceTagsNode,
  executeJudgeTextNode,
  executeTranslateTextNode,
} from './system-llm-node-operations'

/** Handlers of the LLM nodes in BUILTIN_LLM_NODE_DEFINITIONS, keyed by operation key. */
export const LLM_NODE_HANDLERS: Record<string, SystemOperationHandler> = {
  'system.translate_text': executeTranslateTextNode,
  'system.judge_text': executeJudgeTextNode,
  'system.chat_profile_reply': executeChatProfileReplyNode,
  'system.draft_appearance_tags': executeDraftAppearanceTagsNode,
}
