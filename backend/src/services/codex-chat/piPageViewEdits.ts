import { PAGE_VIEW_CHANGES_KEY, PAGE_VIEW_RESIDUAL_KEY, pageViewResidual, type PageViewJson } from '../../mcp/tools/chatPageView'
import { PAGE_VIEW_TOOLS, pageViewLine } from './chatPageContext'

/**
 * What a pi chat's session no longer needs to carry of its screens: each full view (one without pageOperationView's
 * `changesOnly` or "unchanged" markers) that a later full view of the same screen follows keeps only what that later
 * view does not repeat (pageViewResidual). A view is read where CoNAI put it: the screen line of a user message (chatPageReference),
 * or the result of get_current_page, page_act and page_fill, at its top level or under `page`; a request's view is the
 * newest. Everything else is never touched: changed-parts results, failed calls, other tools' results (run_tool and
 * codemode included), assistant messages, a cut result that no longer parses, the latest full view of each screen, and
 * a view that already carries the marker. Same screen: the instance, path, kind and resource pageOperationView compares.
 */

/** A pi session's projected entries (SessionManager.buildSessionProjection): what the model is sent, earlier edits applied. */
export type ProjectedSessionEntries = ReadonlyArray<{ sourceEntry: { id: string; type: string }; messages: readonly unknown[] }>
/** One persisted context edit (SessionManager.appendContextEdit): the entry and its new content. */
export type PageViewEdit = { targetId: string; content: string | unknown[] }

type Part = { type?: unknown; text?: unknown }
type Located = { view: PageViewJson; content: (view: PageViewJson) => string | unknown[] }

const isPageView = (value: unknown): value is PageViewJson => {
  const view = value as Partial<PageViewJson> | null
  return typeof view === 'object' && view !== null && !Array.isArray(view) && typeof view.instanceId === 'string' && typeof view.path === 'string' && typeof view.kind === 'string' && Array.isArray(view.fields)
}
// The "unchanged" markers also catch changed parts recorded before `changesOnly`.
const isFullView = (view: PageViewJson) => !(PAGE_VIEW_CHANGES_KEY in view) && !('otherFields' in view) && !('unchangedData' in view) && !('removedData' in view) && typeof view.actions !== 'string'
const sameScreen = (a: PageViewJson, b: PageViewJson) => a.instanceId === b.instanceId && a.path === b.path && a.kind === b.kind && a.resourceId === b.resourceId
const parse = (text: string): unknown => { try { return JSON.parse(text) } catch { return undefined } }

/** The screen line of a request's text, and the text with another view in its place. */
function viewInText(text: string) {
  const line = pageViewLine(text)
  const view = line ? parse(text.slice(line.start, line.end)) : undefined
  return line && isPageView(view) ? { view, text: (next: PageViewJson) => `${text.slice(0, line.start)}${JSON.stringify(next)}${text.slice(line.end)}` } : null
}

/** A page tool's result text: the view itself (get_current_page) or its `page` (page_act, page_fill). */
function viewInResult(text: string) {
  const value = parse(text)
  if (isPageView(value)) return { view: value, text: (next: PageViewJson) => JSON.stringify(next) }
  const page = typeof value === 'object' && value !== null ? (value as { page?: unknown }).page : undefined
  return isPageView(page) ? { view: page, text: (next: PageViewJson) => JSON.stringify({ ...(value as object), page: next }) } : null
}

/** The first text part holding a view, with the parts it would make. */
function viewInParts(parts: unknown[], find: (text: string) => ReturnType<typeof viewInText>): Located | null {
  for (const [index, part] of parts.entries()) {
    const { type, text } = (part ?? {}) as Part
    const found = type === 'text' && typeof text === 'string' ? find(text) : null
    if (found) return { view: found.view, content: (next) => parts.map((item, at) => (at === index ? { ...(item as object), text: found.text(next) } : item)) }
  }
  return null
}

function viewOf(message: unknown): Located | null {
  const { role, content, toolName, isError } = (message ?? {}) as { role?: unknown; content?: unknown; toolName?: unknown; isError?: unknown }
  if (role === 'user') {
    if (typeof content === 'string') {
      const found = viewInText(content)
      return found && { view: found.view, content: found.text }
    }
    return Array.isArray(content) ? viewInParts(content, viewInText) : null
  }
  return role === 'toolResult' && !isError && typeof toolName === 'string' && PAGE_VIEW_TOOLS.has(toolName) && Array.isArray(content) ? viewInParts(content, viewInResult) : null
}

/** The edits that reduce every superseded full view to its residual against the next full view of its screen. */
export function supersededPageViewEdits(entries: ProjectedSessionEntries, incomingPromptText: string): PageViewEdit[] {
  const views: Array<{ view: PageViewJson; targetId?: string; content?: Located['content'] }> = []
  for (const entry of entries) {
    if (entry.sourceEntry.type !== 'message' || entry.messages.length !== 1) continue
    const found = viewOf(entry.messages[0])
    if (found && isFullView(found.view)) views.push({ ...found, targetId: entry.sourceEntry.id })
  }
  const incoming = viewInText(incomingPromptText)
  if (incoming && isFullView(incoming.view)) views.push({ view: incoming.view })
  return views.flatMap(({ view, targetId, content }, index) => {
    if (!targetId || !content || PAGE_VIEW_RESIDUAL_KEY in view) return []
    const next = views.slice(index + 1).find((later) => sameScreen(later.view, view))
    const residual = next ? pageViewResidual(view, next.view) : view
    return residual === view ? [] : [{ targetId, content: content(residual) }]
  })
}
