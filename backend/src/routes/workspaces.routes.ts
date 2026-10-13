import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { requirePermission } from '../middleware/authMiddleware'
import { cancellableAsyncHandler, asyncHandler } from '../middleware/asyncHandler'
import { getRequesterAccountId } from './requester-session-helpers'
import { requireFileStoreOwner, requireFileStoreAction } from '../services/fileStoreAccess'
import { WorkspaceService, WorkspaceError } from '../services/workspaceService'
import { workspaceIdSchema, workspaceListSchema, workspaceReadSchema, workspaceApplySchema, workspaceSearchSchema } from '../services/workspaceSchemas'
import { CodexChatService } from '../services/codex-chat/codexChatService'

const router = Router()
router.use(requirePermission('files.view'))
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next() })
const requester = (req: Request) => ({ accountId: getRequesterAccountId(req), accountType: req.session?.accountType ?? null })
const owner = (req: Request) => requireFileStoreOwner(requester(req))
const projectId = (req: Request) => workspaceIdSchema.parse(req.params.id)
const threadId = (req: Request) => z.coerce.number().int().positive().parse(req.params.threadId)
router.get('/', (req, res) => res.json({ success: true, data: WorkspaceService.list(owner(req), z.coerce.number().int().min(0).max(1000000).parse(req.query.offset ?? 0)) }))
router.post('/', requirePermission('files.edit'), asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().trim().min(1).max(100), guidelines: z.string().max(64000).default('') }).parse(req.body)
  res.status(201).json({ success: true, data: await WorkspaceService.create(requireFileStoreAction(requester(req), 'organize'), input.name, input.guidelines) })
}))
router.get('/threads/:threadId', (req, res) => res.json({ success: true, data: WorkspaceService.binding(owner(req), threadId(req)) }))
router.put('/threads/:threadId', asyncHandler(async (req, res) => {
  const input = z.object({ projectId: workspaceIdSchema.nullable(), write: z.boolean().default(false) }).parse(req.body)
  const thread = threadId(req)
  if (CodexChatService.isRunning(thread)) throw new WorkspaceError('답변이 끝난 뒤 프로젝트 연결을 바꿔줘.', 409)
  if (input.write) requireFileStoreAction(requester(req), 'organize')
  res.json({ success: true, data: WorkspaceService.bind(owner(req), thread, input.projectId, input.write) })
}))
router.get('/:id', (req, res) => res.json({ success: true, data: WorkspaceService.get(owner(req), projectId(req)) }))
router.get('/:id/entries', asyncHandler(async (req, res) => {
  const input = workspaceListSchema.parse({ target: req.query.target ?? '', offset: Number(req.query.offset ?? 0) })
  res.json({ success: true, data: await WorkspaceService.entries(owner(req), projectId(req), input.target, input.offset) })
}))
router.post('/:id/read', cancellableAsyncHandler(async (req, res, signal) => {
  const input = workspaceReadSchema.parse(req.body)
  res.json({ success: true, data: await WorkspaceService.read(owner(req), projectId(req), input.targets, signal) })
}))
router.post('/:id/search', cancellableAsyncHandler(async (req, res, signal) => {
  const input = workspaceSearchSchema.parse(req.body)
  res.json({ success: true, data: await WorkspaceService.search(owner(req), projectId(req), input.query, input.offset, signal) })
}))
router.get('/:id/changes', (req, res) => res.json({ success: true, data: WorkspaceService.changes(owner(req), projectId(req)) }))
router.post('/:id/apply', requirePermission('files.edit'), cancellableAsyncHandler(async (req, res, signal) => {
  const input = workspaceApplySchema.parse(req.body)
  const account = requester(req)
  res.json({ success: true, data: await WorkspaceService.apply(requireFileStoreAction(account, 'organize'), projectId(req), input.requestId, input.operations, () => { requireFileStoreAction(account, 'organize') }, signal) })
}))
router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof z.ZodError) { res.status(400).json({ error: '잘못된 작업 공간 입력이야.', details: error.issues }); return }
  if (error instanceof Error && 'status' in error) { res.status(Number(error.status) || 400).json({ error: error.message }); return }
  next(error)
})
export default router
