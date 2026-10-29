import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { chatGenerationPollInterval } from '@/features/runtime-events/chat-generation-query-updates'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { getCodexChatRunning, getCodexChatThread, listCodexChatThreads, mergeThreadBefore, mergeThreadTail, type CodexChatThreadDetail } from '@/lib/api-codex-chat'
import { CODEX_CHAT_THREADS_QUERY_KEY, codexChatThreadQueryKey, defaultThreadId, type CodexChatApi } from './codex-chat-context'

const RUNNING_POLL_MS = 2000
const POLL_TAIL_MESSAGES = 40
const MESSAGE_PAGE_SIZE = 80

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
    queryFn: async ({ signal }) => {
      const id = activeThreadId as number
      const key = codexChatThreadQueryKey(id)
      const cached = queryClient.getQueryData<CodexChatThreadDetail>(key)
      // A result event may concern an older message outside the polled tail.
      const invalidated = queryClient.getQueryState(key)?.isInvalidated === true
      if (!invalidated && cached?.running && !cached.pendingJobs) {
        const status = await getCodexChatRunning(id)
        const latest = queryClient.getQueryData<CodexChatThreadDetail>(key)
        if (latest && latest.thread.context_revision > cached.thread.context_revision) return latest
        if (latest && latest.thread.context_revision === cached.thread.context_revision && status.running && status.latestMessageId === (latest.messages.at(-1)?.id ?? null)) return { ...latest, running: status.running }
      }
      // Routine reads start at the tail. Refresh only the older range the reader explicitly loaded.
      if (!invalidated && cached && (cached.running || cached.pendingJobs)) {
        const tail = await getCodexChatThread(id, POLL_TAIL_MESSAGES, undefined, signal)
        const latest = queryClient.getQueryData<CodexChatThreadDetail>(key)
        if (latest && latest.thread.context_revision > tail.thread.context_revision) return latest
        const merged = latest ? mergeThreadTail(latest, tail) : tail
        if (merged) return merged
      }
      let detail = await getCodexChatThread(id, MESSAGE_PAGE_SIZE, undefined, signal)
      // Loading earlier pages can finish while this request is on the wire, including after cancelling
      // the read that preceded it. Merge against the current cache, never the request-start snapshot.
      const latest = queryClient.getQueryData<CodexChatThreadDetail>(key)
      if (latest && latest.thread.context_revision > detail.thread.context_revision) return latest
      if (!latest || latest.thread.context_revision !== detail.thread.context_revision) return detail
      if (!invalidated) return mergeThreadTail(latest, detail) ?? detail
      while (detail.hasMoreBefore) {
        const current = queryClient.getQueryData<CodexChatThreadDetail>(key)
        const first = current?.historyLoaded && current.thread.context_revision === detail.thread.context_revision ? current.messages[0]?.id : undefined
        if (first === undefined || detail.messages[0].id <= first) break
        const before = detail.messages[0].id
        const page = await getCodexChatThread(id, MESSAGE_PAGE_SIZE, before, signal)
        const merged = mergeThreadBefore(detail, page, before)
        if (!merged) break
        detail = merged
      }
      const current = queryClient.getQueryData<CodexChatThreadDetail>(key)
      return current && current.thread.context_revision > detail.thread.context_revision ? current : detail
    },
    enabled: activeThreadId !== null,
    refetchInterval: (query) => (query.state.data?.running && liveThreadId !== activeThreadId ? RUNNING_POLL_MS : query.state.data?.pendingJobs ? chatGenerationPollInterval(streamStatus) : false),
  })
  const loadingRef = useRef<{ threadId: number; promise: Promise<number | null> } | null>(null)
  const older = useMutation({
    mutationFn: async (id: number) => {
      const key = codexChatThreadQueryKey(id)
      const current = queryClient.getQueryData<CodexChatThreadDetail>(key)
      const before = current?.messages[0]?.id
      if (!current?.hasMoreBefore || before === undefined) return null
      // Serialize against a refresh so it cannot overwrite a page just prepended.
      await queryClient.cancelQueries({ queryKey: key })
      const page = await getCodexChatThread(id, MESSAGE_PAGE_SIZE, before)
      let first: number | null = null
      queryClient.setQueryData<CodexChatThreadDetail>(key, (latest) => {
        const merged = latest ? mergeThreadBefore(latest, page, before) : null
        if (!merged) return latest
        first = page.messages[0]?.id ?? null
        return merged
      })
      return first
    },
  })
  const { mutateAsync } = older
  const loadEarlier = useCallback(() => {
    if (activeThreadId === null) return Promise.resolve(null)
    if (loadingRef.current?.threadId === activeThreadId) return loadingRef.current.promise
    const request = { threadId: activeThreadId, promise: mutateAsync(activeThreadId).finally(() => {
      if (loadingRef.current === request) loadingRef.current = null
    }) }
    loadingRef.current = request
    return request.promise
  }, [activeThreadId, mutateAsync])
  const preserveHistory = useCallback(() => {
    if (activeThreadId === null) return
    const key = codexChatThreadQueryKey(activeThreadId)
    const current = queryClient.getQueryData<CodexChatThreadDetail>(key)
    if (current && !current.historyLoaded) queryClient.setQueryData(key, { ...current, historyLoaded: true })
  }, [activeThreadId, queryClient])
  return { threadsQuery, threads, activeThreadId, activeThread, threadQuery, thread: threadQuery.data?.thread ?? null,
    displayThread: threadQuery.data?.thread ?? activeThread,
    loadEarlier, preserveHistory, loadingEarlier: older.variables === activeThreadId && older.isPending,
    earlierError: older.variables === activeThreadId ? older.error : null, hasMoreBefore: threadQuery.data?.hasMoreBefore ?? false }
}
