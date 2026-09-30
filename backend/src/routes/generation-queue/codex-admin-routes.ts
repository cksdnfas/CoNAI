import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../../middleware/asyncHandler'
import { requireAdmin } from '../../middleware/authMiddleware'
import { getCodexCliVersionInfo, updateCodexCli } from '../../services/codexCliMaintenance'
import { cancelCodexDeviceLogin, getCodexDeviceLoginState, startCodexDeviceLogin } from '../../services/codexDeviceLogin'
import { sendRouteBadRequest } from '../routeValidation'

/**
 * Server-wide Codex CLI management. Signing in logs the whole server into one account and updating swaps the
 * binary every Codex job uses, so both are admin-only.
 */
export function createCodexAdminRoutes() {
  const router = express.Router()

  /** GET /api/generation-queue/codex/login */
  router.get('/codex/login', requireAdmin, (_req: Request, res: Response) => {
    res.json({ success: true, data: getCodexDeviceLoginState() })
  })

  /** POST /api/generation-queue/codex/login */
  router.post('/codex/login', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: await startCodexDeviceLogin() })
  }))

  /** DELETE /api/generation-queue/codex/login */
  router.delete('/codex/login', requireAdmin, (_req: Request, res: Response) => {
    res.json({ success: true, data: cancelCodexDeviceLogin() })
  })

  /** GET /api/generation-queue/codex/cli?refresh=true */
  router.get('/codex/cli', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    res.json({ success: true, data: await getCodexCliVersionInfo({ refreshLatest: req.query.refresh === 'true' }) })
  }))

  /** POST /api/generation-queue/codex/cli/update */
  router.post('/codex/cli/update', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await updateCodexCli() })
    } catch (error) {
      sendRouteBadRequest(res, error instanceof Error ? error.message : 'Codex CLI update failed')
    }
  }))

  return router
}
