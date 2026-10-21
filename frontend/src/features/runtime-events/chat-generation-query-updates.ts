import type { QueryClient } from '@tanstack/react-query'
import type { RuntimeStreamStatus } from './runtime-event-fallback'

/** Live events drive updates; retain a slow watchdog and the original 3s disconnected fallback. */
export function chatGenerationPollInterval(status: RuntimeStreamStatus) {
  return status === 'live' ? 15_000 : 3_000
}

/** Refetch only this chat's active surfaces immediately; inactive caches remain stale until opened. */
export type ChatGenerationRefresh = {
  threadId?: number
  jobId?: number | null
  historyId?: number | null
  compositeHash?: string | null
}

export function refreshChatGenerationQueries(queryClient: QueryClient, result: ChatGenerationRefresh | ChatGenerationRefresh[]) {
  const results = Array.isArray(result) ? result : [result]
  return refreshRuntimeQueryKeys(queryClient, results.flatMap((entry) => [
    ...(entry.threadId == null ? [] : [['codex-chat-thread', entry.threadId], ['codex-chat-media', entry.threadId]]),
    ...(entry.jobId == null ? [] : [['image-generation-history', 'codex-chat-job', entry.jobId]]),
    ...(entry.historyId == null ? [] : [['codex-chat-history', entry.historyId]]),
    ...(entry.compositeHash ? [['image-detail', entry.compositeHash]] : []),
  ]))
}

/** Initial requests also need cancellation: they may have read before the event. */
export function refreshRuntimeQueryKeys(queryClient: QueryClient, keys: readonly (readonly unknown[])[]) {
  const unique = new Map(keys.map(key => [JSON.stringify(key), key]))
  return Promise.all([...unique.values()].map(async (queryKey) => {
    const state = queryClient.getQueryState(queryKey)
    // React Query normally reuses an initial in-flight request with no cached data. That request may have read
    // the old status before this event: cancel it explicitly so the first render cannot miss the completion.
    if (state?.fetchStatus === 'fetching' && state.data === undefined) {
      await queryClient.cancelQueries({ queryKey, exact: true })
    }
    await queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
  }))
}
