import type { ChatProfileAssetsProposal, ChatExecutionContext } from '@conai/shared'
import type { McpRequester } from '../../mcp/context'
import { requireActiveChatReply } from './chatReplyRegistry'
import { ChatProposalStore } from './chatProposals'
import { ChatProfileStore } from './chatProfiles'
import { CodexChatStore } from './codexChatStore'
import { ChatAssetError, requireChatAssetAdmin } from './chatAssetAccess'
import { createChatAssetBatch, getChatAssetBatch, applyChatAssetBatch, chooseChatAssetSlot, validateChatAssetBatchProposal } from './chatAssetBatches'
import { normalizeAvatarCrop } from './chatProfileAssets'

type AssetsProposal = ChatProfileAssetsProposal & { id: number; dismissed?: boolean }

/** Stores a review card only; generation and profile/group changes require separate user approvals. */
export function proposeProfileAssets(requester: McpRequester, context: ChatExecutionContext, value: { action?: 'create' | 'apply'; profile_id?: number; input?: unknown; batch_id?: number; picks?: Record<string, string>; avatarCrop?: unknown }): AssetsProposal {
  requireChatAssetAdmin(requester)
  requireActiveChatReply(context)
  const profileId = value.profile_id ?? context.profileId
  const profile = ChatProfileStore.find(profileId)
  if (!profile) throw new ChatAssetError('프로필을 찾을 수 없어.', 404)
  if (ChatProposalStore.forReply(context.threadId, context.replyId!, 'profile_assets').length) throw new ChatAssetError('이 답변에는 자산 제안이 이미 있어.', 409)
  if (value.action === 'apply') {
    if (!value.batch_id) throw new ChatAssetError('적용할 자산 묶음을 골라줘.')
    const batch = getChatAssetBatch(requester, value.batch_id, profileId)
    // The chat may pick among a slot's own successful candidates; anything else is refused here, before the card.
    const picks = Object.fromEntries(Object.entries(value.picks ?? {}).map(([slotKey, hash]) => {
      const slot = batch.slots.find((entry) => entry.slotKey === slotKey)
      if (!slot || !slot.attempts.some((attempt) => attempt.candidates.some((candidate) => candidate.compositeHash === hash))) throw new ChatAssetError(`${slotKey}: 이 슬롯의 성공한 후보를 골라줘.`)
      return [slotKey, hash]
    }))
    const chosenHashes = { ...Object.fromEntries(batch.slots.filter((slot) => slot.chosenHash).map((slot) => [slot.slotKey, slot.chosenHash!])), ...picks }
    if (!Object.keys(chosenHashes).length) throw new ChatAssetError('적용할 후보를 먼저 골라줘.')
    return ChatProposalStore.add(context, { kind: 'profile_assets', action: 'apply', profileId, profileName: profile.name, batchId: batch.id, chosenHashes, ...(Object.keys(picks).length ? { picks } : {}), input: value.avatarCrop === undefined ? {} : { avatarCrop: normalizeAvatarCrop(value.avatarCrop) } }) as AssetsProposal
  }
  const input = validateChatAssetBatchProposal(requester, profileId, { ...(value.input as Record<string, unknown>), idempotencyKey: `proposal:${context.threadId}:${context.replyId}` })
  return ChatProposalStore.add(context, { kind: 'profile_assets', action: 'create', profileId, profileName: profile.name, input }) as AssetsProposal
}

const approvals = new Map<number, Promise<unknown>>()

/** Retry creation through its durable request key, and never apply changed selections behind an approved card. */
export async function applyProfileAssetsProposal(requester: McpRequester, proposalId: number) {
  requireChatAssetAdmin(requester)
  const previous = approvals.get(proposalId) ?? Promise.resolve()
  const task = previous.catch(() => {}).then(async () => {
    requireChatAssetAdmin(requester)
    const proposal = ChatProposalStore.find(proposalId)
    const threadId = ChatProposalStore.threadIdOf(proposalId)
    if (threadId === null || !CodexChatStore.findThread(threadId, requester.accountId)) throw new ChatAssetError('제안을 찾을 수 없어.', 404)
    if (proposal?.kind !== 'profile_assets') throw new ChatAssetError('자산 제안이 아니야.')
    if (proposal.dismissed) throw new ChatAssetError('무시한 제안이야.', 409)
    if (proposal.savedId !== undefined) throw new ChatAssetError('이미 승인한 제안이야.', 409)
    if (proposal.action === 'create') {
      const batch = await createChatAssetBatch(requester, proposal.profileId, proposal.input)
      return { proposal: ChatProposalStore.markSaved(proposalId, batch.id), batch }
    }
    for (const [slotKey, hash] of Object.entries(proposal.picks ?? {})) await chooseChatAssetSlot(requester, proposal.batchId, slotKey, hash)
    const result = applyChatAssetBatch(requester, proposal.batchId, proposal.input, proposal.chosenHashes)
    return { proposal: ChatProposalStore.markSaved(proposalId, proposal.batchId), result }
  })
  approvals.set(proposalId, task)
  try { return await task } finally { if (approvals.get(proposalId) === task) approvals.delete(proposalId) }
}
