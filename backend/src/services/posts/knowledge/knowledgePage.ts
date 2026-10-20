import type { ChatPageSnapshot } from '@conai/shared'
import type { McpRequestContext } from '../../../mcp/context'
import { getUserSettingsDb } from '../../../database/userSettingsDb'
import { actorFromRequester, PostError } from '../postActor'
import { PostCommentStore, PostStore } from '../postStore'
import { knowledgeExecutionFromMcp, recordKnowledgeUse } from './knowledgeRuntime'
import { BoardCallRooms } from '../boardCallRooms'
import { chatPageView } from '../../../mcp/tools/chatPageView'
import { contextContentLimit } from '../../codex-chat/chatContentRating'

const KNOWLEDGE_MUTATIONS = new Set(['posts.save', 'posts.body_edit', 'posts.delete', 'posts.restore_revision'])

/** Tool-less board bots receive this exact server Markdown interval in their input. */
export function recordQuotedBoardKnowledge(context: McpRequestContext) {
  if (!context.requester || !context.chatContext) return
  const quoted = BoardCallRooms.quotedPostFor(context.chatContext.threadId, context.chatContext.profileId)
  if (!quoted?.body) return
  try {
    const actor = actorFromRequester(context.requester, context.chatContext.profileId)
    const post = PostStore.get(actor, quoted.postId)
    if (!post.knowledge?.enabled) return
    recordKnowledgeUse(actor, { postId: post.id, body: quoted.body, intervals: [{ start: 0, end: quoted.body.length }], execution: knowledgeExecutionFromMcp(context) })
  } catch (error) { console.warn('[Knowledge] quoted board reference skipped:', error instanceof Error ? error.message : error) }
}

/** An AI page card must use the knowledge proposal contract even when the person later clicks Apply. */
export function requireKnowledgePageAction(page: Pick<ChatPageSnapshot, 'path'> & Partial<Pick<ChatPageSnapshot, 'resourceId' | 'data'>>, actionId: string) {
  if (!KNOWLEDGE_MUTATIONS.has(actionId) || page.path.split('?')[0] !== '/posts') return
  const ids = new Set<number>()
  const resource = /^(?:[a-z_]+:)?(\d+)$/.exec(page.resourceId ?? '')
  if (resource) ids.add(Number(resource[1]))
  for (const key of ['open', 'selected', 'editor']) {
    const value = page.data?.[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const id = value.id ?? value.postId
      if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ids.add(id)
    }
  }
  for (const id of ids) {
    if (getUserSettingsDb().prepare('SELECT 1 FROM post_knowledge WHERE post_id = ?').get(id)) {
      throw new PostError('지식 문서 변경은 posts_propose_knowledge로 제안하고 게시판에서 검토해야 해.', 403, 'KNOWLEDGE_PROPOSAL_REQUIRED')
    }
  }
}

/** Replace browser-supplied body evidence with the current, permission-checked server interval. */
export function knowledgePageForExecution(context: McpRequestContext, page: ChatPageSnapshot): ChatPageSnapshot {
  if (page.kind !== 'posts' || !context.requester || !context.chatContext) return page
  const open = page.data?.open
  if (!open || typeof open !== 'object' || Array.isArray(open) || typeof open.id !== 'number') return page
  const actor = actorFromRequester(context.requester, context.chatContext.profileId)
  try {
    const post = PostStore.get(actor, open.id)
    if (!post.knowledge?.enabled) return page
    const start = typeof open.bodyOffset === 'number' && Number.isSafeInteger(open.bodyOffset) ? Math.max(0, Math.min(open.bodyOffset, post.body.length)) : 0
    // Keep the actual source interval short; the full emitted packet must fit before issuing evidence.
    const shownLength = typeof open.body === 'string' ? Math.max(1, open.body.length) : 200
    const end = Math.min(post.body.length, start + Math.min(shownLength, 2000))
    const body = post.body.slice(start, end)
    const requestedComments = Array.isArray(page.data?.comments) ? new Set(page.data.comments.flatMap(item => item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'number' ? [item.id] : [])) : new Set<number>()
    const comments = PostCommentStore.list(actor, post.id, { ids: [...requestedComments].slice(-40), limit: 40, visibleOnly: true })
      .map(item => ({ id: item.id, replyTo: item.parentId, author: item.author.name, bot: item.author.type === 'profile', text: item.body.slice(0, 400) }))
    const serverOpen = { id: post.id, title: post.title, author: post.author.name, bot: post.author.type === 'profile', categoryId: post.categoryId,
      tags: post.tags, status: post.status, comments: post.commentCount, canEdit: false, revision: post.revision, pinned: post.pinned,
      body, bodyOffset: start, bodyLength: post.body.length, knowledge: { enabled: post.knowledge.enabled, contentVersion: post.knowledge.contentVersion, contentHash: post.knowledge.contentHash, reviewStatus: post.knowledge.reviewStatus } }
    const candidate: ChatPageSnapshot = { ...page, data: { ...page.data, open: serverOpen, comments } }
    const budget = Math.min(12_000, context.chatContext.knowledgeOutputLimit ?? 12_000)
    // Reserve for the receipt and operation wrapper, which the LLM output limiter counts too.
    if (!body || JSON.stringify(chatPageView(context.requester, candidate, contextContentLimit(context))).length + 1000 > budget) return candidate
    const reference = recordKnowledgeUse(actor, { postId: post.id, body, intervals: [{ start, end }], execution: knowledgeExecutionFromMcp(context) })
    return reference ? { ...candidate, data: { ...candidate.data, open: { ...serverOpen, reference: { ...reference, intervals: reference.intervals.map(span => ({ start: span.start, end: span.end })) } } } } : candidate
  } catch (error) {
    // Stale tabs and a revoked permission do not become trusted references.
    const { open: _open, comments: _comments, earlierVersions: _versions, ...data } = page.data ?? {}
    return { ...page, data: { ...data, knowledgeReferenceUnavailable: error instanceof PostError ? error.message : '지식 문서를 서버에서 확인하지 못했어.' } }
  }
}
