import { Router, type Request, type Response } from 'express'
import { errorResponse, successResponse } from '@conai/shared'
import { asyncHandler } from '../../middleware/asyncHandler'
import { requireImageAction } from '../../middleware/imageAccess'
import { requirePermission } from '../../middleware/authMiddleware'
import { isSpriteError } from '../../services/sprite/spriteErrors'
import { startImageBatchResizeJob } from '../../services/imageBatchResize/imageBatchResizeService'
import { getRequesterAccountId } from '../requester-session-helpers'

/**
 * POST /api/images/batch-resize — resize selected library images into new items (images.edit + images.upload).
 * body: { compositeHashes: string[], width, height, format?: 'png'|'webp', quality?, groupId?, groupPath? }
 * Answers 202 with the runtime job; progress and the result come through /api/jobs/:id.
 */
const router = Router()

router.post('/', requireImageAction('images.edit'), requirePermission('images.upload'), asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  try {
    const job = startImageBatchResizeJob({
      compositeHashes: Array.isArray(body.compositeHashes) ? body.compositeHashes.map(String) : [],
      width: Number(body.width),
      height: Number(body.height),
      format: (body.format === 'webp' ? 'webp' : 'png'),
      quality: body.quality === undefined ? 90 : Number(body.quality),
      groupId: body.groupId === undefined || body.groupId === null || body.groupId === '' ? null : Number(body.groupId),
      groupPath: typeof body.groupPath === 'string' ? body.groupPath : null,
      requestedByAccountId: getRequesterAccountId(req) ?? null,
    })
    res.status(202).json(successResponse(job))
  } catch (error) {
    if (isSpriteError(error)) {
      res.status(error.statusCode).json(errorResponse(error.message))
      return
    }
    throw error
  }
}))

export { router as batchResizeRoutes }
