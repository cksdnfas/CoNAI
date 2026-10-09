import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { throwIfExecutionAborted } from './execution-abort'
import { buildRuntimeArtifact } from './system-module-artifacts'
import { runWorkflowLlmText, type WorkflowLlmResult } from './workflow-llm-runtime'
import {
  normalizeOptionalString,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

export function normalizeOptionalNumber(value: unknown) {
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

/** A positive integer id from a node value (selects store numbers; older values may be numeric strings). */
export function normalizeOptionalId(value: unknown) {
  const number = normalizeOptionalNumber(value)
  return number !== null && Number.isSafeInteger(number) && number > 0 ? number : null
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

/** Run one node request; a request cut by cancelling the run becomes the run's abort, not a node failure. */
export async function runNodeLlmRequest<T>(context: ExecutionContext, node: GraphWorkflowNode, run: () => Promise<T>) {
  throwIfExecutionAborted(context, node.id)
  try {
    return await run()
  } catch (error) {
    throwIfExecutionAborted(context, node.id)
    throw error
  }
}

export async function executeCallLlmNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  // The model row (★ default when empty) or a chat profile picks the model; the node's temperature / output limit /
  // reasoning, when filled, win. Graphs saved before rows still name a bare connection (+ model).
  const profileId = normalizeOptionalId(resolvedInputs.profile_id)
  const modelSlotId = normalizeOptionalId(resolvedInputs.model_slot_id)
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
      profileId,
      modelSlotId,
      responseMode,
      hasStructuredOutputJson: Boolean(structuredOutputJson),
      hasImage: Boolean(imageDataUrl),
    },
  })

  let result: WorkflowLlmResult
  try {
    result = await runNodeLlmRequest(context, node, () => runWorkflowLlmText({
      target: {
        profileId,
        modelSlotId,
        requesterAccountId: context.requestedByAccountId ?? null,
        legacy: { providerName: normalizeOptionalString(resolvedInputs.provider_name), model: normalizeOptionalString(resolvedInputs.model) },
      },
      systemPrompt,
      prompt,
      context: contextValue,
      image: imageDataUrl,
      structuredOutputJson,
      overrides: {
        temperature: normalizeOptionalNumber(resolvedInputs.temperature),
        maxTokens: normalizeOptionalNumber(resolvedInputs.max_tokens),
        reasoningEffort: normalizeOptionalString(resolvedInputs.reasoning_effort),
      },
      signal: context.signal,
    }))
  } catch (error) {
    if (error instanceof Error && /JSON/.test(error.message)) {
      writeExecutionLog({
        executionId: context.executionId,
        nodeId: node.id,
        level: 'error',
        eventType: 'llm_json_parse_failed',
        message: `LLM JSON parse failed: ${moduleDefinition.name}`,
        details: { operationKey: 'system.call_llm', error: error.message },
      })
    }
    throw error
  }

  const metadataValue = {
    ...result.metadata,
    prompt_length: prompt.length,
    system_prompt_length: systemPrompt?.length ?? 0,
    context_length: contextValue?.length ?? 0,
    structured_output_json_length: structuredOutputJson?.length ?? 0,
    has_image: Boolean(imageDataUrl),
  }
  const artifactMeta = { operationKey: 'system.call_llm', providerName: result.providerName, model: result.model }

  const nodeArtifacts: Record<string, RuntimeArtifact> = {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', result.text, { kind: 'system-llm-text', ...artifactMeta }),
    metadata: buildRuntimeArtifact(context.executionId, node.id, 'metadata', 'json', metadataValue, { kind: 'system-llm-metadata', ...artifactMeta }),
  }

  if (result.json !== null) {
    nodeArtifacts.json = buildRuntimeArtifact(context.executionId, node.id, 'json', 'json', result.json, {
      kind: 'system-llm-json',
      ...artifactMeta,
      responseMode,
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
      engine: result.engine,
      providerName: result.providerName,
      model: result.model,
      responseMode,
      outputKeys: Object.keys(nodeArtifacts),
    },
  })
}
