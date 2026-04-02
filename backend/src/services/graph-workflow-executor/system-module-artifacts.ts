import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import type { RuntimeArtifact } from './shared'

/** Persist one structured runtime artifact row and keep it available to downstream nodes. */
export function buildRuntimeArtifact(
  executionId: number,
  nodeId: string,
  portKey: string,
  artifactType: 'prompt' | 'text' | 'json',
  value: unknown,
  metadata?: Record<string, unknown>,
): RuntimeArtifact {
  GraphExecutionArtifactModel.create({
    execution_id: executionId,
    node_id: nodeId,
    port_key: portKey,
    artifact_type: artifactType,
    metadata: JSON.stringify({ value, ...(metadata ?? {}) }),
  })

  return {
    type: artifactType,
    value,
    metadata,
  }
}
