import express, { type NextFunction, type Request, type Response } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import {
  deleteExternalMcpServer,
  ExternalMcpError,
  externalMcpServerViews,
  refreshExternalMcpServer,
  saveExternalMcpServer,
  setExternalMcpEnabled,
  type ExternalMcpServerInput,
} from '../services/externalMcp/externalMcpServers'

/**
 * External MCP servers (/api/codex-chat/admin/external-mcp), administrators only. Secrets (headers, environment
 * variables) go in and never come back out: a view names them only.
 */
const router = express.Router()
router.use(requireAdmin)

const viewOf = (id: string) => externalMcpServerViews().find((server) => server.id === id) ?? null

router.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, data: externalMcpServerViews() })
})

router.post('/', (req: Request, res: Response) => {
  const server = saveExternalMcpServer(req.body as ExternalMcpServerInput)
  res.status(201).json({ success: true, data: viewOf(server.id) })
})

router.put('/:id', (req: Request, res: Response) => {
  const server = saveExternalMcpServer(req.body as ExternalMcpServerInput, String(req.params.id))
  res.json({ success: true, data: viewOf(server.id) })
})

router.patch('/:id', (req: Request, res: Response) => {
  const { enabled, tool } = req.body ?? {}
  if ((enabled !== undefined && typeof enabled !== 'boolean')
    || (tool !== undefined && (!tool || typeof tool.remoteName !== 'string' || typeof tool.enabled !== 'boolean'))
    || (enabled === undefined && tool === undefined)) {
    throw new ExternalMcpError('바꿀 값을 알 수 없어.')
  }
  setExternalMcpEnabled(String(req.params.id), { enabled, tool })
  res.json({ success: true, data: viewOf(String(req.params.id)) })
})

router.delete('/:id', (req: Request, res: Response) => {
  deleteExternalMcpServer(String(req.params.id))
  res.json({ success: true })
})

/** Connects again and reads the tool list; answers once that is done (the view says whether it worked). */
router.post('/:id/refresh', asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id)
  if (!viewOf(id)) throw new ExternalMcpError('서버를 찾을 수 없어.', 404)
  await refreshExternalMcpServer(id)
  res.json({ success: true, data: viewOf(id) })
}))

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (!(error instanceof ExternalMcpError)) return next(error)
  res.status(error.status).json({ success: false, error: error.message })
})

export default router
