import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import type { GraphWorkflowNode } from '../../types/moduleGraph'
import { isExecutionDebugModeEnabled, writeExecutionLog, type ExecutionContext, type ParsedModuleDefinition, type RuntimeArtifact } from './shared'

/** Persist one structured runtime artifact row and keep it available to downstream nodes. */
export function buildRuntimeArtifact(
  executionId: number,
  nodeId: string,
  portKey: string,
  artifactType: 'prompt' | 'text' | 'json' | 'number' | 'boolean' | 'any',
  value: unknown,
  metadata?: Record<string, unknown>,
): RuntimeArtifact {
  const artifactRecordId = isExecutionDebugModeEnabled(executionId)
    ? GraphExecutionArtifactModel.create({
      execution_id: executionId,
      node_id: nodeId,
      port_key: portKey,
      artifact_type: artifactType,
      metadata: JSON.stringify({ value, ...(metadata ?? {}) }),
    })
    : undefined

  return {
    type: artifactType,
    value,
    artifactRecordId,
    metadata,
  }
}

/** Store system node outputs and write the shared completion log. */
export function completeSystemNode(
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
