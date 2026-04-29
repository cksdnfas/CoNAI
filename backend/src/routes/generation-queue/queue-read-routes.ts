import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../../middleware/errorHandler'
import { GenerationQueueModel } from '../../models/GenerationQueue'
import { ComfyUIServerModel } from '../../models/ComfyUIServer'
import { getCodexAvailabilityStatus } from '../../services/codexGenerationExecutor'
import { readComfyRequestDebugSnapshot } from '../../services/generationRequestDebugService'
import type { GenerationQueueJobRecord, GenerationQueueJobStatus } from '../../types/generationQueue'
import { sendRouteBadRequest } from '../routeValidation'
import {
  ACTIVE_QUEUE_STATUSES,
  buildQueueRequesterUsernameMap,
  filterQueueRecords,
  getRequesterAccountId,
  parsePositiveIntegerQuery,
  parseQueueDebugMeta,
  parseServiceType,
  parseStatusList,
  resolveAccessibleQueueJob,
} from './queue-route-helpers'
import { computeQueueEtas, computeQueuePositions } from './queue-eta'

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

    const visibleRecords = filterQueueRecords(GenerationQueueModel.findAll(), {

      serviceType,

      workflowId,

    })

    const visibleStatusCounts: Record<GenerationQueueJobStatus, number> = {

      queued: 0,

      dispatching: 0,

      running: 0,

      completed: 0,

      failed: 0,

      cancelled: 0,

    }

    for (const record of visibleRecords) {

      visibleStatusCounts[record.status] += 1

    }

    res.json({

      success: true,

      global: GenerationQueueModel.getStatusCounts(),

      visible: visibleStatusCounts,

      total_visible: visibleRecords.length,

      active_visible: visibleRecords.filter((record) => ACTIVE_QUEUE_STATUSES.includes(record.status)).length,

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

    let statuses: GenerationQueueJobStatus[] | undefined

    let serviceType: GenerationQueueJobRecord['service_type'] | undefined

    let workflowId: number | undefined

    try {

      statuses = parseStatusList(req.query.status)

      serviceType = parseServiceType(req.query.service_type)

      workflowId = parsePositiveIntegerQuery(req.query.workflow_id, 'workflow_id')

    } catch (error) {

      sendRouteBadRequest(res, error instanceof Error ? error.message : 'Invalid queue filter')

      return

    }

    const mineOnly = req.query.mine === 'true'

    const requesterAccountId = getRequesterAccountId(req)

    let records = filterQueueRecords(GenerationQueueModel.findAll(statuses), {

      serviceType,

      workflowId,

    })

    if (mineOnly) {

      records = requesterAccountId === null

        ? []

        : records.filter((record) => record.requested_by_account_id === requesterAccountId)

    }

    const activeRelevantRecords = filterQueueRecords(GenerationQueueModel.findAll(ACTIVE_QUEUE_STATUSES), {

      serviceType,

      workflowId,

    })

    const completedRelevantRecords = filterQueueRecords(GenerationQueueModel.findRecentCompleted(), {

      serviceType,

      workflowId,

    })

    const activeComfyServers = ComfyUIServerModel.findActiveServers()

    const activeComfyServerCount = activeComfyServers.length

    const queuePositions = computeQueuePositions(activeRelevantRecords, activeComfyServers)

    const queueEtas = computeQueueEtas(activeRelevantRecords, queuePositions, completedRelevantRecords, activeComfyServerCount)

    const requesterUsernames = buildQueueRequesterUsernameMap(records)

    res.json({

      success: true,

      records: records.map((record) => {

        const queuePosition = queuePositions.get(record.id)

        const queueEta = queueEtas.get(record.id)

        return {

          ...record,

          requested_by_username: record.requested_by_account_id != null ? (requesterUsernames.get(record.requested_by_account_id) ?? null) : null,

          queue_position: queuePosition?.position ?? null,

          queue_position_scope: queuePosition?.scope ?? null,

          queue_position_server_id: queuePosition?.serverId ?? null,

          queue_position_server_tag: queuePosition?.serverTag ?? null,

          estimated_wait_seconds: queueEta?.waitSeconds ?? null,

          estimated_total_seconds: queueEta?.totalSeconds ?? null,

          estimated_duration_seconds: queueEta?.durationSeconds ?? null,

          is_mine: requesterAccountId !== null && record.requested_by_account_id === requesterAccountId,

        }

      }),

      total: records.length,

    })

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
