import { buildChatImageRecord } from './chat-image-record'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImageIcon, Reply } from 'lucide-react'
import { useMediaHoverPreview } from '@/components/common/media-hover-preview'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { useI18n } from '@/i18n'
import { getCodexChatThreadMedia, type ChatMediaAttachment, type CodexChatMediaItem } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { codexChatMediaQueryKey, useCodexChatReference } from './codex-chat-context'

/**
 * "참조": attach a library image seen in the chat to the next message (it goes along as an app-media attachment, the
 * same thing the paperclip's "앱 미디어에서 고르기" produces). Pressed while it is in the draft; pressing again detaches.
 */
export function useChatReference(compositeHash: string | null | undefined, mimeType: string | null) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const chat = useCodexChatReference()
  const active = Boolean(compositeHash) && (chat?.draftMediaAttachments.some((item) => item.compositeHash === compositeHash) ?? false)
  const toggle = useCallback(() => {
    if (!canViewImages || !chat || !compositeHash) return
    chat.toggleMediaAttachment({ compositeHash, name: t({ ko: '참조 이미지', en: 'Referenced image' }), mimeType })
  }, [canViewImages, chat, compositeHash, mimeType, t])
  return { available: canViewImages && chat !== null && Boolean(compositeHash), active, toggle }
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

const LONG_PRESS_DELAY_MS = 450
const LONG_PRESS_MOVE_TOLERANCE_PX = 10
/** The click a browser fires after lifting a long-pressed finger must not also open the lightbox. */
const LONG_PRESS_CLICK_SUPPRESS_MS = 450

/**
 * Hover (or keyboard focus) on a thumbnail slides its actions in over the image's corner; nothing shows at rest so
 * the picture stays clean. Touch has no hover: a still finger held on the thumbnail pins the actions in place (same
 * rules as long-press selection in the image list) until a tap elsewhere or a scroll; the lightbox toolbar has them too.
 */
export function ChatThumbOverlay({ children, actions, className }: { children: ReactNode; actions: ReactNode; className?: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [pinned, setPinned] = useState(false)
  const pressRef = useRef<{ pointerId: number; x: number; y: number; timer: number } | null>(null)
  const suppressClickUntilRef = useRef(0)

  const cancelPress = useCallback(() => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer)
      pressRef.current = null
    }
  }, [])

  const pin = useCallback(() => {
    cancelPress()
    suppressClickUntilRef.current = Number.POSITIVE_INFINITY
    navigator.vibrate?.(12)
    setPinned(true)
  }, [cancelPress])

  useEffect(() => cancelPress, [cancelPress])

  useEffect(() => {
    if (!pinned) return
    const unpin = () => setPinned(false)
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (root && event.target instanceof Node && root.contains(event.target)) return
      unpin()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', unpin, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', unpin, true)
    }
  }, [pinned])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    cancelPress()
    if (event.pointerType !== 'touch' || !event.isPrimary) return
    pressRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: window.setTimeout(pin, LONG_PRESS_DELAY_MS) }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current
    if (press && press.pointerId === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_MOVE_TOLERANCE_PX) {
      cancelPress()
    }
  }
  // Lifting (or the browser taking the gesture for a scroll) ends the press; after a fired one the ghost click is eaten.
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pressRef.current?.pointerId === event.pointerId) cancelPress()
    if (suppressClickUntilRef.current === Number.POSITIVE_INFINITY) suppressClickUntilRef.current = performance.now() + LONG_PRESS_CLICK_SUPPRESS_MS
  }
  // Android raises the context menu around the same delay; treat it as the long-press itself.
  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!pressRef.current && !pinned) return
    event.preventDefault()
    if (pressRef.current) pin()
  }
  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (performance.now() >= suppressClickUntilRef.current) return
    suppressClickUntilRef.current = 0
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      ref={rootRef}
      className={cn('group/thumb relative select-none [-webkit-touch-callout:none]', className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={onContextMenu}
      onClickCapture={onClickCapture}
    >
      {children}
      <div className={cn(
        'pointer-events-none absolute right-1 top-1 flex translate-y-1 scale-95 gap-1 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover/thumb:pointer-events-auto group-hover/thumb:translate-y-0 group-hover/thumb:scale-100 group-hover/thumb:opacity-100 group-focus-within/thumb:pointer-events-auto group-focus-within/thumb:translate-y-0 group-focus-within/thumb:scale-100 group-focus-within/thumb:opacity-100 motion-reduce:transition-none',
        pinned && 'pointer-events-auto translate-y-0 scale-100 opacity-100',
      )}>
        {actions}
      </div>
    </div>
  )
}

function ChatReferenceChip({ item, sourceMessageId, media }: { item: ChatMediaAttachment; sourceMessageId: number | undefined; media?: CodexChatMediaItem }) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const chat = useCodexChatReference()
  const viewer = useImageViewModal()
  const isVideo = item.mimeType?.startsWith('video/') === true
  const image = buildChatImageRecord(item.compositeHash, undefined, media)
  const thumbnailUrl = image.thumbnail_url ?? ''
  const fileUrl = image.image_url ?? ''
  const hoverPreview = useMediaHoverPreview(canViewImages ? { src: thumbnailUrl, fullSrc: isVideo ? null : fileUrl, videoSrc: isVideo ? fileUrl : null, caption: item.name } : null)
  const canJump = sourceMessageId !== undefined && chat !== null
  const open = () => {
    if (canJump) chat.focusMessage(sourceMessageId)
    else if (canViewImages) viewer?.openImageView({ compositeHash: item.compositeHash, sourceItems: [image] })
  }
  return (
    <>
      <Button
        variant="subtle"
        size="sm"
        className="gap-1.5"
        title={canJump ? t({ ko: '이 이미지가 나온 메시지로 이동', en: 'Go to the message with this image' }) : item.name}
        disabled={!canJump && (!canViewImages || !viewer)}
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
  const { canViewImages } = useImagePermissions()
  const mediaQuery = useQuery({
    queryKey: codexChatMediaQueryKey(threadId),
    queryFn: () => getCodexChatThreadMedia(threadId as number),
    enabled: canViewImages && threadId !== null && items.length > 0,
    staleTime: 30_000,
  })
  if (!items.length) return null
  const messageIdByHash = new Map((mediaQuery.data ?? []).map((media) => [media.compositeHash, media.messageId]))
  return (
    <div className="mt-1 flex flex-wrap justify-end gap-1">
      {items.map((item) => <ChatReferenceChip key={item.compositeHash} item={item} sourceMessageId={messageIdByHash.get(item.compositeHash)} media={mediaQuery.data?.find((media) => media.compositeHash === item.compositeHash)} />)}
    </div>
  )
}
