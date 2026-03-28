import fs from 'fs'
import path from 'path'
import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import { runtimePaths } from '../../config/runtimePaths'
import {
  type GraphWorkflowEdge,
  type GraphWorkflowNode,
  type ModulePortDataType,
} from '../../types/moduleGraph'
import {
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
