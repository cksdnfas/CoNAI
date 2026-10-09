import { chatPageActionTier, type ChatPageSnapshot } from '@conai/shared'
import type { McpRequester } from '../context'
import { requireChatPageActionAccess, requireChatPageDataAccess } from '../../services/codex-chat/chatPageContext'

export const pageResult = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })
export const pageFailure = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Page tool failed' }] })

/** What the model may see of a screen: fields, permitted operations with their tier, and collection sizes only. */
export function chatPageView(requester: McpRequester, page: ChatPageSnapshot) {
  const { data, workflow, ...summary } = page
  const allowedData = Object.entries(data ?? {}).filter(([key]) => { try { requireChatPageDataAccess(requester, key); return true } catch { return false } })
  const actions = (page.actions ?? []).filter((action) => { try { requireChatPageActionAccess(requester, page, action.id); return true } catch { return false } })
    .map((action) => ({ ...action, tier: chatPageActionTier(action.id) }))
  return {
    ...summary,
    ...(page.actions ? { actions } : {}),
    ...(data ? { data: Object.fromEntries(allowedData.map(([key, value]) => [key, Array.isArray(value) ? { count: value.length, readWith: 'read_page_data' } : value])) } : {}),
    ...(workflow ? { workflow: { revision: workflow.revision, nodeCount: workflow.nodes.length, edgeCount: workflow.edges.length }, nextTool: 'get_workflow_editor' } : {}),
  }
}
