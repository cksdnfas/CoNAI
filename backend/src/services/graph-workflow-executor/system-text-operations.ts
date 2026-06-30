import { WildcardService } from '../wildcardService'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { buildRuntimeArtifact, completeSystemNode } from './system-module-artifacts'
import {
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'

type TextTransformMode = 'extract' | 'replace'
type RandomChoiceOutputType = 'text' | 'number' | 'boolean' | 'json' | 'any'

type RandomTextChoiceEntry = {
  key?: unknown
  value?: unknown
}

const RANDOM_TEXT_CHOICE_FIELD_PREFIX = 'options.'

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
function normalizeRequiredTextInput(value: unknown, nodeLabel: string) {
  const textValue = normalizeTextValue(value)
  if (value === undefined || value === null) {
    throw new Error(`${nodeLabel} 노드에는 텍스트 입력이 필요해`)
  }
  return textValue
}

function normalizeRequiredTransformSourceText(value: unknown) {
  return normalizeRequiredTextInput(value, '텍스트 변환')
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

function normalizeRandomChoiceOutputType(value: unknown): RandomChoiceOutputType {
  return value === 'number'
    || value === 'boolean'
    || value === 'json'
    || value === 'any'
    ? value
    : 'text'
}

function parseRandomChoiceBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
  }

  return undefined
}

function normalizeRandomChoiceCandidateValue(value: unknown, outputType: RandomChoiceOutputType) {
  if (outputType === 'any') {
    return value === undefined || value === null || value === '' ? undefined : value
  }

  if (outputType === 'number') {
    const numericValue = Number(value)
    return Number.isFinite(numericValue) ? numericValue : undefined
  }

  if (outputType === 'boolean') {
    return parseRandomChoiceBoolean(value)
  }

  if (outputType === 'json') {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        return undefined
      }
    }

    return value
  }

  const textValue = normalizeTextValue(value)
  return textValue.length > 0 ? textValue : undefined
}

/** Normalize configured candidate rows from the random text choice node. */
function normalizeRandomTextChoiceEntries(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (entry && typeof entry === 'object' ? entry as RandomTextChoiceEntry : null))
      .filter((entry): entry is RandomTextChoiceEntry => Boolean(entry))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => ({ key, value: entryValue }))
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      return normalizeRandomTextChoiceEntries(JSON.parse(value))
    } catch {
      return []
    }
  }

  return []
}

/** Collect explicit rows plus dynamic upstream inputs such as `options.text_1`. */
function collectRandomTextChoiceCandidates(resolvedInputs: Record<string, any>, outputType: RandomChoiceOutputType) {
  const candidates: unknown[] = []
  const connectedValueByKey = new Map<string, unknown>()

  for (const [inputKey, inputValue] of Object.entries(resolvedInputs)) {
    if (!inputKey.startsWith(RANDOM_TEXT_CHOICE_FIELD_PREFIX)) {
      continue
    }

    const entryKey = inputKey.slice(RANDOM_TEXT_CHOICE_FIELD_PREFIX.length).trim()
    const candidateValue = normalizeRandomChoiceCandidateValue(inputValue, outputType)
    if (entryKey && candidateValue !== undefined) {
      connectedValueByKey.set(entryKey, candidateValue)
    }
  }

  const configuredKeys = new Set<string>()
  for (const entry of normalizeRandomTextChoiceEntries(resolvedInputs.options)) {
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    if (key) {
      configuredKeys.add(key)
    }

    const candidateValue = key && connectedValueByKey.has(key)
      ? connectedValueByKey.get(key)
      : normalizeRandomChoiceCandidateValue(entry.value, outputType)
    if (candidateValue !== undefined) {
      candidates.push(candidateValue)
    }
  }

  for (const [key, candidateValue] of connectedValueByKey) {
    if (!configuredKeys.has(key)) {
      candidates.push(candidateValue)
    }
  }

  return candidates
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

/** Execute the expandable random text choice system node. */
export function executeRandomTextChoiceNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const outputType = normalizeRandomChoiceOutputType(resolvedInputs.output_type)
  const candidates = collectRandomTextChoiceCandidates(resolvedInputs, outputType)
  const selectedValue = candidates.length > 0
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : outputType === 'text' ? '' : null

  const nodeArtifacts = {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', outputType, selectedValue, {
      kind: 'system-random-text-choice',
      operationKey: 'system.random_text_choice',
      outputType,
      candidateCount: candidates.length,
    }),
  }

  completeSystemNode(context, node, moduleDefinition, 'system.random_text_choice', nodeArtifacts)
}

/** Execute a prompt wildcard transform node and emit tool-specific prompt outputs. */
export function executeWildcardTransformNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const sourceText = normalizeRequiredTextInput(resolvedInputs.text, '와일드카드 적용')
  const generalText = WildcardService.parseWildcards(sourceText, 'general')
  const naiText = WildcardService.parseWildcards(sourceText, 'nai')
  const comfyuiText = WildcardService.parseWildcards(sourceText, 'comfyui')

  const nodeArtifacts = {
    general: buildRuntimeArtifact(context.executionId, node.id, 'general', 'prompt', generalText, {
      kind: 'system-wildcard-transform',
      operationKey: 'system.apply_wildcards',
      tool: 'general',
    }),
    nai: buildRuntimeArtifact(context.executionId, node.id, 'nai', 'prompt', naiText, {
      kind: 'system-wildcard-transform',
      operationKey: 'system.apply_wildcards',
      tool: 'nai',
    }),
    comfyui: buildRuntimeArtifact(context.executionId, node.id, 'comfyui', 'prompt', comfyuiText, {
      kind: 'system-wildcard-transform',
      operationKey: 'system.apply_wildcards',
      tool: 'comfyui',
    }),
  }

  completeSystemNode(context, node, moduleDefinition, 'system.apply_wildcards', nodeArtifacts)
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
