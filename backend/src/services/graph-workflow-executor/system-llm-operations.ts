import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { executeLlmTextRequest } from '../llmProviderService'
import { settingsService } from '../settingsService'
import { buildRuntimeArtifact } from './system-module-artifacts'
import {
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
} from './shared'

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeOptionalNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function resolveOptionalJsonText(value: unknown) {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : null
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }

  return null
}

export async function executeCallLlmNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const providerName = normalizeOptionalString(resolvedInputs.provider_name)
  const model = normalizeOptionalString(resolvedInputs.model)
  const legacyPresetName = normalizeOptionalString(resolvedInputs.preset_name)
  const systemPromptPresetName = normalizeOptionalString(resolvedInputs.system_prompt_preset_name) ?? legacyPresetName
  const promptPresetName = normalizeOptionalString(resolvedInputs.prompt_preset_name) ?? legacyPresetName
  const structuredOutputJsonPresetName = normalizeOptionalString(resolvedInputs.structured_output_json_preset_name) ?? legacyPresetName
  const systemPromptPreset = systemPromptPresetName ? settingsService.findLlmPresetByName('systemPromptPresets', systemPromptPresetName) : null
  const promptPreset = promptPresetName ? settingsService.findLlmPresetByName('promptPresets', promptPresetName) : null
  const structuredOutputJsonPreset = structuredOutputJsonPresetName
    ? settingsService.findLlmPresetByName('structuredOutputJsonPresets', structuredOutputJsonPresetName)
    : null

  if (systemPromptPresetName && !systemPromptPreset) {
    throw new Error(`시스템 프롬프트 프리셋을 찾을 수 없어: ${systemPromptPresetName}`)
  }

  if (promptPresetName && !promptPreset) {
    throw new Error(`프롬프트 프리셋을 찾을 수 없어: ${promptPresetName}`)
  }

  if (structuredOutputJsonPresetName && !structuredOutputJsonPreset) {
    throw new Error(`구조화 출력 JSON 프리셋을 찾을 수 없어: ${structuredOutputJsonPresetName}`)
  }

  if (legacyPresetName && !systemPromptPreset && !promptPreset && !structuredOutputJsonPreset) {
    throw new Error(`LLM 프리셋을 찾을 수 없어: ${legacyPresetName}`)
  }

  const prompt = normalizeOptionalString(resolvedInputs.prompt) ?? promptPreset?.content ?? ''
  const systemPrompt = normalizeOptionalString(resolvedInputs.system_prompt) ?? systemPromptPreset?.content ?? null
  const contextValue = normalizeOptionalString(resolvedInputs.context)
  const structuredOutputJson = resolveOptionalJsonText(resolvedInputs.structured_output_json) ?? structuredOutputJsonPreset?.content ?? null
  const responseMode = structuredOutputJson ? 'json' : resolvedInputs.response_mode === 'json' ? 'json' : 'text'

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_progress',
    message: `LLM node request started: ${moduleDefinition.name}`,
    details: {
      operationKey: 'system.call_llm',
      providerName,
      model,
      legacyPresetName,
      systemPromptPresetName,
      promptPresetName,
      structuredOutputJsonPresetName,
      responseMode,
      hasStructuredOutputJson: Boolean(structuredOutputJson),
    },
  })

  const result = await executeLlmTextRequest({
    providerName: providerName ?? '',
    prompt,
    systemPrompt,
    context: contextValue,
    model,
    temperature: normalizeOptionalNumber(resolvedInputs.temperature),
    maxTokens: normalizeOptionalNumber(resolvedInputs.max_tokens),
    responseMode,
    structuredOutputJson,
  })

  const metadataValue = {
    ...result.metadata,
    preset_name: legacyPresetName,
    system_prompt_preset_name: systemPromptPreset?.name ?? null,
    prompt_preset_name: promptPreset?.name ?? null,
    structured_output_json_preset_name: structuredOutputJsonPreset?.name ?? null,
    prompt_length: prompt.length,
    system_prompt_length: systemPrompt?.length ?? 0,
    context_length: contextValue?.length ?? 0,
    structured_output_json_length: structuredOutputJson?.length ?? 0,
  }

  const nodeArtifacts = {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', result.text, {
      kind: 'system-llm-text',
      operationKey: 'system.call_llm',
      providerName: result.providerName,
      model: result.model,
    }),
    json: buildRuntimeArtifact(context.executionId, node.id, 'json', 'json', result.json, {
      kind: 'system-llm-json',
      operationKey: 'system.call_llm',
      providerName: result.providerName,
      model: result.model,
      responseMode: result.responseMode,
    }),
    metadata: buildRuntimeArtifact(context.executionId, node.id, 'metadata', 'json', metadataValue, {
      kind: 'system-llm-metadata',
      operationKey: 'system.call_llm',
      providerName: result.providerName,
      model: result.model,
    }),
  }

  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `LLM node completed: ${moduleDefinition.name}`,
    details: {
      operationKey: 'system.call_llm',
      providerName: result.providerName,
      providerType: result.providerType,
      model: result.model,
      responseMode: result.responseMode,
      systemPromptPresetName: systemPromptPreset?.name ?? null,
      promptPresetName: promptPreset?.name ?? null,
      structuredOutputJsonPresetName: structuredOutputJsonPreset?.name ?? null,
      outputKeys: Object.keys(nodeArtifacts),
    },
  })
}
