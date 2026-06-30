import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { executeLlmTextRequest } from '../llmProviderService'
import { buildRuntimeArtifact } from './system-module-artifacts'
import {
  normalizeOptionalString,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

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
  const legacyModelOverride = normalizeOptionalString(resolvedInputs.model)
  const prompt = normalizeOptionalString(resolvedInputs.prompt) ?? ''
  const systemPrompt = normalizeOptionalString(resolvedInputs.system_prompt)
  const contextValue = normalizeOptionalString(resolvedInputs.context)
  const imageDataUrl = normalizeOptionalString(resolvedInputs.image)
  const structuredOutputJson = resolveOptionalJsonText(resolvedInputs.structured_output_json)
  const responseMode = structuredOutputJson ? 'json' : 'text'

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_progress',
    message: `LLM node request started: ${moduleDefinition.name}`,
    details: {
      operationKey: 'system.call_llm',
      providerName,
      modelOverrideIgnored: legacyModelOverride,
      responseMode,
      hasStructuredOutputJson: Boolean(structuredOutputJson),
      hasImage: Boolean(imageDataUrl),
    },
  })

  const result = await executeLlmTextRequest({
    providerName: providerName ?? '',
    prompt,
    systemPrompt,
    context: contextValue,
    image: imageDataUrl,
    model: null,
    temperature: normalizeOptionalNumber(resolvedInputs.temperature),
    maxTokens: normalizeOptionalNumber(resolvedInputs.max_tokens),
    responseMode,
    structuredOutputJson,
    onDebugEvent: (event) => {
      writeExecutionLog({
        executionId: context.executionId,
        nodeId: node.id,
        level: event.eventType === 'json_parse_failed' ? 'error' : 'info',
        eventType: event.eventType === 'json_parse_failed' ? 'llm_json_parse_failed' : 'llm_provider_response',
        message: event.eventType === 'json_parse_failed'
          ? `LLM JSON parse failed: ${moduleDefinition.name}`
          : `LLM provider response received: ${moduleDefinition.name}`,
        details: {
          operationKey: 'system.call_llm',
          ...event.details,
        },
      })
    },
  })

  const metadataValue = {
    ...result.metadata,
    prompt_length: prompt.length,
    system_prompt_length: systemPrompt?.length ?? 0,
    context_length: contextValue?.length ?? 0,
    structured_output_json_length: structuredOutputJson?.length ?? 0,
    has_image: Boolean(imageDataUrl),
  }

  const nodeArtifacts: Record<string, RuntimeArtifact> = {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', result.text, {
      kind: 'system-llm-text',
      operationKey: 'system.call_llm',
      providerName: result.providerName,
      model: result.model,
    }),
    metadata: buildRuntimeArtifact(context.executionId, node.id, 'metadata', 'json', metadataValue, {
      kind: 'system-llm-metadata',
      operationKey: 'system.call_llm',
      providerName: result.providerName,
      model: result.model,
    }),
  }

  if (result.json !== null) {
    nodeArtifacts.json = buildRuntimeArtifact(context.executionId, node.id, 'json', 'json', result.json, {
      kind: 'system-llm-json',
      operationKey: 'system.call_llm',
      providerName: result.providerName,
      model: result.model,
      responseMode: result.responseMode,
    })
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
      outputKeys: Object.keys(nodeArtifacts),
    },
  })
}
