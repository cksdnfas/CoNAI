import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import { ChatProposalStore } from '../services/codex-chat/chatProposals'
import { applyLoreProposal, LoreProposalError } from '../services/codex-chat/chatLoreProposals'
import { LorebookError } from '../services/codex-chat/chatLorebookFiles'
import { FileStoreError } from '../services/fileStoreService'
import { CodexChatStore } from '../services/codex-chat/codexChatStore'
import { getRequesterAccountId } from './requester-session-helpers'

const router = express.Router()

function parseId(value: unknown) {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** The proposal id when it belongs to a chat the requester can see; otherwise 404 (someone else's looks missing). */
function visibleProposalId(req: Request, res: Response) {
  const proposalId = parseId(req.params.proposalId)
  const threadId = proposalId === null ? null : ChatProposalStore.threadIdOf(proposalId)
  if (proposalId === null || threadId === null || !CodexChatStore.findThread(threadId, getRequesterAccountId(req))) {
    res.status(404).json({ success: false, error: '제안을 찾을 수 없어.' })
    return null
  }
  return proposalId
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

/**
 * POST /:proposalId/apply — save a lore proposal (save_lore) into the chat's own lorebook: the server writes the entry
 * (and its file) and marks the proposal saved with the book's id. Other kinds are saved through the admin REST.
 */
router.post('/:proposalId/apply', asyncHandler(async (req: Request, res: Response) => {
  const proposalId = visibleProposalId(req, res)
  if (proposalId === null) return
  if (ChatProposalStore.find(proposalId)?.kind !== 'lore') {
    res.status(400).json({ success: false, error: '이 제안은 카드에서 저장해줘.' })
    return
  }
  try {
    const { proposal, book } = applyLoreProposal(proposalId)
    res.json({ success: true, data: { proposal, book } })
  } catch (error) {
    if (error instanceof LoreProposalError || error instanceof LorebookError || error instanceof FileStoreError) {
      res.status(error.status).json({ success: false, error: error.message })
      return
    }
    throw error
  }
}))

/** POST /:proposalId/dismiss — a person set the proposal aside (무시); a dismissed lore title is not proposed again. */
router.post('/:proposalId/dismiss', asyncHandler(async (req: Request, res: Response) => {
  const proposalId = visibleProposalId(req, res)
  if (proposalId === null) return
  const proposal = ChatProposalStore.markDismissed(proposalId)
  if (!proposal) {
    res.status(409).json({ success: false, error: '이미 저장한 제안이야.' })
    return
  }
  res.json({ success: true, data: proposal })
}))

export default router
