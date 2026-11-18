import { chatPageActionTier, type ChatPageData, type ChatPageSnapshot } from '@conai/shared'
import type { McpRequestContext, McpRequester } from '../context'
import { boundedPageView, ChatPageContextError, notePageViewShown, PAGE_VIEW_BUDGET, PAGE_VIEW_UNKNOWN, pageViewTextKey, requireChatPageActionAccess, requireChatPageDataAccess, takePageViewFolded, type PageViewShown } from '../../services/codex-chat/chatPageContext'
import { contextContentLimit, hideRatingRestrictedText, RATING_RESTRICTED_TEXT, ratingRestrictedHashesUnder } from '../../services/codex-chat/chatContentRating'
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

const clipValue = <T,>(value: T): T | string => (typeof value === 'string' && value.length > 300 ? `${value.slice(0, 300)}…` : value)

/** Every changed-parts view (pageOperationView) carries it, so it is never read as a whole screen (supersededPageViewEdits). */
export const PAGE_VIEW_CHANGES_KEY = 'changesOnly'
/** The room a page operation's result leaves its screen: the result, `around` it included, stays within PAGE_VIEW_BUDGET. */
export const pageViewRoom = (around: unknown) => PAGE_VIEW_BUDGET - JSON.stringify(around).length

/**
 * The screen a page_act / page_fill answers with, bounded by `budget`. On the same screen instance only what changed
 * comes back, marked `changesOnly`: the fields whose state changed (long values clipped: the model just wrote them), the
 * operations only when they changed, and the data keys whose value changed, with the unchanged ones named; removed
 * fields, operations and data keys are listed by id. Past the budget it stays that view, its oversized changed values shortened by boundedPageView. Another
 * screen comes back whole, bounded like the request's view, and so does the same one when `whole` (the reply's memory
 * was folded, takePageViewFolded). With it what the model now holds (notePageViewShown): a whole view's own key, the new
 * screen's key after changes it got whole, PAGE_VIEW_UNKNOWN after shortened ones; changes also name the screen they were
 * computed from (`base`: the key of its full view), which the model must hold for them to make up the new one (pageViewAfter).
 */
export function pageOperationView(requester: McpRequester, before: ChatPageSnapshot, next: ChatPageSnapshot, limit: ContentRatingLimit, whole = false, budget = PAGE_VIEW_BUDGET): PageViewShown & { page: unknown } {
  const view = chatPageView(requester, next, limit)
  if (whole || before.instanceId !== next.instanceId || before.path !== next.path || before.kind !== next.kind || before.resourceId !== next.resourceId) {
    const text = boundedPageView(view, budget)
    return { page: JSON.parse(text), key: pageViewTextKey(text) }
  }
  const previous = chatPageView(requester, before, limit)
  const earlier = new Map(previous.fields.map((field) => [field.id, JSON.stringify(field)]))
  const changedFields = view.fields.filter((field) => earlier.get(field.id) !== JSON.stringify(field))
  const changed = changedFields.map((field) => ({ ...field, value: clipValue(field.value) }))
  const present = new Set(view.fields.map((field) => field.id))
  const removedFields = previous.fields.map((field) => field.id).filter((id) => !present.has(id))
  const sameActions = JSON.stringify(previous.actions ?? null) === JSON.stringify(view.actions ?? null)
  const offered = new Set((view.actions ?? []).map((action) => action.id))
  const removedActions = (previous.actions ?? []).map((action) => action.id).filter((id) => !offered.has(id))
  // Do not resend the same option lists, document excerpt or result on each step; changed/deleted keys remain explicit.
  const unchangedData = Object.keys(view.data ?? {}).filter(key =>
    Object.prototype.hasOwnProperty.call(previous.data ?? {}, key)
    && JSON.stringify(before.data?.[key]) === JSON.stringify(next.data?.[key]))
  const removedData = Object.keys(previous.data ?? {}).filter(key => !Object.prototype.hasOwnProperty.call(view.data ?? {}, key))
  const compact = {
    [PAGE_VIEW_CHANGES_KEY]: true,
    ...view,
    fields: changed,
    ...(changed.length < view.fields.length ? { otherFields: 'unchanged from the screen you had' } : {}),
    ...(removedFields.length ? { removedFields } : {}),
    ...(view.actions && sameActions ? { actions: 'unchanged: the same operations as the screen you had' } : {}),
    ...(removedActions.length ? { removedActions } : {}),
    ...(unchangedData.length ? { data: Object.fromEntries(Object.entries(view.data ?? {}).filter(([key]) => !unchangedData.includes(key))), unchangedData } : {}),
    ...(removedData.length ? { removedData } : {}),
  }
  const text = boundedPageView(compact, budget)
  const shortened = text !== JSON.stringify(compact) || changed.some((field, index) => field.value !== changedFields[index].value)
  return { page: JSON.parse(text), key: shortened ? PAGE_VIEW_UNKNOWN : pageViewTextKey(boundedPageView(view)), base: pageViewTextKey(JSON.stringify(previous)) }
}

/** Where a superseded view names what it left out (pageViewResidual). */
export const PAGE_VIEW_RESIDUAL_KEY = 'sameInNextView'
const PAGE_VIEW_RESIDUAL_NOTE = 'Left out here: identical in the next full view of this screen, later in this conversation.'
/** A screen view as the model was given it (JSON): fields by id, operations, data by key, workflow, and the rest. */
export type PageViewJson = { fields: Array<{ id?: unknown }>; actions?: unknown; data?: Record<string, unknown>; workflow?: unknown; [key: string]: unknown }

/**
 * An earlier full view of a screen once a later full view of the same screen follows it: pageOperationView's comparisons
 * in reverse. The fields (by id), operations, data keys and workflow the later view repeats byte for byte are left out
 * and named under `sameInNextView`; everything that differs stays as it is, a value the later view shortened included.
 * A view that names nothing it repeats, or already carries the marker, comes back as it is.
 */
export function pageViewResidual(older: PageViewJson, newer: PageViewJson): PageViewJson {
  if (PAGE_VIEW_RESIDUAL_KEY in older) return older
  const same = (value: unknown, later: unknown) => later !== undefined && JSON.stringify(value) === JSON.stringify(later)
  const laterFields = new Map(newer.fields.map((field) => [field.id, field]))
  const sameFields = older.fields.filter((field) => field.id !== undefined && same(field, laterFields.get(field.id)))
  const sameActions = older.actions !== undefined && same(older.actions, newer.actions)
  const sameWorkflow = older.workflow !== undefined && same(older.workflow, newer.workflow)
  const data = Object.entries(older.data ?? {})
  const sameData = data.filter(([key, value]) => newer.data !== undefined && Object.prototype.hasOwnProperty.call(newer.data, key) && same(value, newer.data[key])).map(([key]) => key)
  if (!sameFields.length && !sameActions && !sameWorkflow && !sameData.length) return older
  const kept = data.filter(([key]) => !sameData.includes(key))
  const residual = Object.fromEntries(Object.entries(older).flatMap(([key, value]): Array<[string, unknown]> => {
    if (key === 'fields') return [[key, older.fields.filter((field) => !sameFields.includes(field))]]
    if ((key === 'actions' && sameActions) || (key === 'workflow' && sameWorkflow) || (key === 'data' && sameData.length && !kept.length)) return []
    return [[key, key === 'data' ? Object.fromEntries(kept) : value]]
  }))
  return {
    ...residual,
    fields: residual.fields as PageViewJson['fields'],
    [PAGE_VIEW_RESIDUAL_KEY]: {
      note: PAGE_VIEW_RESIDUAL_NOTE,
      ...(sameFields.length ? { fields: sameFields.map((field) => field.id) } : {}),
      ...(sameActions ? { actions: true } : {}),
      ...(sameData.length ? { data: sameData } : {}),
      ...(sameWorkflow ? { workflow: true } : {}),
    },
  }
}

/**
 * A page_act / page_fill the tab refused (a stale screen) or that failed on its screen stays an error. When the tab
 * reported a screen other than the one the server acted from, its changed parts (pageOperationView, current revision
 * included) follow the message, so the model can decide and retry without reading the page again. `shown` is the
 * success path's own check of a returned screen; a screen that fails it, or an unchanged one, leaves the message alone.
 */
export function pageOperationFailure(context: McpRequestContext, before: ChatPageSnapshot | undefined, error: unknown, shown: (page: ChatPageSnapshot) => ChatPageSnapshot) {
  const reported = error instanceof ChatPageContextError ? error.page : undefined
  if (!before || !reported) return pageFailure(error)
  try {
    const next = shown(reported)
    if (JSON.stringify(next) === JSON.stringify(before)) return pageFailure(error)
    const requester = context.requester!
    const limit = contextContentLimit(context)
    const message = (error as Error).message
    // The two parts reach the model joined by a line break.
    const view = pageOperationView(requester, before, next, limit, takePageViewFolded(context.chatContext!.threadId), pageViewRoom({ page: null }) - message.length - 1)
    const viewKey = notePageViewShown(context, next, limit, view)
    return { isError: true, content: [{ type: 'text' as const, text: message }, { type: 'text' as const, text: JSON.stringify({ page: view.page }) }], ...(viewKey ? { structuredContent: viewKey } : {}) }
  } catch { return pageFailure(error) }
}
