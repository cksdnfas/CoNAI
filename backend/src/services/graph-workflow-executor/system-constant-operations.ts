import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { saveArtifactBuffer } from './artifacts'
import { buildRuntimeArtifact, completeSystemNode } from './system-module-artifacts'
import {
  normalizeBase64ImageData,
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
      throw new Error('JSON 노드에는 JSON 값 1개가 필요해')
    }

    try {
      return JSON.parse(trimmedValue)
    } catch {
      throw new Error('JSON 노드에는 올바른 JSON 텍스트가 필요해')
    }
  }

  if (value === undefined) {
    throw new Error('JSON 노드에는 JSON 값 1개가 필요해')
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

function executeConstantScalarNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
  config: {
    operationKey: string
    inputKey: string
    outputKey: string
    artifactType: 'prompt' | 'text' | 'number' | 'boolean'
    normalizeValue: (value: unknown, label: string) => unknown
  },
) {
  const value = config.normalizeValue(resolvedInputs[config.inputKey], moduleDefinition.name)
  const nodeArtifacts: Record<string, RuntimeArtifact> = {
    [config.outputKey]: buildRuntimeArtifact(context.executionId, node.id, config.outputKey, config.artifactType, value, {
      kind: 'system-constant-input',
      operationKey: config.operationKey,
    }),
  }

  completeSystemNode(context, node, moduleDefinition, config.operationKey, nodeArtifacts)
}

/** Execute a constant text system node. */
export function executeConstantTextNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  executeConstantScalarNode(context, node, moduleDefinition, resolvedInputs, {
    operationKey: 'system.constant_text',
    inputKey: 'text',
    outputKey: 'text',
    artifactType: 'text',
    normalizeValue: normalizeRequiredStringInput,
  })
}

/** Execute a legacy prompt-key text system node. */
export function executeConstantPromptNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  executeConstantScalarNode(context, node, moduleDefinition, resolvedInputs, {
    operationKey: 'system.constant_prompt',
    inputKey: 'prompt',
    outputKey: 'prompt',
    artifactType: 'text',
    normalizeValue: normalizeRequiredStringInput,
  })
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
    throw new Error('이미지 노드에는 이미지 입력 1개가 필요해')
  }

  const base64 = normalizeBase64ImageData(imageValue)
  if (!base64) {
    throw new Error('이미지 노드에는 올바른 이미지 data URL 입력이 필요해')
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
  executeConstantScalarNode(context, node, moduleDefinition, resolvedInputs, {
    operationKey: 'system.constant_number',
    inputKey: 'number',
    outputKey: 'number',
    artifactType: 'number',
    normalizeValue: normalizeRequiredNumberInput,
  })
}

/** Execute a constant boolean system node. */
export function executeConstantBooleanNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  executeConstantScalarNode(context, node, moduleDefinition, resolvedInputs, {
    operationKey: 'system.constant_boolean',
    inputKey: 'boolean',
    outputKey: 'boolean',
    artifactType: 'boolean',
    normalizeValue: normalizeRequiredBooleanInput,
  })
}
