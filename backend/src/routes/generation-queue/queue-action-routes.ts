import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../../middleware/errorHandler'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { ComfyUIServerModel, WorkflowServerModel } from '../../models/ComfyUIServer'
import { WorkflowModel } from '../../models/Workflow'
import { GenerationQueueService } from '../../services/generationQueueService'
import { hasGenerationQueueServerRoutingTag } from '../../services/generationQueueRouting'
import { parsePositiveInteger, sendRouteBadRequest } from '../routeValidation'
import {
  getRequesterAccountId,
  hasGenerationPageAccess,
  parseRequestedServerTag,
  resolveAccessibleQueueJob,
  TERMINAL_QUEUE_STATUSES,
} from './queue-route-helpers'

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

    const jobIds: number[] = []

    for (let index = 0; index < codexJobCount; index += 1) {

      const expandedPayload = service_type === 'codex'

        ? {

            ...request_payload,

            count: 1,

            n: 1,

          }

        : request_payload

      jobIds.push(GenerationQueueModel.create({

        ...jobCreateBase,

        request_payload: expandedPayload,

        request_summary: codexJobCount > 1 && normalizedRequestSummary

          ? `${normalizedRequestSummary} (${index + 1}/${codexJobCount})`

          : normalizedRequestSummary,

      }))

    }

    const record = GenerationQueueModel.findListRecordById(jobIds[0] ?? 0)

    GenerationQueueService.requestDispatch()

    res.status(201).json({

      success: true,

      record,

      message: codexJobCount > 1 ? `Generation queue jobs created (${codexJobCount})` : 'Generation queue job created',

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

    const { jobId } = resolvedJob

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

        message: existing.status === 'running' ? 'Cancellation requested' : 'Queue job cancelled',

      })

    } catch (error) {

      const message = error instanceof Error ? error.message : 'Queue cancellation failed'

      const isConflict = typeof message === 'string' && message.includes('changed state before')

      res.status(isConflict ? 409 : 400).json({

        success: false,

        error: message,

      })

    }

  }))

  return router
}
