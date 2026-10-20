import { useCallback, useEffect, useRef } from 'react'
import { useInfiniteQuery, useQuery, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { getCodexChatThreadSummaries, listCodexChatThreadPage, type ChatRoomListOptions, type ChatRoomPage, type CodexChatThreadSummary } from '@/lib/api-codex-chat'
import { CODEX_CHAT_THREADS_QUERY_KEY } from './codex-chat-context'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'

export function useChatRoomPages(options: ChatRoomListOptions, enabled = true) {
  const { status } = useRuntimeEventStream()
  const query = useInfiniteQuery({
    queryKey: [...CODEX_CHAT_THREADS_QUERY_KEY, 'pages', options],
    queryFn: ({ pageParam, signal }) => listCodexChatThreadPage(options, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.pagination.has_more ? page.pagination.next_cursor ?? undefined : undefined,
    // An event refreshes at most two cursor pages, regardless of how far the person has browsed.
    maxPages: 2,
    enabled,
    staleTime: 10_000,
    refetchInterval: (query) => resolveStreamFallbackInterval(status, query.state.data?.pages.some((page) => page.data.some((room) => room.running)) ? 4000 : false),
  })
  const firstEvicted = query.data !== undefined && query.data.pageParams[0] !== undefined
  // Keep the current head (including new/updated and pinned rooms) reachable after cursor-window eviction.
  const head = useQuery({
    queryKey: [...CODEX_CHAT_THREADS_QUERY_KEY, 'head', options],
    queryFn: ({ signal }) => listCodexChatThreadPage(options, undefined, signal),
    enabled: enabled && firstEvicted,
    staleTime: 10_000,
    refetchInterval: (query) => resolveStreamFallbackInterval(status, query.state.data?.data.some((room) => room.running) ? 4000 : false),
  })
  const first = (firstEvicted ? head.data : undefined) ?? query.data?.pages[0]
  // Activity can move a room between pages while the person browses. Prefer its newest loaded occurrence.
  const rooms: CodexChatThreadSummary[] = []
  const seen = new Set<number>()
  for (const page of [...(firstEvicted && head.data ? [head.data] : []), ...query.data?.pages ?? []]) for (const room of page.data) {
    if (!seen.has(room.id)) { rooms.push(room); seen.add(room.id) }
  }
  return {
    ...query, rooms, total: first?.pagination.total, hasAutomation: first?.has_automation ?? false,
    hasArchivedChats: first?.has_archived_chats ?? false,
    hasArchivedAutomation: first?.has_archived_automation ?? false,
    isError: query.isError || (firstEvicted && head.isError),
    refetch: async () => {
      const [result] = await Promise.all([query.refetch(), ...(firstEvicted ? [head.refetch()] : [])])
      return result
    },
  }
}

export function useChatRoomSummaries(ids: number[], enabled = true) {
  const unique = [...new Set(ids)].sort((a, b) => a - b)
  return useQuery({
    queryKey: [...CODEX_CHAT_THREADS_QUERY_KEY, 'ids', unique],
    queryFn: ({ signal }) => getCodexChatThreadSummaries(unique, signal),
    enabled: enabled && unique.length > 0,
    staleTime: 10_000,
  })
}

export function useChatBranchParents(rooms: CodexChatThreadSummary[]) {
  const loaded = new Set(rooms.map((room) => room.id))
  const ids = [...new Set(rooms.flatMap((room) => room.branch_purpose === 'preserve' && room.branched_from_thread_id && !loaded.has(room.branched_from_thread_id) ? [room.branched_from_thread_id] : []))].sort((a, b) => a - b)
  return useQuery({
    queryKey: [...CODEX_CHAT_THREADS_QUERY_KEY, 'parents', ids],
    queryFn: async ({ signal }) => {
      const seen = new Set(ids)
      const result: CodexChatThreadSummary[] = []
      let pending = ids
      while (pending.length) {
        const parents = await getCodexChatThreadSummaries(pending, signal)
        result.push(...parents)
        pending = []
        for (const parent of parents) {
          const id = parent.branch_purpose === 'preserve' ? parent.branched_from_thread_id : null
          if (id && !seen.has(id)) { seen.add(id); pending.push(id) }
        }
      }
      return result
    },
    enabled: ids.length > 0,
    staleTime: 10_000,
  })
}

/** A partial directory cannot prove a draft's room was deleted. Validate only draft ids outside the page. */
export function usePagedChatDraftRetention(drafts: Record<number, string>, keepDrafts: (ids: number[]) => void) {
  const currentDrafts = useRef(drafts)
  const revision = useRef(0)
  useEffect(() => { currentDrafts.current = drafts }, [drafts])
  return useCallback((loadedIds: number[]) => {
    const loaded = new Set(loadedIds)
    const outside = Object.keys(currentDrafts.current).map(Number).filter((id) => id > 0 && !loaded.has(id))
    const request = ++revision.current
    if (!outside.length) { keepDrafts(loadedIds); return }
    void getCodexChatThreadSummaries(outside).then((rooms) => {
      if (request !== revision.current) return
      const checked = new Set(outside)
      const existing = new Set(rooms.map((room) => room.id))
      keepDrafts([...loadedIds, ...Object.keys(currentDrafts.current).map(Number).filter((id) => !checked.has(id) || existing.has(id))])
    }).catch(() => { /* An unavailable directory is not evidence that a room or its draft was deleted. */ })
  }, [keepDrafts])
}

export function patchChatRoomLists(queryClient: QueryClient, id: number, patch: Partial<CodexChatThreadSummary> | null) {
  const apply = (rooms: CodexChatThreadSummary[]) => patch === null ? rooms.filter((room) => room.id !== id) : rooms.map((room) => room.id === id ? { ...room, ...patch } : room)
  queryClient.setQueriesData<CodexChatThreadSummary[] | ChatRoomPage | InfiniteData<ChatRoomPage>>({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY }, (current) => {
    if (Array.isArray(current)) return apply(current)
    if (current && typeof current === 'object' && 'pages' in current) return { ...current, pages: current.pages.map((page) => ({ ...page, data: apply(page.data) })) }
    if (current && typeof current === 'object' && 'data' in current) return { ...current, data: apply(current.data) }
    return current
  })
}

export function ChatRoomPageMore({ page }: { page: Pick<ReturnType<typeof useChatRoomPages>, 'isPending' | 'isFetchingNextPage' | 'isError' | 'hasNextPage' | 'fetchNextPage' | 'refetch'> }) {
  const { t } = useI18n()
  if (page.isPending) return <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{t({ ko: '방 불러오는 중…', en: 'Loading rooms…' })}</p>
  if (!page.hasNextPage && !page.isError) return null
  return <Button variant="ghost" size="sm" className="my-1 w-full" disabled={page.isFetchingNextPage} onClick={() => void (page.isError ? page.refetch() : page.fetchNextPage())}>
    {page.isError ? t({ ko: '방을 불러오지 못했어. 다시 시도', en: 'Could not load rooms. Retry' }) : page.isFetchingNextPage ? t({ ko: '불러오는 중…', en: 'Loading…' }) : t({ ko: '방 더 보기', en: 'Load more rooms' })}
  </Button>
}
