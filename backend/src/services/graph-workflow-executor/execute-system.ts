import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import { PromptCollectionModel } from '../../models/PromptCollection'
import { PromptGroupModel } from '../../models/PromptGroup'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import {
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

type PromptCollectionType = 'positive' | 'negative' | 'auto'

type PromptRecord = {
  id: number
  prompt: string
  usage_count: number
  group_id: number | null
  synonyms?: string[]
}

/** Persist one structured runtime artifact row and keep it available to downstream nodes. */
function buildRuntimeArtifact(executionId: number, nodeId: string, portKey: string, artifactType: 'prompt' | 'text' | 'json', value: unknown, metadata?: Record<string, unknown>): RuntimeArtifact {
  GraphExecutionArtifactModel.create({
    execution_id: executionId,
    node_id: nodeId,
    port_key: portKey,
    artifact_type: artifactType,
    metadata: JSON.stringify({ value, ...(metadata ?? {}) }),
  })

  return {
    type: artifactType,
    value,
    metadata,
  }
}

/** Normalize prompt collection type inputs. */
function normalizePromptCollectionType(value: unknown): PromptCollectionType {
  if (typeof value !== 'string') {
    return 'positive'
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'negative' || normalized === 'auto') {
    return normalized
  }

  return 'positive'
}

/** Resolve one prompt group by explicit id or exact group name. */
function resolvePromptGroup(groupIdValue: unknown, groupNameValue: unknown, type: PromptCollectionType) {
  const explicitGroupId = Number(groupIdValue)
  if (Number.isFinite(explicitGroupId) && explicitGroupId > 0) {
    return PromptGroupModel.findById(explicitGroupId, type)
  }

  if (typeof groupNameValue === 'string' && groupNameValue.trim()) {
    return PromptGroupModel.findByName(groupNameValue.trim(), type)
  }

  return null
}

/** Deterministically map an integer seed into an item index. */
function pickSeededIndex(length: number, seedValue: unknown) {
  if (!Number.isFinite(length) || length <= 0) {
    return 0
  }

  const numericSeed = Number(seedValue)
  if (!Number.isFinite(numericSeed)) {
    return Math.floor(Math.random() * length)
  }

  const normalizedSeed = Math.abs(Math.trunc(numericSeed))
  return normalizedSeed % length
}

/** Execute the built-in random prompt from group system module. */
async function executeRandomPromptFromGroup(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const promptType = normalizePromptCollectionType(resolvedInputs.type)
  const promptGroup = resolvePromptGroup(resolvedInputs.group_id, resolvedInputs.group_name, promptType)

  if (!promptGroup) {
    throw new Error('Random Prompt From Group requires a valid group_id or group_name')
  }

  const promptItems = PromptCollectionModel.getPromptsByGroupId(promptGroup.id, promptType) as PromptRecord[]

  if (!Array.isArray(promptItems) || promptItems.length === 0) {
    throw new Error(`Prompt group is empty: ${promptGroup.group_name}`)
  }

  const selectedIndex = pickSeededIndex(promptItems.length, resolvedInputs.seed)
  const selectedPrompt = promptItems[selectedIndex]
  const entryJsonValue = {
    id: selectedPrompt.id,
    prompt: selectedPrompt.prompt,
    usage_count: selectedPrompt.usage_count,
    group_id: selectedPrompt.group_id,
    group_name: promptGroup.group_name,
    type: promptType,
    selected_index: selectedIndex,
    total_candidates: promptItems.length,
    synonyms: selectedPrompt.synonyms ?? [],
  }

  const nodeArtifacts = {
    prompt: buildRuntimeArtifact(context.executionId, node.id, 'prompt', 'prompt', selectedPrompt.prompt, {
      kind: 'system-random-prompt',
      group_name: promptGroup.group_name,
      type: promptType,
    }),
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', selectedPrompt.prompt, {
      kind: 'system-random-prompt',
      group_name: promptGroup.group_name,
      type: promptType,
    }),
    entry_json: buildRuntimeArtifact(context.executionId, node.id, 'entry_json', 'json', entryJsonValue, {
      kind: 'system-random-prompt-entry',
      group_name: promptGroup.group_name,
      type: promptType,
    }),
  }

  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `System module completed: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey: 'system.random_prompt_from_group',
      selectedPromptId: selectedPrompt.id,
      groupName: promptGroup.group_name,
      type: promptType,
    },
  })
}

/** Execute a CoNAI system-native module node through a stable operation key. */
export async function executeSystemModule(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const operationKey =
    typeof moduleDefinition.template_defaults?.operation_key === 'string'
      ? moduleDefinition.template_defaults.operation_key
      : typeof moduleDefinition.internal_fixed_values?.operation_key === 'string'
        ? moduleDefinition.internal_fixed_values.operation_key
        : null

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

  if (operationKey === 'system.random_prompt_from_group') {
    await executeRandomPromptFromGroup(context, node, moduleDefinition, resolvedInputs)
    return
  }

  throw new Error(`System module operation not implemented yet: ${operationKey}`)
}
