import fs from 'fs'
import path from 'path'
import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import { runtimePaths } from '../../config/runtimePaths'
import {
  type GraphExecutionArtifactRecord,
  type GraphWorkflowEdge,
  type GraphWorkflowNode,
  type ModulePortDataType,
} from '../../types/moduleGraph'
import {
  bufferToDataUrl,
  parseJson,
  sanitizeFileSegment,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

/** Persist a binary graph artifact into temp storage and the artifact table. */
export async function saveArtifactBuffer(executionId: number, nodeId: string, portKey: string, artifactType: ModulePortDataType | 'file', buffer: Buffer) {
  const executionDir = path.join(runtimePaths.tempDir, 'graph-executions', String(executionId))
  await fs.promises.mkdir(executionDir, { recursive: true })

  const filePath = path.join(executionDir, `${sanitizeFileSegment(nodeId)}_${sanitizeFileSegment(portKey)}_${Date.now()}.png`)
  await fs.promises.writeFile(filePath, buffer)

  GraphExecutionArtifactModel.create({
    execution_id: executionId,
    node_id: nodeId,
    port_key: portKey,
    artifact_type: artifactType,
    storage_path: filePath,
    metadata: JSON.stringify({ size: buffer.length }),
  })

  return filePath
}

/** Look up the source artifact feeding a graph edge. */
export function getSourceArtifact(context: ExecutionContext, edge: GraphWorkflowEdge) {
  const nodeArtifacts = context.artifactsByNode.get(edge.source_node_id)
  return nodeArtifacts?.[edge.source_port_key]
}

/** Collect all incoming artifacts for a target node. */
export function getIncomingArtifacts(context: ExecutionContext, nodeId: string) {
  return context.workflow.graph.edges
    .filter((edge) => edge.target_node_id === nodeId)
    .reduce<Record<string, RuntimeArtifact>>((acc, edge) => {
      const artifact = getSourceArtifact(context, edge)
      if (artifact) {
        acc[edge.target_port_key] = artifact
      }
      return acc
    }, {})
}

/** Merge template defaults, fixed values, explicit inputs, and upstream artifacts. */
export function resolveNodeInputs(node: GraphWorkflowNode, moduleDefinition: ParsedModuleDefinition, incomingArtifacts: Record<string, RuntimeArtifact>) {
  const templateDefaults = { ...(moduleDefinition.template_defaults || {}) }
  const internalFixedValues = { ...(moduleDefinition.internal_fixed_values || {}) }
  const explicitInputs = { ...(node.input_values || {}) }

  const resolvedInputs: Record<string, any> = {
    ...templateDefaults,
    ...internalFixedValues,
  }

  for (const port of moduleDefinition.exposed_inputs) {
    if (port.default_value !== undefined) {
      resolvedInputs[port.key] = port.default_value
    }
  }

  Object.assign(resolvedInputs, explicitInputs)

  for (const [portKey, artifact] of Object.entries(incomingArtifacts)) {
    resolvedInputs[portKey] = artifact.value
  }

  return resolvedInputs
}

/** Create the standard metadata artifact row for a node execution. */
export function saveMetadataArtifact(executionId: number, nodeId: string, metadataValue: Record<string, unknown>) {
  GraphExecutionArtifactModel.create({
    execution_id: executionId,
    node_id: nodeId,
    port_key: 'metadata',
    artifact_type: 'json',
    metadata: JSON.stringify(metadataValue),
  })
}

/** Parse an execution plan JSON field and return ordered node ids. */
export function getOrderedNodeIdsFromExecutionPlan(executionPlan?: string | null) {
  const parsedPlan = executionPlan
    ? parseJson(executionPlan, { orderedNodeIds: [] as string[] })
    : { orderedNodeIds: [] as string[] }

  return parsedPlan.orderedNodeIds ?? []
}

/** Hydrate one stored artifact row back into a runtime artifact usable by downstream nodes. */
async function loadRuntimeArtifactFromRecord(artifact: GraphExecutionArtifactRecord): Promise<RuntimeArtifact | null> {
  const parsedMetadata = artifact.metadata ? parseJson<Record<string, unknown> | string>(artifact.metadata, {}) : {}

  if (artifact.artifact_type === 'image' || artifact.artifact_type === 'mask' || artifact.artifact_type === 'file') {
    if (!artifact.storage_path) {
      return null
    }

    try {
      const buffer = await fs.promises.readFile(artifact.storage_path)
      return {
        type: artifact.artifact_type,
        value: bufferToDataUrl(buffer),
        storagePath: artifact.storage_path,
        metadata: parsedMetadata && typeof parsedMetadata === 'object' && !Array.isArray(parsedMetadata) ? parsedMetadata : undefined,
      }
    } catch {
      return null
    }
  }

  const value = parsedMetadata && typeof parsedMetadata === 'object' && !Array.isArray(parsedMetadata) && 'value' in parsedMetadata
    ? parsedMetadata.value
    : parsedMetadata

  return {
    type: artifact.artifact_type,
    value,
    metadata: parsedMetadata && typeof parsedMetadata === 'object' && !Array.isArray(parsedMetadata) ? parsedMetadata : undefined,
  }
}

/** Hydrate every artifact for one reused node; return null when any required artifact is unavailable. */
export async function loadRuntimeArtifactsByNode(artifacts: GraphExecutionArtifactRecord[]) {
  const nodeArtifacts: Record<string, RuntimeArtifact> = {}

  for (const artifact of artifacts) {
    const runtimeArtifact = await loadRuntimeArtifactFromRecord(artifact)
    if (!runtimeArtifact) {
      return null
    }

    nodeArtifacts[artifact.port_key] = runtimeArtifact
  }

  return nodeArtifacts
}
