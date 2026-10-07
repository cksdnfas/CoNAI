import { AuthAccount } from '../../models/AuthAccount'
import { hasConfiguredAuth } from '../../routes/auth-route-helpers'
import { requireRequesterPermission } from '../../middleware/featureAccess'
import type { McpRequester } from '../../mcp/context'
import { ChatProfileStore } from './chatProfiles'

export class ChatAssetError extends Error {
  constructor(message: string, readonly status = 400, readonly details?: Record<string, unknown>) { super(message) }
}

/** Check live account authority, including delayed jobs; callers establish the trusted bootstrap HTTP boundary. */
export function requireChatAssetAdmin(requester: McpRequester) {
  const account = requester.accountId === null ? null : AuthAccount.findById(requester.accountId)
  if (requester.accountId === null ? hasConfiguredAuth() : account?.status !== 'active' || account.account_type !== 'admin') {
    throw new ChatAssetError('자산을 만들거나 적용할 관리자 권한이 없어.', 403)
  }
  requester.accountType = 'admin'
  requireRequesterPermission(requester, 'images.view')
}

export function requireChatAssetGeneration(requester: McpRequester, profileId: number, service: string) {
  requireChatAssetAdmin(requester)
  const profile = ChatProfileStore.find(profileId)
  if (!profile) throw new ChatAssetError('프로필을 찾을 수 없어.', 404)
  requireRequesterPermission(requester, 'generation.execute')
  requireRequesterPermission(requester, 'groups.update')
  requireRequesterPermission(requester, 'groups.create')
  if (service === 'comfyui') requireRequesterPermission(requester, 'workflows.view')
  if (service !== 'comfyui' && service !== 'novelai') throw new ChatAssetError('자산 생성은 NAI 또는 ComfyUI 프리셋을 골라줘.')
  return profile
}
