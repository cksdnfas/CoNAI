import type { QueryClient, QueryFilters, QueryKey } from '@tanstack/react-query'
import { CODEX_CHAT_THREADS_QUERY_KEY } from './codex-chat-context'

const pending = new WeakMap<QueryClient, Promise<void>>()
const pendingReads = new WeakMap<QueryClient, Map<string, Promise<void>>>()

/** Wait for reads already on the wire, not offline/paused retries or reads started after this call. */
export function waitForChatQueryReads(queryClient: QueryClient, filters: QueryFilters): Promise<void> {
  const cache = queryClient.getQueryCache()
  const reads = cache.findAll(filters).filter((query) => query.state.fetchStatus === 'fetching')
  return Promise.all(reads.map((query) => new Promise<void>((resolve) => {
    const unsubscribe = cache.subscribe((event) => {
      if (event.query === query && (event.type === 'removed' || query.state.fetchStatus !== 'fetching')) finish()
    })
    function finish() { unsubscribe(); resolve() }
    // Also covers silent cancellation, which need not publish an idle state.
    void query.promise?.then(finish, finish)
  }))).then(() => undefined)
}

/** Exact tail/media/badge refresh: a pre-event response cannot satisfy it; unopened caches never fetch. */
export function refetchActiveChatQuery(queryClient: QueryClient, queryKey: QueryKey): Promise<void> {
  let reads = pendingReads.get(queryClient)
  if (!reads) { reads = new Map(); pendingReads.set(queryClient, reads) }
  const key = JSON.stringify(queryKey)
  const existing = reads.get(key)
  if (existing) return existing
  const filters = { queryKey, exact: true, type: 'active' as const }
  const refresh = waitForChatQueryReads(queryClient, filters).then(() => {
    // Events arriving after the fresh read starts need their own follow-up, not its older snapshot.
    reads.delete(key)
    void queryClient.refetchQueries(filters, { cancelRefetch: false })
    return waitForChatQueryReads(queryClient, filters)
  })
  reads.set(key, refresh)
  return refresh
}

/** One directory refresh for a burst of turn/title/task events; never cancel a directory read already underway. */
export function scheduleChatDirectoryRefresh(queryClient: QueryClient): Promise<void> {
  const existing = pending.get(queryClient)
  if (existing) return existing
  const refresh = new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      // A request already underway may have read before the event. Let it settle, then read once more,
      // rather than cancelling it or reusing its potentially stale result as the event's refresh.
      void waitForChatQueryReads(queryClient, { queryKey: CODEX_CHAT_THREADS_QUERY_KEY }).then(() => {
        pending.delete(queryClient)
        void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY }, { cancelRefetch: false })
        return waitForChatQueryReads(queryClient, { queryKey: CODEX_CHAT_THREADS_QUERY_KEY, type: 'active' })
      }).then(resolve, reject)
    }, 200)
  })
  pending.set(queryClient, refresh)
  return refresh
}
