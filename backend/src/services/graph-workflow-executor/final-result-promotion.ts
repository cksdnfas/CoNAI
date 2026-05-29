import fs from 'fs'
import path from 'path'
import { GenerationHistoryModel, type ServiceType } from '../../models/GenerationHistory'
import { GenerationHistoryService } from '../generationHistoryService'
import { FileDiscoveryService } from '../folderScan/fileDiscoveryService'
import type { RuntimeArtifact } from './shared'

type ArtifactMetadata = Record<string, unknown>

type FinalResultPromotionCandidate = {
  shouldPromote: boolean
  serviceType: ServiceType | null
  mimeType: string | null
  storagePath: string | null
  originalFileName: string | null
  compositeHash: string | null
  reason: string | null
}

type FinalResultPromotionParams = {
  executionId: number
  workflowId: number
  workflowName: string
  finalNodeId: string
  sourceNodeId: string
  sourcePortKey: string
  sourceArtifact: RuntimeArtifact
}

function parseMetadata(value: unknown): ArtifactMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as ArtifactMetadata
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function optionalNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function readValueObject(value: unknown): ArtifactMetadata {
  return value && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value) ? value as ArtifactMetadata : {}
}

function resolveArtifactMetadata(sourceArtifact: RuntimeArtifact) {
  const metadata = parseMetadata(sourceArtifact.metadata)
  const valueObject = readValueObject(sourceArtifact.value)

  return {
    metadata: { ...valueObject, ...metadata },
    valueObject,
  }
}

function resolveCompositeHash(metadata: ArtifactMetadata, valueObject: ArtifactMetadata) {
  return optionalString(metadata.actualCompositeHash)
    ?? optionalString(metadata.actual_composite_hash)
    ?? optionalString(metadata.compositeHash)
    ?? optionalString(metadata.composite_hash)
    ?? optionalString(valueObject.actualCompositeHash)
    ?? optionalString(valueObject.actual_composite_hash)
    ?? optionalString(valueObject.compositeHash)
    ?? optionalString(valueObject.composite_hash)
    ?? null
}

function resolveStoragePath(sourceArtifact: RuntimeArtifact, metadata: ArtifactMetadata, valueObject: ArtifactMetadata) {
  return sourceArtifact.storagePath
    ?? optionalString(metadata.storagePath)
    ?? optionalString(metadata.storage_path)
    ?? optionalString(metadata.originalFilePath)
    ?? optionalString(metadata.original_file_path)
    ?? optionalString(metadata.filePath)
    ?? optionalString(metadata.file_path)
    ?? optionalString(valueObject.storagePath)
    ?? optionalString(valueObject.storage_path)
    ?? optionalString(valueObject.originalFilePath)
    ?? optionalString(valueObject.original_file_path)
    ?? optionalString(valueObject.filePath)
    ?? optionalString(valueObject.file_path)
    ?? null
}

function resolveMimeType(metadata: ArtifactMetadata, valueObject: ArtifactMetadata, storagePath: string | null) {
  return optionalString(metadata.mimeType)
    ?? optionalString(metadata.mime_type)
    ?? optionalString(metadata.output_mime_type)
    ?? optionalString(metadata.contentType)
    ?? optionalString(metadata.content_type)
    ?? optionalString(valueObject.mimeType)
    ?? optionalString(valueObject.mime_type)
    ?? optionalString(valueObject.output_mime_type)
    ?? optionalString(valueObject.contentType)
    ?? optionalString(valueObject.content_type)
    ?? (storagePath ? FileDiscoveryService.getMimeType(storagePath) : null)
}

function resolveOriginalFileName(metadata: ArtifactMetadata, valueObject: ArtifactMetadata, storagePath: string | null) {
  return optionalString(metadata.originalFileName)
    ?? optionalString(metadata.original_file_name)
    ?? optionalString(metadata.output_file_name)
    ?? optionalString(metadata.fileName)
    ?? optionalString(metadata.file_name)
    ?? optionalString(valueObject.originalFileName)
    ?? optionalString(valueObject.original_file_name)
    ?? optionalString(valueObject.output_file_name)
    ?? optionalString(valueObject.fileName)
    ?? optionalString(valueObject.file_name)
    ?? (storagePath ? path.basename(storagePath) : null)
}

function inferServiceType(metadata: ArtifactMetadata): ServiceType {
  const explicitServiceType = optionalString(metadata.graph_result_service_type)
    ?? optionalString(metadata.serviceType)
    ?? optionalString(metadata.service_type)

  if (explicitServiceType === 'novelai' || explicitServiceType === 'codex' || explicitServiceType === 'comfyui') {
    return explicitServiceType
  }

  const kind = optionalString(metadata.kind)?.toLowerCase() ?? ''
  if (kind.includes('nai') || optionalString(metadata.action) || optionalString(metadata.sampler)) {
    return 'novelai'
  }

  if (kind.includes('codex') || optionalString(metadata.codex_last_message)) {
    return 'codex'
  }

  return 'comfyui'
}

function isPromotableMimeType(mimeType: string | null) {
  return Boolean(mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/')))
}

function buildMetadataPatch(params: FinalResultPromotionParams, metadata: ArtifactMetadata, serviceType: ServiceType) {
  const prompt = optionalString(metadata.prompt)
    ?? optionalString(metadata.positive_prompt)
  const negativePrompt = optionalString(metadata.negative_prompt)
    ?? optionalString(metadata.uc)

  return {
    ai_tool: serviceType,
    software: 'CoNAI module workflow',
    model: optionalString(metadata.model) ?? optionalString(metadata.nai_model) ?? undefined,
    prompt: prompt ?? undefined,
    positive_prompt: prompt ?? undefined,
    negative_prompt: negativePrompt ?? undefined,
    width: optionalNumber(metadata.width) ?? undefined,
    height: optionalNumber(metadata.height) ?? undefined,
    sampler: optionalString(metadata.sampler) ?? undefined,
    scheduler: optionalString(metadata.scheduler) ?? undefined,
    conai_graph_execution_id: params.executionId,
    conai_graph_workflow_id: params.workflowId,
    conai_graph_workflow_name: params.workflowName,
    conai_graph_final_node_id: params.finalNodeId,
    conai_graph_source_node_id: params.sourceNodeId,
    conai_graph_source_port_key: params.sourcePortKey,
    conai_graph_source_artifact_id: params.sourceArtifact.artifactRecordId,
  }
}

/** Resolve whether a final-result source artifact should enter the main generation-result index. */
export function resolveFinalResultPromotionCandidate(sourceArtifact: RuntimeArtifact): FinalResultPromotionCandidate {
  const { metadata, valueObject } = resolveArtifactMetadata(sourceArtifact)
  const compositeHash = resolveCompositeHash(metadata, valueObject)
  const storagePath = resolveStoragePath(sourceArtifact, metadata, valueObject)
  const mimeType = resolveMimeType(metadata, valueObject, storagePath)
  const originalFileName = resolveOriginalFileName(metadata, valueObject, storagePath)
  if (compositeHash) {
    return {
      shouldPromote: false,
      serviceType: inferServiceType(metadata),
      mimeType,
      storagePath,
      originalFileName,
      compositeHash,
      reason: 'already_uploaded',
    }
  }

  if (!storagePath) {
    return {
      shouldPromote: false,
      serviceType: null,
      mimeType: null,
      storagePath: null,
      originalFileName: null,
      compositeHash: null,
      reason: 'missing_storage_path',
    }
  }

  if (!isPromotableMimeType(mimeType) && sourceArtifact.type !== 'image' && sourceArtifact.type !== 'mask') {
    return {
      shouldPromote: false,
      serviceType: null,
      mimeType,
      storagePath,
      originalFileName,
      compositeHash: null,
      reason: 'not_visual_media',
    }
  }

  return {
    shouldPromote: true,
    serviceType: inferServiceType(metadata),
    mimeType,
    storagePath,
    originalFileName,
    compositeHash: null,
    reason: null,
  }
}

/** Promote one explicit final-result visual artifact into the shared image-generation result list. */
export async function promoteFinalResultArtifactToGenerationHistory(params: FinalResultPromotionParams) {
  const candidate = resolveFinalResultPromotionCandidate(params.sourceArtifact)
  if (!candidate.shouldPromote) {
    return candidate
  }

  const { metadata } = resolveArtifactMetadata(params.sourceArtifact)
  const serviceType = candidate.serviceType ?? inferServiceType(metadata)
  const storagePath = candidate.storagePath as string
  await fs.promises.access(storagePath, fs.constants.R_OK)

  const historyId = GenerationHistoryModel.create({
    service_type: serviceType,
    generation_status: 'pending',
    workflow_id: params.workflowId,
    workflow_name: params.workflowName,
    nai_model: optionalString(metadata.model) ?? optionalString(metadata.nai_model) ?? (serviceType === 'codex' ? 'codex' : undefined),
    positive_prompt: optionalString(metadata.prompt) ?? optionalString(metadata.positive_prompt) ?? undefined,
    negative_prompt: optionalString(metadata.negative_prompt) ?? optionalString(metadata.uc) ?? undefined,
    width: optionalNumber(metadata.width) ?? undefined,
    height: optionalNumber(metadata.height) ?? undefined,
    metadata: JSON.stringify({
      graph_execution_id: params.executionId,
      graph_workflow_id: params.workflowId,
      graph_workflow_name: params.workflowName,
      graph_final_node_id: params.finalNodeId,
      graph_source_node_id: params.sourceNodeId,
      graph_source_port_key: params.sourcePortKey,
      graph_source_artifact_id: params.sourceArtifact.artifactRecordId,
      graph_result_service_type: serviceType,
    }),
  })

  await GenerationHistoryService.processAndUploadGeneratedFile(historyId, storagePath, serviceType, {
    sourcePathForMetadata: storagePath,
    sourceMimeType: candidate.mimeType ?? undefined,
    originalFileName: candidate.originalFileName ?? path.basename(storagePath),
    metadataPatch: buildMetadataPatch(params, metadata, serviceType),
  })

  const completedHistory = GenerationHistoryModel.findById(historyId)
  return {
    ...candidate,
    reason: 'promoted',
    historyId,
    compositeHash: completedHistory?.composite_hash ?? null,
  }
}
