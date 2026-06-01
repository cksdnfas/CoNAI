import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../../middleware/errorHandler'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { getCodexAvailabilityStatus } from '../../services/codexGenerationExecutor'
import { readComfyRequestDebugSnapshot } from '../../services/generationRequestDebugService'
import type { GenerationQueueJobRecord } from '../../types/generationQueue'
import { sendRouteBadRequest } from '../routeValidation'
import {
  ACTIVE_QUEUE_STATUSES,
  parsePositiveIntegerQuery,
  parseQueueDebugMeta,
  parseServiceType,
  resolveAccessibleQueueJob,
} from './queue-route-helpers'
import { buildGenerationQueueListResponse } from './queue-list-service'

export function createGenerationQueueReadRoutes() {
  const router = express.Router()

  /** GET /api/generation-queue/stats */

  router.get('/stats', asyncHandler(async (req: Request, res: Response) => {

    let serviceType: GenerationQueueJobRecord['service_type'] | undefined

    let workflowId: number | undefined

    try {

      serviceType = parseServiceType(req.query.service_type)

      workflowId = parsePositiveIntegerQuery(req.query.workflow_id, 'workflow_id')

    } catch (error) {

      sendRouteBadRequest(res, error instanceof Error ? error.message : 'Invalid queue stats filter')

      return

    }

    const visibleStatusCounts = GenerationQueueModel.getStatusCounts({
      serviceType,
      workflowId,
    })
    const totalVisible = Object.values(visibleStatusCounts).reduce((sum, count) => sum + count, 0)
    const activeVisible = ACTIVE_QUEUE_STATUSES.reduce((sum, status) => sum + visibleStatusCounts[status], 0)

    res.json({
      success: true,
      global: GenerationQueueModel.getStatusCounts(),
      visible: visibleStatusCounts,
      total_visible: totalVisible,
      active_visible: activeVisible,
    })

  }))

  /** GET /api/generation-queue/codex/status */

  router.get('/codex/status', asyncHandler(async (_req: Request, res: Response) => {

    const status = await getCodexAvailabilityStatus()

    res.json({

      success: true,

      data: status,

    })

  }))

  /** GET /api/generation-queue */

  router.get('/', asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(buildGenerationQueueListResponse(req))
    } catch (error) {
      sendRouteBadRequest(res, error instanceof Error ? error.message : 'Invalid queue filter')
    }
  }))

  /** GET /api/generation-queue/:id/request-debug */

  router.get('/:id/request-debug', asyncHandler(async (req: Request, res: Response) => {

    const resolvedJob = resolveAccessibleQueueJob(req, res)

    if (!resolvedJob) {

      return

    }

    const { job } = resolvedJob

    if (job.service_type !== 'comfyui') {

      sendRouteBadRequest(res, 'Request debug is currently supported for comfyui jobs only')

      return

    }

    try {

      const snapshot = await readComfyRequestDebugSnapshot(job.id)

      const debugMeta = parseQueueDebugMeta(job)

      res.json({

        success: true,

        data: {

          ...snapshot,

          cancellation_requested_at: typeof debugMeta?.cancellation_requested_at === 'string' ? debugMeta.cancellation_requested_at : null,

          cancellation_endpoint: typeof debugMeta?.cancellation_endpoint === 'string' ? debugMeta.cancellation_endpoint : null,

          cancellation_prompt_id: typeof debugMeta?.cancellation_prompt_id === 'string' ? debugMeta.cancellation_prompt_id : null,

          cancellation_state: typeof debugMeta?.cancellation_state === 'string' ? debugMeta.cancellation_state : null,

          cancellation_error: typeof debugMeta?.cancellation_error === 'string' ? debugMeta.cancellation_error : null,

          cancellation_result: debugMeta?.cancellation_result && typeof debugMeta.cancellation_result === 'object' && !Array.isArray(debugMeta.cancellation_result)

            ? debugMeta.cancellation_result

            : null,

        },

      })

    } catch (error) {

      res.status(404).json({

        success: false,

        error: error instanceof Error ? error.message : 'Request debug snapshot not found',

      })

    }

  }))

  return router
}
