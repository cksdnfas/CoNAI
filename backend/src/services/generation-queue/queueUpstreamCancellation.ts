import { ComfyUIServerModel } from '../../models/ComfyUIServer'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { WorkflowModel } from '../../models/Workflow'
import type { ComfyUIServerRecord } from '../../types/comfyuiServer'
import type { GenerationQueueJobRecord } from '../../types/generationQueue'
import { createComfyUIService, type ComfyUICancelPromptResult } from '../comfyuiService'
import { updateQueueRequestDebugMeta } from './queueDebugMeta'

export type QueueUpstreamCancellationOptions = {
  assignedServer?: ComfyUIServerRecord | null
  providerJobId?: string | null
}

function resolveComfyCancellationEndpoint(job: GenerationQueueJobRecord, assignedServer?: ComfyUIServerRecord | null) {
  if (assignedServer?.endpoint) {
    return assignedServer.endpoint
  }

  if (job.assigned_server_id) {
    const server = ComfyUIServerModel.findById(job.assigned_server_id)
    if (server?.endpoint) {
      return server.endpoint
    }
  }

  if (job.workflow_id) {
    const workflow = WorkflowModel.findById(job.workflow_id)
    if (workflow?.api_endpoint) {
      return workflow.api_endpoint
    }
  }

  return null
}

function resolveCancellationState(result: ComfyUICancelPromptResult, assignedServer?: ComfyUIServerRecord | null) {
  if (assignedServer?.backend_type === 'modal') {
    return 'unsupported'
  }

  if (result.interrupted || result.deleted) {
    return result.matchedByMarker ? 'requested_by_marker' : 'requested'
  }

  // 상류는 실행 중이라는데 prompt id를 확인할 수 없어 /interrupt를 건너뛴 경우.
  // 큐 행은 cancelled로 바뀌지만 상류 생성은 완주하므로 not_found와 구분해서 기록한다.
  if (result.runningIdsUnresolved) {
    return 'running_ids_unresolved'
  }

  return 'not_found'
}

export async function attemptQueueUpstreamCancellation(jobId: number, options?: QueueUpstreamCancellationOptions) {
  const latest = GenerationQueueModel.findById(jobId)
  if (!latest || latest.service_type !== 'comfyui') {
    return null
  }

  const promptId = options?.providerJobId ?? latest.provider_job_id ?? null
  const assignedServer = options?.assignedServer ?? (latest.assigned_server_id ? ComfyUIServerModel.findById(latest.assigned_server_id) : null)
  const endpoint = resolveComfyCancellationEndpoint(latest, assignedServer)
  const requestedAt = new Date().toISOString()

  // prompt id 가 없어도 PJ-3 마커로 `/queue` 를 역매칭할 수 있으므로 엔드포인트만 있으면 진행한다.
  if (!endpoint) {
    GenerationQueueModel.markProviderCancelState(jobId, 'missing_endpoint')
    updateQueueRequestDebugMeta(latest, {
      cancellation_requested_at: requestedAt,
      cancellation_endpoint: endpoint,
      cancellation_prompt_id: promptId,
      cancellation_state: 'missing_endpoint',
    })
    return null
  }

  const comfyService = createComfyUIService(endpoint, assignedServer)
  const result = await comfyService.cancelPrompt(promptId ?? '', { queueJobId: jobId })
  const cancellationState = resolveCancellationState(result, assignedServer)

  // R-c: 취소 결과는 컬럼으로 승격해 기록한다(payload 전체 재작성 없이 읽을 수 있다).
  // `_debug` 미러는 큐 상세 응답(queue-read-routes)이 아직 그 키를 읽기 때문에 함께 유지한다.
  if (result.interrupted || result.deleted) {
    // 상류 큐에서 우리 항목을 확인하고 지웠거나 중단시켰다 = 확인된 취소.
    // 마커로 뒤늦게 찾은 prompt id 도 함께 채워 넣어 이후 추적이 가능하게 한다.
    GenerationQueueModel.markProviderSubmitState(jobId, 'cancel_confirmed', {
      providerCancelState: cancellationState,
      providerJobId: result.resolvedPromptId ?? undefined,
    })
  } else if (cancellationState === 'unsupported') {
    // modal 백엔드는 취소 API 가 없다. 로컬 슬롯만 회수되고 상류 과금은 계속된다.
    GenerationQueueModel.markProviderSubmitState(jobId, 'cancel_unsupported', { providerCancelState: cancellationState })
  } else if (result.runningIdsUnresolved) {
    // 상류는 실행 중인데 우리 잡인지 입증할 수 없다. 주기 reconciler 가 마커로 재시도한다.
    GenerationQueueModel.markProviderSubmitState(jobId, 'orphan_suspected', { providerCancelState: cancellationState })
  } else {
    GenerationQueueModel.markProviderCancelState(jobId, cancellationState)
  }

  updateQueueRequestDebugMeta(latest, {
    cancellation_requested_at: requestedAt,
    cancellation_endpoint: endpoint,
    cancellation_prompt_id: result.resolvedPromptId ?? promptId,
    cancellation_state: cancellationState,
    cancellation_result: result,
  })
  return result
}
