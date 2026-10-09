import type {
  PostBotRun,
  PostCategory,
  PostComment,
  PostCommentMode,
  PostCommentsResult,
  PostDetail,
  PostListResult,
  PostMentionableProfile,
  PostsSettings,
  PostStatus,
  PostTag,
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
  const query = search.toString()
  return requestApiData<PostListResult>(`/api/posts${query ? `?${query}` : ''}`)
}

export const getPost = (id: number) => requestApiData<PostDetail>(`/api/posts/${id}`)
export const createPost = (input: PostInput) => requestApiData<PostDetail>('/api/posts', json('POST', input))
export const updatePost = (id: number, input: PostInput) => requestApiData<PostDetail>(`/api/posts/${id}`, json('PATCH', input))
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

/** A file store file a post embeds, served through the post. */
export const getPostFile = (postId: number, fileId: string) => requestApiData<StoredFileEntry>(`/api/posts/${postId}/files/${fileId}`)
export const postFileUrl = (postId: number, fileId: string, kind: 'view' | 'thumbnail' | 'download') =>
  buildApiUrl(`/api/posts/${postId}/files/${encodeURIComponent(fileId)}/${kind}`)
