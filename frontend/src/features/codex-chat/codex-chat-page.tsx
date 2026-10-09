import { useQuery } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadingState } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import { CHAT_PROFILES_QUERY_KEY, getCodexChatStatus, listChatProfiles, listCodexChatThreads } from '@/lib/api-codex-chat'
import { CODEX_CHAT_THREADS_QUERY_KEY, useCodexChat } from './codex-chat-context'
import { useChatPageRegistration } from './chat-page-context'
import { pageAction, pageChoice, pageObject } from './page-action-helpers'
import { useLeaveCodexChatPage } from './codex-chat-shell'
import { CodexChatView } from './codex-chat-view'

/** /chat: the same chat as the side panel, with room for the thread list and wider results. */
export function CodexChatPage() {
  const { t } = useI18n()
  const chat = useCodexChat()
  const leaveChatPage = useLeaveCodexChatPage()
  const statusQuery = useQuery({ queryKey: ['codex-chat-status'], queryFn: getCodexChatStatus, staleTime: 60_000, retry: false })
  const threadsQuery = useQuery({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY, queryFn: listCodexChatThreads, enabled: Boolean(chat?.canUse) })
  const profilesQuery = useQuery({ queryKey: CHAT_PROFILES_QUERY_KEY, queryFn: listChatProfiles, staleTime: 30_000, enabled: Boolean(chat?.canUse) })
  const threads = (threadsQuery.data ?? []).filter((thread) => !thread.archived).slice(0, 100)
  const profiles = (profilesQuery.data ?? []).filter((profile) => profile.isEnabled !== false)

  // A connected chat opens another chat or prepares a new one with a profile (shown with its greeting, not saved until sent).
  useChatPageRegistration(chat?.canUse ? {
    kind: 'page', title: t({ ko: '채팅', en: 'Chat' }), resourceId: null, priority: 5, fields: [],
    data: {
      openThreadId: chat.selectedThreadId ?? null,
      threads: threads.map((thread) => ({ id: thread.id, title: thread.title, kind: thread.kind, profileId: thread.profile_id ?? null })),
      profiles: profiles.map((profile) => ({ id: profile.id, name: profile.name, tagline: profile.tagline })),
    },
    actions: [
      ...(threads.length ? [pageAction('chat.open', t({ ko: '채팅 열기', en: 'Open chat' }), t({ ko: '목록(data.threads)의 채팅을 열어. 지금 대화 화면이 그 채팅으로 바뀌어.', en: 'Open a listed chat (data.threads); the screen switches to it.' }), pageObject({ threadId: pageChoice(threads.map((thread) => thread.id)) }, ['threadId']))] : []),
      ...(profiles.length ? [pageAction('chat.prepare', t({ ko: '새 채팅 준비', en: 'Prepare new chat' }), t({ ko: '프로필(data.profiles)로 새 채팅 화면을 열어. 인사말만 보이고, 사용자가 첫 메시지를 보내야 저장돼.', en: 'Open a new chat with a listed profile; it shows the greeting and is saved only when the person sends.' }), pageObject({ profileId: pageChoice(profiles.map((profile) => profile.id)) }, ['profileId']))] : []),
    ],
    apply: () => {},
    applyAction: (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'chat.open') { chat.selectThread(Number(args.threadId)); return }
      if (id === 'chat.prepare') { chat.prepareChat(Number(args.profileId)); return }
      throw new Error('채팅 화면에 없는 작업이야.')
    },
  } : null)

  if (statusQuery.isPending) {
    return <LoadingState variant="inline" />
  }

  if (!chat?.canUse) {
    return <EmptyState icon={MessageSquare} title={t({ ko: '채팅을 쓸 수 없어.', en: 'Chat is not available.' })} />
  }

  return (
    <div className="flex h-[calc(100dvh-var(--theme-shell-header-height)-1.5rem-var(--theme-shell-main-padding-bottom))] min-h-0 flex-col">
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
