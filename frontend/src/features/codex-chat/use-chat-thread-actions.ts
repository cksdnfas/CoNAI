import { useLayoutEffect, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { threadLorebooksQueryKey, updateChatListState, type CodexChatThread, type CodexChatThreadDetail } from '@/lib/api-codex-chat'
import { codexChatMediaQueryKey, codexChatThreadQueryKey, type CodexChatApi } from './codex-chat-context'
import type { ChatListPatch } from './chat-thread-list'
import { applyChatThreadUpdate, refetchActiveChatQuery, scheduleChatDirectoryRefresh } from './chat-query-refresh'
import { patchChatRoomLists } from './use-chat-room-directory'

/** Both the list buttons and page assistant update the header's detail cache as well as the directory. */
export async function updateChatListEntry(queryClient: QueryClient, threadId: number, patch: ChatListPatch) {
  const apply = (entry: CodexChatThread) => ({
    ...entry,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.pinned !== undefined ? { pinned: patch.pinned ? 1 as const : 0 as const } : {}),
    ...(patch.archived !== undefined ? { archived: patch.archived ? 1 as const : 0 as const } : {}),
    ...(patch.notify !== undefined ? { notify_enabled: patch.notify } : {}),
  })
  patchChatRoomLists(queryClient, threadId, apply({ id: threadId } as CodexChatThread))
  queryClient.setQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(threadId), current => current ? { ...current, thread: apply(current.thread) } : current)
  try {
    const thread = await updateChatListState(threadId, patch)
    patchChatRoomLists(queryClient, threadId, thread)
    await applyChatThreadUpdate(queryClient, thread)
  } catch (error) {
    void refetchActiveChatQuery(queryClient, codexChatThreadQueryKey(threadId))
    throw error
  } finally {
    void scheduleChatDirectoryRefresh(queryClient)
  }
}

export function useChatThreadActions(chat: CodexChatApi | null) {
  const queryClient = useQueryClient()
  const current = useRef(chat)
  useLayoutEffect(() => { current.current = chat })
  const dropThread = (threadId: number) => {
    void queryClient.cancelQueries({ queryKey: codexChatThreadQueryKey(threadId) })
    patchChatRoomLists(queryClient, threadId, null)
    queryClient.removeQueries({ queryKey: codexChatThreadQueryKey(threadId) })
    queryClient.removeQueries({ queryKey: codexChatMediaQueryKey(threadId) })
    queryClient.removeQueries({ queryKey: threadLorebooksQueryKey(threadId) })
    const live = current.current
    live?.keepDrafts(Object.keys(live.currentDrafts()).map(Number).filter(id => id !== threadId))
  }
  const forgetThread = (threadId: number) => {
    dropThread(threadId)
    const live = current.current
    if (live?.selectedThreadId === threadId) { live.selectThread(undefined); live.setListOpen(true) }
  }
  return { dropThread, forgetThread, updateListEntry: (threadId: number, patch: ChatListPatch) => updateChatListEntry(queryClient, threadId, patch) }
}
