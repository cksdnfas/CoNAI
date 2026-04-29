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
  isExecutionDebugModeEnabled,
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

/** Persist a graph artifact row that references an already-saved file without copying or re-encoding it. */
export async function saveArtifactFileReference(
  executionId: number,
  nodeId: string,
  portKey: string,
  artifactType: ModulePortDataType | 'file',
  storagePath: string,
  options?: {
    mimeType?: string
    metadata?: Record<string, unknown>
  },
) {
  const stats = await fs.promises.stat(storagePath)
  const artifactRecordId = GraphExecutionArtifactModel.create({
    execution_id: executionId,
    node_id: nodeId,
    port_key: portKey,
    artifact_type: artifactType,
    storage_path: storagePath,
    metadata: JSON.stringify({
      size: stats.size,
      mimeType: options?.mimeType || 'application/octet-stream',
      referencedExistingFile: true,
      ...(options?.metadata ?? {}),
    }),
  })

  return {
    storagePath,
    artifactRecordId,
  }
}

/** Look up the source artifact feeding a graph edge. */
export function getSourceArtifact(context: ExecutionContext, edge: GraphWorkflowEdge) {
  const nodeArtifacts = context.artifactsByNode.get(edge.source_node_id)
  return nodeArtifacts?.[edge.source_port_key]
}

/** Collect all incoming artifacts for a target node, materializing binary values only when the target needs inline data. */
export async function getIncomingArtifacts(context: ExecutionContext, nodeId: string) {
  const incomingArtifacts: Record<string, RuntimeArtifact> = {}

  for (const edge of context.workflow.graph.edges.filter((candidate) => candidate.target_node_id === nodeId)) {
    const artifact = getSourceArtifact(context, edge)
    if (artifact) {
      incomingArtifacts[edge.target_port_key] = await resolveArtifactForTarget(context, edge, artifact)
    }
  }

  return incomingArtifacts
}

function getTargetModuleForEdge(context: ExecutionContext, edge: GraphWorkflowEdge) {
  const targetNode = context.workflow.graph.nodes.find((candidate) => candidate.id === edge.target_node_id)
  return targetNode ? context.modulesById.get(targetNode.module_id) ?? null : null
}

function isFinalResultTarget(context: ExecutionContext, edge: GraphWorkflowEdge) {
  const targetModule = getTargetModuleForEdge(context, edge)
  return targetModule?.internal_fixed_values?.operation_key === 'system.final_result'
}

function canTargetConsumeFileReference(context: ExecutionContext, edge: GraphWorkflowEdge, artifactType: ModulePortDataType | 'file') {
  if (isFinalResultTarget(context, edge)) {
    return true
  }

  if (artifactType !== 'image' && artifactType !== 'mask') {
    return false
  }

  const targetModule = getTargetModuleForEdge(context, edge)
  if (targetModule?.engine_type !== 'comfyui') {
    return false
  }

  const targetInput = targetModule.exposed_inputs.find((input) => input.key === edge.target_port_key)
  return targetInput?.data_type === 'image' || targetInput?.data_type === 'mask' || targetInput?.data_type === 'any'
}

function isBinaryArtifactType(artifactType: ModulePortDataType | 'file') {
  return artifactType === 'image' || artifactType === 'mask' || artifactType === 'file'
}

function normalizeArtifactMetadata(metadata: Record<string, unknown> | string) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
}

function inferMimeTypeFromPath(storagePath: string, fallback: string) {
  const extension = path.extname(storagePath).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.bmp') return 'image/bmp'
  if (extension === '.avif') return 'image/avif'
  if (extension === '.mp4') return 'video/mp4'
  if (extension === '.webm') return 'video/webm'
  if (extension === '.mov') return 'video/quicktime'
  return fallback
}

function resolveArtifactMimeType(storagePath: string, metadata: Record<string, unknown>, artifactType: ModulePortDataType | 'file') {
  const explicitMimeType = metadata.mimeType ?? metadata.mime_type ?? metadata.output_mime_type
  if (typeof explicitMimeType === 'string' && explicitMimeType.trim().length > 0) {
    return explicitMimeType
  }

  return inferMimeTypeFromPath(storagePath, artifactType === 'file' ? 'application/octet-stream' : 'image/png')
}

function buildFileReferenceValue(storagePath: string, metadata: Record<string, unknown>, artifactType: ModulePortDataType | 'file') {
  const mimeType = resolveArtifactMimeType(storagePath, metadata, artifactType)
  return {
    storagePath,
    fileName: path.basename(storagePath),
    mimeType,
    originalFileName: typeof metadata.originalFileName === 'string' ? metadata.originalFileName : undefined,
    compositeHash: typeof metadata.compositeHash === 'string' ? metadata.compositeHash : typeof metadata.composite_hash === 'string' ? metadata.composite_hash : undefined,
  }
}

async function resolveArtifactForTarget(context: ExecutionContext, edge: GraphWorkflowEdge, artifact: RuntimeArtifact): Promise<RuntimeArtifact> {
  if (!isBinaryArtifactType(artifact.type) || !artifact.storagePath || typeof artifact.value === 'string') {
    return artifact
  }

  if (canTargetConsumeFileReference(context, edge, artifact.type)) {
    return artifact
  }

  const metadata = normalizeArtifactMetadata(artifact.metadata ?? {})
  const buffer = await fs.promises.readFile(artifact.storagePath)
  return {
    ...artifact,
    value: bufferToDataUrl(buffer, resolveArtifactMimeType(artifact.storagePath, metadata, artifact.type)),
    metadata,
  }
}

/** Decide whether a runtime artifact value must include inline data for downstream consumers. */
export function shouldMaterializeRuntimeArtifactValue(
  context: ExecutionContext,
  nodeId: string,
  outputPortKey: string,
  artifactType: ModulePortDataType | 'file',
) {
  const outgoingEdges = context.workflow.graph.edges.filter((edge) => edge.source_node_id === nodeId && edge.source_port_key === outputPortKey)
  if (outgoingEdges.length === 0) {
    return false
  }

  return outgoingEdges.some((edge) => !canTargetConsumeFileReference(context, edge, artifactType))
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
  if (!isExecutionDebugModeEnabled(executionId)) {
    return
  }

  GraphExecutionArtifactModel.create({
    execution_id: executionId,
    node_id: nodeId,
    port_key: 'metadata',
    artifact_type: 'json',
    metadata: JSON.stringify(metadataValue),
  })
}

/** Hydrate one stored artifact row back into a runtime artifact usable by downstream nodes. */
async function loadRuntimeArtifactFromRecord(artifact: GraphExecutionArtifactRecord): Promise<RuntimeArtifact | null> {
  const parsedMetadata = artifact.metadata ? parseJson<Record<string, unknown> | string>(artifact.metadata, {}) : {}

  if (artifact.artifact_type === 'image' || artifact.artifact_type === 'mask' || artifact.artifact_type === 'file') {
    if (!artifact.storage_path) {
      return null
    }

    try {
      await fs.promises.access(artifact.storage_path, fs.constants.R_OK)
      const metadata = normalizeArtifactMetadata(parsedMetadata)
      return {
        type: artifact.artifact_type,
        value: buildFileReferenceValue(artifact.storage_path, metadata, artifact.artifact_type),
        storagePath: artifact.storage_path,
        artifactRecordId: artifact.id,
        metadata,
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
