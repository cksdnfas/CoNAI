import { type GraphWorkflowNode } from '../../types/moduleGraph'
import {
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'
import {
  executeConstantBooleanNode,
  executeConstantImageNode,
  executeConstantJsonNode,
  executeConstantNumberNode,
  executeConstantPromptNode,
  executeConstantTextNode,
} from './system-constant-operations'
import { executeRegexTextTransformNode, executeTextMergeNode, executeWildcardTransformNode } from './system-text-operations'
import { executeCallLlmNode } from './system-llm-operations'
import { executeLoadLlmPresetNode } from './system-llm-preset-operations'
import {
  executeFindSimilarImages,
  executeExtractArtistFromImage,
  executeExtractTagsFromImage,
} from './system-image-analysis-operations'
import { executeRandomPromptFromGroup } from './system-prompt-operations'
import { executeFinalResultNode } from './system-result-operations'
import {
  executeLoadImageFromReference,
  executeLoadPromptFromReference,
  executeRandomImageFromLibrary,
  executeRandomVideoFromLibrary,
} from './system-reference-operations'
import { executeCodexImageGenerationNode } from './system-codex-operations'
import { executeCallCodexMessageNode } from './system-codex-message-operations'
import { executeJsonExtractNode } from './system-json-operations'
import {
  executeLogicAndNode,
  executeLogicCompareNode,
  executeLogicConditionSelectNode,
  executeLogicIfBranchNode,
  executeLogicNotNode,
  executeLogicOrNode,
  executeLogicTextMatchNode,
  executeLogicValuePresenceNode,
  executeWorkflowStopNode,
} from './system-logic-operations'

type SystemOperationHandler = (
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) => Promise<void> | void

const SYSTEM_OPERATION_HANDLERS: Record<string, SystemOperationHandler> = {
  'system.constant_text': executeConstantTextNode,
  'system.constant_prompt': executeConstantPromptNode,
  'system.constant_json': executeConstantJsonNode,
  'system.constant_image': executeConstantImageNode,
  'system.constant_number': executeConstantNumberNode,
  'system.constant_boolean': executeConstantBooleanNode,
  'system.regex_text_transform': executeRegexTextTransformNode,
  'system.json_extract': executeJsonExtractNode,
  'system.merge_text': executeTextMergeNode,
  'system.apply_wildcards': executeWildcardTransformNode,
  'system.random_prompt_from_group': executeRandomPromptFromGroup,
  'system.load_llm_preset': executeLoadLlmPresetNode,
  'system.call_llm': executeCallLlmNode,
  'system.call_codex_message': executeCallCodexMessageNode,
  'system.generate_image_codex': executeCodexImageGenerationNode,
  'system.find_similar_images': executeFindSimilarImages,
  'system.load_prompt_from_reference': executeLoadPromptFromReference,
  'system.load_image_from_reference': executeLoadImageFromReference,
  'system.random_image_from_library': async (context, node, moduleDefinition) =>
    executeRandomImageFromLibrary(context, node, moduleDefinition),
  'system.random_video_from_library': async (context, node, moduleDefinition) =>
    executeRandomVideoFromLibrary(context, node, moduleDefinition),
  'system.extract_tags_from_image': executeExtractTagsFromImage,
  'system.extract_artist_from_image': executeExtractArtistFromImage,
  'system.logic_and': executeLogicAndNode,
  'system.logic_or': executeLogicOrNode,
  'system.logic_not': executeLogicNotNode,
  'system.logic_compare': executeLogicCompareNode,
  'system.logic_text_match': executeLogicTextMatchNode,
  'system.logic_value_presence': executeLogicValuePresenceNode,
  'system.logic_condition_select': executeLogicConditionSelectNode,
  'system.logic_if_branch': executeLogicIfBranchNode,
  'system.workflow_stop': executeWorkflowStopNode,
  'system.final_result': executeFinalResultNode,
}

/** List the built-in system operation keys that the workflow executor can run. */
export function getSupportedSystemOperationKeys() {
  return Object.keys(SYSTEM_OPERATION_HANDLERS)
}

/** Resolve the stable system operation key from module defaults. */
function resolveSystemOperationKey(moduleDefinition: ParsedModuleDefinition) {
  if (typeof moduleDefinition.template_defaults?.operation_key === 'string') {
    return moduleDefinition.template_defaults.operation_key
  }

  if (typeof moduleDefinition.internal_fixed_values?.operation_key === 'string') {
    return moduleDefinition.internal_fixed_values.operation_key
  }

  return null
}

/** Execute a CoNAI system-native module node through a stable operation key. */
export async function executeSystemModule(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const operationKey = resolveSystemOperationKey(moduleDefinition)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_start',
    message: `System module start: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey,
      inputKeys: Object.keys(resolvedInputs),
    },
  })

  if (!operationKey) {
    throw new Error(`System module ${moduleDefinition.name} is missing operation_key`)
  }

  const executeOperation = SYSTEM_OPERATION_HANDLERS[operationKey]
  if (!executeOperation) {
    throw new Error(`System module operation not implemented yet: ${operationKey}`)
  }

  await executeOperation(context, node, moduleDefinition, resolvedInputs)
}
