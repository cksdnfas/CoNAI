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
} from './system-reference-operations'

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
  'system.random_prompt_from_group': executeRandomPromptFromGroup,
  'system.find_similar_images': executeFindSimilarImages,
  'system.load_prompt_from_reference': executeLoadPromptFromReference,
  'system.load_image_from_reference': executeLoadImageFromReference,
  'system.random_image_from_library': async (context, node, moduleDefinition) =>
    executeRandomImageFromLibrary(context, node, moduleDefinition),
  'system.extract_tags_from_image': executeExtractTagsFromImage,
  'system.extract_artist_from_image': executeExtractArtistFromImage,
  'system.final_result': executeFinalResultNode,
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
