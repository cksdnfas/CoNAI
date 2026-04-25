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

function parseStructuredOutputJsonPreset(value: string, presetName: string) {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`구조화 출력 JSON 프리셋이 올바른 JSON이 아니야: ${presetName}`)
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
  const nodeArtifacts: Record<string, RuntimeArtifact> = presetType === 'structuredOutputJsonPresets'
    ? {
        json: buildRuntimeArtifact(
          context.executionId,
          node.id,
          'json',
          'json',
          parseStructuredOutputJsonPreset(content, preset.name),
          {
            kind: 'system-llm-preset-json',
            operationKey: 'system.load_llm_preset',
            presetType,
            presetName: preset.name,
          },
        ),
      }
    : {
        text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', content, {
          kind: 'system-llm-preset-text',
          operationKey: 'system.load_llm_preset',
          presetType,
          presetName: preset.name,
        }),
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
