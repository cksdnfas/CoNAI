import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { settingsService } from '../settingsService'
import { buildRuntimeArtifact } from './system-module-artifacts'
import {
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

type LlmPresetCollectionKey = 'systemPromptPresets' | 'promptPresets' | 'structuredOutputJsonPresets'

const PRESET_TYPE_LABELS: Record<LlmPresetCollectionKey, string> = {
  systemPromptPresets: '시스템 프롬프트',
  promptPresets: '프롬프트',
  structuredOutputJsonPresets: '구조화 출력 JSON',
}

function normalizePresetType(value: unknown): LlmPresetCollectionKey {
  return value === 'systemPromptPresets' || value === 'structuredOutputJsonPresets'
    ? value
    : 'promptPresets'
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseJsonContent(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export async function executeLoadLlmPresetNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const presetType = normalizePresetType(resolvedInputs.preset_type)
  const presetName = normalizeOptionalString(resolvedInputs.preset_name)

  if (!presetName) {
    throw new Error('LLM 프리셋 이름이 필요해')
  }

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_progress',
    message: `LLM preset load started: ${moduleDefinition.name}`,
    details: {
      operationKey: 'system.load_llm_preset',
      presetType,
      presetName,
    },
  })

  const preset = settingsService.findLlmPresetByName(presetType, presetName)
  if (!preset) {
    throw new Error(`${PRESET_TYPE_LABELS[presetType]} 프리셋을 찾을 수 없어: ${presetName}`)
  }

  const content = preset.content
  const jsonValue = parseJsonContent(content)
  const metadataValue = {
    preset_type: presetType,
    preset_type_label: PRESET_TYPE_LABELS[presetType],
    preset_id: preset.id,
    preset_name: preset.name,
    content_length: content.length,
    has_json: jsonValue !== null,
  }

  const nodeArtifacts: Record<string, RuntimeArtifact> = {
    content: buildRuntimeArtifact(context.executionId, node.id, 'content', 'any', content, {
      kind: 'system-llm-preset-content',
      operationKey: 'system.load_llm_preset',
      presetType,
      presetName: preset.name,
    }),
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', content, {
      kind: 'system-llm-preset-text',
      operationKey: 'system.load_llm_preset',
      presetType,
      presetName: preset.name,
    }),
    prompt: buildRuntimeArtifact(context.executionId, node.id, 'prompt', 'prompt', content, {
      kind: 'system-llm-preset-prompt',
      operationKey: 'system.load_llm_preset',
      presetType,
      presetName: preset.name,
    }),
    metadata: buildRuntimeArtifact(context.executionId, node.id, 'metadata', 'json', metadataValue, {
      kind: 'system-llm-preset-metadata',
      operationKey: 'system.load_llm_preset',
      presetType,
      presetName: preset.name,
    }),
  }

  if (jsonValue !== null) {
    nodeArtifacts.json = buildRuntimeArtifact(context.executionId, node.id, 'json', 'json', jsonValue, {
      kind: 'system-llm-preset-json',
      operationKey: 'system.load_llm_preset',
      presetType,
      presetName: preset.name,
    })
  }

  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `LLM preset loaded: ${moduleDefinition.name}`,
    details: {
      operationKey: 'system.load_llm_preset',
      presetType,
      presetName: preset.name,
      outputKeys: Object.keys(nodeArtifacts),
    },
  })
}
