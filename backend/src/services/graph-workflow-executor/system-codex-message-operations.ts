import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { executeCodexMessageRequest } from '../codexMessageService'
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

export async function executeCallCodexMessageNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const model = normalizeOptionalString(resolvedInputs.model)
  const responseMode = resolvedInputs.response_mode === 'json' ? 'json' : 'text'

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_progress',
    message: `Codex message node request started: ${moduleDefinition.name}`,
    details: {
      operationKey: 'system.call_codex_message',
      model,
      responseMode,
    },
  })

  const result = await executeCodexMessageRequest({
    prompt: typeof resolvedInputs.prompt === 'string' ? resolvedInputs.prompt : '',
    systemPrompt: normalizeOptionalString(resolvedInputs.system_prompt),
    context: normalizeOptionalString(resolvedInputs.context),
    model,
    responseMode,
    shouldCancel: context.shouldCancel,
  })

  const metadataValue = {
    ...result.metadata,
    model: result.model,
    response_mode: result.responseMode,
    prompt_length: typeof resolvedInputs.prompt === 'string' ? resolvedInputs.prompt.length : 0,
    system_prompt_length: typeof resolvedInputs.system_prompt === 'string' ? resolvedInputs.system_prompt.length : 0,
    context_length: typeof resolvedInputs.context === 'string' ? resolvedInputs.context.length : 0,
  }

  const nodeArtifacts = {
    text: buildRuntimeArtifact(context.executionId, node.id, 'text', 'text', result.text, {
      kind: 'system-codex-message-text',
      operationKey: 'system.call_codex_message',
      model: result.model,
    }),
    json: buildRuntimeArtifact(context.executionId, node.id, 'json', 'json', result.json, {
      kind: 'system-codex-message-json',
      operationKey: 'system.call_codex_message',
      model: result.model,
      responseMode: result.responseMode,
    }),
    metadata: buildRuntimeArtifact(context.executionId, node.id, 'metadata', 'json', metadataValue, {
      kind: 'system-codex-message-metadata',
      operationKey: 'system.call_codex_message',
      model: result.model,
    }),
  }

  context.artifactsByNode.set(node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_complete',
    message: `Codex message node completed: ${moduleDefinition.name}`,
    details: {
      operationKey: 'system.call_codex_message',
      model: result.model,
      responseMode: result.responseMode,
      outputKeys: Object.keys(nodeArtifacts),
      jobDirectory: result.metadata.job_directory,
      sessionId: result.metadata.session_id,
    },
  })
}
