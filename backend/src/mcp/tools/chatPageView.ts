import { chatPageActionTier, type ChatPageSnapshot } from '@conai/shared'
import type { McpRequester } from '../context'
import { boundedPageView, PAGE_VIEW_BUDGET, requireChatPageActionAccess, requireChatPageDataAccess } from '../../services/codex-chat/chatPageContext'

export const pageResult = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] })
export const pageFailure = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Page tool failed' }] })

/** A collection this small goes in the view itself, so picking an item by name needs no read_page_data first. */
const INLINE_ITEMS = 20
const INLINE_CHARS = 2000
/** A workflow graph this small shows its nodes and edges, so most edits need no get_workflow_editor first. */
const INLINE_NODES = 12

function collectionView(value: unknown[]) {
  return value.length <= INLINE_ITEMS && JSON.stringify(value).length <= INLINE_CHARS ? value : { count: value.length, readWith: 'read_page_data' }
}

/** What the model may see of a screen: fields, permitted operations with their tier, small collections whole, larger ones as sizes. */
export function chatPageView(requester: McpRequester, page: ChatPageSnapshot) {
  const { data, workflow, ...summary } = page
  const allowedData = Object.entries(data ?? {}).filter(([key]) => { try { requireChatPageDataAccess(requester, key); return true } catch { return false } })
  const actions = (page.actions ?? []).filter((action) => { try { requireChatPageActionAccess(requester, page, action.id); return true } catch { return false } })
    .map((action) => ({ ...action, tier: chatPageActionTier(action.id) }))
  return {
    ...summary,
    ...(page.actions ? { actions } : {}),
    ...(data ? { data: Object.fromEntries(allowedData.map(([key, value]) => [key, Array.isArray(value) ? collectionView(value) : value])) } : {}),
    ...(workflow ? {
      workflow: {
        revision: workflow.revision, nodeCount: workflow.nodes.length, edgeCount: workflow.edges.length,
        ...(workflow.nodes.length <= INLINE_NODES ? {
          nodes: workflow.nodes.map((node) => ({ id: node.id, moduleId: node.module_id, label: node.label, ...(node.disabled ? { disabled: true } : {}) })),
          edges: workflow.edges.map((edge) => ({ id: edge.id, from: `${edge.source_node_id}.${edge.source_port_key}`, to: `${edge.target_node_id}.${edge.target_port_key}` })),
        } : {}),
      },
      nextTool: workflow.nodes.length <= INLINE_NODES ? 'get_workflow_editor only for node input values' : 'get_workflow_editor',
    } : {}),
  }
}

const clipValue = (value: unknown) => (typeof value === 'string' && value.length > 300 ? `${value.slice(0, 300)}…` : value)

/**
 * The screen a page_act / page_fill answers with. On the same screen instance only what changed comes back: the fields
 * whose state changed (long values clipped: the model just wrote them) and the operations only when they changed.
 * Another screen comes back whole, bounded like the request's view.
 */
export function pageOperationView(requester: McpRequester, before: ChatPageSnapshot, next: ChatPageSnapshot): unknown {
  const view = chatPageView(requester, next)
  if (before.instanceId !== next.instanceId || before.path !== next.path || before.kind !== next.kind || before.resourceId !== next.resourceId) return JSON.parse(boundedPageView(view))
  const previous = chatPageView(requester, before)
  const earlier = new Map(previous.fields.map((field) => [field.id, JSON.stringify(field)]))
  const changed = view.fields.filter((field) => earlier.get(field.id) !== JSON.stringify(field)).map((field) => ({ ...field, value: clipValue(field.value) }))
  const sameActions = JSON.stringify(previous.actions ?? null) === JSON.stringify(view.actions ?? null)
  const compact = {
    ...view,
    fields: changed,
    ...(changed.length < view.fields.length ? { otherFields: 'unchanged from the screen you had' } : {}),
    ...(view.actions && sameActions ? { actions: 'unchanged: the same operations as the screen you had' } : {}),
  }
  return JSON.stringify(compact).length <= PAGE_VIEW_BUDGET ? compact : JSON.parse(boundedPageView(view))
}
