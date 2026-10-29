import { useCallback, useRef } from 'react'
import { useInfiniteQuery, useQuery, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { getCodexChatThreadSummaries, listCodexChatThreadPage, type ChatRoomListOptions, type ChatRoomPage, type CodexChatThreadDetail, type CodexChatThreadSummary } from '@/lib/api-codex-chat'
import { CODEX_CHAT_THREADS_QUERY_KEY, codexChatThreadQueryKey } from './codex-chat-context'
import { refetchActiveChatQuery, waitForChatQueryReads } from './chat-query-refresh'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'

export function compareChatRoomActivity(a: CodexChatThreadSummary, b: CodexChatThreadSummary, pinnedFirst: boolean) {
  return (pinnedFirst ? (b.pinned ?? 0) - (a.pinned ?? 0) : 0) || b.updated_date.localeCompare(a.updated_date) || b.id - a.id
}

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
  // A local send can move a retained-window room ahead of the separately fetched head.
  rooms.sort((a, b) => compareChatRoomActivity(a, b, options.pinnedFirst === true))
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
  const ids = [...new Set(rooms.flatMap((room) => !room.pinned && room.branch_purpose === 'preserve' && room.branched_from_thread_id && !loaded.has(room.branched_from_thread_id) ? [room.branched_from_thread_id] : []))].sort((a, b) => a - b)
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
          const id = !parent.pinned && parent.branch_purpose === 'preserve' ? parent.branched_from_thread_id : null
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
export function usePagedChatDraftRetention(currentDrafts: () => Record<number, string>, keepDrafts: (ids: number[]) => void) {
  const revision = useRef(0)
  const checkedMembership = useRef<string | null>(null)
  return useCallback((loadedIds: number[]) => {
    const loaded = new Set(loadedIds)
    const outside = Object.keys(currentDrafts()).map(Number).filter((id) => id > 0 && !loaded.has(id)).sort((a, b) => a - b)
    const membership = `${[...loaded].sort((a, b) => a - b).join(',')}|${outside.join(',')}`
    // Activity/read patches change neither room membership nor which drafts need validation.
    if (checkedMembership.current === membership) return
    checkedMembership.current = membership
    const request = ++revision.current
    if (!outside.length) { keepDrafts(loadedIds); return }
    void getCodexChatThreadSummaries(outside).then((rooms) => {
      if (request !== revision.current) return
      const checked = new Set(outside)
      const existing = new Set(rooms.map((room) => room.id))
      keepDrafts([...loadedIds, ...Object.keys(currentDrafts()).map(Number).filter((id) => !checked.has(id) || existing.has(id))])
    }).catch(() => {
      // An unavailable directory is not evidence of deletion; allow the next directory update to retry.
      if (revision.current === request) checkedMembership.current = null
    })
  }, [currentDrafts, keepDrafts])
}

export function patchChatRoomLists(queryClient: QueryClient, id: number, patch: Partial<CodexChatThreadSummary> | null) {
  let found = false
  const caches = queryClient.getQueriesData<CodexChatThreadSummary[] | ChatRoomPage | InfiniteData<ChatRoomPage>>({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
  const hasPageCache = caches.some(([key]) => key[1] === 'pages' || key[1] === 'head')
  for (const [key, current] of caches) {
    const pinnedFirst = (key[1] === 'pages' || key[1] === 'head') && (key[2] as ChatRoomListOptions).pinnedFirst === true
    const apply = (rooms: CodexChatThreadSummary[]) => {
      if (!rooms.some((room) => room.id === id)) return rooms
      // The startup list is not pinned-first and can contain rooms absent from the paged directory.
      if ((!hasPageCache && key.length === 1) || key[1] === 'pages' || key[1] === 'head') found = true
      const next = patch === null ? rooms.filter((room) => room.id !== id) : rooms.map((room) => room.id === id ? { ...room, ...patch } : room)
      if (patch?.updated_date !== undefined) next.sort((a, b) => compareChatRoomActivity(a, b, pinnedFirst))
      return next
    }
    if (Array.isArray(current)) {
      const next = apply(current)
      if (next !== current) queryClient.setQueryData(key, next)
    } else if (current && typeof current === 'object' && 'pages' in current) {
      const rooms = current.pages.flatMap((page) => page.data)
      const next = apply(rooms)
      if (next === rooms) continue
      let offset = 0
      const pages = current.pages.map((page) => {
        // Removal preserves each cursor page; activity reorders only the already loaded window.
        if (patch?.updated_date === undefined) return { ...page, data: apply(page.data) }
        const data = next.slice(offset, offset + page.data.length)
        offset += page.data.length
        return { ...page, data }
      })
      queryClient.setQueryData(key, { ...current, pages })
    } else if (current && typeof current === 'object' && 'data' in current) {
      const next = apply(current.data)
      if (next !== current.data) queryClient.setQueryData(key, { ...current, data: next })
    }
  }
  return found
}

/** Acknowledged read marks must survive directory requests that began before the acknowledgement. */
export async function applyChatReadReceipt(queryClient: QueryClient, threadId: number, messageId: number) {
  const patch = () => {
    const latest = queryClient.getQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(threadId))?.messages.at(-1)?.id
    if (latest === messageId) patchChatRoomLists(queryClient, threadId, { unread_count: 0 })
  }
  patch()
  await waitForChatQueryReads(queryClient, { queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
  patch()
  await refetchActiveChatQuery(queryClient, [...CODEX_CHAT_THREADS_QUERY_KEY, 'unread'])
}

export function ChatRoomPageMore({ page }: { page: Pick<ReturnType<typeof useChatRoomPages>, 'isPending' | 'isFetchingNextPage' | 'isError' | 'hasNextPage' | 'fetchNextPage' | 'refetch'> }) {
  const { t } = useI18n()
  if (page.isPending) return <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{t({ ko: '방 불러오는 중…', en: 'Loading rooms…' })}</p>
  if (!page.hasNextPage && !page.isError) return null
  return <Button variant="ghost" size="sm" className="my-1 w-full" disabled={page.isFetchingNextPage} onClick={() => void (page.isError ? page.refetch() : page.fetchNextPage())}>
    {page.isError ? t({ ko: '방을 불러오지 못했어. 다시 시도', en: 'Could not load rooms. Retry' }) : page.isFetchingNextPage ? t({ ko: '불러오는 중…', en: 'Loading…' }) : t({ ko: '방 더 보기', en: 'Load more rooms' })}
  </Button>
}
