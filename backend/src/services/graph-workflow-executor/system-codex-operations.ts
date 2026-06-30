import fs from 'fs'
import path from 'path'
import { resolveUploadsPath } from '../../config/runtimePaths'
import { GenerationHistoryModel } from '../../models/GenerationHistory'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { ImageUploadService } from '../imageUploadService'
import { settingsService } from '../settingsService'
import { saveCanonicalMediaArtifactReference, saveMetadataArtifact, shouldMaterializeRuntimeArtifactValue } from './artifacts'
import {
  bufferToDataUrl,
  normalizeOptionalString,
  parsePositiveIntegerish,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'
import { GenerationQueueService } from '../generationQueueService'
import { assertCodexAvailable } from '../codexGenerationExecutor'
import { GRAPH_EXECUTION_CANCELLED_MESSAGE, waitForGraphQueueCompletion } from './queue-wait'

const CODEX_RANDOM_ASPECT_CHOICES = [
  { value: '1:1', width: 1, height: 1 },
  { value: '4:3', width: 4, height: 3 },
  { value: '3:4', width: 3, height: 4 },
  { value: '16:9', width: 16, height: 9 },
  { value: '9:16', width: 9, height: 16 },
] as const
const CODEX_DEFAULT_ASPECT_RATIO = '1:1'
const CODEX_DEFAULT_RESOLUTION = 1024
const CODEX_DEFAULT_COUNT = 1
const CODEX_MAX_COUNT = 4

function roundCodexDimension(value: number) {
  return Math.max(64, Math.round(value / 64) * 64)
}

function pickCodexAspectRatio(value: string | null) {
  if (!value || value === 'random') {
    const randomIndex = Math.floor(Math.random() * CODEX_RANDOM_ASPECT_CHOICES.length)
    return CODEX_RANDOM_ASPECT_CHOICES[randomIndex] ?? CODEX_RANDOM_ASPECT_CHOICES[0]
  }

  return CODEX_RANDOM_ASPECT_CHOICES.find((option) => option.value === value) ?? CODEX_RANDOM_ASPECT_CHOICES[0]
}

function resolveCodexRequestedSize(resolvedInputs: Record<string, any>) {
  const explicitWidth = parsePositiveIntegerish(resolvedInputs.width)
  const explicitHeight = parsePositiveIntegerish(resolvedInputs.height)
  if (explicitWidth && explicitHeight) {
    return {
      size: `${explicitWidth}x${explicitHeight}`,
      width: explicitWidth,
      height: explicitHeight,
      aspectRatio: 'custom',
      resolution: null,
    }
  }

  const aspectRatio = normalizeOptionalString(resolvedInputs.aspect_ratio) ?? CODEX_DEFAULT_ASPECT_RATIO
  const resolution = parsePositiveIntegerish(resolvedInputs.resolution) ?? CODEX_DEFAULT_RESOLUTION
  const chosenAspect = pickCodexAspectRatio(aspectRatio)
  const scale = resolution / Math.max(chosenAspect.width, chosenAspect.height)
  const width = roundCodexDimension(chosenAspect.width * scale)
  const height = roundCodexDimension(chosenAspect.height * scale)

  return {
    size: `${width}x${height}`,
    width,
    height,
    aspectRatio: aspectRatio === 'random' ? 'random' : chosenAspect.value,
    resolution: String(resolution),
  }
}

function buildQueueImageSaveOptions() {
  const imageSaveSettings = settingsService.loadSettings().imageSave
  if (!imageSaveSettings.applyToWorkflowOutputs) {
    return undefined
  }

  return {
    format: imageSaveSettings.defaultFormat,
    quality: imageSaveSettings.quality,
    resizeEnabled: imageSaveSettings.resizeEnabled,
    maxWidth: imageSaveSettings.maxWidth,
    maxHeight: imageSaveSettings.maxHeight,
  }
}

function resolveMimeTypeFromPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }
  if (extension === '.webp') {
    return 'image/webp'
  }
  if (extension === '.mp4') {
    return 'video/mp4'
  }
  return 'image/png'
}

function parseStoredQueuePayload(record: { request_payload: string }) {
  try {
    const parsed = JSON.parse(record.request_payload) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function resolveQueueHistoryId(debug: Record<string, unknown>) {
  const directHistoryId = parsePositiveIntegerish(debug.history_id)
  if (directHistoryId) {
    return directHistoryId
  }

  if (Array.isArray(debug.history_ids)) {
    for (const value of debug.history_ids) {
      const historyId = parsePositiveIntegerish(value)
      if (historyId) {
        return historyId
      }
    }
  }

  return null
}

function parseHistoryMetadata(record: { metadata?: string | null } | null | undefined) {
  if (!record?.metadata) {
    return {}
  }

  try {
    const parsed = JSON.parse(record.metadata) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function resolveHistoryOriginalPath(historyRecords: Array<{ metadata?: string | null }>, compositeHash: string | null) {
  if (compositeHash) {
    const activePath = ImageUploadService.getActiveFilePath(compositeHash)
    if (activePath) {
      return activePath
    }
  }

  for (const historyRecord of historyRecords) {
    const metadata = parseHistoryMetadata(historyRecord)
    const savedOriginalPath = normalizeOptionalString(metadata.saved_original_path)
      ?? normalizeOptionalString(metadata.codex_saved_original_path)
      ?? normalizeOptionalString(metadata.original_path)
    if (savedOriginalPath) {
      return savedOriginalPath
    }

    const generatedOutputPath = normalizeOptionalString(metadata.codex_output_file)
    if (generatedOutputPath) {
      return generatedOutputPath
    }
  }

  return null
}

async function resolveQueueBackedCodexOutput(params: {
  context: ExecutionContext
  node: GraphWorkflowNode
  moduleDefinition: ParsedModuleDefinition
  completedJobId: number
  requestedSize: ReturnType<typeof resolveCodexRequestedSize>
}) {
  const completedJob = GenerationQueueModel.findById(params.completedJobId)
  if (!completedJob) {
    throw new Error(`Completed queue job ${params.completedJobId} is no longer available`)
  }

  const storedPayload = parseStoredQueuePayload(completedJob)
  const debug = storedPayload._debug && typeof storedPayload._debug === 'object' && !Array.isArray(storedPayload._debug)
    ? storedPayload._debug as Record<string, unknown>
    : {}

  const historyId = resolveQueueHistoryId(debug)
  const preferredHistoryRecord = historyId ? GenerationHistoryModel.findById(historyId) : null
  const queueHistoryRecords = GenerationHistoryModel.findAll({
    service_type: 'codex',
    queue_job_id: completedJob.id,
    order_by: 'created_at',
    order_direction: 'ASC',
  })
  const historyRecords = [
    ...(preferredHistoryRecord ? [preferredHistoryRecord] : []),
    ...queueHistoryRecords.filter((record) => record.id !== preferredHistoryRecord?.id),
  ]
  const compositeHash = normalizeOptionalString(debug.result_composite_hash)
    ?? historyRecords.map((record) => normalizeOptionalString(record.composite_hash)).find((value) => Boolean(value))
    ?? null
  const fallbackOriginalPath = normalizeOptionalString(debug.result_original_path)
  const originalPath = fallbackOriginalPath ?? resolveHistoryOriginalPath(historyRecords, compositeHash)

  if (!originalPath) {
    throw new Error(`Queue job ${completedJob.id} completed but Codex output path could not be resolved`)
  }

  const absoluteOriginalPath = path.isAbsolute(originalPath) ? originalPath : resolveUploadsPath(originalPath)
  const resolvedMimeType = normalizeOptionalString(debug.result_mime_type) ?? resolveMimeTypeFromPath(absoluteOriginalPath)
  const artifactType: 'file' | 'image' = resolvedMimeType.startsWith('video/') ? 'file' : 'image'
  const originalFileName = path.basename(absoluteOriginalPath)
  const primaryOutputPort = params.moduleDefinition.output_ports.find((port) => port.key === 'image')
    ?? params.moduleDefinition.output_ports.find((port) => port.key !== 'metadata')
    ?? { key: 'image', data_type: 'image' as const }

  const referenceValue = {
    storagePath: absoluteOriginalPath,
    composite_hash: compositeHash,
    original_path: originalPath,
    original_file_path: absoluteOriginalPath,
    mime_type: resolvedMimeType,
    output_file_name: originalFileName,
    queue_job_id: completedJob.id,
    history_id: historyId,
    requested_width: params.requestedSize.width,
    requested_height: params.requestedSize.height,
    requested_aspect_ratio: params.requestedSize.aspectRatio,
    requested_resolution: params.requestedSize.resolution,
    codex_last_message: normalizeOptionalString(debug.codex_last_message),
  }
  const shouldMaterializeValue = shouldMaterializeRuntimeArtifactValue(params.context, params.node.id, primaryOutputPort.key, artifactType)

  let outputValue: unknown = referenceValue
  const referencedArtifact = await saveCanonicalMediaArtifactReference(
    params.context.executionId,
    params.node.id,
    primaryOutputPort.key,
    artifactType,
    absoluteOriginalPath,
    {
      mimeType: resolvedMimeType,
      originalFileName,
      queueJobId: completedJob.id,
      historyId,
      compositeHash,
      metadata: {
        source: 'codex-queue-image',
      },
    },
  )

  if (shouldMaterializeValue) {
    const outputBuffer = await fs.promises.readFile(absoluteOriginalPath)
    outputValue = bufferToDataUrl(outputBuffer, resolvedMimeType)
  }

  const metadataValue = {
    ...referenceValue,
    workflow_execution_id: params.context.executionId,
    node_id: params.node.id,
    provider_job_id: completedJob.provider_job_id ?? null,
  }

  const nodeArtifacts: Record<string, RuntimeArtifact> = {
    [primaryOutputPort.key]: {
      type: artifactType,
      value: outputValue,
      storagePath: referencedArtifact.storagePath,
      artifactRecordId: referencedArtifact.artifactRecordId,
      metadata: referencedArtifact.metadata,
    },
    image_ref: {
      type: 'json',
      value: referenceValue,
      metadata: {
        kind: 'codex-queue-image-reference',
        queueJobId: completedJob.id,
      },
    },
    metadata: {
      type: 'json',
      value: metadataValue,
      metadata: {
        kind: 'codex-queue-metadata',
        queueJobId: completedJob.id,
      },
    },
  }

  saveMetadataArtifact(params.context.executionId, params.node.id, metadataValue)
  params.context.artifactsByNode.set(params.node.id, nodeArtifacts)

  writeExecutionLog({
    executionId: params.context.executionId,
    nodeId: params.node.id,
    eventType: 'node_queue_complete',
    message: `Queue-backed Codex module completed: ${params.moduleDefinition.name}`,
    details: {
      queueJobId: completedJob.id,
      historyId,
      compositeHash,
      storagePath: referencedArtifact.storagePath,
      referenceKind: 'canonical-generated-media',
      requestedWidth: params.requestedSize.width,
      requestedHeight: params.requestedSize.height,
      requestedAspectRatio: params.requestedSize.aspectRatio,
      requestedResolution: params.requestedSize.resolution,
    },
  })
}

/** Execute one Codex image-generation module through the shared generation queue and pass its result to downstream nodes. */
export async function executeCodexImageGenerationNode(
  context: ExecutionContext,
  node: GraphWorkflowNode,
  moduleDefinition: ParsedModuleDefinition,
  resolvedInputs: Record<string, any>,
) {
  const prompt = normalizeOptionalString(resolvedInputs.prompt)
  if (!prompt) {
    throw new Error('Codex image generation requires a prompt input')
  }

  const negativePrompt = normalizeOptionalString(resolvedInputs.negative_prompt)
  const inputImage = normalizeOptionalString(resolvedInputs.image)
  const maskImage = normalizeOptionalString(resolvedInputs.mask)
  if (maskImage && !inputImage) {
    throw new Error('Codex mask input requires an image input')
  }

  const operation = inputImage ? (maskImage ? 'infill' : 'edit') : 'generate'
  const requestedSize = resolveCodexRequestedSize(resolvedInputs)
  const count = Math.min(CODEX_MAX_COUNT, Math.max(CODEX_DEFAULT_COUNT, parsePositiveIntegerish(resolvedInputs.count) ?? CODEX_DEFAULT_COUNT))
  const imageSaveOptions = buildQueueImageSaveOptions()

  await assertCodexAvailable('Codex 이미지 생성')

  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_start',
    message: `Codex module start: ${moduleDefinition.name}`,
    details: {
      engine: 'codex',
      executionPath: 'generation_queue',
      requestedSize: requestedSize.size,
      requestedAspectRatio: requestedSize.aspectRatio,
      requestedResolution: requestedSize.resolution,
      hasNegativePrompt: Boolean(negativePrompt),
      operation,
      hasImageInput: Boolean(inputImage),
      hasMaskInput: Boolean(maskImage),
      count,
      hasImageSaveOptions: Boolean(imageSaveOptions),
    },
  })

  try {
    const jobId = GenerationQueueModel.create({
      service_type: 'codex',
      workflow_name: moduleDefinition.name,
      request_payload: {
        prompt,
        negative_prompt: negativePrompt ?? undefined,
        size: requestedSize.size,
        count,
        operation,
        image: inputImage ?? undefined,
        mask: maskImage ?? undefined,
        imageSaveOptions,
        _debug: {
          graph_execution_id: context.executionId,
          workflow_debug_mode: context.debugMode,
        },
      },
      request_summary: `${context.workflow.name} · ${node.label || moduleDefinition.name}`,
    })

    GenerationQueueService.requestDispatch()

    writeExecutionLog({
      executionId: context.executionId,
      nodeId: node.id,
      eventType: 'node_queue_registered',
      message: `Queue-backed Codex module registered: ${moduleDefinition.name}`,
      details: {
        queueJobId: jobId,
        requestedSize: requestedSize.size,
        requestedAspectRatio: requestedSize.aspectRatio,
        requestedResolution: requestedSize.resolution,
        operation,
        count,
        hasImageSaveOptions: Boolean(imageSaveOptions),
      },
    })

    const completedJob = await waitForGraphQueueCompletion({
      context,
      nodeId: node.id,
      jobId,
      cancellationMessage: `Queue cancellation requested for Codex node job ${jobId}`,
    })
    await resolveQueueBackedCodexOutput({
      context,
      node,
      moduleDefinition,
      completedJobId: completedJob.id,
      requestedSize,
    })
  } catch (error) {
    if (error instanceof Error && error.message === GRAPH_EXECUTION_CANCELLED_MESSAGE) {
      throw new Error('__GRAPH_EXECUTION_CANCELLED__')
    }
    throw error
  }
}
