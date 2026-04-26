import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { buildRuntimeArtifact, completeSystemNode } from './system-module-artifacts'
import {
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'

/** Normalize a JSON-like workflow input into a traversable value. */
function normalizeJsonInput(value: unknown) {
  if (typeof value === 'string') {
    const trimmedValue = value.trim()
    if (trimmedValue.length === 0) {
      throw new Error('JSON 추출 노드에는 JSON 입력이 필요해')
    }

    try {
      return JSON.parse(trimmedValue)
    } catch {
      throw new Error('JSON 추출 노드에는 올바른 JSON 입력이 필요해')
    }
  }

  if (value === undefined || value === null) {
    throw new Error('JSON 추출 노드에는 JSON 입력이 필요해')
  }

  return value
}

/** Parse a simple JSON path such as tags, items[0].title, or items.0.title. */
function parseJsonPath(pathValue: unknown) {
  if (typeof pathValue !== 'string') {
    return [] as string[]
  }

  return pathValue
    .trim()
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Resolve one value from a JSON object by a simple dot/bracket path. */
function resolveJsonPath(source: unknown, pathParts: string[]) {
  let currentValue = source

  for (const part of pathParts) {
    if (Array.isArray(currentValue)) {
      const index = Number(part)
      if (!Number.isInteger(index) || index < 0 || index >= currentValue.length) {
        throw new Error(`JSON 경로를 찾을 수 없어: ${part}`)
      }
      currentValue = currentValue[index]
      continue
    }

    if (currentValue && typeof currentValue === 'object' && part in currentValue) {
      currentValue = (currentValue as Record<string, unknown>)[part]
      continue
    }

    throw new Error(`JSON 경로를 찾을 수 없어: ${part}`)
  }

  return currentValue
}

/** Convert an extracted JSON value into a practical text representation. */
function stringifyJsonExtraction(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  if (Array.isArray(value) && value.every((item) => typeof item !== 'object' || item === null)) {
    return value.map((item) => stringifyJsonExtraction(item)).join(', ')
  }

  return JSON.stringify(value, null, 2)
}

/** Extract one value from a JSON input by path and expose practical text/json outputs. */
export function executeJsonExtractNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const sourceJson = normalizeJsonInput(resolvedInputs.json)
  const pathParts = parseJsonPath(resolvedInputs.path)
  const extractedValue = pathParts.length > 0 ? resolveJsonPath(sourceJson, pathParts) : sourceJson
  const extractedText = stringifyJsonExtraction(extractedValue)

  const nodeArtifacts = {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', extractedText, {
      kind: 'system-json-extract-text',
      operationKey: 'system.json_extract',
      path: pathParts.join('.'),
    }),
    json: buildRuntimeArtifact(context.executionId, node.id, 'json', 'json', extractedValue, {
      kind: 'system-json-extract-json',
      operationKey: 'system.json_extract',
      path: pathParts.join('.'),
    }),
  }

  completeSystemNode(context, node, moduleDefinition, 'system.json_extract', nodeArtifacts)
}
