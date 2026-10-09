import { requirePermission } from '../../middleware/authMiddleware';
import { Router, type Request, type Response } from 'express'
import { asyncHandler } from '../../middleware/asyncHandler'
import { sendRouteBadRequest } from '../routeValidation'
import type { ModuleGraphResponse } from '../../types/moduleGraph'
import { WorkflowInputImageError, ingestWorkflowInputImage } from '../../services/workflowInputImages'

/** Images for node values and run inputs: put into the library ("워크플로 입력"), answered with `{ composite_hash }`. */
export function createGraphWorkflowInputImageRoutes() {
  const router = Router()

  router.post('/input-images', requirePermission('generation.execute'), asyncHandler(async (req: Request, res: Response) => {
    const dataUrl = typeof req.body?.data_url === 'string' ? req.body.data_url : ''
    if (!dataUrl) {
      return sendRouteBadRequest(res, 'data_url is required')
    }

    try {
      const ref = await ingestWorkflowInputImage(dataUrl)
      return res.status(201).json({ success: true, data: ref } as ModuleGraphResponse)
    } catch (error) {
      if (error instanceof WorkflowInputImageError) {
        return res.status(error.status).json({ success: false, error: error.message } as ModuleGraphResponse)
      }
      console.error('Error saving workflow input image:', error)
      return res.status(500).json({ success: false, error: 'Failed to save the image' } as ModuleGraphResponse)
    }
  }))

  return router
}
