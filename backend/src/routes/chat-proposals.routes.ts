import express, { type Request, type Response } from 'express'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireAdmin } from '../middleware/authMiddleware'
import { ChatProposalStore } from '../services/codex-chat/chatProposals'
import { applyLoreProposal, LoreProposalError } from '../services/codex-chat/chatLoreProposals'
import { LorebookError } from '../services/codex-chat/chatLorebookFiles'
import { FileStoreError } from '../services/fileStoreService'
import { CodexChatStore } from '../services/codex-chat/codexChatStore'
import { getRequesterAccountId, getRequesterAccountType } from './requester-session-helpers'
import { ChatPageContextError, requireChatPageAccess, requireChatPageActionAccess, requireChatPageProposalBinding } from '../services/codex-chat/chatPageContext'
import { requireChatMcpAccountAccess } from '../services/codex-chat/codexChatAccess'
import { ChatProfileStore } from '../services/codex-chat/chatProfiles'
import type { ChatProposal } from '@conai/shared'
import { requireChatWorkflowModules } from '../services/codex-chat/chatWorkflowContext'
import { chatPageNativeActionRevision } from '../services/codex-chat/chatPageNativeActions'
import { applyProfileAssetsProposal } from '../services/codex-chat/chatAssetProposals'
import { ChatAssetError } from '../services/codex-chat/chatAssetAccess'
import { hasAdminAccess } from '../middleware/authMiddleware'

const router = express.Router()

/** This only authorizes an owned review card. The browser validates its live field state and applies locally. */
function pageProposal(req: Request, res: Response, receipt = false): Extract<ChatProposal, { kind: 'page_fields' | 'workflow_graph' | 'page_action' }> | null {
  const id = visibleProposalId(req, res)
  if (id === null) return null
  try {
    const proposal = ChatProposalStore.find(id)
    if (proposal?.kind !== 'page_fields' && proposal?.kind !== 'workflow_graph' && proposal?.kind !== 'page_action') throw new ChatPageContextError('페이지 편집 제안이 아니야.')
    const tool = proposal.kind === 'workflow_graph' ? 'propose_workflow_changes' : proposal.kind === 'page_action' ? 'propose_page_action' : 'propose_page_changes'
    const thread = CodexChatStore.findThread(ChatProposalStore.threadIdOf(id)!, getRequesterAccountId(req))!
    const profile = thread.profile_id === null ? null : ChatProfileStore.find(thread.profile_id)
    if (!profile?.isEnabled || !profile.mcpEnabled || !profile.mcpScopes.includes('read') || (profile.toolAllowlist && !profile.toolAllowlist.includes(tool))) throw new ChatPageContextError('프로필의 페이지 편집 도구 권한이 변경됐어.', 403)
    const requester = { accountId: getRequesterAccountId(req), accountType: getRequesterAccountType(req) }
    requireChatMcpAccountAccess({ requester, scopes: ['read'], source: thread.engine === 'codex' ? 'codex-chat' : 'llm-chat', chatContext: { threadId: thread.id, profileId: profile.id, kind: 'direct' } }, tool)
    requireChatPageAccess(requester, proposal.page)
    if (proposal.kind === 'page_action') requireChatPageActionAccess(requester, proposal.page, proposal.action.id, proposal.arguments)
    const undo = req.body?.undo === true
    if (proposal.dismissed || (!receipt && !undo && proposal.saved)) throw new ChatPageContextError('이미 적용하거나 무시한 제안이야.', 409)
    requireChatPageProposalBinding(proposal, req.body, undo)
    if (!receipt && proposal.kind === 'page_action' && proposal.nativeRevision !== chatPageNativeActionRevision(proposal.page, proposal.action.id, proposal.arguments)) throw new ChatPageContextError('저장된 항목이 다른 작업에서 바뀌었어. 새로 읽고 다시 요청해줘.', 409)
    if (proposal.kind === 'workflow_graph') {
      try { requireChatWorkflowModules(proposal.modules) }
      catch (error) { throw new ChatPageContextError(error instanceof Error ? error.message : '모듈 정의를 확인하지 못했어.', 409) }
    }
    return proposal
  } catch (error) {
    res.status(error instanceof ChatPageContextError ? error.status : 403).json({ success: false, error: error instanceof Error ? error.message : '페이지 입력 권한을 확인하지 못했어.' })
    return null
  }
}

router.post('/:proposalId/page-check', (req: Request, res: Response) => {
  const proposal = pageProposal(req, res)
  if (proposal) res.json({ success: true, data: proposal })
})

/** A receipt after the browser applied the registered form setters; never changes application data. */
router.post('/:proposalId/page-applied', (req: Request, res: Response) => {
  const proposal = pageProposal(req, res, true)
  if (proposal) res.json({ success: true, data: ChatProposalStore.markSaved(proposal.id, null) })
})

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
  if (proposal?.kind === 'profile_assets') {
    res.status(400).json({ success: false, error: '자산 제안은 승인 경로에서 적용해줘.' })
    return
  }
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
    if (ChatProposalStore.find(proposalId)?.kind === 'profile_assets') {
      if (!hasAdminAccess(req)) { res.status(403).json({ success: false, error: '자산을 승인할 관리자 권한이 없어.' }); return }
      try {
        res.json({ success: true, data: await applyProfileAssetsProposal({ accountId: getRequesterAccountId(req), accountType: getRequesterAccountType(req) }, proposalId) })
      } catch (error) {
        if (error instanceof ChatAssetError) { res.status(error.status).json({ success: false, error: error.message, ...error.details }); return }
        throw error
      }
      return
    }
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
