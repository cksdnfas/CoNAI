import { memo, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useContext, useEffect, useState } from 'react'
import { ActionContextMenu, ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { HistoryAudioResult, HistorySoundBar } from '@/features/audio/history-audio-result'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { ImagePreviewPlaceholder } from '@/features/images/components/image-preview-placeholder'
import { getImagePreviewStateLabel, resolveImagePreviewState } from '@/features/images/components/image-preview-state'
import { ImageEditAction } from '@/features/images/components/detail/image-edit-action'
import { ChatDockReferenceButton, ChatImageListActionsContext, ChatThumbOverlay } from '@/features/codex-chat/chat-reference'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import type { ImageListActivateModifiers } from './image-list-types'
import { ImageListVideoPreview } from './image-list-video-preview'
import {
  getImageListDisplayName,
  getImageListItemId,
  getImageListMediaKind,
  getImageListPreviewUrl,
} from './image-list-utils'

interface ImageListItemProps {
  image: ImageRecord
  href?: string
  selected?: boolean
  selectionMode?: boolean
  gridItemHeight?: number
  gridItemAspectRatio?: string
  itemId?: string
  onActivate?: (image: ImageRecord, itemId: string, href?: string, modifiers?: ImageListActivateModifiers) => void
  /** Space toggles selection through `onToggleSelect`. */
  selectable?: boolean
  onToggleSelect?: (image: ImageRecord, itemId: string, modifiers?: ImageListActivateModifiers) => void
  renderOverlay?: ReactNode
  renderPersistentOverlay?: ReactNode
  /** Tile action menu: mouse right-click at the pointer, a ⋯ button on touch. */
  menuEntries?: ActionMenuEntry[]
  showDefaultQuickActions?: boolean
  interactive?: boolean
  blurPreview?: boolean
  onPreviewIntent?: (image: ImageRecord) => void
}

/** Prevent native media dragging so drag gestures can be used for selection. */
function preventNativeDrag(event: DragEvent<HTMLElement>) {
  event.preventDefault()
}

/** Same, except for a tile the list armed for drag-out (see useImageListDragOut). */
function preventUnarmedTileDrag(event: DragEvent<HTMLElement>) {
  if (event.currentTarget.dataset.dragArmed === 'true') {
    return
  }
  event.preventDefault()
}

/** Render a reusable image list cell that supports image, GIF, and video previews. */
const ImageListItemComponent = memo(function ImageListItemComponent({
  image,
  href,
  selected = false,
  selectionMode = false,
  gridItemHeight,
  gridItemAspectRatio,
  itemId,
  onActivate,
  selectable = false,
  onToggleSelect,
  renderOverlay,
  renderPersistentOverlay,
  menuEntries,
  showDefaultQuickActions = true,
  interactive = true,
  blurPreview = false,
  onPreviewIntent,
}: ImageListItemProps) {
  const { t } = useI18n()
  const chatActions = useContext(ChatImageListActionsContext)
  const previewUrl = getImageListPreviewUrl(image)
  const imageId = itemId ?? getImageListItemId(image)
  const displayName = getImageListDisplayName(image)
  const [hasPreviewError, setHasPreviewError] = useState(false)
  // Mount the query-backed edit action lazily so idle cells skip its per-cell query observers.
  const [hasRevealedQuickActions, setHasRevealedQuickActions] = useState(false)
  const mediaKind = getImageListMediaKind(image)
  const aspectRatio = image.width && image.height ? `${image.width} / ${image.height}` : undefined
  const mediaFrameStyle = gridItemHeight
    ? { height: gridItemHeight }
    : gridItemAspectRatio
      ? { aspectRatio: gridItemAspectRatio }
      : aspectRatio
        ? { aspectRatio }
        : { aspectRatio: '4 / 5', minHeight: 240 }

  useEffect(() => {
    setHasPreviewError(false)
  }, [previewUrl, image.is_processing, image.preview_status, image.file_status, image.width, image.height, image.composite_hash, image.original_file_path])

  const previewState = resolveImagePreviewState({
    image,
    hasPreviewUrl: Boolean(previewUrl),
    hasPreviewError,
  })
  const placeholderLabel = image.refmod_name ? t({ ko: 'RefMod 저장: {name}', en: 'RefMod saved: {name}' }, { name: image.refmod_name }) : getImagePreviewStateLabel(previewState, t('images.components.image.preview.state.no.preview'), {
    empty: t('images.components.image.preview.state.no.preview'),
    processing: t('images.components.image.preview.state.active'),
    failed: t('images.components.image.preview.state.failed'),
    unavailable: t('images.components.image.preview.state.unavailable'),
  })

  const content = mediaKind === 'audio' && image.audio ? (
    // A run that made sounds instead of a picture: play them in place.
    <HistoryAudioResult sounds={image.audio} style={gridItemHeight || gridItemAspectRatio ? mediaFrameStyle : undefined} className="h-full" />
  ) : previewUrl && !hasPreviewError ? (
    mediaKind === 'video' ? (
      // 호버 딤은 포스터·영상 레이어가 아니라 묶음에 한 번 건다. 레이어마다 걸면 group-hover 가 숨긴 포스터의
      // opacity-0 보다 우선해서, 정지 포스터가 재생 중인 영상 위에 반투명하게 겹친다.
      <div className="transition-opacity duration-150 group-hover:opacity-85">
        {/* key: 가상화 레이아웃이 컴포넌트 인스턴스를 다른 미디어에 재활용해도 <video> DOM 이
            함께 재활용되어 이전 프레임이 남는 일이 없도록, 미디어 identity 로 서브트리를 교체한다. */}
        <ImageListVideoPreview
          key={imageId}
          image={image}
          className="h-full w-full object-cover"
          style={mediaFrameStyle}
          draggable={false}
          onDragStart={preventNativeDrag}
          onError={() => setHasPreviewError(true)}
          suspendPlayback={blurPreview}
        />
      </div>
    ) : (
      <ImagePreviewMedia
        image={image}
        alt={displayName}
        className="h-full w-full object-cover transition-opacity duration-150 group-hover:opacity-85"
        style={mediaFrameStyle}
        loading="lazy"
        draggable={false}
        onDragStart={preventNativeDrag}
        onError={() => setHasPreviewError(true)}
      />
    )
  ) : (
    <ImagePreviewPlaceholder
      label={placeholderLabel}
      className="text-sm"
      iconClassName="h-10 w-10"
      labelClassName="text-sm"
      style={mediaFrameStyle}
    />
  )

  // A run that made a picture and sounds: the sounds play from a bar over the picture.
  const soundBar = mediaKind !== 'audio' && image.audio?.length ? <HistorySoundBar sounds={image.audio} floating /> : null

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only keys on the tile itself: a focused quick action / menu button, or a modal it opened (keys bubble here
    // through React), handles its own Enter and Space.
    if (!interactive || event.target !== event.currentTarget) {
      return
    }

    // Space toggles selection whenever the list is selectable; Enter keeps opening (or toggling in selection mode).
    if (event.key === ' ' && selectable && onToggleSelect) {
      event.preventDefault()
      onToggleSelect(image, imageId, { shiftKey: event.shiftKey })
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onActivate?.(image, imageId, href, { shiftKey: event.shiftKey })
    }
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    onActivate?.(image, imageId, href, { shiftKey: event.shiftKey })
  }

  const quickActions = chatActions ? null : showDefaultQuickActions && !selectionMode ? (
    <div
      className="absolute right-2 top-2 z-30 flex items-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      // Portals a quick action opens (the image editor) bubble here through React; keep them off the tile menu.
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      {hasRevealedQuickActions ? <ChatDockReferenceButton compositeHash={image.composite_hash} mimeType={image.mime_type ?? null} /> : null}
      {hasRevealedQuickActions ? <ImageEditAction image={image} /> : null}
      {renderOverlay}
    </div>
  ) : renderOverlay ? <div className="absolute right-2 top-2 z-30">{renderOverlay}</div> : null

  // Touch has no hover or right-click, and its long-press selects: the tile menu sits on a ⋯ button there.
  const touchMenu = menuEntries?.length && !selectionMode ? (
    <div
      className="absolute right-2 top-2 z-30 hidden pointer-coarse:block"
      data-no-select-drag="true"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <ActionMenuButton entries={menuEntries} label={t({ ko: '작업', en: 'Actions' })} variant="overlay" size="icon-sm" motion="pop" />
    </div>
  ) : null

  const tile = (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={cn(
        'theme-list-shadow image-list-selectable group relative isolate block w-full select-none rounded-sm bg-surface-low text-left transition-transform duration-300 [-webkit-touch-callout:none] focus:outline-none focus:ring-2 focus:ring-primary/60 hover:z-10 focus-within:z-10',
        'data-[drag-armed=true]:scale-[0.97] data-[drag-armed=true]:cursor-grabbing',
        selected && 'is-selected',
        selectionMode || !interactive ? 'cursor-default' : 'cursor-pointer',
      )}
      data-image-id={imageId}
      data-selected={selected ? 'true' : 'false'}
      aria-label={interactive ? `${displayName} ${selectionMode ? t({ ko: '선택', en: 'select' }) : t({ ko: '상세', en: 'detail' })}` : displayName}
      aria-pressed={selected}
      draggable={false}
      onDragStart={preventUnarmedTileDrag}
      onPointerEnter={() => {
        setHasRevealedQuickActions(true)
        if (interactive) {
          onPreviewIntent?.(image)
        }
      }}
      onFocus={() => {
        setHasRevealedQuickActions(true)
        if (interactive) {
          onPreviewIntent?.(image)
        }
      }}
      onClick={interactive ? handleClick : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="relative overflow-hidden rounded-sm bg-surface-lowest select-none">
        <div className={cn('transition duration-300', blurPreview && 'scale-103 blur-2xl saturate-55')}>
          {content}
        </div>
        {blurPreview ? <div className="pointer-events-none absolute inset-0 z-10 bg-backdrop/25" /> : null}
      </div>
      {renderPersistentOverlay || soundBar ? <div className="absolute inset-x-0 bottom-0 z-30 space-y-1 p-2">{soundBar}{renderPersistentOverlay}</div> : null}
      {quickActions}
      {touchMenu}
      <div className="image-list-selection-frame pointer-events-none absolute inset-0 z-20 rounded-sm" />
    </div>
  )
  const menuTile = menuEntries ? <ActionContextMenu entries={menuEntries} mouseOnly motion="pop">{tile}</ActionContextMenu> : tile
  return chatActions ? <ChatThumbOverlay actions={renderOverlay} actionsClassName="z-30">{menuTile}</ChatThumbOverlay> : menuTile
})

ImageListItemComponent.displayName = 'ImageListItem'

export { ImageListItemComponent as ImageListItem }
