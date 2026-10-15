import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { chatGenerationPollInterval } from '@/features/runtime-events/chat-generation-query-updates'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { getCodexChatRunning, getCodexChatThread, listCodexChatThreads, mergeThreadTail, type CodexChatThreadDetail } from '@/lib/api-codex-chat'
import { CODEX_CHAT_THREADS_QUERY_KEY, codexChatThreadQueryKey, defaultThreadId, type CodexChatApi } from './codex-chat-context'

const RUNNING_POLL_MS = 2000
const POLL_TAIL_MESSAGES = 40

/** Own thread selection and server refresh policy for both the dock and the full chat page. */
export function useChatThreadData({ selectedThreadId, settleSelection, keepDrafts }: Pick<CodexChatApi, 'selectedThreadId' | 'settleSelection' | 'keepDrafts'>, liveThreadId: number | null) {
  const queryClient = useQueryClient()
  const { status: streamStatus } = useRuntimeEventStream()
  const threadsQuery = useQuery({
    queryKey: CODEX_CHAT_THREADS_QUERY_KEY,
    queryFn: listCodexChatThreads,
    refetchInterval: (query) => resolveStreamFallbackInterval(streamStatus, query.state.data?.some((entry) => entry.running && entry.id !== liveThreadId) ? RUNNING_POLL_MS * 2 : false),
  })
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data])
  const activeThreadId = selectedThreadId === undefined ? defaultThreadId(threads) : selectedThreadId
  useEffect(() => {
    if (selectedThreadId === undefined && activeThreadId !== null) settleSelection(activeThreadId)
  }, [activeThreadId, selectedThreadId, settleSelection])
  useEffect(() => {
    if (threadsQuery.data) keepDrafts(threadsQuery.data.map((entry) => entry.id))
  }, [keepDrafts, threadsQuery.data])
  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null
  const threadQuery = useQuery({
    queryKey: codexChatThreadQueryKey(activeThreadId),
    queryFn: async () => {
      const id = activeThreadId as number
      const cached = queryClient.getQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(id))
      // A result event may concern an older message outside the polled tail.
      const invalidated = queryClient.getQueryState(codexChatThreadQueryKey(id))?.isInvalidated === true
      if (!invalidated && cached?.running && !cached.pendingJobs) {
        const status = await getCodexChatRunning(id)
        if (status.running && status.latestMessageId === (cached.messages.at(-1)?.id ?? null)) return { ...cached, running: status.running }
      }
      // Only the tail changes during a reply; a missed event still triggers a complete refresh.
      if (!invalidated && cached && (cached.running || cached.pendingJobs)) {
        const merged = mergeThreadTail(cached, await getCodexChatThread(id, POLL_TAIL_MESSAGES))
        if (merged) return merged
      }
      return getCodexChatThread(id)
    },
    enabled: activeThreadId !== null,
    refetchInterval: (query) => (query.state.data?.running && liveThreadId !== activeThreadId ? RUNNING_POLL_MS : query.state.data?.pendingJobs ? chatGenerationPollInterval(streamStatus) : false),
  })
  return { threadsQuery, threads, activeThreadId, activeThread, threadQuery, thread: threadQuery.data?.thread ?? activeThread }
}
