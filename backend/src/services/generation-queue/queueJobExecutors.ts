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
import { resolveComfyAbandonedCancelResult } from '../comfyuiService'
import { executeNaiGeneration } from '../naiGenerationExecutor'
import { executeCodexGeneration } from '../codexGenerationExecutor'
import { reconcileComfyModelSelectionValues } from '../comfyModelSelectionResolver'
import { FileDiscoveryService } from '../folderScan/fileDiscoveryService'
import { ImageUploadService } from '../imageUploadService'
import type { ComfyUIServerRecord } from '../../types/comfyuiServer'
import type { GenerationQueueJobListRecord, GenerationQueueJobRecord, GenerationQueueJobStatus } from '../../types/generationQueue'
import type { NAIMetadataInputParams } from '../../utils/nai/metadata'
import {
  buildCodexMetadataPatch,
  parseCodexQueuePayload,
  parseComfyQueuePayload,
  parseNaiQueuePayload,
  resolveFailureMessage,
} from './queuePayloads'
import { updateQueueRequestDebugMeta, writeQueueComfyDebugSnapshot } from './queueDebugMeta'
import { classifySubmitFailure } from './queueSubmitFailureClassifier'
import { clearGenerationQueueLiveProgress, setGenerationQueueLiveProgress } from './queueProgressRegistry'
import { publishQueueJobEvent, publishQueueJobProgressEvent } from '../runtime-events/runtimeEventPublishers'
import {
  handleComfySubmitFailure,
  markNaiSubmitAmbiguous,
  NAI_SUBMIT_AMBIGUOUS_FAILURE_CODE,
  NAI_SUBMIT_AMBIGUOUS_MESSAGE,
} from './queueOrphanReconciler'

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
    // PAYLOAD-1: 전이는 경량 레코드를 돌려준다(실행기는 반환값을 쓰지 않는다).
  ) => GenerationQueueJobListRecord | null | undefined
  attemptUpstreamCancellation: (jobId: number, options?: {
    assignedServer?: ComfyUIServerRecord | null
    providerJobId?: string | null
  }) => Promise<unknown>
  /** 소유 워커의 취소 시그널. 프로세스 로컬 지연 최적화이고, 정확성은 DB 폴링이 보증한다. */
  signal?: AbortSignal
}

export function isGenerationQueueCancellationError(error: unknown) {
  return error instanceof Error && error.message === GENERATION_QUEUE_CANCELLATION_MESSAGE
}

type QueueFailureCodeCarrier = {
  queueFailureCode?: string
  queueFailureMessage?: string
}

/** 실행기가 결정한 실패 코드를 원본 에러에 그대로 실어 보낸다(스택/원인 보존). */
export function stampQueueFailureCode(error: unknown, failureCode: string, failureMessage?: string) {
  if (error && typeof error === 'object') {
    const carrier = error as QueueFailureCodeCarrier
    carrier.queueFailureCode = failureCode
    if (failureMessage) {
      carrier.queueFailureMessage = failureMessage
    }
  }

  return error
}

/** Read the executor-provided failure code, if any. */
export function resolveQueueFailureCode(error: unknown) {
  const carrier = error && typeof error === 'object' ? error as QueueFailureCodeCarrier : null
  return typeof carrier?.queueFailureCode === 'string' ? carrier.queueFailureCode : null
}

/** Read the executor-provided failure message, if any. */
export function resolveQueueFailureMessage(error: unknown) {
  const carrier = error && typeof error === 'object' ? error as QueueFailureCodeCarrier : null
  return typeof carrier?.queueFailureMessage === 'string' ? carrier.queueFailureMessage : null
}

/** 취소 폴링 hot path. `readCancelState`로 컬럼 3~4개만 읽고 payload는 건드리지 않는다. */
function isQueueCancelRequested(jobId: number) {
  return GenerationQueueModel.readCancelState(jobId)?.cancelRequested === true
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

  let acceptedPromptId = job.provider_job_id ?? null
  try {
    const result = await executeComfyGeneration({
      comfyService,
      workflow: substitutedWorkflow,
      imageSaveOptions: payload.imageSaveOptions,
      artifactWorkflow: workflow.result_view_mode === 'artifact_explorer' ? workflow : null,
      queueJobId: job.id,
      signal: context.signal,
      shouldCancel: () => isQueueCancelRequested(job.id),
      onCancelRequested: async (promptId) => {
        await context.attemptUpstreamCancellation(job.id, {
          assignedServer,
          providerJobId: promptId,
        })
      },
      // PJ-1: POST 직전에 "제출 의사"를 커밋한다. 프로세스가 여기서 죽어도 orphan 복구 근거가 남는다.
      onUpstreamSubmitting: () => {
        GenerationQueueModel.markProviderSubmitState(job.id, 'in_flight', {
          providerSubmitStartedAt: new Date().toISOString(),
          assignedServerId: assignedServer?.id ?? job.assigned_server_id ?? null,
          incrementSubmitAttempt: true,
          expectedStatuses: ['dispatching'],
        })
      },
      // PJ-2: 응답 파싱과 같은 tick 에서 핸들 + running 전이를 한 번의 UPDATE 로 커밋한다.
      onPromptAccepted: (promptId) => {
        acceptedPromptId = promptId
        GenerationQueueModel.markProviderAccepted(job.id, promptId)
        publishQueueJobEvent('queue.job.status', GenerationQueueModel.findListRecordById(job.id), {
          previousStatus: 'dispatching',
        })
      },
      onProgress: (progress) => {
        setGenerationQueueLiveProgress(job.id, progress)
        publishQueueJobProgressEvent({
          id: job.id,
          requested_by_account_id: job.requested_by_account_id,
          provider_job_id: acceptedPromptId,
        }, progress)
      },
      onPromptSubmitted: async (promptId) => {
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
    const cancelState = GenerationQueueModel.readCancelState(job.id)

    // CC-1/CC-2: 제출 단계(in_flight)에서 끝난 실패는 상류에 작업이 남았을 수 있다.
    // 분류가 ambiguous 면 마커 기반 보상 취소가 여기서 돈다(취소로 abort 된 요청도 ambiguous 다).
    if (cancelState?.providerSubmitState === 'in_flight') {
      try {
        await handleComfySubmitFailure(job.id, error, { assignedServer })
      } catch (compensationError) {
        console.warn(`⚠️ Failed compensating ComfyUI cancellation for queue job ${job.id}:`, compensationError)
      }
    }

    // GEN-8: 폴링 포기/타임아웃으로 살아 있는 프롬프트를 버린 경우, 취소 확인 여부를 컬럼에 남긴다.
    // 확인되지 않았으면 상류가 그대로 완주하므로 reconciler 가 이어받게 orphan 후보로 남긴다.
    const abandonedCancelResult = resolveComfyAbandonedCancelResult(error)
    if (abandonedCancelResult !== undefined) {
      const cancelConfirmed = abandonedCancelResult?.deleted === true || abandonedCancelResult?.interrupted === true
      GenerationQueueModel.markProviderSubmitState(job.id, cancelConfirmed ? 'cancel_confirmed' : 'orphan_suspected', {
        providerCancelState: cancelConfirmed ? 'abandoned_cancel_confirmed' : 'abandoned_cancel_unconfirmed',
      })
    }

    const cancellationRequested = isComfyGenerationCancelledError(error) || cancelState?.cancelRequested === true
    if (cancellationRequested) {
      await writeQueueComfyDebugSnapshot(job, {
        ...debugSnapshotBase,
        stage: 'cancelled',
        captured_at: new Date().toISOString(),
        prompt_id: GenerationQueueModel.readCancelState(job.id)?.providerJobId ?? null,
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
  } finally {
    clearGenerationQueueLiveProgress(job.id)
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
      signal: context.signal,
      // PJ-1: 전송 직전 지점(GEN-2가 만든 자리). 여기서부터 상류 작업이 생겼을 수 있다.
      onUpstreamSubmitting: async () => {
        GenerationQueueModel.markProviderSubmitState(job.id, 'in_flight', {
          providerSubmitStartedAt: new Date().toISOString(),
          incrementSubmitAttempt: true,
          expectedStatuses: ['dispatching'],
        })

        context.transitionJob(job.id, 'running', {
          expectedCurrentStatuses: ['dispatching'],
        })

        if (placeholderHistoryId) {
          GenerationHistoryModel.updateStatus(placeholderHistoryId, 'processing')
        }
      },
      onUpstreamAccepted: () => {
        // NovelAI 는 업스트림 핸들 개념이 없어 provider_job_id 는 계속 null 이다(PJ-4).
        GenerationQueueModel.markProviderSubmitState(job.id, 'accepted')
      },
    })

    // 업스트림 호출 내내 running 상태라 취소 요청은 cancel_requested 플래그로만 남는다.
    // 인메모리 abort 는 같은 프로세스에서만 닿으므로, 분리 모드 정확성은 이 DB 확인이 보증한다.
    // 라이브러리에 이미지를 올리기 전에 확인하지 않으면 취소가 사실상 무시된다.
    if (isQueueCancelRequested(job.id)) {
      throw new Error(GENERATION_QUEUE_CANCELLATION_MESSAGE)
    }

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
    const cancelState = GenerationQueueModel.readCancelState(job.id)

    // CC-3: NovelAI 는 업스트림 취소 API 가 없어 보상이 불가능하다.
    // 접수 여부가 모호하면 Anlas 소모 가능성을 남기고 자동 재시도를 차단한다.
    if (cancelState?.providerSubmitState === 'in_flight' && classifySubmitFailure(error) === 'ambiguous') {
      markNaiSubmitAmbiguous(job.id)
      stampQueueFailureCode(error, NAI_SUBMIT_AMBIGUOUS_FAILURE_CODE, NAI_SUBMIT_AMBIGUOUS_MESSAGE)
    }

    if (placeholderHistoryId) {
      const failureMessage = cancelState?.status === 'cancelled' || cancelState?.cancelRequested === true
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

    GenerationQueueModel.markProviderSubmitState(job.id, 'in_flight', {
      providerSubmitStartedAt: new Date().toISOString(),
      incrementSubmitAttempt: true,
    })

    const result = await executeCodexGeneration(payload, {
      signal: context.signal,
      onProcessSpawned: (pid) => {
        // PJ-4: Codex 핸들은 로컬 프로세스다. 재시작 후에는 pid 재사용 위험 때문에 kill 하지 않는다.
        GenerationQueueModel.markProviderSubmitState(job.id, 'accepted', {
          providerJobId: `pid:${pid}@${new Date().toISOString()}`,
        })
      },
    })

    // Codex도 comfyui가 아니라 업스트림 취소 경로가 없다. 산출물을 라이브러리에 올리기 전에
    // cancel_requested를 확인해야 취소가 무시되지 않는다(인메모리 abort 는 같은 프로세스 전용).
    if (isQueueCancelRequested(job.id)) {
      throw new Error(GENERATION_QUEUE_CANCELLATION_MESSAGE)
    }

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
    // CC-4: 로컬 프로세스뿐이라 프로바이더 측 잔재가 없다. 트리 kill + 디렉터리 정리로 완결된다.
    GenerationQueueModel.markProviderSubmitState(job.id, 'none', { providerCancelState: 'codex_local_only' })

    if (placeholderHistoryId) {
      const cancelState = GenerationQueueModel.readCancelState(job.id)
      const failureMessage = cancelState?.status === 'cancelled' || cancelState?.cancelRequested === true
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
