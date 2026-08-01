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
    return 'requested'
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

  if (!promptId || !endpoint) {
    updateQueueRequestDebugMeta(latest, {
      cancellation_requested_at: requestedAt,
      cancellation_endpoint: endpoint,
      cancellation_prompt_id: promptId,
      cancellation_state: promptId ? 'missing_endpoint' : 'missing_prompt_id',
    })
    return null
  }

  const comfyService = createComfyUIService(endpoint, assignedServer)
  const result = await comfyService.cancelPrompt(promptId)
  updateQueueRequestDebugMeta(latest, {
    cancellation_requested_at: requestedAt,
    cancellation_endpoint: endpoint,
    cancellation_prompt_id: promptId,
    cancellation_state: resolveCancellationState(result, assignedServer),
    cancellation_result: result,
  })
  return result
}
