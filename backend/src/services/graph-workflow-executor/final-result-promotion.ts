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
  width: number | null
  height: number | null
  seed: number | null
  steps: number | null
  cfgScale: number | null
  sampler: string | null
  scheduler: string | null
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
    ?? optionalString(metadata.outputPath)
    ?? optionalString(metadata.output_path)
    ?? optionalString(metadata.originalFilePath)
    ?? optionalString(metadata.original_file_path)
    ?? optionalString(metadata.filePath)
    ?? optionalString(metadata.file_path)
    ?? optionalString(valueObject.storagePath)
    ?? optionalString(valueObject.storage_path)
    ?? optionalString(valueObject.outputPath)
    ?? optionalString(valueObject.output_path)
    ?? optionalString(valueObject.originalFilePath)
    ?? optionalString(valueObject.original_file_path)
    ?? optionalString(valueObject.filePath)
    ?? optionalString(valueObject.file_path)
    ?? null
}

function resolveMimeType(metadata: ArtifactMetadata, valueObject: ArtifactMetadata, storagePath: string | null) {
  return optionalString(metadata.mimeType)
    ?? optionalString(metadata.mime_type)
    ?? optionalString(metadata.outputMimeType)
    ?? optionalString(metadata.output_mime_type)
    ?? optionalString(metadata.contentType)
    ?? optionalString(metadata.content_type)
    ?? optionalString(valueObject.mimeType)
    ?? optionalString(valueObject.mime_type)
    ?? optionalString(valueObject.outputMimeType)
    ?? optionalString(valueObject.output_mime_type)
    ?? optionalString(valueObject.contentType)
    ?? optionalString(valueObject.content_type)
    ?? (storagePath ? FileDiscoveryService.getMimeType(storagePath) : null)
}

function resolveOriginalFileName(metadata: ArtifactMetadata, valueObject: ArtifactMetadata, storagePath: string | null) {
  return optionalString(metadata.originalFileName)
    ?? optionalString(metadata.original_file_name)
    ?? optionalString(metadata.outputFileName)
    ?? optionalString(metadata.output_file_name)
    ?? optionalString(metadata.fileName)
    ?? optionalString(metadata.file_name)
    ?? optionalString(valueObject.originalFileName)
    ?? optionalString(valueObject.original_file_name)
    ?? optionalString(valueObject.outputFileName)
    ?? optionalString(valueObject.output_file_name)
    ?? optionalString(valueObject.fileName)
    ?? optionalString(valueObject.file_name)
    ?? (storagePath ? path.basename(storagePath) : null)
}

function resolveModelName(metadata: ArtifactMetadata) {
  return optionalString(metadata.model)
    ?? optionalString(metadata.modelName)
    ?? optionalString(metadata.model_name)
    ?? optionalString(metadata.nai_model)
    ?? optionalString(metadata.checkpoint)
    ?? optionalString(metadata.ckpt_name)
    ?? null
}

function resolvePositivePrompt(metadata: ArtifactMetadata) {
  return optionalString(metadata.prompt)
    ?? optionalString(metadata.positivePrompt)
    ?? optionalString(metadata.positive_prompt)
    ?? optionalString(metadata.caption)
    ?? null
}

function resolveNegativePrompt(metadata: ArtifactMetadata) {
  return optionalString(metadata.negativePrompt)
    ?? optionalString(metadata.negative_prompt)
    ?? optionalString(metadata.negative)
    ?? optionalString(metadata.uc)
    ?? null
}

function resolveSampler(metadata: ArtifactMetadata) {
  return optionalString(metadata.sampler)
    ?? optionalString(metadata.samplerName)
    ?? optionalString(metadata.sampler_name)
    ?? null
}

function resolveScheduler(metadata: ArtifactMetadata) {
  return optionalString(metadata.scheduler)
    ?? optionalString(metadata.schedulerName)
    ?? optionalString(metadata.scheduler_name)
    ?? optionalString(metadata.noiseSchedule)
    ?? optionalString(metadata.noise_schedule)
    ?? null
}

function resolveGenerationParameters(metadata: ArtifactMetadata) {
  return {
    width: optionalNumber(metadata.actualWidth)
      ?? optionalNumber(metadata.actual_width)
      ?? optionalNumber(metadata.outputWidth)
      ?? optionalNumber(metadata.output_width)
      ?? optionalNumber(metadata.width)
      ?? null,
    height: optionalNumber(metadata.actualHeight)
      ?? optionalNumber(metadata.actual_height)
      ?? optionalNumber(metadata.outputHeight)
      ?? optionalNumber(metadata.output_height)
      ?? optionalNumber(metadata.height)
      ?? null,
    seed: optionalNumber(metadata.seed)
      ?? optionalNumber(metadata.nai_seed)
      ?? optionalNumber(metadata.noiseSeed)
      ?? optionalNumber(metadata.noise_seed)
      ?? null,
    steps: optionalNumber(metadata.steps)
      ?? optionalNumber(metadata.nai_steps)
      ?? optionalNumber(metadata.stepCount)
      ?? optionalNumber(metadata.step_count)
      ?? optionalNumber(metadata.samplingSteps)
      ?? optionalNumber(metadata.sampling_steps)
      ?? optionalNumber(metadata.stepsTotal)
      ?? optionalNumber(metadata.steps_total)
      ?? null,
    cfgScale: optionalNumber(metadata.cfg_scale)
      ?? optionalNumber(metadata.cfgScale)
      ?? optionalNumber(metadata.guidance_scale)
      ?? optionalNumber(metadata.guidanceScale)
      ?? optionalNumber(metadata.scale)
      ?? optionalNumber(metadata.nai_scale)
      ?? optionalNumber(metadata.cfg)
      ?? null,
    sampler: resolveSampler(metadata),
    scheduler: resolveScheduler(metadata),
  }
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

function setDefinedParam(target: Record<string, unknown>, key: string, value: unknown) {
  if (value !== null && value !== undefined) {
    target[key] = value
  }
}

function buildHistoryGenerationParameters(
  metadata: ArtifactMetadata,
  generationParams: ReturnType<typeof resolveGenerationParameters>,
) {
  const params: Record<string, unknown> = {}
  setDefinedParam(params, 'prompt', resolvePositivePrompt(metadata))
  setDefinedParam(params, 'negative_prompt', resolveNegativePrompt(metadata))
  setDefinedParam(params, 'model', resolveModelName(metadata))
  setDefinedParam(params, 'width', generationParams.width)
  setDefinedParam(params, 'height', generationParams.height)
  setDefinedParam(params, 'steps', generationParams.steps)
  setDefinedParam(params, 'scale', generationParams.cfgScale)
  setDefinedParam(params, 'seed', generationParams.seed)
  setDefinedParam(params, 'sampler', generationParams.sampler)
  setDefinedParam(params, 'noise_schedule', generationParams.scheduler)
  setDefinedParam(params, 'scheduler', generationParams.scheduler)

  return Object.keys(params).length > 0 ? JSON.stringify(params) : undefined
}

function buildMetadataPatch(
  params: FinalResultPromotionParams,
  metadata: ArtifactMetadata,
  serviceType: ServiceType,
  generationParams: ReturnType<typeof resolveGenerationParameters>,
) {
  const prompt = resolvePositivePrompt(metadata)
  const negativePrompt = resolveNegativePrompt(metadata)

  return {
    ai_tool: serviceType,
    software: 'CoNAI module workflow',
    model: resolveModelName(metadata) ?? undefined,
    prompt: prompt ?? undefined,
    positive_prompt: prompt ?? undefined,
    negative_prompt: negativePrompt ?? undefined,
    width: generationParams.width ?? undefined,
    height: generationParams.height ?? undefined,
    steps: generationParams.steps ?? undefined,
    cfg_scale: generationParams.cfgScale ?? undefined,
    seed: generationParams.seed ?? undefined,
    sampler: generationParams.sampler ?? undefined,
    scheduler: generationParams.scheduler ?? undefined,
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
  const generationParams = resolveGenerationParameters(metadata)
  if (compositeHash) {
    return {
      shouldPromote: false,
      serviceType: inferServiceType(metadata),
      mimeType,
      storagePath,
      originalFileName,
      compositeHash,
      ...generationParams,
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
      ...generationParams,
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
      ...generationParams,
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
    ...generationParams,
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
  const historyGenerationParameters = buildHistoryGenerationParameters(metadata, candidate)
  const storagePath = candidate.storagePath as string
  await fs.promises.access(storagePath, fs.constants.R_OK)

  const historyId = GenerationHistoryModel.create({
    service_type: serviceType,
    generation_status: 'pending',
    workflow_id: params.workflowId,
    workflow_name: params.workflowName,
    nai_model: resolveModelName(metadata) ?? (serviceType === 'codex' ? 'codex' : undefined),
    nai_sampler: candidate.sampler ?? undefined,
    nai_seed: candidate.seed ?? undefined,
    nai_steps: candidate.steps ?? undefined,
    nai_scale: candidate.cfgScale ?? undefined,
    nai_parameters: historyGenerationParameters,
    positive_prompt: resolvePositivePrompt(metadata) ?? undefined,
    negative_prompt: resolveNegativePrompt(metadata) ?? undefined,
    width: candidate.width ?? undefined,
    height: candidate.height ?? undefined,
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
    metadataPatch: buildMetadataPatch(params, metadata, serviceType, candidate),
  })

  const completedHistory = GenerationHistoryModel.findById(historyId)
  return {
    ...candidate,
    reason: 'promoted',
    historyId,
    compositeHash: completedHistory?.composite_hash ?? null,
  }
}

/** Promote final-result media when possible without letting history indexing fail the workflow execution. */
export async function tryPromoteFinalResultArtifactToGenerationHistory(params: FinalResultPromotionParams) {
  try {
    return await promoteFinalResultArtifactToGenerationHistory(params)
  } catch (error) {
    const candidate = resolveFinalResultPromotionCandidate(params.sourceArtifact)
    return {
      ...candidate,
      shouldPromote: false,
      reason: 'promotion_failed',
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}
