import { CHAT_DELEGATABLE_PERMISSION_KEYS, type ChatExecutionContext } from '@conai/shared'
import { withRequesterPermissionGrant } from '../../middleware/featureAccess'
import { isChatMcpSource, isPublicChatPage, type McpRequester, type McpRequestContext } from '../../mcp/context'
import { canUseChatProfile, resolveChatAccess } from './codexChatAccess'
import { CodexChatStore } from './codexChatStore'
import { ChatGroupStore } from './chatGroupStore'
import { ChatProfileStore } from './chatProfiles'
import { loadChatSettings } from './chatSettings'

type ChatPermissionBinding = Pick<ChatExecutionContext, 'threadId' | 'profileId' | 'kind' | 'page'>

/** Only call with a server-established chat binding, never with an unverified browser profile id. */
export function chatProfileRequester(requester: McpRequester, chat: ChatPermissionBinding): McpRequester {
  const accountId = requester.accountId
  const { threadId, profileId, kind } = chat
  const publicPage = chat.page?.path.startsWith('/public/') === true
  return withRequesterPermissionGrant(requester, () => {
    if (publicPage || accountId === null || !loadChatSettings().enabled) return []
    const profile = ChatProfileStore.findToolGrant(profileId)
    if (!profile?.mcpEnabled || !profile.delegatedPermissions.length
      || !canUseChatProfile(resolveChatAccess(accountId), profile)) return []
    const thread = CodexChatStore.findThread(threadId, accountId)
    if (!thread || thread.kind !== kind
      || (kind === 'group' ? !ChatGroupStore.member(threadId, profileId) : thread.profile_id !== profileId)) return []
    return profile.delegatedPermissions.filter((key) => (CHAT_DELEGATABLE_PERMISSION_KEYS as readonly string[]).includes(key))
  })
}

/** External MCP keys and plugin callers never inherit a chat profile's permissions. */
export function chatMcpRequester(context: McpRequestContext): McpRequester | undefined {
  const requester = context.requester
  if (!requester) return undefined
  const plain = { accountId: requester.accountId, accountType: requester.accountType }
  return isChatMcpSource(context.source) && context.chatContext && !isPublicChatPage(context)
    ? chatProfileRequester(plain, context.chatContext)
    : plain
}
