import fs from 'fs'
import path from 'path'
import { type NAIMetadataInputParams } from '../../utils/nai/metadata'
import { GenerationHistoryModel } from '../../models/GenerationHistory'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { type GraphWorkflowNode } from '../../types/moduleGraph'
import { FileDiscoveryService } from '../folderScan/fileDiscoveryService'
import { ImageUploadService } from '../imageUploadService'
import { GenerationQueueService } from '../generationQueueService'
import { settingsService } from '../settingsService'
import { saveCanonicalMediaArtifactReference, saveMetadataArtifact, shouldMaterializeRuntimeArtifactValue } from './artifacts'
import { GRAPH_EXECUTION_CANCELLED_MESSAGE, waitForGraphQueueCompletion } from './queue-wait'
import {
  bufferToDataUrl,
  writeExecutionLog,
  type ExecutionContext,
  type ParsedModuleDefinition,
  type RuntimeArtifact,
} from './shared'

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

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function resolveQueueBackedNaiOutput(params: {
  context: ExecutionContext
  node: GraphWorkflowNode
  moduleDefinition: ParsedModuleDefinition
  completedJobId: number
  requestInput: NAIMetadataInputParams
}) {
  const completedJob = GenerationQueueModel.findById(params.completedJobId)
  if (!completedJob) {
    throw new Error(`Completed queue job ${params.completedJobId} is no longer available`)
  }

  const historyRecords = GenerationHistoryModel.findAll({
    service_type: 'novelai',
    queue_job_id: completedJob.id,
    order_by: 'created_at',
    order_direction: 'ASC',
  })
  const firstHistory = historyRecords.find((history) => Boolean(history.composite_hash || history.original_path)) ?? historyRecords[0] ?? null
  if (!firstHistory) {
    throw new Error(`Queue job ${completedJob.id} completed but no NovelAI history row could be resolved`)
  }

  const compositeHash = normalizeOptionalString(firstHistory.composite_hash)
  const activePath = compositeHash ? ImageUploadService.getActiveFilePath(compositeHash) : null
  const originalPath = activePath ?? normalizeOptionalString(firstHistory.original_path)
  if (!originalPath) {
    throw new Error(`Queue job ${completedJob.id} completed but NovelAI output path could not be resolved`)
  }

  const resolvedMimeType = FileDiscoveryService.getMimeType(originalPath)
  const originalFileName = path.basename(originalPath)
  const primaryOutputPort = params.moduleDefinition.output_ports.find((port) => port.key === 'image')
    ?? params.moduleDefinition.output_ports.find((port) => port.key !== 'metadata')
    ?? { key: 'image', data_type: 'image' as const }
  const shouldMaterializeValue = shouldMaterializeRuntimeArtifactValue(params.context, params.node.id, primaryOutputPort.key, 'image')
  const referencedArtifact = await saveCanonicalMediaArtifactReference(
    params.context.executionId,
    params.node.id,
    primaryOutputPort.key,
    'image',
    originalPath,
    {
      mimeType: resolvedMimeType,
      originalFileName,
      queueJobId: completedJob.id,
      historyId: firstHistory.id,
      compositeHash,
      metadata: {
        source: 'nai-queue-image',
      },
    },
  )
  const imageValue = shouldMaterializeValue
    ? bufferToDataUrl(await fs.promises.readFile(originalPath), resolvedMimeType)
    : {
      storagePath: originalPath,
      composite_hash: compositeHash,
      original_path: originalPath,
      mime_type: resolvedMimeType,
      output_file_name: originalFileName,
      queue_job_id: completedJob.id,
      history_id: firstHistory.id,
    }

  const metadataValue = {
    prompt: params.requestInput.prompt,
    negative_prompt: params.requestInput.negative_prompt,
    characters: params.requestInput.characters,
    vibes: params.requestInput.vibes,
    character_refs: params.requestInput.character_refs,
    model: params.requestInput.model,
    action: params.requestInput.action,
    width: params.requestInput.width,
    height: params.requestInput.height,
    steps: params.requestInput.steps,
    scale: params.requestInput.scale,
    seed: firstHistory.nai_seed ?? params.requestInput.seed,
    sampler: params.requestInput.sampler,
    scheduler: params.requestInput.noise_schedule,
    queue_job_id: completedJob.id,
    history_id: firstHistory.id,
    composite_hash: compositeHash,
    original_path: originalPath,
  }

  const nodeArtifacts: Record<string, RuntimeArtifact> = {
    [primaryOutputPort.key]: {
      type: 'image',
      value: imageValue,
      storagePath: referencedArtifact.storagePath,
      artifactRecordId: referencedArtifact.artifactRecordId,
      metadata: referencedArtifact.metadata,
    },
    image_ref: {
      type: 'json',
      value: {
        storagePath: originalPath,
        composite_hash: compositeHash,
        original_path: originalPath,
        mime_type: resolvedMimeType,
        queue_job_id: completedJob.id,
        history_id: firstHistory.id,
      },
      metadata: {
        kind: 'nai-queue-image-reference',
        queueJobId: completedJob.id,
      },
    },
    metadata: {
      type: 'json',
      value: metadataValue,
      metadata: {
        kind: 'nai-queue-metadata',
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
    message: `Queue-backed NAI module completed: ${params.moduleDefinition.name}`,
    details: {
      queueJobId: completedJob.id,
      historyId: firstHistory.id,
      compositeHash,
      storagePath: referencedArtifact.storagePath,
      referenceKind: 'canonical-generated-media',
    },
  })
}

/** Execute a NovelAI-backed module node and persist its outputs. */
export async function executeNaiModule(context: ExecutionContext, node: GraphWorkflowNode, moduleDefinition: ParsedModuleDefinition, resolvedInputs: Record<string, any>) {
  writeExecutionLog({
    executionId: context.executionId,
    nodeId: node.id,
    eventType: 'node_engine_start',
    message: `NAI module start: ${moduleDefinition.name}`,
    details: {
      engine: 'nai',
      model: resolvedInputs.model,
      action: resolvedInputs.action,
    },
  })

  const requestInput = resolvedInputs as NAIMetadataInputParams
  const imageSaveOptions = buildQueueImageSaveOptions()

  try {
    const jobId = GenerationQueueModel.create({
      service_type: 'novelai',
      workflow_name: moduleDefinition.name,
      request_payload: {
        ...requestInput,
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
      message: `Queue-backed NAI module registered: ${moduleDefinition.name}`,
      details: {
        queueJobId: jobId,
        hasImageSaveOptions: Boolean(imageSaveOptions),
      },
    })

    const completedJob = await waitForGraphQueueCompletion({
      context,
      nodeId: node.id,
      jobId,
      cancellationMessage: `Queue cancellation requested for NAI node job ${jobId}`,
    })
    await resolveQueueBackedNaiOutput({
      context,
      node,
      moduleDefinition,
      completedJobId: completedJob.id,
      requestInput,
    })
  } catch (error) {
    if (error instanceof Error && error.message === GRAPH_EXECUTION_CANCELLED_MESSAGE) {
      throw new Error('__GRAPH_EXECUTION_CANCELLED__')
    }
    throw error
  }
}

/** Execute the fixed built-in NovelAI image-generation system node. */
export async function executeNaiImageGenerationNode(context: ExecutionContext, node: GraphWorkflowNode, moduleDefinition: ParsedModuleDefinition, resolvedInputs: Record<string, any>) {
  return executeNaiModule(context, node, moduleDefinition, resolvedInputs)
}
