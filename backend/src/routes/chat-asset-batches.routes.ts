import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import { getRequesterAccountId, getRequesterAccountType } from './requester-session-helpers'
import { ChatAssetError } from '../services/codex-chat/chatAssetAccess'
import { createChatAssetBatch, getChatAssetBatch, regenerateChatAssetSlot, cancelChatAssetSlot, chooseChatAssetSlot, applyChatAssetBatch, assertChatAssetBatchProfile } from '../services/codex-chat/chatAssetBatches'
import { reviewChatAssetVision } from '../services/codex-chat/chatAssetVision'

const router = express.Router({ mergeParams: true })
router.use(requireAdmin)

function idOf(value: unknown) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new ChatAssetError('자산 묶음 또는 프로필 id가 올바르지 않아.')
  return id
}
function handle(run: (req: Request, requester: { accountId: number | null; accountType: ReturnType<typeof getRequesterAccountType> }, profileId: number, signal: AbortSignal) => unknown | Promise<unknown>, created = false) {
  return asyncHandler(async (req: Request, res: Response) => {
    const controller = new AbortController()
    const abort = () => { if (!res.writableEnded) controller.abort() }
    req.on?.('aborted', abort)
    res.on?.('close', abort)
    try {
      const requester = { accountId: getRequesterAccountId(req), accountType: getRequesterAccountType(req) }
      const profileId = idOf(req.params.profileId)
      if (req.params.batchId !== undefined) assertChatAssetBatchProfile(requester, idOf(req.params.batchId), profileId)
      res.status(created ? 201 : 200).json({ success: true, data: await run(req, requester, profileId, controller.signal) })
    } catch (error) {
      if (error instanceof ChatAssetError) { res.status(error.status).json({ success: false, error: error.message, ...error.details }); return }
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : '자산 작업을 처리하지 못했어.' })
    } finally {
      req.off?.('aborted', abort)
      res.off?.('close', abort)
    }
  })
}

router.post('/', handle((req, requester, profileId) => createChatAssetBatch(requester, profileId, req.body), true))
router.get('/:batchId', handle((req, requester, profileId) => getChatAssetBatch(requester, idOf(req.params.batchId), profileId)))
router.post('/:batchId/slots/:slotKey/regenerate', handle((req, requester) => regenerateChatAssetSlot(requester, idOf(req.params.batchId), String(req.params.slotKey), req.body)))
router.post('/:batchId/slots/:slotKey/cancel', handle((req, requester) => cancelChatAssetSlot(requester, idOf(req.params.batchId), String(req.params.slotKey))))
router.post('/:batchId/slots/:slotKey/choose', handle((req, requester) => chooseChatAssetSlot(requester, idOf(req.params.batchId), String(req.params.slotKey), req.body?.compositeHash)))
router.post('/:batchId/slots/:slotKey/vision-review', handle((req, requester, profileId, signal) => reviewChatAssetVision(requester, profileId, idOf(req.params.batchId), String(req.params.slotKey), req.body ?? {}, signal)))
router.post('/:batchId/apply', handle((req, requester) => applyChatAssetBatch(requester, idOf(req.params.batchId), req.body ?? {})))

export default router
