import { chatPageActionTier, type ChatPageData, type ChatPageSnapshot } from '@conai/shared'
import type { McpRequester } from '../context'
import { boundedPageView, PAGE_VIEW_BUDGET, requireChatPageActionAccess, requireChatPageDataAccess } from '../../services/codex-chat/chatPageContext'
import { hideRatingRestrictedText, RATING_RESTRICTED_TEXT, ratingRestrictedHashesUnder } from '../../services/codex-chat/chatContentRating'
import type { ContentRatingLimit } from '../../services/contentRating'
import { textResult } from '../toolResults'

/**
 * The descriptive text a screen shows of the library media it is about (its resourceId): field ids, and data keys
 * hidden whole or by their listed members. Other screens list media by hash only.
 */
const PAGE_MEDIA_TEXT: Partial<Record<ChatPageSnapshot['kind'], { fields: string[]; data: Record<string, string[] | 'all'> }>> = {
  image_detail: { fields: ['prompt', 'negativePrompt'], data: { autoTags: 'all' } },
  metadata: { fields: ['prompt', 'negativePrompt'], data: { selected: ['prompt', 'negativePrompt'] } },
}

/**
 * The screen as a model under `limit` may read it: the media it is about above the ceiling (or unrated) keeps its
 * fields and ids but its prompts and tags become the marker, with `rating_restricted: true` in the data. A copy: the
 * live snapshot (revisions, field changes, review cards) is untouched. One stored-score lookup; no ceiling: as is.
 */
export function ratingFilteredPage(page: ChatPageSnapshot, limit: ContentRatingLimit): ChatPageSnapshot {
  const text = PAGE_MEDIA_TEXT[page.kind]
  if (!text || !page.resourceId || ratingRestrictedHashesUnder(limit, [page.resourceId]).size === 0) return page
  const data: Record<string, ChatPageData> = { ...page.data, rating_restricted: true }
  for (const [key, members] of Object.entries(text.data)) {
    const value = data[key]
    if (value === undefined || value === null) continue
    data[key] = members === 'all' || typeof value !== 'object' || Array.isArray(value) ? RATING_RESTRICTED_TEXT : hideRatingRestrictedText(value, members)
  }
  return {
    ...page,
    fields: page.fields.map((field) => text.fields.includes(field.id) && field.value !== '' ? { ...field, value: RATING_RESTRICTED_TEXT } : field),
    data,
  }
}

export const pageResult = (data: unknown) => textResult(data)
export const pageFailure = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Page tool failed' }] })

/** A collection this small goes in the view itself, so picking an item by name needs no read_page_data first. */
const INLINE_ITEMS = 20
const INLINE_CHARS = 2000
/** A workflow graph this small shows its nodes and edges, so most edits need no get_workflow_editor first. */
const INLINE_NODES = 12

function collectionView(value: unknown[]) {
  return value.length <= INLINE_ITEMS && JSON.stringify(value).length <= INLINE_CHARS ? value : { count: value.length, readWith: 'read_page_data' }
}

/**
 * What the model may see of a screen: fields, permitted operations with their tier, small collections whole, larger
 * ones as sizes; the text of media above its content rating `limit` hidden (ratingFilteredPage).
 */
export function chatPageView(requester: McpRequester, live: ChatPageSnapshot, limit: ContentRatingLimit) {
  const page = ratingFilteredPage(live, limit)
  const { data, workflow, ...summary } = page
  const allowedData = Object.entries(data ?? {}).filter(([key]) => { try { requireChatPageDataAccess(requester, key); return true } catch { return false } })
  const actions = (page.actions ?? []).filter((action) => { try { requireChatPageActionAccess(requester, page, action.id); return true } catch { return false } })
    .map((action) => ({ ...action, tier: chatPageActionTier(action.id, action) }))
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
export function pageOperationView(requester: McpRequester, before: ChatPageSnapshot, next: ChatPageSnapshot, limit: ContentRatingLimit): unknown {
  const view = chatPageView(requester, next, limit)
  if (before.instanceId !== next.instanceId || before.path !== next.path || before.kind !== next.kind || before.resourceId !== next.resourceId) return JSON.parse(boundedPageView(view))
  const previous = chatPageView(requester, before, limit)
  const earlier = new Map(previous.fields.map((field) => [field.id, JSON.stringify(field)]))
  const changed = view.fields.filter((field) => earlier.get(field.id) !== JSON.stringify(field)).map((field) => ({ ...field, value: clipValue(field.value) }))
  const sameActions = JSON.stringify(previous.actions ?? null) === JSON.stringify(view.actions ?? null)
  // Extension actions often only request a review card. Do not resend the same
  // document excerpt on each step; changed/deleted keys remain explicit.
  const unchangedData = next.kind === 'extension' ? Object.keys(view.data ?? {}).filter(key =>
    Object.prototype.hasOwnProperty.call(previous.data ?? {}, key)
    && JSON.stringify(before.data?.[key]) === JSON.stringify(next.data?.[key])) : []
  const removedData = next.kind === 'extension' ? Object.keys(previous.data ?? {}).filter(key => !Object.prototype.hasOwnProperty.call(view.data ?? {}, key)) : []
  const compact = {
    ...view,
    fields: changed,
    ...(changed.length < view.fields.length ? { otherFields: 'unchanged from the screen you had' } : {}),
    ...(view.actions && sameActions ? { actions: 'unchanged: the same operations as the screen you had' } : {}),
    ...(unchangedData.length ? { data: Object.fromEntries(Object.entries(view.data ?? {}).filter(([key]) => !unchangedData.includes(key))), unchangedData } : {}),
    ...(removedData.length ? { removedData } : {}),
  }
  return JSON.stringify(compact).length <= PAGE_VIEW_BUDGET ? compact : JSON.parse(boundedPageView(view))
}
