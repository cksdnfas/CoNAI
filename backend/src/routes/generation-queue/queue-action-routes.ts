import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../../middleware/asyncHandler'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { ComfyUIServerModel, WorkflowServerModel } from '../../models/ComfyUIServer'
import { WorkflowModel } from '../../models/Workflow'
import { GenerationQueueService } from '../../services/generationQueueService'
import { externalizeQueueInputDataUrls } from '../../services/generation-queue/queueInputStore'
import {
  buildWorkflowRoleQueueLimitMessage,
  checkWorkflowRoleQueueLimit,
} from '../../services/generation-queue/queueRoleLimitPolicy'
import { hasGenerationQueueServerRoutingTag } from '../../services/generationQueueRouting'
import { publishQueueJobEvent } from '../../services/runtime-events/runtimeEventPublishers'
import {
  normalizeWorkflowNumericPromptValues,
  WorkflowNumericFieldValidationError,
} from '../../services/workflowNumericFieldPolicy'
import type { WorkflowRecord } from '../../types/workflow'
import { getRequesterAccountType, isAdminRequest } from '../requester-session-helpers'
import { parsePositiveInteger, sendRouteBadRequest } from '../routeValidation'
import {
  getRequesterAccountId,
  hasGenerationPageAccess,
  parseRequestedServerTag,
  resolveAccessibleQueueJob,
  TERMINAL_QUEUE_STATUSES,
} from './queue-route-helpers'

/** Mirrors the frontend "개수" control ceiling; one request may expand into this many jobs. */
const MAX_QUEUE_ENQUEUE_COUNT = 32

export function createGenerationQueueActionRoutes() {
  const router = express.Router()

  /** POST /api/generation-queue */

  router.post('/', asyncHandler(async (req: Request, res: Response) => {

    if (!hasGenerationPageAccess(req)) {

      res.status(403).json({ success: false, error: 'Generation workspace permission is required to create queue jobs here' })

      return

    }

    const {

      service_type,

      priority,

      workflow_id,

      workflow_name,

      requested_group_id,

      requested_server_id,

      requested_server_tag,

      request_payload,

      request_summary,

      enqueue_count,

    } = req.body ?? {}

    if (service_type !== 'comfyui' && service_type !== 'novelai' && service_type !== 'codex') {

      sendRouteBadRequest(res, 'service_type must be one of comfyui, novelai, or codex')

      return

    }

    if (!request_payload || typeof request_payload !== 'object' || Array.isArray(request_payload)) {

      sendRouteBadRequest(res, 'request_payload must be an object')

      return

    }

    if (priority !== undefined && (!Number.isInteger(priority) || priority < 0 || priority > 100000)) {

      sendRouteBadRequest(res, 'priority must be an integer between 0 and 100000')

      return

    }

    if (enqueue_count !== undefined && (!Number.isInteger(enqueue_count) || enqueue_count < 1 || enqueue_count > MAX_QUEUE_ENQUEUE_COUNT)) {

      sendRouteBadRequest(res, `enqueue_count must be an integer between 1 and ${MAX_QUEUE_ENQUEUE_COUNT}`)

      return

    }

    let parsedRequestedServerTag: string | undefined

    try {

      parsedRequestedServerTag = parseRequestedServerTag(requested_server_tag)

    } catch (error) {

      sendRouteBadRequest(res, error instanceof Error ? error.message : 'requested_server_tag is invalid')

      return

    }

    let workflowIdNumber: number | null = null

    let requestedGroupIdNumber: number | null = null

    let requestedServerIdNumber: number | null = null

    let workflowLinkedServers: Array<{ id: number; routing_tags?: string[] }> = []

    let workflowHasServerLinks = false

    let workflowMarkedFields: Array<{ id: string; type?: string; default_value?: unknown; min?: unknown; max?: unknown; step?: unknown }> = []

    let workflowRecord: WorkflowRecord | null = null

    if (workflow_id !== undefined && workflow_id !== null) {

      workflowIdNumber = parsePositiveInteger(workflow_id)

      if (workflowIdNumber === null) {

        sendRouteBadRequest(res, 'workflow_id must be a positive integer')

        return

      }

      const workflow = await WorkflowModel.findById(workflowIdNumber)

      if (!workflow) {

        res.status(404).json({ success: false, error: 'Referenced workflow not found' })

        return

      }

      workflowRecord = workflow

      workflowMarkedFields = workflow.marked_fields ? JSON.parse(workflow.marked_fields) : []

      workflowHasServerLinks = WorkflowServerModel.findServersByWorkflow(workflowIdNumber, false).length > 0

      workflowLinkedServers = WorkflowServerModel.findServersByWorkflow(workflowIdNumber, true)

    }

    if (requested_group_id !== undefined && requested_group_id !== null) {

      requestedGroupIdNumber = parsePositiveInteger(requested_group_id)

      if (requestedGroupIdNumber === null) {

        sendRouteBadRequest(res, 'requested_group_id must be a positive integer')

        return

      }

    }

    if (service_type === 'comfyui') {

      if (workflowIdNumber === null) {

        sendRouteBadRequest(res, 'workflow_id is required for comfyui jobs')

        return

      }

      if (workflowHasServerLinks && workflowLinkedServers.length === 0) {

        sendRouteBadRequest(res, 'This workflow has no active linked ComfyUI servers')

        return

      }

    }

    if (requested_server_id !== undefined && requested_server_id !== null) {

      requestedServerIdNumber = parsePositiveInteger(requested_server_id)

      if (requestedServerIdNumber === null) {

        sendRouteBadRequest(res, 'requested_server_id must be a positive integer')

        return

      }

      const server = ComfyUIServerModel.findById(requestedServerIdNumber)

      if (!server || !server.is_active) {

        res.status(404).json({ success: false, error: 'Referenced ComfyUI server not found or inactive' })

        return

      }

      if (service_type !== 'comfyui') {

        sendRouteBadRequest(res, 'requested_server_id is only valid for comfyui jobs')

        return

      }

      if (workflowHasServerLinks && !workflowLinkedServers.some((linkedServer) => Number(linkedServer.id) === requestedServerIdNumber)) {

        sendRouteBadRequest(res, 'requested_server_id is not linked to this workflow')

        return

      }

    }

    if (parsedRequestedServerTag !== undefined && service_type !== 'comfyui') {

      sendRouteBadRequest(res, 'requested_server_tag is only valid for comfyui jobs')

      return

    }

    if (requested_server_id !== undefined && requested_server_id !== null && parsedRequestedServerTag !== undefined) {

      sendRouteBadRequest(res, 'requested_server_id and requested_server_tag cannot be combined')

      return

    }

    if (parsedRequestedServerTag !== undefined) {

      const tagCandidateServers = workflowHasServerLinks ? workflowLinkedServers : ComfyUIServerModel.findActiveServers()

      if (!tagCandidateServers.some((linkedServer) => hasGenerationQueueServerRoutingTag(linkedServer, parsedRequestedServerTag))) {

        sendRouteBadRequest(res, workflowHasServerLinks ? 'requested_server_tag does not match any linked workflow server' : 'requested_server_tag does not match any active ComfyUI server')

        return

      }

    }

    let normalizedRequestPayload = request_payload

    if (service_type === 'comfyui') {

      const promptData = request_payload.prompt_data

      if (!promptData || typeof promptData !== 'object' || Array.isArray(promptData)) {

        sendRouteBadRequest(res, 'request_payload.prompt_data must be an object')

        return

      }

      try {

        // PAYLOAD-3: base64 image inputs are written once to the content-addressed store and the
        // payload keeps only a reference. With `enqueue_count` up to 32, this turns "32 × 5MB in
        // the request body and in 32 rows" into "one 5MB file and 32 small rows".
        normalizedRequestPayload = {

          ...request_payload,

          prompt_data: externalizeQueueInputDataUrls(normalizeWorkflowNumericPromptValues(workflowMarkedFields, promptData)).value,

        }

      } catch (error) {

        if (error instanceof WorkflowNumericFieldValidationError) {

          sendRouteBadRequest(res, error.message)

          return

        }

        throw error

      }

    }

    const requesterAccountId = getRequesterAccountId(req)

    const normalizedRequestSummary = typeof request_summary === 'string' && request_summary.trim().length > 0 ? request_summary.trim() : null

    const jobCreateBase = {

      service_type,

      priority,

      workflow_id: workflowIdNumber,

      workflow_name: typeof workflow_name === 'string' && workflow_name.trim().length > 0 ? workflow_name.trim() : null,

      requested_group_id: requestedGroupIdNumber,

      requested_server_id: requestedServerIdNumber,

      requested_server_tag: parsedRequestedServerTag ?? null,

      requested_by_account_id: requesterAccountId,

      requested_by_account_type: req.session?.accountType,

    }

    const rawCodexCount = service_type === 'codex'

      ? (typeof request_payload.count === 'number' ? request_payload.count : Number(request_payload.count ?? request_payload.n ?? 1))

      : 1

    const codexJobCount = service_type === 'codex' && Number.isInteger(rawCodexCount)

      ? Math.max(1, Math.min(rawCodexCount, 4))

      : 1

    // PAYLOAD-3: the "개수" control used to fire one full HTTP request per copy, so a 32-way
    // img2img submission uploaded and parsed 5MB thirty-two times. One request now expands
    // server-side, and the shared inputs are stored once.
    const enqueueCount = service_type === 'codex' ? codexJobCount : (enqueue_count ?? 1)

    // 워크플로우에 등급별 회원 1인당 동시 대기열 제한이 설정돼 있으면 이 경로에서도 동일하게 막는다.
    if (workflowRecord) {

      const roleLimitViolation = checkWorkflowRoleQueueLimit({
        workflow: workflowRecord,
        accountId: requesterAccountId,
        accountType: getRequesterAccountType(req),
        requestedCount: enqueueCount,
      })

      if (roleLimitViolation) {

        res.status(429).json({
          success: false,
          error: buildWorkflowRoleQueueLimitMessage(roleLimitViolation),
          limit: roleLimitViolation.limit,
          active: roleLimitViolation.active,
        })

        return

      }

    }

    const jobIds: number[] = []

    for (let index = 0; index < enqueueCount; index += 1) {

      const expandedPayload = service_type === 'codex'

        ? {

            ...request_payload,

            count: 1,

            n: 1,

          }

        : normalizedRequestPayload

      jobIds.push(GenerationQueueModel.create({

        ...jobCreateBase,

        request_payload: expandedPayload,

        request_summary: enqueueCount > 1 && normalizedRequestSummary

          ? `${normalizedRequestSummary} (${index + 1}/${enqueueCount})`

          : normalizedRequestSummary,

      }))

    }

    const record = GenerationQueueModel.findListRecordById(jobIds[0] ?? 0)

    // E7: 사용자 enqueue. 폴링 대신 헤더 위젯이 즉시 신규 잡을 보게 하는 유일한 경로다.

    for (const jobId of jobIds) {

      publishQueueJobEvent('queue.job.created', GenerationQueueModel.findListRecordById(jobId))

    }

    GenerationQueueService.requestDispatch()

    res.status(201).json({

      success: true,

      record,

      enqueued_count: jobIds.length,

      message: enqueueCount > 1 ? `Generation queue jobs created (${enqueueCount})` : 'Generation queue job created',

    })

  }))

  /** POST /api/generation-queue/:id/retry */

  router.post('/:id/retry', asyncHandler(async (req: Request, res: Response) => {

    if (!hasGenerationPageAccess(req)) {

      res.status(403).json({ success: false, error: 'Generation workspace permission is required to retry queue jobs here' })

      return

    }

    const resolvedJob = resolveAccessibleQueueJob(req, res)

    if (!resolvedJob) {

      return

    }

    const { jobId, job } = resolvedJob

    // 재시도는 원 요청자 계정으로 새 활성 잡을 만들므로, 관리자가 아닌 요청자는 등급 제한을 넘겨 쓸 수 없게 한다.
    if (!isAdminRequest(req) && typeof job.workflow_id === 'number') {

      const retryWorkflow = await WorkflowModel.findById(job.workflow_id)

      if (retryWorkflow) {

        const roleLimitViolation = checkWorkflowRoleQueueLimit({
          workflow: retryWorkflow,
          accountId: job.requested_by_account_id ?? null,
          accountType: job.requested_by_account_type ?? null,
          requestedCount: 1,
        })

        if (roleLimitViolation) {

          res.status(429).json({
            success: false,
            error: buildWorkflowRoleQueueLimitMessage(roleLimitViolation),
            limit: roleLimitViolation.limit,
            active: roleLimitViolation.active,
          })

          return

        }

      }

    }

    try {

      const retryRecord = GenerationQueueService.retryJob(jobId)
      const responseRecord = retryRecord ? GenerationQueueModel.findListRecordById(retryRecord.id) : null

      res.status(201).json({

        success: true,

        record: responseRecord,

        message: 'Queue job retried',

      })

    } catch (error) {

      sendRouteBadRequest(res, error instanceof Error ? error.message : 'Retry failed')

    }

  }))

  /** POST /api/generation-queue/:id/cancel */

  router.post('/:id/cancel', asyncHandler(async (req: Request, res: Response) => {

    const resolvedJob = resolveAccessibleQueueJob(req, res)

    if (!resolvedJob) {

      return

    }

    const { jobId, job: existing } = resolvedJob

    if (TERMINAL_QUEUE_STATUSES.includes(existing.status)) {

      res.json({

        success: true,

        record: GenerationQueueModel.findListRecordById(existing.id),

        message: 'Queue job is already finished',

      })

      return

    }

    try {

      const updated = await GenerationQueueService.requestCancellation(jobId)
      const responseRecord = updated ? GenerationQueueModel.findListRecordById(updated.id) : null

      res.json({

        success: true,

        record: responseRecord,

        // CR-2: `queued` 만 여기서 확정된다. dispatching/running 은 워커(또는 스테일 스위퍼)가 확정한다.
        message: existing.status === 'queued' ? 'Queue job cancelled' : 'Cancellation requested',

      })

    } catch (error) {

      // 취소 요청은 CR-1 이후 멱등이라 상태 충돌(409)로 실패하지 않는다.
      const message = error instanceof Error ? error.message : 'Queue cancellation failed'

      res.status(400).json({

        success: false,

        error: message,

      })

    }

  }))

  return router
}
