import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { PostAuthor, PostMentionableProfile, PostSourceChat } from '@conai/shared'
import { AtSign, History, MessageSquare, Reply } from 'lucide-react'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useChatDockedBesidePage } from '@/features/codex-chat/chat-reference'
import { useCodexChat, useCodexChatReference } from '@/features/codex-chat/codex-chat-context'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { BotBadge, PostAuthorAvatar } from './post-author'

/**
 * "채팅에 참조" on a post or comment, as a menu entry: puts it on the docked chat's next message (a chip over the
 * composer), or takes it off again. Only while the chat is docked beside the board, like 참조 on library images.
 */
export function usePostReferenceEntry({ postId, commentId = null, label }: { postId: number; commentId?: number | null; label: string }): ActionMenuEntry {
  const { t } = useI18n()
  const docked = useChatDockedBesidePage()
  const chat = useCodexChatReference()
  if (!docked || !chat) return null
  const active = chat.draftPostRefs.some((item) => item.postId === postId && item.commentId === commentId)
  return {
    key: 'reference', icon: Reply,
    label: active ? t({ ko: '채팅 참조 빼기', en: 'Remove chat reference' }) : t({ ko: '채팅에 참조', en: 'Reference in chat' }),
    onSelect: () => chat.togglePostReference({ postId, commentId, label }),
  }
}

/**
 * An author's face and name. A bot, or a post/comment written from the viewer's own chat, opens a small card on click:
 * chat with the bot, call it in a reply, or go back to the chat reply the text came from.
 */
export function PostAuthorChip({ author, source = null, avatarSize = 'md', showAvatar = true, onMention, className }: {
  author: PostAuthor
  source?: PostSourceChat | null
  avatarSize?: 'xs' | 'sm' | 'md'
  showAvatar?: boolean
  /** Reply calling this bot (comments only). */
  onMention?: () => void
  className?: string
}) {
  const { t } = useI18n()
  const chat = useCodexChat()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const bot = author.type === 'profile' && author.profileId !== null
  const canChat = Boolean(chat?.canUse)
  const fromChat = Boolean(source && canChat)
  const name = <span className="truncate font-medium text-foreground">{author.name}</span>
  const face = showAvatar ? <PostAuthorAvatar author={author} size={avatarSize} /> : null
  if (!bot && !fromChat) {
    return <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>{face}{name}</span>
  }
  const tagline = bot ? queryClient.getQueryData<PostMentionableProfile[]>(['post-mentionable'])?.find((profile) => profile.id === author.profileId)?.tagline : null
  const act = (run: () => void) => () => { setOpen(false); run() }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className={cn('h-auto min-w-0 justify-start gap-1.5 rounded-sm p-0 text-sm font-normal hover:bg-transparent hover:underline', className)}>
          {face}{name}{bot ? <BotBadge /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="flex items-center gap-2.5 px-1.5 pt-1 pb-2">
          <PostAuthorAvatar author={author} size="lg" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">{author.name}</span>
            {tagline ? <span className="truncate text-xs text-muted-foreground">{tagline}</span> : null}
          </div>
        </div>
        <div className="flex flex-col border-t border-line pt-1">
          {bot && canChat ? <MenuButton icon={MessageSquare} onClick={act(() => { chat?.openPanel(); chat?.prepareChat(author.profileId as number) })}>{t({ ko: '이 봇과 채팅', en: 'Chat with this bot' })}</MenuButton> : null}
          {bot && onMention ? <MenuButton icon={AtSign} onClick={act(onMention)}>{t({ ko: '@{name} 불러서 답글', en: 'Reply calling @{name}' }, { name: author.name })}</MenuButton> : null}
          {fromChat && source ? <MenuButton icon={History} onClick={act(() => {
            chat?.openPanel()
            chat?.selectThread(source.threadId)
            if (source.messageId !== null) chat?.focusMessage(source.messageId)
          })}>{t({ ko: '이 글을 쓴 채팅으로', en: 'Go to the chat it came from' })}</MenuButton> : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function MenuButton({ icon: Icon, onClick, children }: { icon: typeof MessageSquare; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" className="h-8 justify-start gap-2 px-2 font-normal" onClick={onClick}>
      <Icon className="text-muted-foreground" />{children}
    </Button>
  )
}
