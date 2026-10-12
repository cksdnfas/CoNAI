import type {
  PostBotRun,
  PostCategory,
  PostComment,
  PostCommentMode,
  PostCommentsResult,
  PostDetail,
  PostListResult,
  PostMentionableProfile,
  PostRevision,
  PostsSettings,
  PostStatus,
  PostTag,
  PostKnowledgeLinks,
  PostKnowledgeReviewQueue,
  PostKnowledgeReviewStatus,
  PostKnowledgeSource,
  PostKnowledgeVersion,
  PostKnowledgeExport,
  PostQualityStats,
  PostAssessmentQuality,
  PostAssessmentTaskFit,
  PostTaskFitFeedback,
  PostAssessmentAuditList,
  PostAssessmentModerationResult,
  PostKnowledgePermanentDeletePreview,
  PostKnowledgePermanentDeleteResult,
  PostKnowledgeProposal,
  PostKnowledgeProposalDetail,
  PostKnowledgeProposalListResult,
  PostEvaluationRequest,
  StoredFileEntry,
} from '@conai/shared'
import { requestApiData } from './api-request'
import { buildApiUrl } from './api-url'

/** Every posts query starts with this, so the SSE `posts.changed` event refreshes them all. */
export const POSTS_QUERY_KEY = 'posts'

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export type PostListParams = {
  categoryId?: number | null
  tag?: string | null
  q?: string | null
  status?: 'published' | 'draft' | 'hidden' | 'all'
  authorProfileId?: number | null
  offset?: number
  limit?: number
  kind?: 'knowledge' | 'post' | 'all'
  reviewStatus?: PostKnowledgeReviewStatus
  deleted?: 'only'
  sort?: 'relevance' | 'recent'
  snapshot?: string
}

export type PostInput = {
  title?: string
  body?: string
  categoryId?: number | null
  tags?: string[]
  status?: PostStatus
  commentMode?: PostCommentMode
  pinned?: boolean
  expectedRevision?: number
}

export type PostCategoryInput = { name?: string; parentId?: number | null; description?: string; sortOrder?: number }

export const getPostsSettings = () => requestApiData<PostsSettings>('/api/posts/settings')
export const updatePostsSettings = (settings: Partial<PostsSettings>) => requestApiData<PostsSettings>('/api/posts/settings', json('PUT', settings))

export const listPostCategories = () => requestApiData<PostCategory[]>('/api/posts/categories')
export const createPostCategory = (input: PostCategoryInput) => requestApiData<PostCategory>('/api/posts/categories', json('POST', input))
export const updatePostCategory = (id: number, input: PostCategoryInput) => requestApiData<PostCategory>(`/api/posts/categories/${id}`, json('PATCH', input))
export const deletePostCategory = (id: number) => requestApiData<void>(`/api/posts/categories/${id}`, json('DELETE'))

export const listPostTags = () => requestApiData<PostTag[]>('/api/posts/tags')

export function listPosts(params: PostListParams = {}) {
  const search = new URLSearchParams()
  if (params.categoryId) search.set('categoryId', String(params.categoryId))
  if (params.tag) search.set('tag', params.tag)
  if (params.q) search.set('q', params.q)
  if (params.status) search.set('status', params.status)
  if (params.authorProfileId) search.set('authorProfileId', String(params.authorProfileId))
  if (params.offset) search.set('offset', String(params.offset))
  if (params.limit) search.set('limit', String(params.limit))
  if (params.kind) search.set('kind', params.kind)
  if (params.reviewStatus) search.set('reviewStatus', params.reviewStatus)
  if (params.deleted) search.set('deleted', params.deleted)
  if (params.sort) search.set('sort', params.sort)
  if (params.snapshot) search.set('snapshot', params.snapshot)
  const query = search.toString()
  return requestApiData<PostListResult>(`/api/posts${query ? `?${query}` : ''}`)
}

export const getPost = (id: number) => requestApiData<PostDetail>(`/api/posts/${id}`)
export const createPost = (input: PostInput) => requestApiData<PostDetail>('/api/posts', json('POST', input))
export const updatePost = (id: number, input: PostInput) => requestApiData<PostDetail>(`/api/posts/${id}`, json('PATCH', input))
export const listPostRevisions = (id: number) => requestApiData<PostRevision[]>(`/api/posts/${id}/revisions`)
export const deletePost = (id: number) => requestApiData<void>(`/api/posts/${id}`, json('DELETE'))

export const listPostComments = (postId: number) => requestApiData<PostCommentsResult>(`/api/posts/${postId}/comments`)
export const createPostComment = (postId: number, input: { body: string; parentId?: number | null; mentions?: number[] }) =>
  requestApiData<PostComment>(`/api/posts/${postId}/comments`, json('POST', input))
export const updatePostComment = (commentId: number, input: { body: string; expectedRevision?: number }) =>
  requestApiData<PostComment>(`/api/posts/comments/${commentId}`, json('PATCH', input))
export const deletePostComment = (commentId: number) => requestApiData<void>(`/api/posts/comments/${commentId}`, json('DELETE'))
export const setPostCommentHidden = (commentId: number, hidden: boolean) =>
  requestApiData<PostComment>(`/api/posts/comments/${commentId}/hidden`, json('POST', { hidden }))

export const listMentionableProfiles = () => requestApiData<PostMentionableProfile[]>('/api/posts/mentionable')
export const cancelPostBotRun = (runId: number) => requestApiData<PostBotRun>(`/api/posts/runs/${runId}/cancel`, json('POST'))
export const listPostBotRuns = (postId: number) => requestApiData<PostBotRun[]>(`/api/posts/${postId}/runs`)

/** A file store file a post embeds, served through the post. */
const postFileVersionQuery = (knowledgeContentVersion?: number) => knowledgeContentVersion === undefined ? '' : `?contentVersion=${knowledgeContentVersion}`
export const getPostFile = (postId: number, fileId: string, knowledgeContentVersion?: number) => requestApiData<StoredFileEntry>(`/api/posts/${postId}/files/${encodeURIComponent(fileId)}${postFileVersionQuery(knowledgeContentVersion)}`)
export const postFileUrl = (postId: number, fileId: string, kind: 'view' | 'thumbnail' | 'download', knowledgeContentVersion?: number) =>
  buildApiUrl(`/api/posts/${postId}/files/${encodeURIComponent(fileId)}/${kind}${postFileVersionQuery(knowledgeContentVersion)}`)

export const updatePostKnowledge = (id: number, input: { expectedRevision: number; enabled?: boolean; sources?: PostKnowledgeSource[]; replacementPostId?: number | null }) =>
  requestApiData<PostDetail>(`/api/posts/${id}/knowledge`, json('PATCH', input))
export const getPostKnowledgeLinks = (id: number) => requestApiData<PostKnowledgeLinks>(`/api/posts/${id}/links`)
export const getPostQuality = (id: number) => requestApiData<PostQualityStats>(`/api/posts/${id}/quality`)
export const getPostTaskFit = (id: number, searchReceiptToken: string) => requestApiData<PostTaskFitFeedback | null>(`/api/posts/${id}/task-fit?${new URLSearchParams({ searchReceiptToken })}`)
export const setPostTaskFit = (id: number, input: { contentVersion: number; searchReceiptToken: string; taskFit: PostAssessmentTaskFit; idempotencyKey: string; reasonCode?: string; reason?: string }) =>
  requestApiData<PostTaskFitFeedback>(`/api/posts/${id}/task-fit`, json('PUT', input))
export function listPostAssessmentAudit(id: number, params: { offset?: number; limit?: number } = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value))
  return requestApiData<PostAssessmentAuditList>(`/api/posts/${id}/assessments?${query}`)
}
export const moderatePostAssessment = (id: number, eventId: number, input: { action: 'invalidate' | 'correct'; expectedHeadEventId: number; idempotencyKey: string; reason: string; quality?: PostAssessmentQuality; taskFit?: PostAssessmentTaskFit }) =>
  requestApiData<PostAssessmentModerationResult>(`/api/posts/${id}/assessments/${eventId}/moderate`, json('POST', input))
export const previewPostKnowledgePermanentDelete = (id: number, expectedRevision: number) => requestApiData<PostKnowledgePermanentDeletePreview>(`/api/posts/${id}/permanent-delete/preview`, json('POST', { expectedRevision }))
export const permanentlyDeletePostKnowledge = (id: number, input: { expectedRevision: number; previewToken: string; confirm: true }) => requestApiData<PostKnowledgePermanentDeleteResult>(`/api/posts/${id}/permanent-delete`, json('POST', input))
export const votePost = (id: number, input: { contentVersion: number; idempotencyKey: string; quality: PostAssessmentQuality; taskFit?: PostAssessmentTaskFit; reasonCode?: string; reason?: string; evidenceQuote?: string }) =>
  requestApiData<PostQualityStats>(`/api/posts/${id}/vote`, json('PUT', input))
export const cancelPostVote = (id: number, contentVersion: number, idempotencyKey: string) =>
  requestApiData<PostQualityStats>(`/api/posts/${id}/vote`, json('DELETE', { contentVersion, idempotencyKey }))
export const reviewPost = (id: number, input: { contentVersion: number; action: 'verify' | 'request_review' | 'report_error' | 'resolve_issue'; reason: string; evidenceQuote?: string; issueId?: number }) =>
  requestApiData<PostDetail>(`/api/posts/${id}/review`, json('POST', input))
export const listPostKnowledgeReviewQueue = () => requestApiData<PostKnowledgeReviewQueue>('/api/posts/knowledge/review-queue')
export const trashPostKnowledge = (id: number, expectedRevision: number) => requestApiData<PostDetail>(`/api/posts/${id}/trash`, json('POST', { expectedRevision }))
export const restorePostKnowledge = (id: number, expectedRevision: number) => requestApiData<PostDetail>(`/api/posts/${id}/restore`, json('POST', { expectedRevision }))
export const listPostKnowledgeVersions = (id: number) => requestApiData<PostKnowledgeVersion[]>(`/api/posts/${id}/knowledge/versions`)
export const restorePostKnowledgeVersion = (id: number, contentVersion: number, expectedRevision: number) =>
  requestApiData<PostDetail>(`/api/posts/${id}/knowledge/versions/${contentVersion}/restore`, json('POST', { expectedRevision }))
export const exportPostKnowledge = (id: number) => requestApiData<PostKnowledgeExport>(`/api/posts/${id}/knowledge/export`)

export type KnowledgeProposalInput = {
  kind: 'create' | 'update'
  postId?: number
  baseRevision?: number
  baseContentVersion?: number
  title: string
  body: string
  sources: PostKnowledgeSource[]
  reason?: string
  idempotencyKey: string
  categoryId?: number | null
  tags?: string[]
  status?: 'draft' | 'published'
}
export function listPostKnowledgeProposals(params: { postId?: number; status?: 'pending' | 'applied' | 'rejected'; offset?: number; limit?: number } = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value))
  return requestApiData<PostKnowledgeProposalListResult>(`/api/posts/knowledge/proposals?${search}`)
}
export const getPostKnowledgeProposal = (id: string) => requestApiData<PostKnowledgeProposalDetail>(`/api/posts/knowledge/proposals/${encodeURIComponent(id)}`)
export const createPostKnowledgeProposal = (input: KnowledgeProposalInput) => requestApiData<PostKnowledgeProposal>('/api/posts/knowledge/proposals', json('POST', input))
export const applyPostKnowledgeProposal = (id: string, input: { expectedRevision?: number; contentVersion?: number }) =>
  requestApiData<PostKnowledgeProposal>(`/api/posts/knowledge/proposals/${encodeURIComponent(id)}/apply`, json('POST', input))
export const rejectPostKnowledgeProposal = (id: string, reason: string) =>
  requestApiData<PostKnowledgeProposal>(`/api/posts/knowledge/proposals/${encodeURIComponent(id)}/reject`, json('POST', { reason }))
export const listPostEvaluations = (id: number) => requestApiData<PostEvaluationRequest[]>(`/api/posts/${id}/evaluations`)
export const requestPostEvaluation = (id: number, contentVersion: number, idempotencyKey: string) =>
  requestApiData<PostEvaluationRequest>(`/api/posts/${id}/evaluations`, json('POST', { contentVersion, idempotencyKey }))
export const cancelPostEvaluation = (id: number, requestId: string) =>
  requestApiData<PostEvaluationRequest>(`/api/posts/${id}/evaluations/${encodeURIComponent(requestId)}/cancel`, json('POST'))

export type PostKnowledgeSearchStatus = { enabled: boolean; state: 'disabled' | 'unavailable' | 'indexing' | 'ready' | 'partial'; indexed: number; total: number; message: string }
export const getPostKnowledgeSearchStatus = () => requestApiData<PostKnowledgeSearchStatus>('/api/posts/knowledge/search-status')

export type PostKnowledgeEvaluationStatus = {
  queued: number; running: number; completed: number; skipped: number; failed: number; cancelled: number
  todayCalls: number; todayTokens: number | null; todayReservedTokens: number; tokensUnreported: number
  enabled: boolean; providerReady: boolean
}
export const getPostKnowledgeEvaluationStatus = () => requestApiData<PostKnowledgeEvaluationStatus>('/api/posts/knowledge/evaluations/status')
