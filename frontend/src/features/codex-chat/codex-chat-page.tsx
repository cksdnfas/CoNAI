import { useQuery } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadingState } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import { getCodexChatStatus } from '@/lib/api-codex-chat'
import { useCodexChat } from './codex-chat-context'
import { useLeaveCodexChatPage } from './codex-chat-shell'
import { CodexChatView } from './codex-chat-view'

/** /chat: the same chat as the side panel, with room for the thread list and wider results. */
export function CodexChatPage() {
  const { t } = useI18n()
  const chat = useCodexChat()
  const leaveChatPage = useLeaveCodexChatPage()
  const statusQuery = useQuery({ queryKey: ['codex-chat-status'], queryFn: getCodexChatStatus, staleTime: 60_000, retry: false })

  if (statusQuery.isPending) {
    return <LoadingState variant="inline" />
  }

  if (!chat?.canUse) {
    return <EmptyState icon={MessageSquare} title={t({ ko: 'Codex 채팅을 쓸 수 없어.', en: 'Codex chat is not available.' })} />
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
