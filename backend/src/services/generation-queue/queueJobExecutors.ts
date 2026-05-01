import { getToken } from '../../utils/nai/auth'
import { WorkflowModel } from '../../models/Workflow'
import { GenerationHistoryModel } from '../../models/GenerationHistory'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { GenerationHistoryService } from '../generationHistoryService'
import { BackgroundProcessorService } from '../backgroundProcessorService'
import { createComfyUIService } from '../comfyuiService'
import { prepareComfyPromptData } from '../prepareComfyPromptData'
import { resolveWorkflowPromptValues } from '../workflowPromptValueResolver'
import { executeComfyGeneration, isComfyGenerationCancelledError } from '../comfyGenerationExecutor'
import { executeNaiGeneration } from '../naiGenerationExecutor'
import { executeCodexGeneration } from '../codexGenerationExecutor'
import { reconcileComfyModelSelectionValues } from '../comfyModelSelectionResolver'
import { FileDiscoveryService } from '../folderScan/fileDiscoveryService'
import { ImageUploadService } from '../imageUploadService'
import type { ComfyUIServerRecord } from '../../types/comfyuiServer'
import type { GenerationQueueJobRecord, GenerationQueueJobStatus } from '../../types/generationQueue'
import type { NAIMetadataInputParams } from '../../utils/nai/metadata'
import {
  buildCodexMetadataPatch,
  parseCodexQueuePayload,
  parseComfyQueuePayload,
  parseNaiQueuePayload,
  resolveFailureMessage,
} from './queuePayloads'
import { updateQueueRequestDebugMeta, writeQueueComfyDebugSnapshot } from './queueDebugMeta'

const GENERATION_QUEUE_CANCELLATION_MESSAGE = '__GENERATION_QUEUE_CANCELLATION__'

export type QueueJobExecutorContext = {
  transitionJob: (
    id: number,
    nextStatus: GenerationQueueJobStatus,
    options?: {
      assignedServerId?: number | null
      failureCode?: string | null
      failureMessage?: string | null
      nowIso?: string
      allowRecovery?: boolean
      expectedCurrentStatuses?: GenerationQueueJobStatus[]
      providerJobId?: string | null
    },
  ) => GenerationQueueJobRecord | null | undefined
  attemptUpstreamCancellation: (jobId: number, options?: {
    assignedServer?: ComfyUIServerRecord | null
    providerJobId?: string | null
  }) => Promise<unknown>
}

export function isGenerationQueueCancellationError(error: unknown) {
  return error instanceof Error && error.message === GENERATION_QUEUE_CANCELLATION_MESSAGE
}

export async function executeGenerationQueueJob(
  job: GenerationQueueJobRecord,
  assignedServer: ComfyUIServerRecord | null,
  context: QueueJobExecutorContext,
) {
  if (job.service_type === 'comfyui') {
    await executeComfyUiJob(job, assignedServer, context)
    return
  }

  if (job.service_type === 'novelai') {
    await executeNovelAiJob(job, context)
    return
  }

  if (job.service_type === 'codex') {
    await executeCodexJob(job, context)
    return
  }

  throw new Error(`Unsupported queue service type: ${job.service_type}`)
}

async function executeComfyUiJob(job: GenerationQueueJobRecord, assignedServer: ComfyUIServerRecord | null, context: QueueJobExecutorContext) {
  if (!job.workflow_id) {
    throw new Error(`Queue job ${job.id} is missing workflow_id for ComfyUI execution`)
  }

  const workflow = WorkflowModel.findById(job.workflow_id)
  if (!workflow) {
    throw new Error(`Queue job ${job.id} references missing workflow ${job.workflow_id}`)
  }

  if (!workflow.is_active) {
    throw new Error(`Queue job ${job.id} references inactive workflow ${job.workflow_id}`)
  }

  const payload = parseComfyQueuePayload(job)
  const apiEndpoint = assignedServer?.endpoint ?? workflow.api_endpoint
  const comfyService = createComfyUIService(apiEndpoint, assignedServer)
  const markedFields = workflow.marked_fields ? JSON.parse(workflow.marked_fields) : []
  const preparedPromptData = await prepareComfyPromptData(comfyService, markedFields, payload.promptData)
  const parsedPromptData = resolveWorkflowPromptValues(markedFields, preparedPromptData, 'comfyui', {
    modelPathSeparator: comfyService.isModalBackend() ? 'posix' : 'windows',
  })
  const resolvedPromptData = await reconcileComfyModelSelectionValues(workflow.workflow_json, markedFields, parsedPromptData, comfyService, { strict: !comfyService.isModalBackend() })
  const substitutedWorkflow = comfyService.substitutePromptData(
    workflow.workflow_json,
    markedFields,
    resolvedPromptData,
  )

  let historyId: number | undefined
  try {
    historyId = await GenerationHistoryService.createComfyUIHistory({
      workflowId: workflow.id,
      workflowName: workflow.name,
      groupId: job.requested_group_id ?? undefined,
      queueJobId: job.id,
      requestedByAccountId: job.requested_by_account_id ?? undefined,
      requestedByAccountType: job.requested_by_account_type ?? undefined,
      serverId: assignedServer?.id ?? job.assigned_server_id ?? undefined,
    })
  } catch (historyError) {
    console.error(`⚠️ Failed to create ComfyUI queue history for job ${job.id}:`, historyError)
  }

  updateQueueRequestDebugMeta(job, {
    history_id: historyId ?? null,
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    server_id: assignedServer?.id ?? job.assigned_server_id ?? null,
    server_name: assignedServer?.name ?? null,
    endpoint: apiEndpoint,
  })

  const debugSnapshotBase = {
    service_type: 'comfyui' as const,
    queue_job_id: job.id,
    history_id: historyId ?? null,
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    server_id: assignedServer?.id ?? job.assigned_server_id ?? null,
    server_name: assignedServer?.name ?? null,
    endpoint: apiEndpoint,
    raw_prompt_data: payload.promptData,
    prepared_prompt_data: preparedPromptData,
    resolved_prompt_data: resolvedPromptData,
    request_body: {
      prompt: substitutedWorkflow,
    },
  }

  const preparedDebugLog = await writeQueueComfyDebugSnapshot(job, {
    ...debugSnapshotBase,
    stage: 'prepared',
    captured_at: new Date().toISOString(),
  })

  if (preparedDebugLog.relativePath) {
    console.log(`🧾 Queue job ${job.id} ComfyUI request snapshot: ${preparedDebugLog.relativePath}`)
  }

  try {
    const result = await executeComfyGeneration({
      comfyService,
      workflow: substitutedWorkflow,
      imageSaveOptions: payload.imageSaveOptions,
      artifactWorkflow: workflow.result_view_mode === 'artifact_explorer' ? workflow : null,
      shouldCancel: () => (GenerationQueueModel.findById(job.id)?.cancel_requested ?? 0) > 0,
      onCancelRequested: async (promptId) => {
        await context.attemptUpstreamCancellation(job.id, {
          assignedServer,
          providerJobId: promptId,
        })
      },
      onPromptSubmitted: async (promptId) => {
        context.transitionJob(job.id, 'running', {
          assignedServerId: assignedServer?.id ?? job.assigned_server_id ?? null,
          expectedCurrentStatuses: ['dispatching'],
          providerJobId: promptId,
        })

        await writeQueueComfyDebugSnapshot(job, {
          ...debugSnapshotBase,
          stage: 'submitted',
          captured_at: new Date().toISOString(),
          prompt_id: promptId,
        })

        if (!historyId) {
          return
        }

        GenerationHistoryModel.update(historyId, {
          generation_status: 'processing',
        })
      },
    })

    if (workflow.result_view_mode === 'artifact_explorer') {
      if (result.savedArtifactCount === 0) {
        throw new Error(`Queue job ${job.id} finished ComfyUI artifact execution but no artifact output was saved`)
      }

      if (historyId) {
        GenerationHistoryModel.updateStatus(historyId, 'completed')
      }

      updateQueueRequestDebugMeta(job, {
        history_id: historyId ?? null,
        result_prompt_id: result.promptId,
        attempted_artifact_count: result.attemptedArtifactCount,
        saved_artifact_count: result.savedArtifactCount,
        artifact_directory: result.savedArtifacts[0]?.directoryRelativePath ?? '',
      })
    } else {
      if (!result.representativeImage) {
        throw new Error(`Queue job ${job.id} finished ComfyUI execution but no representative output was saved`)
      }

      if (historyId) {
        GenerationHistoryModel.updateImagePaths(historyId, {
          compositeHash: result.representativeImage.compositeHash,
        })
        await BackgroundProcessorService.processApiGenerationGroupAssignmentForHash(result.representativeImage.compositeHash)
        GenerationHistoryModel.updateStatus(historyId, 'completed')
      }

      updateQueueRequestDebugMeta(job, {
        history_id: historyId ?? null,
        result_prompt_id: result.promptId,
        result_composite_hash: result.representativeImage.compositeHash,
        result_original_path: result.representativeImage.originalPath,
        result_file_size: result.representativeImage.fileSize,
        result_mime_type: FileDiscoveryService.getMimeType(result.representativeImage.originalPath),
        attempted_image_count: result.attemptedImageCount,
        saved_image_count: result.savedImageCount,
      })
    }

    await writeQueueComfyDebugSnapshot(job, {
      ...debugSnapshotBase,
      stage: 'completed',
      captured_at: new Date().toISOString(),
      prompt_id: result.promptId,
    })

    context.transitionJob(job.id, 'completed', {
      expectedCurrentStatuses: ['running'],
    })

    if (workflow.result_view_mode === 'artifact_explorer') {
      console.log(`✅ Queue job ${job.id} completed via ComfyUI artifacts (${result.savedArtifactCount}/${result.attemptedArtifactCount} artifacts saved)`)
    } else {
      console.log(`✅ Queue job ${job.id} completed via ComfyUI (${result.savedImageCount}/${result.attemptedImageCount} outputs saved)`)
    }
  } catch (error) {
    const cancellationRequested = isComfyGenerationCancelledError(error) || (GenerationQueueModel.findById(job.id)?.cancel_requested ?? 0) > 0
    if (cancellationRequested) {
      await writeQueueComfyDebugSnapshot(job, {
        ...debugSnapshotBase,
        stage: 'cancelled',
        captured_at: new Date().toISOString(),
        prompt_id: GenerationQueueModel.findById(job.id)?.provider_job_id ?? null,
        error_message: 'Queue job cancelled before ComfyUI output handoff completed',
      })

      if (historyId) {
        GenerationHistoryModel.recordError(historyId, 'Cancelled by user')
      }

      throw new Error(GENERATION_QUEUE_CANCELLATION_MESSAGE)
    }

    const failureMessage = resolveFailureMessage(error)
    await writeQueueComfyDebugSnapshot(job, {
      ...debugSnapshotBase,
      stage: 'failed',
      captured_at: new Date().toISOString(),
      error_message: failureMessage,
    })

    if (historyId) {
      GenerationHistoryModel.recordError(historyId, failureMessage)
    }
    throw error
  }
}

async function executeNovelAiJob(job: GenerationQueueJobRecord, context: QueueJobExecutorContext) {
  const token = getToken()
  if (!token) {
    throw new Error('NovelAI queue execution requires a configured backend token')
  }

  const payload = parseNaiQueuePayload(job)
  const requestInput: NAIMetadataInputParams = {
    ...payload,
    groupId: job.requested_group_id ?? payload.groupId,
  }

  let placeholderHistoryId: number | null = null
  try {
    placeholderHistoryId = await GenerationHistoryService.createNAIHistory({
      model: requestInput.model || 'nai-diffusion-4-5-curated',
      groupId: job.requested_group_id ?? requestInput.groupId,
      queueJobId: job.id,
      requestedByAccountId: job.requested_by_account_id ?? undefined,
      requestedByAccountType: job.requested_by_account_type ?? undefined,
      serverId: job.assigned_server_id ?? undefined,
    })
  } catch (historyError) {
    console.error(`⚠️ Failed to create NovelAI queue history for job ${job.id}:`, historyError)
  }

  try {
    const { metadata, imageBuffers } = await executeNaiGeneration(requestInput, token, {
      onUpstreamAccepted: async () => {
        context.transitionJob(job.id, 'running', {
          expectedCurrentStatuses: ['dispatching'],
        })

        if (placeholderHistoryId) {
          GenerationHistoryModel.updateStatus(placeholderHistoryId, 'processing')
        }
      },
    })
    if (imageBuffers.length === 0) {
      throw new Error(`Queue job ${job.id} returned no NovelAI images`)
    }

    const historyIds: number[] = []
    const processPromises: Promise<void>[] = []

    for (let index = 0; index < imageBuffers.length; index += 1) {
      let historyId: number
      if (index === 0 && placeholderHistoryId) {
        historyId = placeholderHistoryId
        GenerationHistoryModel.update(historyId, {
          nai_model: metadata.model || 'unknown',
          assigned_group_id: job.requested_group_id ?? metadata.groupId,
          requested_by_account_id: job.requested_by_account_id ?? undefined,
          requested_by_account_type: job.requested_by_account_type ?? undefined,
          server_id: job.assigned_server_id ?? undefined,
        })
      } else {
        historyId = await GenerationHistoryService.createNAIHistory({
          model: metadata.model || 'unknown',
          groupId: job.requested_group_id ?? metadata.groupId,
          queueJobId: job.id,
          requestedByAccountId: job.requested_by_account_id ?? undefined,
          requestedByAccountType: job.requested_by_account_type ?? undefined,
          serverId: job.assigned_server_id ?? undefined,
        })
      }

      historyIds.push(historyId)
      processPromises.push(
        GenerationHistoryService.processAndUploadImage(historyId, imageBuffers[index], 'novelai', payload.imageSaveOptions),
      )
    }

    await Promise.all(processPromises)

    context.transitionJob(job.id, 'completed', {
      expectedCurrentStatuses: ['running'],
    })

    console.log(`✅ Queue job ${job.id} completed via NovelAI (${historyIds.length} histories)`)
  } catch (error) {
    if (placeholderHistoryId) {
      const latestQueue = GenerationQueueModel.findById(job.id)
      const failureMessage = latestQueue?.status === 'cancelled' || (latestQueue?.cancel_requested ?? 0) > 0
        ? 'Cancelled by user'
        : resolveFailureMessage(error)
      const placeholderHistory = GenerationHistoryModel.findById(placeholderHistoryId)
      if (placeholderHistory && placeholderHistory.generation_status !== 'completed') {
        GenerationHistoryModel.recordError(placeholderHistoryId, failureMessage)
      }
    }

    throw error
  }
}

async function executeCodexJob(job: GenerationQueueJobRecord, context: QueueJobExecutorContext) {
  const payload = parseCodexQueuePayload(job)

  let placeholderHistoryId: number | null = null
  try {
    placeholderHistoryId = await GenerationHistoryService.createCodexHistory({
      model: payload.model || 'codex',
      prompt: payload.prompt,
      negativePrompt: payload.negative_prompt,
      groupId: job.requested_group_id ?? undefined,
      queueJobId: job.id,
      requestedByAccountId: job.requested_by_account_id ?? undefined,
      requestedByAccountType: job.requested_by_account_type ?? undefined,
    })
  } catch (historyError) {
    console.error(`⚠️ Failed to create Codex queue history for job ${job.id}:`, historyError)
  }

  try {
    context.transitionJob(job.id, 'running', {
      expectedCurrentStatuses: ['dispatching'],
    })

    if (placeholderHistoryId) {
      GenerationHistoryModel.updateStatus(placeholderHistoryId, 'processing')
    }

    const result = await executeCodexGeneration(payload)
    if (result.outputFiles.length === 0) {
      throw new Error(`Queue job ${job.id} finished Codex execution but no outputs were discovered`)
    }

    const historyIds: number[] = []
    const processPromises: Promise<void>[] = []

    for (let index = 0; index < result.outputFiles.length; index += 1) {
      const output = result.outputFiles[index]
      let historyId: number

      if (index === 0 && placeholderHistoryId) {
        historyId = placeholderHistoryId
        GenerationHistoryModel.update(historyId, {
          metadata: JSON.stringify({
            codex_job_directory: result.jobDirectory,
            codex_output_file: output.absolutePath,
            codex_last_message: result.lastMessage,
          }),
        })
      } else {
        historyId = await GenerationHistoryService.createCodexHistory({
          model: payload.model || 'codex',
          prompt: payload.prompt,
          negativePrompt: payload.negative_prompt,
          groupId: job.requested_group_id ?? undefined,
          queueJobId: job.id,
          requestedByAccountId: job.requested_by_account_id ?? undefined,
          requestedByAccountType: job.requested_by_account_type ?? undefined,
          metadata: {
            codex_job_directory: result.jobDirectory,
            codex_output_file: output.absolutePath,
            codex_last_message: result.lastMessage,
          },
        })
      }

      historyIds.push(historyId)
      processPromises.push(
        GenerationHistoryService.processAndUploadGeneratedFile(historyId, output.absolutePath, 'codex', {
          ...payload.imageSaveOptions,
          sourcePathForMetadata: output.absolutePath,
          sourceMimeType: output.mimeType,
          originalFileName: output.absolutePath.split(/[/\\]/).pop(),
          metadataPatch: buildCodexMetadataPatch(payload, index, result.outputFiles.length, result.lastMessage),
        }),
      )
    }

    await Promise.all(processPromises)

    const representativeHistory = historyIds
      .map((historyId) => GenerationHistoryModel.findById(historyId))
      .find((history) => Boolean(history?.composite_hash))
      ?? (historyIds.length > 0 ? GenerationHistoryModel.findById(historyIds[0]) : null)
    const representativeCompositeHash = representativeHistory?.composite_hash ?? null
    const representativeOriginalPath = representativeCompositeHash
      ? ImageUploadService.getActiveFilePath(representativeCompositeHash)
      : null

    updateQueueRequestDebugMeta(job, {
      history_ids: historyIds,
      codex_job_directory: result.jobDirectory,
      codex_stdout_path: result.stdoutPath,
      codex_stderr_path: result.stderrPath,
      codex_last_message: result.lastMessage,
      attempted_image_count: payload.count ?? result.outputFiles.length,
      saved_image_count: result.outputFiles.length,
      result_mime_types: result.outputFiles.map((output) => output.mimeType),
      result_composite_hash: representativeCompositeHash,
      result_original_path: representativeOriginalPath,
      result_mime_type: representativeOriginalPath ? FileDiscoveryService.getMimeType(representativeOriginalPath) : null,
    })

    context.transitionJob(job.id, 'completed', {
      expectedCurrentStatuses: ['running'],
    })

    console.log(`✅ Queue job ${job.id} completed via Codex (${historyIds.length} histories)`)
  } catch (error) {
    if (placeholderHistoryId) {
      const latestQueue = GenerationQueueModel.findById(job.id)
      const failureMessage = latestQueue?.status === 'cancelled' || (latestQueue?.cancel_requested ?? 0) > 0
        ? 'Cancelled by user'
        : resolveFailureMessage(error)
      const placeholderHistory = GenerationHistoryModel.findById(placeholderHistoryId)
      if (placeholderHistory && placeholderHistory.generation_status !== 'completed') {
        GenerationHistoryModel.recordError(placeholderHistoryId, failureMessage)
      }
    }

    throw error
  }
}
