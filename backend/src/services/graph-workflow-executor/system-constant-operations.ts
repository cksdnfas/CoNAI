import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { saveArtifactBuffer } from './artifacts'
import { buildRuntimeArtifact } from './system-module-artifacts'
import {
  normalizeBase64ImageData,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

/** Normalize a required string-ish constant-node input. */
function normalizeRequiredStringInput(value: unknown, label: string) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }

  throw new Error(`${label} 노드에는 비어 있지 않은 문자열 입력이 필요해`)
}

/** Normalize a JSON constant-node input from either a parsed value or a JSON string. */
function normalizeJsonConstantInput(value: unknown) {
  if (typeof value === 'string') {
    const trimmedValue = value.trim()
    if (trimmedValue.length === 0) {
      throw new Error('상수 JSON 노드에는 JSON 값 1개가 필요해')
    }

    try {
      return JSON.parse(trimmedValue)
    } catch {
      throw new Error('상수 JSON 노드에는 올바른 JSON 텍스트가 필요해')
    }
  }

  if (value === undefined) {
    throw new Error('상수 JSON 노드에는 JSON 값 1개가 필요해')
  }

  return value
}

/** Normalize a number constant-node input. */
function normalizeRequiredNumberInput(value: unknown, label: string) {
  const numericValue = Number(value)
  if (Number.isFinite(numericValue)) {
    return numericValue
  }

  throw new Error(`${label} 노드에는 올바른 숫자 입력이 필요해`)
}

/** Normalize a boolean constant-node input. */
function normalizeRequiredBooleanInput(value: unknown, label: string) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }

  throw new Error(`${label} 노드에는 불리언 입력이 필요해`)
}

/** Store system node outputs and write the shared completion log. */
function completeSystemNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  operationKey: string,
  nodeArtifacts: Record<string, RuntimeArtifact>,
) {
  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `System module completed: ${moduleDefinition.name}`,
    details: {
      engine: 'system',
      operationKey,
      outputKeys: Object.keys(nodeArtifacts),
    },
  })
}

/** Execute a constant text system node. */
export function executeConstantTextNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const value = normalizeRequiredStringInput(resolvedInputs.text, moduleDefinition.name)
  const nodeArtifacts = {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', value, {
      kind: 'system-constant-input',
      operationKey: 'system.constant_text',
    }),
  }

  completeSystemNode(context, node, moduleDefinition, 'system.constant_text', nodeArtifacts)
}

/** Execute a constant prompt system node. */
export function executeConstantPromptNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const value = normalizeRequiredStringInput(resolvedInputs.prompt, moduleDefinition.name)
  const nodeArtifacts = {
    prompt: buildRuntimeArtifact(context.executionId, node.id, 'prompt', 'prompt', value, {
      kind: 'system-constant-input',
      operationKey: 'system.constant_prompt',
    }),
  }

  completeSystemNode(context, node, moduleDefinition, 'system.constant_prompt', nodeArtifacts)
}

/** Execute a constant JSON system node. */
export function executeConstantJsonNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const jsonValue = normalizeJsonConstantInput(resolvedInputs.json)
  const nodeArtifacts = {
    json: buildRuntimeArtifact(context.executionId, node.id, 'json', 'json', jsonValue, {
      kind: 'system-constant-input',
      operationKey: 'system.constant_json',
    }),
  }

  completeSystemNode(context, node, moduleDefinition, 'system.constant_json', nodeArtifacts)
}

/** Execute a constant image system node. */
export async function executeConstantImageNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const imageValue = resolvedInputs.image
  if (typeof imageValue !== 'string' || !imageValue.startsWith('data:image/')) {
    throw new Error('상수 이미지 노드에는 이미지 입력 1개가 필요해')
  }

  const base64 = normalizeBase64ImageData(imageValue)
  if (!base64) {
    throw new Error('상수 이미지 노드에는 올바른 이미지 data URL 입력이 필요해')
  }

  const mimeType = imageValue.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/)?.[1] ?? 'image/png'
  const { storagePath, artifactRecordId } = await saveArtifactBuffer(
    context.executionId,
    node.id,
    'image',
    'image',
    Buffer.from(base64, 'base64'),
    { mimeType },
  )

  const nodeArtifacts = {
    image: {
      type: 'image' as const,
      value: imageValue,
      storagePath,
      artifactRecordId,
      metadata: {
        kind: 'system-constant-input',
        operationKey: 'system.constant_image',
      },
    },
  }

  completeSystemNode(context, node, moduleDefinition, 'system.constant_image', nodeArtifacts)
}

/** Execute a constant number system node. */
export function executeConstantNumberNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const numberValue = normalizeRequiredNumberInput(resolvedInputs.number, moduleDefinition.name)
  const nodeArtifacts = {
    number: buildRuntimeArtifact(context.executionId, node.id, 'number', 'number', numberValue, {
      kind: 'system-constant-input',
      operationKey: 'system.constant_number',
    }),
  }

  completeSystemNode(context, node, moduleDefinition, 'system.constant_number', nodeArtifacts)
}

/** Execute a constant boolean system node. */
export function executeConstantBooleanNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const booleanValue = normalizeRequiredBooleanInput(resolvedInputs.boolean, moduleDefinition.name)
  const nodeArtifacts = {
    boolean: buildRuntimeArtifact(context.executionId, node.id, 'boolean', 'boolean', booleanValue, {
      kind: 'system-constant-input',
      operationKey: 'system.constant_boolean',
    }),
  }

  completeSystemNode(context, node, moduleDefinition, 'system.constant_boolean', nodeArtifacts)
}
