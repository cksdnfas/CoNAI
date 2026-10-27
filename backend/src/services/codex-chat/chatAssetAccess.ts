import { isRequesterAdmin, requireRequesterPermission } from '../../middleware/featureAccess'
import type { McpRequester } from '../../mcp/context'
import type { ChatAssetOwner } from '@conai/shared'
import { chatAssetOwner, chatAssetOwnerProfile } from './chatAssetOwner'
import { ChatProfileStore } from './chatProfiles'

export class ChatAssetError extends Error {
  constructor(message: string, readonly status = 400, readonly details?: Record<string, unknown>) { super(message) }
}
export function requireLocalProfileAssets(owner: ChatAssetOwner | number, backgroundOnly = false) {
  const target = chatAssetOwner(owner)
  if (!backgroundOnly && target.kind === 'profile' && ChatProfileStore.find(target.id)?.characterLink?.synced) throw new ChatAssetError('라이브러리와 동기화된 프로필이야. 배경 외의 자산은 연결된 외형 설정에서 만들거나 연결을 분리해줘.', 409)
}

/** Check live account authority, including delayed jobs; callers establish the trusted bootstrap HTTP boundary. */
export function requireChatAssetAdmin(requester: McpRequester) {
  if (!isRequesterAdmin(requester)) {
    throw new ChatAssetError('자산을 만들거나 적용할 관리자 권한이 없어.', 403)
  }
  requester.accountType = 'admin'
  requireRequesterPermission(requester, 'images.view')
}

export function requireChatAssetGeneration(requester: McpRequester, owner: ChatAssetOwner | number, service: string) {
  requireChatAssetAdmin(requester)
  if (chatAssetOwner(owner).kind === 'setting') requireRequesterPermission(requester, 'characters.edit')
  const profile = chatAssetOwnerProfile(owner)
  if (!profile) throw new ChatAssetError('프로필을 찾을 수 없어.', 404)
  requireRequesterPermission(requester, 'generation.execute')
  requireRequesterPermission(requester, 'images.edit')
  if (service === 'comfyui') requireRequesterPermission(requester, 'workflows.view')
  if (service !== 'comfyui' && service !== 'novelai') throw new ChatAssetError('자산 생성은 NAI 또는 ComfyUI 프리셋을 골라줘.')
  return profile
}
