import type { QueryClient, QueryFilters, QueryKey } from '@tanstack/react-query'
import { getCodexChatThread, mergeThreadBefore, mergeThreadTail, type CodexChatThread, type CodexChatThreadDetail } from '@/lib/api-codex-chat'
import { CODEX_CHAT_THREADS_QUERY_KEY, codexChatThreadQueryKey } from './codex-chat-context'

/**
 * A settings change answers with the thread row alone: lay it over the open chat instead of re-reading its transcript.
 * Settings do not move `context_revision`, so a read sent before the save would put the old row back when it lands:
 * such a read is replaced by a full stale-marked read (which also hands over its waiters and any message changes).
 */
export async function applyChatThreadUpdate(queryClient: QueryClient, thread: CodexChatThread) {
  const queryKey = codexChatThreadQueryKey(thread.id)
  const interrupted = queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching'
  queryClient.setQueryData<CodexChatThreadDetail>(queryKey, (current) => current ? { ...current, thread } : current)
  if (interrupted) void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'active' })
}

/** Merge a mutation's bounded detail, refreshing the loaded range if another rewrite preceded a reply edit. */
export async function applyChatThreadDetail(queryClient: QueryClient, detail: CodexChatThreadDetail) {
  const queryKey = codexChatThreadQueryKey(detail.thread.id)
  const interrupted = queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching'
  let firstToRestore: number | undefined
  let stale = false
  queryClient.setQueryData<CodexChatThreadDetail>(queryKey, (current) => {
    if (!current) return detail
    if (current.thread.context_revision > detail.thread.context_revision) {
      stale = true
      return current
    }
    const merged = mergeThreadTail(current, detail)
    if (merged) return merged
    if (current.thread.context_revision === detail.thread.context_revision
      && (current.messageCount ?? current.messages.length) > (detail.messageCount ?? detail.messages.length)) {
      stale = true
      return current
    }
    if (detail.changedMessage && current.messages.some((message) => message.id === detail.changedMessage?.id)) {
      firstToRestore = current.messages[0]?.id
    }
    return detail
  })
  if (interrupted || stale) void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'active' })
  while (firstToRestore !== undefined) {
    const current = queryClient.getQueryData<CodexChatThreadDetail>(queryKey)
    const before = current?.messages[0]?.id
    if (!current || current.thread.context_revision !== detail.thread.context_revision
      || !current.hasMoreBefore || before === undefined || before <= firstToRestore) break
    let page: CodexChatThreadDetail
    try {
      page = await getCodexChatThread(detail.thread.id, 80, before)
    } catch {
      // The write already landed: re-read the chat rather than leaving a partly restored range.
      void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'active' })
      break
    }
    let applied = false
    queryClient.setQueryData<CodexChatThreadDetail>(queryKey, (latest) => {
      const merged = latest ? mergeThreadBefore(latest, page, before) : null
      if (!merged) return latest
      applied = true
      return merged
    })
    if (!applied) {
      const latest = queryClient.getQueryData<CodexChatThreadDetail>(queryKey)
      if (latest?.thread.context_revision === detail.thread.context_revision && (latest.messages[0]?.id ?? before) < before) continue
      void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'active' })
      break
    }
  }
}

/** If the cache changed while a mutation was in flight, read its tail after the write before merging it. */
export async function runChatThreadDetailMutation(queryClient: QueryClient, threadId: number, mutate: () => Promise<CodexChatThreadDetail>) {
  const queryKey = codexChatThreadQueryKey(threadId)
  const before = queryClient.getQueryData<CodexChatThreadDetail>(queryKey)
  let detail = await mutate()
  const after = queryClient.getQueryData<CodexChatThreadDetail>(queryKey)
  if (after !== before) {
    try {
      const changed = detail.changedMessage
      const previousContextRevision = detail.previousContextRevision
      const fresh = await getCodexChatThread(threadId, 80)
      if (changed) {
        const page = fresh.messages.some((message) => message.id === changed.id)
          ? fresh : await getCodexChatThread(threadId, 1, changed.id + 1)
        const sameRevision = page.thread.context_revision === fresh.thread.context_revision
          && detail.thread.context_revision === fresh.thread.context_revision
        detail = { ...fresh, changedMessage: page.messages.find((message) => message.id === changed.id) ?? changed,
          previousContextRevision: sameRevision ? previousContextRevision : undefined, media: { ...page.media, ...fresh.media } }
      } else {
        detail = fresh
      }
    } catch {
      // The write succeeded; a failed follow-up read must not report it as failed. Re-read the chat instead.
      void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'active' })
      return detail
    }
    if (queryClient.getQueryData(queryKey) !== after) void refetchActiveChatQuery(queryClient, queryKey)
  }
  await applyChatThreadDetail(queryClient, detail)
  return detail
}

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
