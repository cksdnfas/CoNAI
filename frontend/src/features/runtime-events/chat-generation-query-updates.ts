import type { QueryClient } from '@tanstack/react-query'
import type { RuntimeStreamStatus } from './runtime-event-fallback'

/** Live events drive updates; retain a slow watchdog and the original 3s disconnected fallback. */
export function chatGenerationPollInterval(status: RuntimeStreamStatus) {
  return status === 'live' ? 15_000 : 3_000
}

/** Refetch only this chat's active surfaces immediately; inactive caches remain stale until opened. */
export function refreshChatGenerationQueries(queryClient: QueryClient, result: {
  threadId: number
  jobId: number
  historyId?: number | null
}) {
  const keys: readonly unknown[][] = [
    ['codex-chat-thread', result.threadId],
    ['codex-chat-media', result.threadId],
    ['image-generation-history', 'codex-chat-job', result.jobId],
    ...(result.historyId == null ? [] : [['codex-chat-history', result.historyId]]),
  ]
  return Promise.all(keys.map(async (queryKey) => {
    const state = queryClient.getQueryState(queryKey)
    // React Query normally reuses an initial in-flight request with no cached data. That request may have read
    // the old status before this event: cancel it explicitly so the first render cannot miss the completion.
    if (state?.fetchStatus === 'fetching' && state.data === undefined) {
      await queryClient.cancelQueries({ queryKey, exact: true })
    }
    await queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
  }))
}
