import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadingState } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import { CHAT_PROFILES_QUERY_KEY, deleteCodexChatThread, getCodexChatStatus, getCodexChatThreadSummaries, listChatProfiles } from '@/lib/api-codex-chat'
import { CODEX_CHAT_THREADS_QUERY_KEY, useCodexChat } from './codex-chat-context'
import { activeChatRoomOptions, useChatRoomPages } from './use-chat-room-directory'
import { useChatThreadActions } from './use-chat-thread-actions'
import { useChatPageRegistration } from './chat-page-context'
import { pageAction, pageChoice, pageNumber, pageObject, pageText } from './page-action-helpers'
import { useLeaveCodexChatPage } from './codex-chat-shell'
import { CodexChatView } from './codex-chat-view'

/** /chat: the same chat as the side panel, with room for the thread list and wider results. */
export function CodexChatPage() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const chat = useCodexChat()
  const { updateListEntry, forgetThread } = useChatThreadActions(chat)
  const leaveChatPage = useLeaveCodexChatPage()
  const statusQuery = useQuery({ queryKey: ['codex-chat-status'], queryFn: getCodexChatStatus, staleTime: 60_000, retry: false })
  // The chat list's own cache: the page adds no directory read of its own.
  const threadsQuery = useChatRoomPages(activeChatRoomOptions(''), Boolean(chat?.canUse))
  const profilesQuery = useQuery({ queryKey: CHAT_PROFILES_QUERY_KEY, queryFn: listChatProfiles, staleTime: 30_000, enabled: Boolean(chat?.canUse) })
  const threads = threadsQuery.rooms
  const profiles = (profilesQuery.data ?? []).filter((profile) => profile.isEnabled !== false)

  // A connected chat opens another chat or prepares a new one with a profile (shown with its greeting, not saved until sent).
  useChatPageRegistration(chat?.canUse ? {
    kind: 'page', title: t({ ko: '채팅', en: 'Chat' }), resourceId: null, priority: 5, fields: [],
    data: {
      openThreadId: chat.selectedThreadId ?? null,
      roomsLoaded: threadsQuery.rooms.length,
      roomsTotal: threadsQuery.total ?? 0,
      roomsHaveMore: threadsQuery.hasNextPage,
      threads: threads.map((thread) => ({ id: thread.id, title: thread.title, kind: thread.kind, profileId: thread.profile_id ?? null, pinned: !!thread.pinned, archived: !!thread.archived })),
      profiles: profiles.map((profile) => ({ id: profile.id, name: profile.name, tagline: profile.tagline })),
    },
    actions: [
      pageAction('chat.open', t({ ko: '채팅 열기', en: 'Open chat' }), t({ ko: 'threadId로 내 채팅을 열어. data.threads는 채팅 목록에 불러온 방이고(roomsHaveMore면 더 있어), 그 밖의 방은 list_chat_rooms로 검색할 수 있어. 서버가 현재 계정의 방인지 확인해.', en: 'Open an owned chat by threadId. data.threads lists the rooms loaded in the chat list (more exist when roomsHaveMore); use list_chat_rooms to find others. The server checks this account owns the room.' }), pageObject({ threadId: pageNumber(1, Number.MAX_SAFE_INTEGER, true) }, ['threadId'])),
      ...(profiles.length ? [pageAction('chat.prepare', t({ ko: '새 채팅 준비', en: 'Prepare new chat' }), t({ ko: '프로필(data.profiles)로 새 채팅 화면을 열어. 인사말만 보이고, 사용자가 첫 메시지를 보내야 저장돼.', en: 'Open a new chat with a listed profile; it shows the greeting and is saved only when the person sends.' }), pageObject({ profileId: pageChoice(profiles.map((profile) => profile.id)) }, ['profileId']))] : []),
      pageAction('chat.rename', t({ ko: '채팅 이름 변경', en: 'Rename chat' }), '', pageObject({ threadId: pageNumber(1, undefined, true), title: pageText(200) }, ['threadId', 'title']), 'save'),
      pageAction('chat.pin', t({ ko: '채팅 고정', en: 'Pin chat' }), '', pageObject({ threadId: pageNumber(1, undefined, true), pinned: { type: 'boolean' } }, ['threadId', 'pinned']), 'save'),
      pageAction('chat.archive', t({ ko: '채팅 보관', en: 'Archive chat' }), '', pageObject({ threadId: pageNumber(1, undefined, true), archived: { type: 'boolean' } }, ['threadId', 'archived']), 'save'),
      { ...pageAction('chat.delete', t({ ko: '채팅 삭제', en: 'Delete chat' }), t({ ko: '목록의 채팅을 고르고 로어북도 삭제할지 보존할지 선택해.', en: 'Choose a listed chat and whether to delete or keep its lorebook.' }), pageObject({ threadId: pageNumber(1, undefined, true), lorebook: pageChoice(['delete', 'keep']) }, ['threadId', 'lorebook']), 'save'), targets: [{ argument: 'threadId', collection: 'threads', id: 'id', keys: ['title', 'kind', 'profileId'] }] },
    ],
    apply: () => {},
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'chat.open') {
        const threadId = Number(args.threadId)
        const [room] = await getCodexChatThreadSummaries([threadId])
        assertCurrent()
        if (!room) throw new Error(t({ ko: '이 계정의 채팅을 찾을 수 없어.', en: 'Could not find this account’s chat.' }))
        chat.selectThread(room.id)
        return
      }
      if (id === 'chat.prepare') { chat.prepareChat(Number(args.profileId)); return }
      if (id === 'chat.rename' || id === 'chat.pin' || id === 'chat.archive') {
        const threadId = Number(args.threadId)
        const title = String(args.title ?? '').replace(/\s+/g, ' ').trim()
        if (id === 'chat.rename' && !title) throw new Error('채팅 이름이 필요해.')
        const patch = id === 'chat.rename' ? { title } : id === 'chat.pin' ? { pinned: args.pinned === true } : { archived: args.archived === true }
        await updateListEntry(threadId, patch)
        return
      }
      if (id === 'chat.delete') {
        const threadId = Number(args.threadId)
        await deleteCodexChatThread(threadId, { action: args.lorebook === 'keep' ? 'keep' : 'delete' })
        forgetThread(threadId)
        await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
        return
      }
      throw new Error('채팅 화면에 없는 작업이야.')
    },
  } : null)

  if (statusQuery.isPending) {
    return <LoadingState variant="inline" />
  }

  if (!chat?.canUse) {
    return <EmptyState icon={MessageSquare} title={t({ ko: '채팅을 쓸 수 없어', en: 'Chat is not available' })} />
  }

  return (
    // Same edges as PageWithSidebar: the thread column runs to the shell's sides and bottom; the view puts the bottom
    // padding back under the chat.
    <div className="page-bleed flex h-(--shell-content-height) min-h-0 flex-col">
      <CodexChatView
        layout="page"
        onCollapse={() => {
          chat.openPanel()
          leaveChatPage()
        }}
      />
    </div>
  )
}
