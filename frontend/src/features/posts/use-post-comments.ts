import { createContext, useContext, useState } from 'react'
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostComment, PostCommentCursor } from '@conai/shared'
import { listPostComments, POSTS_QUERY_KEY } from '@/lib/api-posts'

type ReplyRequest = { parentId: number; before: PostCommentCursor }

/** Shared by the rendered threads and the page assistant, including older pages the reader has opened. */
export function usePostComments(postId: number | null, focusIds: number[] = [], enabled = true) {
  const queryClient = useQueryClient()
  const active = enabled && postId !== null
  const query = useInfiniteQuery({
    queryKey: [POSTS_QUERY_KEY, 'comments', postId, 'threads'],
    initialPageParam: null as PostCommentCursor | null,
    queryFn: ({ pageParam, signal }) => listPostComments(postId!, { before: pageParam, signal }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: active,
  })
  const [replyState, setReplyState] = useState<{ postId: number | null; requests: ReplyRequest[] }>({ postId: null, requests: [] })
  const requests = replyState.postId === postId ? replyState.requests : []
  const replyOptions = (request: ReplyRequest) => ({
    queryKey: [POSTS_QUERY_KEY, 'comments', postId, 'replies', request.parentId, request.before],
    queryFn: ({ signal }: { signal: AbortSignal }) => listPostComments(postId!, { ...request, signal }),
  })
  // Each expanded thread has its own cursor; only pages explicitly opened by the reader have observers.
  const replyQueries = useQueries({ queries: requests.map((request) => ({ ...replyOptions(request), enabled: active })) })
  const loaded = new Map([...(query.data?.pages ?? []), ...replyQueries.flatMap((result) => result.data ?? [])].flatMap((page) => page.comments.map((comment) => [comment.id, comment] as const)))
  const missingIds = [...new Set(focusIds)].filter((id) => {
    const comment = loaded.get(id)
    return !comment || (comment.parentId !== null && !loaded.has(comment.parentId))
  }).sort((a, b) => a - b).slice(0, 3)
  const focus = useQuery({
    queryKey: [POSTS_QUERY_KEY, 'comments', postId, 'focus', missingIds],
    queryFn: ({ signal }) => listPostComments(postId!, { focusIds: missingIds, signal }),
    enabled: active && missingIds.length > 0,
  })
  const pages = [...(query.data?.pages ?? []), ...(missingIds.length && focus.data ? [focus.data] : []), ...replyQueries.flatMap((result) => result.data ?? [])]
  const byId = new Map<number, PostComment>()
  const context = new Map<number, PostComment>()
  const moreReplies = new Map<number, PostCommentCursor | null>()
  for (const page of pages) {
    for (const comment of page.comments) byId.set(comment.id, comment)
    for (const comment of page.context) context.set(comment.id, comment)
    for (const reply of page.replies) moreReplies.set(reply.parentId, reply.nextCursor)
  }
  replyQueries.forEach((result, index) => {
    if (result.data) moreReplies.set(requests[index].parentId, result.data.nextCursor)
  })
  // A parent hidden/deleted during refresh can leave cached reply pages behind; they must not become orphan rows.
  for (const parentId of moreReplies.keys()) if (!byId.has(parentId)) moreReplies.delete(parentId)
  const loadingReplies = new Set(requests.flatMap((request, index) => replyQueries[index].isFetching ? [request.parentId] : []))
  const loadMoreReplies = async (parentId: number) => {
    const before = moreReplies.get(parentId)
    if (!active || !before || loadingReplies.has(parentId)) return
    const request = { parentId, before }
    setReplyState((current) => {
      const previous = current.postId === postId ? current.requests : []
      return { postId, requests: previous.some((item) => item.parentId === parentId && item.before.id === before.id) ? previous : [...previous, request] }
    })
    await queryClient.fetchQuery(replyOptions(request))
  }
  const error = query.error ?? focus.error ?? replyQueries.find((result) => result.error)?.error
  return {
    comments: [...byId.values()].filter((comment) => comment.parentId === null || byId.has(comment.parentId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id),
    context, runs: query.data?.pages[0]?.runs ?? [], moreReplies, loadingReplies, loadMoreReplies,
    hasMore: query.hasNextPage, isLoadingMore: query.isFetching, isPending: active && query.isPending, error,
    loadMore: async () => {
      if (active && query.hasNextPage && !query.isFetching) {
        const result = await query.fetchNextPage()
        if (result.isError) throw result.error
      }
    },
    retry: () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY, 'comments', postId] }),
  }
}

export const PostCommentsContext = createContext<ReturnType<typeof usePostComments> | null>(null)

export function usePostCommentsData() {
  const data = useContext(PostCommentsContext)
  if (!data) throw new Error('PostCommentsContext is missing')
  return data
}
