import fs from 'fs'
import path from 'path'
import { GraphExecutionArtifactModel } from '../../models/GraphExecutionArtifact'
import { runtimePaths } from '../../config/runtimePaths'
import { ImageMetadataWriteService, type ImageOutputFormat } from '../imageMetadataWriteService'
import { settingsService } from '../settingsService'
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

function resolveArtifactOutputFormat(requestedFormat: 'original' | ImageOutputFormat, mimeType?: string | null, sourcePathForMetadata?: string | null): ImageOutputFormat {
  if (requestedFormat !== 'original') {
    return requestedFormat
  }

  const normalizedMime = (mimeType || '').toLowerCase()
  const extension = sourcePathForMetadata ? path.extname(sourcePathForMetadata).toLowerCase() : ''

  if (normalizedMime === 'image/png' || extension === '.png') {
    return 'png'
  }

  if (normalizedMime === 'image/jpeg' || extension === '.jpg' || extension === '.jpeg') {
    return 'jpeg'
  }

  if (normalizedMime === 'image/webp' || extension === '.webp') {
    return 'webp'
  }

  return 'png'
}

function buildArtifactMimeType(format: ImageOutputFormat) {
  if (format === 'png') {
    return 'image/png'
  }
  if (format === 'jpeg') {
    return 'image/jpeg'
  }
  return 'image/webp'
}

function shouldBypassArtifactTransform(mimeType?: string | null, sourcePathForMetadata?: string | null) {
  const normalizedMime = (mimeType || '').toLowerCase()
  const extension = sourcePathForMetadata ? path.extname(sourcePathForMetadata).toLowerCase() : ''
  return normalizedMime === 'image/gif' || extension === '.gif' || extension === '.apng'
}

type SaveArtifactBufferOptions = {
  mimeType?: string
  sourcePathForMetadata?: string
  originalFileName?: string
}

/** Persist a binary graph artifact into temp storage and the artifact table. */
export async function saveArtifactBuffer(
  executionId: number,
  nodeId: string,
  portKey: string,
  artifactType: ModulePortDataType | 'file',
  buffer: Buffer,
  options?: SaveArtifactBufferOptions,
) {
  const executionDir = path.join(runtimePaths.tempDir, 'graph-executions', String(executionId))
  await fs.promises.mkdir(executionDir, { recursive: true })

  const imageSaveSettings = settingsService.loadSettings().imageSave
  const shouldTransform = (artifactType === 'image' || artifactType === 'mask')
    && imageSaveSettings.applyToWorkflowOutputs
    && !shouldBypassArtifactTransform(options?.mimeType, options?.sourcePathForMetadata)

  const outputFormat = shouldTransform
    ? resolveArtifactOutputFormat(imageSaveSettings.defaultFormat, options?.mimeType, options?.sourcePathForMetadata)
    : null
  const extension = outputFormat ? (outputFormat === 'jpeg' ? 'jpg' : outputFormat) : (path.extname(options?.sourcePathForMetadata || '') || 'png').replace(/^\./, '')
  const filePath = path.join(executionDir, `${sanitizeFileSegment(nodeId)}_${sanitizeFileSegment(portKey)}_${Date.now()}.${extension}`)

  let outputBuffer = buffer
  let outputMimeType = options?.mimeType || (outputFormat ? buildArtifactMimeType(outputFormat) : 'image/png')

  if (shouldTransform && outputFormat) {
    const rewritten = await ImageMetadataWriteService.writeBufferAsFormatBuffer(buffer, {
      format: outputFormat,
      quality: imageSaveSettings.quality,
      sourcePathForMetadata: options?.sourcePathForMetadata,
      originalFileName: options?.originalFileName,
      mimeType: options?.mimeType,
      maxWidth: imageSaveSettings.resizeEnabled ? imageSaveSettings.maxWidth : undefined,
      maxHeight: imageSaveSettings.resizeEnabled ? imageSaveSettings.maxHeight : undefined,
    })
    outputBuffer = rewritten.buffer
    outputMimeType = buildArtifactMimeType(outputFormat)
  }

  await fs.promises.writeFile(filePath, outputBuffer)

  const artifactRecordId = GraphExecutionArtifactModel.create({
    execution_id: executionId,
    node_id: nodeId,
    port_key: portKey,
    artifact_type: artifactType,
    storage_path: filePath,
    metadata: JSON.stringify({ size: outputBuffer.length, mimeType: outputMimeType }),
  })

  return {
    storagePath: filePath,
    artifactRecordId,
  }
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

  for (const field of moduleDefinition.ui_schema ?? []) {
    if (field.default_value !== undefined && resolvedInputs[field.key] === undefined) {
      resolvedInputs[field.key] = field.default_value
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
        value: bufferToDataUrl(
          buffer,
          parsedMetadata && typeof parsedMetadata === 'object' && !Array.isArray(parsedMetadata) && typeof parsedMetadata.mimeType === 'string'
            ? parsedMetadata.mimeType
            : 'image/png',
        ),
        storagePath: artifact.storage_path,
        artifactRecordId: artifact.id,
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
    artifactRecordId: artifact.id,
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
