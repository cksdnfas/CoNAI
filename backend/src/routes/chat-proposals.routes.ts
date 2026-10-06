import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import { ChatProposalStore } from '../services/codex-chat/chatProposals'
import { CodexChatStore } from '../services/codex-chat/codexChatStore'
import { getRequesterAccountId } from './requester-session-helpers'

const router = express.Router()

function parseId(value: unknown) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * POST /:proposalId/saved — a person saved a proposal from the card (through the admin REST with their own session);
 * this records it so the card shows as saved after a reload. Display block and profile proposals carry the id of
 * what was created; profile updates need none.
 */
router.post('/:proposalId/saved', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const proposalId = parseId(req.params.proposalId)
  const threadId = proposalId === null ? null : ChatProposalStore.threadIdOf(proposalId)
  // A proposal in someone else's chat is indistinguishable from a missing one.
  if (proposalId === null || threadId === null || !CodexChatStore.findThread(threadId, getRequesterAccountId(req))) {
    res.status(404).json({ success: false, error: '제안을 찾을 수 없어.' })
    return
  }
  const proposal = ChatProposalStore.find(proposalId)
  const rawSavedId = (req.body as { savedId?: unknown } | undefined)?.savedId
  const savedId = rawSavedId === undefined || rawSavedId === null ? null : parseId(rawSavedId)
  if (rawSavedId !== undefined && rawSavedId !== null && savedId === null) {
    res.status(400).json({ success: false, error: '저장한 항목의 id가 올바르지 않아.' })
    return
  }
  if (proposal?.kind !== 'profile_update' && savedId === null) {
    res.status(400).json({ success: false, error: '저장한 항목의 id가 필요해.' })
    return
  }
  ChatProposalStore.markSaved(proposalId, savedId)
  res.json({ success: true, data: { id: proposalId, savedId, saved: true } })
}))

export default router
