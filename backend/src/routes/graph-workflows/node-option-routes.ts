import { Router, type Request, type Response } from 'express'
import { asyncHandler } from '../../middleware/asyncHandler'
import type { ModuleGraphResponse } from '../../types/moduleGraph'
import { NODE_OPTION_SOURCES } from '../../services/graph-workflow-executor/node-option-sources'

/** Live choices for node selects whose ui field names an `options_source`. */
export function createGraphWorkflowNodeOptionRoutes() {
  const router = Router()

  router.get('/node-options/:source', asyncHandler(async (req: Request, res: Response) => {
    const source = NODE_OPTION_SOURCES[String(req.params.source)]
    if (!source) {
      return res.status(404).json({ success: false, error: 'Unknown option source' } as ModuleGraphResponse)
    }

    const accountId = typeof req.session?.accountId === 'number' ? req.session.accountId : null
    const options = await source({ accountId })
    return res.json({ success: true, data: options } as ModuleGraphResponse)
  }))

  return router
}
