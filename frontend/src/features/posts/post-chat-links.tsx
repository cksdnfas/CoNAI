import type { PostSourceChat } from '@conai/shared'
import { MessageSquare, Reply } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { useChatDockedBesidePage } from '@/features/codex-chat/chat-reference'
import { useCodexChat, useCodexChatReference } from '@/features/codex-chat/codex-chat-context'
import { useI18n } from '@/i18n'

/**
 * "참조" on a post or comment: puts it on the docked chat's next message (a chip over the composer), or takes it off
 * again. Only while the chat is docked beside the board, like 참조 on library images.
 */
export function PostReferenceButton({ postId, commentId = null, label, size = 'icon-sm' }: { postId: number; commentId?: number | null; label: string; size?: 'icon-sm' | 'icon-xs' }) {
  const { t } = useI18n()
  const docked = useChatDockedBesidePage()
  const chat = useCodexChatReference()
  if (!docked || !chat) return null
  const active = chat.draftPostRefs.some((item) => item.postId === postId && item.commentId === commentId)
  return (
    <IconButton
      variant="ghost"
      size={size}
      active={active}
      label={active ? t({ ko: '참조 빼기', en: 'Remove reference' }) : t({ ko: '채팅에 참조', en: 'Reference in chat' })}
      onClick={() => chat.togglePostReference({ postId, commentId, label })}
    >
      <Reply />
    </IconButton>
  )
}

/** Back to the chat reply a post or comment was written from (shown to that chat's owner only). */
export function SourceChatLink({ source, compact = false }: { source: PostSourceChat | null; compact?: boolean }) {
  const { t } = useI18n()
  const chat = useCodexChat()
  if (!source || !chat?.canUse) return null
  const open = () => {
    chat.openPanel()
    chat.selectThread(source.threadId)
    if (source.messageId !== null) chat.focusMessage(source.messageId)
  }
  const label = t({ ko: '채팅에서 씀', en: 'Written in chat' })
  if (compact) return <IconButton variant="ghost" size="icon-xs" label={label} onClick={open}><MessageSquare /></IconButton>
  return (
    <Button variant="ghost" size="xs" className="h-6 gap-1 px-1.5 font-normal text-muted-foreground" onClick={open}>
      <MessageSquare className="size-3.5" aria-hidden />{label}
    </Button>
  )
}
