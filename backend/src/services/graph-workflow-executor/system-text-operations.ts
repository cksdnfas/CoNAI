import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { buildRuntimeArtifact } from './system-module-artifacts'
import {
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

type TextTransformMode = 'extract' | 'replace'

/** Normalize one upstream workflow value into text for text utilities. */
function normalizeTextValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  try {
    const jsonText = JSON.stringify(value)
    if (typeof jsonText === 'string') {
      return jsonText
    }
  } catch {
    // Fall back to the default string coercion below.
  }

  return String(value)
}

/** Normalize one required upstream workflow value into text for regex processing. */
function normalizeRequiredTransformSourceText(value: unknown) {
  const textValue = normalizeTextValue(value)
  if (value === undefined || value === null) {
    throw new Error('텍스트 변환 노드에는 값 입력이 필요해')
  }
  return textValue
}

/** Normalize the requested regex transform mode. */
function normalizeTextTransformMode(value: unknown): TextTransformMode {
  return value === 'replace' ? 'replace' : 'extract'
}

/** Normalize one capture-group index into a safe non-negative integer. */
function normalizeGroupIndex(value: unknown) {
  const numericValue = Number(value)
  if (Number.isFinite(numericValue) && numericValue >= 0) {
    return Math.floor(numericValue)
  }

  return 0
}

/** Build one JavaScript RegExp instance from node config. */
function buildTransformRegex(pattern: string, flags: string) {
  try {
    return new RegExp(pattern, flags)
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 정규식 오류'
    throw new Error(`텍스트 변환 노드 정규식 설정이 올바르지 않아: ${message}`)
  }
}

/** Apply extract or replace logic to one normalized text input. */
function transformTextValue(params: {
  sourceText: string
  mode: TextTransformMode
  pattern: string
  flags: string
  replacement: string
  groupIndex: number
  prefix: string
  suffix: string
}) {
  const { sourceText, mode, pattern, flags, replacement, groupIndex, prefix, suffix } = params

  let transformedText = sourceText
  if (pattern.trim().length > 0) {
    const regex = buildTransformRegex(pattern, flags)

    if (mode === 'replace') {
      transformedText = sourceText.replace(regex, replacement)
    } else {
      const match = regex.exec(sourceText)
      transformedText = match?.[groupIndex] ?? ''
    }
  }

  return transformedText.length > 0 ? `${prefix}${transformedText}${suffix}` : ''
}

/** Merge optional A/B/C text slots with the configured separators. */
function mergeTextSlots(params: {
  textA: string
  textB: string
  textC: string
  separatorAB: string
  separatorBC: string
}) {
  const { textA, textB, textC, separatorAB, separatorBC } = params
  const chunks: string[] = []

  if (textA.length > 0) {
    chunks.push(textA)
  }

  if (textB.length > 0) {
    if (textA.length > 0) {
      chunks.push(separatorAB)
    }
    chunks.push(textB)
  }

  if (textC.length > 0) {
    if (textB.length > 0) {
      chunks.push(separatorBC)
    } else if (textA.length > 0) {
      chunks.push(separatorAB)
    }
    chunks.push(textC)
  }

  return chunks.join('')
}

/** Store one completed system-node artifact bundle and write the shared log. */
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

/** Execute the built-in A/B/C text merge system node. */
export function executeTextMergeNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const mergedText = mergeTextSlots({
    textA: normalizeTextValue(resolvedInputs.text_a),
    textB: normalizeTextValue(resolvedInputs.text_b),
    textC: normalizeTextValue(resolvedInputs.text_c),
    separatorAB: normalizeTextValue(resolvedInputs.separator_ab),
    separatorBC: normalizeTextValue(resolvedInputs.separator_bc),
  })

  const nodeArtifacts = {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', mergedText, {
      kind: 'system-text-merge',
      operationKey: 'system.merge_text',
    }),
  }

  completeSystemNode(context, node, moduleDefinition, 'system.merge_text', nodeArtifacts)
}

/** Execute a regex-capable text transform node for text or JSON-like inputs. */
export function executeRegexTextTransformNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const sourceText = normalizeRequiredTransformSourceText(resolvedInputs.value)
  const transformedText = transformTextValue({
    sourceText,
    mode: normalizeTextTransformMode(resolvedInputs.mode),
    pattern: normalizeTextValue(resolvedInputs.pattern),
    flags: normalizeTextValue(resolvedInputs.flags),
    replacement: normalizeTextValue(resolvedInputs.replacement),
    groupIndex: normalizeGroupIndex(resolvedInputs.group_index),
    prefix: normalizeTextValue(resolvedInputs.prefix),
    suffix: normalizeTextValue(resolvedInputs.suffix),
  })

  const nodeArtifacts = {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', transformedText, {
      kind: 'system-text-transform',
      operationKey: 'system.regex_text_transform',
    }),
  }

  completeSystemNode(context, node, moduleDefinition, 'system.regex_text_transform', nodeArtifacts)
}
