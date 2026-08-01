import { ComfyUIServerModel } from '../../models/ComfyUIServer'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { WorkflowModel } from '../../models/Workflow'
import { createComfyUIService, type ComfyUICancelPromptResult } from '../comfyuiService'
import type { ComfyUIServerRecord } from '../../types/comfyuiServer'
import type { GenerationQueueReconcileCandidate } from '../../types/generationQueue'
import { classifySubmitFailure, requiresCompensatingCancel, type SubmitFailureClass } from './queueSubmitFailureClassifier'

/** 보상 취소 재시도 백오프. 상류 큐 반영이 늦는 경우를 감안해 짧게 3회만 시도한다. */
const COMPENSATING_CANCEL_BACKOFF_MS = [1000, 3000, 9000]
export const NAI_SUBMIT_AMBIGUOUS_FAILURE_CODE = 'nai_submit_ambiguous'
export const NAI_SUBMIT_AMBIGUOUS_MESSAGE = 'NovelAI 요청이 접수되었을 수 있어 Anlas가 소모되었을 수 있음. 결과를 확인한 뒤 수동 재시도가 필요해.'

export type CompensateComfySubmitOptions = {
  assignedServer?: ComfyUIServerRecord | null
  providerJobId?: string | null
  attempts?: number
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function resolveComfyEndpoint(candidate: { assigned_server_id?: number | null; workflow_id?: number | null }, assignedServer?: ComfyUIServerRecord | null) {
  if (assignedServer?.endpoint) {
    return assignedServer.endpoint
  }

  if (candidate.assigned_server_id) {
    const server = ComfyUIServerModel.findById(candidate.assigned_server_id)
    if (server?.endpoint) {
      return server.endpoint
    }
  }

  if (candidate.workflow_id) {
    const workflow = WorkflowModel.findById(candidate.workflow_id)
    if (workflow?.api_endpoint) {
      return workflow.api_endpoint
    }
  }

  return null
}

function resolveAssignedServer(candidate: { assigned_server_id?: number | null }, assignedServer?: ComfyUIServerRecord | null) {
  if (assignedServer) {
    return assignedServer
  }

  return candidate.assigned_server_id ? ComfyUIServerModel.findById(candidate.assigned_server_id) : null
}

function describeCancelResult(result: ComfyUICancelPromptResult) {
  if (result.deleted && result.interrupted) {
    return 'deleted+interrupted'
  }
  if (result.deleted) {
    return 'deleted'
  }
  if (result.interrupted) {
    return 'interrupted'
  }
  if (result.runningIdsUnresolved) {
    return 'running_ids_unresolved'
  }
  return 'not_found'
}

/**
 * CC-2: ComfyUI 보상 취소.
 * prompt id 가 없어도 PJ-3 마커로 `/queue` 를 역매칭해 pending 삭제 / running interrupt 를 시도한다.
 * 성공하면 `cancel_confirmed`, 전부 실패하면 `orphan_unresolved` 로 남겨 주기 reconciler 가 이어받는다.
 */
export async function compensateComfySubmit(
  jobId: number,
  options: CompensateComfySubmitOptions = {},
): Promise<'cancel_confirmed' | 'cancel_unsupported' | 'orphan_unresolved' | 'not_found'> {
  const latest = GenerationQueueModel.findById(jobId)
  if (!latest || latest.service_type !== 'comfyui') {
    return 'not_found'
  }

  const assignedServer = resolveAssignedServer(latest, options.assignedServer)
  if (assignedServer?.backend_type === 'modal') {
    // modal 백엔드는 취소 API 자체가 없다. 슬롯만 반환되고 상류 과금은 계속된다.
    GenerationQueueModel.markProviderSubmitState(jobId, 'cancel_unsupported', { providerCancelState: 'unsupported' })
    return 'cancel_unsupported'
  }

  const endpoint = resolveComfyEndpoint(latest, assignedServer)
  if (!endpoint) {
    GenerationQueueModel.markProviderSubmitState(jobId, 'orphan_unresolved', { providerCancelState: 'missing_endpoint' })
    return 'orphan_unresolved'
  }

  const providerJobId = options.providerJobId ?? latest.provider_job_id ?? null
  const comfyService = createComfyUIService(endpoint, assignedServer)
  const attempts = Math.max(1, Math.min(options.attempts ?? COMPENSATING_CANCEL_BACKOFF_MS.length, COMPENSATING_CANCEL_BACKOFF_MS.length))

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await comfyService.cancelPrompt(providerJobId ?? '', { queueJobId: jobId })
      if (result.deleted || result.interrupted) {
        GenerationQueueModel.markProviderSubmitState(jobId, 'cancel_confirmed', {
          providerCancelState: describeCancelResult(result),
          // 마커로 뒤늦게 확인한 prompt id 는 추적을 위해 채워 넣는다.
          providerJobId: result.resolvedPromptId ?? undefined,
        })
        return 'cancel_confirmed'
      }

      if (attempt === attempts - 1) {
        // 큐에서 안 보인다는 것은 이미 끝났거나 애초에 접수되지 않았다는 뜻이다.
        // 상류 부작용을 단정할 수 없으므로 미해결 orphan 으로 남긴다.
        GenerationQueueModel.markProviderSubmitState(jobId, 'orphan_unresolved', {
          providerCancelState: describeCancelResult(result),
        })
        return 'orphan_unresolved'
      }
    } catch (error) {
      if (attempt === attempts - 1) {
        GenerationQueueModel.markProviderSubmitState(jobId, 'orphan_unresolved', {
          providerCancelState: `error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
        })
        return 'orphan_unresolved'
      }
    }

    await sleep(COMPENSATING_CANCEL_BACKOFF_MS[attempt])
  }

  return 'orphan_unresolved'
}

/**
 * CC-1: 제출 실패의 분류에 따라 `provider_submit_state` 를 정하고, 모호한 경우에만 보상 취소를 돌린다.
 * 명백한 미전송/거절은 상류에 아무 것도 없으므로 `none` 으로 되돌린다.
 */
export async function handleComfySubmitFailure(
  jobId: number,
  error: unknown,
  options: CompensateComfySubmitOptions = {},
): Promise<SubmitFailureClass> {
  const failureClass = classifySubmitFailure(error)

  if (!requiresCompensatingCancel(failureClass)) {
    GenerationQueueModel.markProviderSubmitState(jobId, 'none', { providerCancelState: failureClass })
    return failureClass
  }

  GenerationQueueModel.markProviderSubmitState(jobId, 'orphan_suspected', { providerCancelState: 'ambiguous_submit' })
  await compensateComfySubmit(jobId, options)
  return failureClass
}

/** CC-3: NovelAI 는 업스트림 취소 API 가 없어 보상이 불가능하다. 이중 과금 차단만 한다. */
export function markNaiSubmitAmbiguous(jobId: number) {
  GenerationQueueModel.markProviderSubmitState(jobId, 'orphan_unresolved', { providerCancelState: 'nai_unsupported' })
}

async function reconcileOneCandidate(candidate: GenerationQueueReconcileCandidate) {
  if (candidate.service_type === 'comfyui') {
    await compensateComfySubmit(candidate.id, { attempts: 1 })
    return
  }

  if (candidate.service_type === 'novelai') {
    // 상류 조회 수단이 없다. 미해결로 종결하고 재시도 가드로 이중 과금만 막는다.
    markNaiSubmitAmbiguous(candidate.id)
    return
  }

  if (candidate.service_type === 'codex') {
    // CC-4: 로컬 프로세스뿐이라 프로바이더 측 잔재가 없다. 재시작 후에는 pid 재사용 위험 때문에
    // 저장된 pid 로 kill 하지 않고(런타임 취소는 실행기의 abort 경로가 담당), 상태만 종결한다.
    GenerationQueueModel.markProviderSubmitState(candidate.id, 'orphan_unresolved', { providerCancelState: 'codex_local_only' })
  }
}

/**
 * Phase 2 기동/주기 reconcile.
 * 이 정리가 돌아야 R5(상류 orphan 때문에 `is_idle` 이 계속 false → 큐 정지)가 풀린다.
 */
export async function reconcileOrphanedProviderJobs(limit = 25) {
  const candidates = GenerationQueueModel.findOrphanReconcileCandidates(limit)
  if (candidates.length === 0) {
    return { scanned: 0, reconciled: 0 }
  }

  let reconciled = 0
  for (const candidate of candidates) {
    try {
      const before = candidate.provider_submit_state ?? 'none'
      await reconcileOneCandidate(candidate)
      const after = GenerationQueueModel.readCancelState(candidate.id)?.providerSubmitState ?? 'none'
      if (after !== before) {
        reconciled += 1
      }
    } catch (error) {
      console.warn(`⚠️ Failed to reconcile orphaned upstream work for queue job ${candidate.id}:`, error)
    }
  }

  return { scanned: candidates.length, reconciled }
}
