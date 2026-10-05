import { useCallback, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImageIcon, Reply } from 'lucide-react'
import { useMediaHoverPreview } from '@/components/common/media-hover-preview'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { useI18n } from '@/i18n'
import { getCodexChatThreadMedia, type ChatMediaAttachment } from '@/lib/api-codex-chat'
import { buildApiUrl } from '@/lib/api-url'
import { cn } from '@/lib/utils'
import { codexChatMediaQueryKey, useCodexChatReference } from './codex-chat-context'

/**
 * "참조": attach a library image seen in the chat to the next message (it goes along as an app-media attachment, the
 * same thing the paperclip's "앱 미디어에서 고르기" produces). Pressed while it is in the draft; pressing again detaches.
 */
export function useChatReference(compositeHash: string | null | undefined, mimeType: string | null) {
  const { t } = useI18n()
  const chat = useCodexChatReference()
  const active = Boolean(compositeHash) && (chat?.draftMediaAttachments.some((item) => item.compositeHash === compositeHash) ?? false)
  const toggle = useCallback(() => {
    if (!chat || !compositeHash) return
    chat.toggleMediaAttachment({ compositeHash, name: t({ ko: '참조 이미지', en: 'Referenced image' }), mimeType })
  }, [chat, compositeHash, mimeType, t])
  return { available: chat !== null && Boolean(compositeHash), active, toggle }
}

export function ChatReferenceButton({ compositeHash, mimeType, size = 'icon-sm', className }: {
  compositeHash: string | null | undefined; mimeType: string | null; size?: 'icon' | 'icon-sm' | 'icon-xs'; className?: string
}) {
  const { t } = useI18n()
  const reference = useChatReference(compositeHash, mimeType)
  if (!reference.available) return null
  return (
    <IconButton
      variant="overlay"
      size={size}
      className={className}
      active={reference.active}
      label={reference.active ? t({ ko: '참조 빼기', en: 'Remove reference' }) : t({ ko: '다음 메시지에 참조', en: 'Reference in next message' })}
      onClick={(event) => { event.stopPropagation(); reference.toggle() }}
    >
      <Reply />
    </IconButton>
  )
}

/**
 * Hover (or keyboard focus) on a thumbnail slides its actions in over the image's corner; nothing shows at rest so
 * the picture stays clean. Touch has no hover: the same actions sit in the lightbox toolbar.
 */
export function ChatThumbOverlay({ children, actions, className }: { children: ReactNode; actions: ReactNode; className?: string }) {
  return (
    <div className={cn('group/thumb relative', className)}>
      {children}
      <div className="pointer-events-none absolute right-1 top-1 flex translate-y-1 scale-95 gap-1 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover/thumb:pointer-events-auto group-hover/thumb:translate-y-0 group-hover/thumb:scale-100 group-hover/thumb:opacity-100 group-focus-within/thumb:pointer-events-auto group-focus-within/thumb:translate-y-0 group-focus-within/thumb:scale-100 group-focus-within/thumb:opacity-100 motion-reduce:transition-none">
        {actions}
      </div>
    </div>
  )
}

function ChatReferenceChip({ item, sourceMessageId }: { item: ChatMediaAttachment; sourceMessageId: number | undefined }) {
  const { t } = useI18n()
  const chat = useCodexChatReference()
  const viewer = useImageViewModal()
  const isVideo = item.mimeType?.startsWith('video/') === true
  const thumbnailUrl = buildApiUrl(`/api/images/${encodeURIComponent(item.compositeHash)}/thumbnail`)
  const fileUrl = buildApiUrl(`/api/images/${encodeURIComponent(item.compositeHash)}/file`)
  const hoverPreview = useMediaHoverPreview({ src: thumbnailUrl, fullSrc: isVideo ? null : fileUrl, videoSrc: isVideo ? fileUrl : null, caption: item.name })
  const canJump = sourceMessageId !== undefined && chat !== null
  const open = () => {
    if (canJump) chat.focusMessage(sourceMessageId)
    else viewer?.openImageView({ compositeHash: item.compositeHash, sourceItems: [] })
  }
  return (
    <>
      <Button
        variant="subtle"
        size="sm"
        className="gap-1.5"
        title={canJump ? t({ ko: '이 이미지가 나온 메시지로 이동', en: 'Go to the message with this image' }) : item.name}
        disabled={!canJump && !viewer}
        onClick={open}
        {...hoverPreview.triggerProps}
      >
        <ImageIcon className="size-3.5 shrink-0" />
        {t({ ko: '참조 이미지', en: 'Referenced image' })}
      </Button>
      {hoverPreview.preview}
    </>
  )
}

/**
 * App media sent with a message, as labels only (the pictures already sit in the transcript): clicking one jumps to
 * the reply the image first appeared in, or opens the image when it was picked from the library; hovering shows it.
 */
export function ChatReferenceChips({ items = [], threadId }: { items?: ChatMediaAttachment[]; threadId: number | null }) {
  const mediaQuery = useQuery({
    queryKey: codexChatMediaQueryKey(threadId),
    queryFn: () => getCodexChatThreadMedia(threadId as number),
    enabled: threadId !== null && items.length > 0,
    staleTime: 30_000,
  })
  if (!items.length) return null
  const messageIdByHash = new Map((mediaQuery.data ?? []).map((media) => [media.compositeHash, media.messageId]))
  return (
    <div className="mt-1 flex flex-wrap justify-end gap-1">
      {items.map((item) => <ChatReferenceChip key={item.compositeHash} item={item} sourceMessageId={messageIdByHash.get(item.compositeHash)} />)}
    </div>
  )
}
