import { memo, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { ImagePreviewPlaceholder } from '@/features/images/components/image-preview-placeholder'
import { getImagePreviewStateLabel, resolveImagePreviewState } from '@/features/images/components/image-preview-state'
import { ImageEditAction } from '@/features/images/components/detail/image-edit-action'
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
  /** Show the selection checkbox (on hover/focus, or always when `alwaysShowSelectionControl`). */
  selectable?: boolean
  /** Keep the checkbox visible: selection mode is on or the device has no hover. */
  alwaysShowSelectionControl?: boolean
  onToggleSelect?: (image: ImageRecord, itemId: string, modifiers?: ImageListActivateModifiers) => void
  renderOverlay?: ReactNode
  renderPersistentOverlay?: ReactNode
  showDefaultQuickActions?: boolean
  interactive?: boolean
  blurPreview?: boolean
  onPreviewIntent?: (image: ImageRecord) => void
}

/** Prevent native media dragging so drag gestures can be used for selection. */
function preventNativeDrag(event: DragEvent<HTMLElement>) {
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
  alwaysShowSelectionControl = false,
  onToggleSelect,
  renderOverlay,
  renderPersistentOverlay,
  showDefaultQuickActions = true,
  interactive = true,
  blurPreview = false,
  onPreviewIntent,
}: ImageListItemProps) {
  const { t } = useI18n()
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
  const placeholderLabel = getImagePreviewStateLabel(previewState, t('images.components.image.preview.state.no.preview'), {
    empty: t('images.components.image.preview.state.no.preview'),
    processing: t('images.components.image.preview.state.active'),
    failed: t('images.components.image.preview.state.failed'),
    unavailable: t('images.components.image.preview.state.unavailable'),
  })

  const content = previewUrl && !hasPreviewError ? (
    mediaKind === 'video' ? (
      // key: 가상화 레이아웃이 컴포넌트 인스턴스를 다른 미디어에 재활용해도 <video> DOM 이
      // 함께 재활용되어 이전 프레임이 남는 일이 없도록, 미디어 identity 로 서브트리를 교체한다.
      <ImageListVideoPreview
        key={imageId}
        image={image}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
        style={mediaFrameStyle}
        draggable={false}
        onDragStart={preventNativeDrag}
        onError={() => setHasPreviewError(true)}
        suspendPlayback={blurPreview}
      />
    ) : (
      <ImagePreviewMedia
        image={image}
        alt={displayName}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) {
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

  // Mount lazily like the quick actions so idle desktop cells skip the Radix checkbox entirely.
  const selectionControl = selectable && onToggleSelect && (alwaysShowSelectionControl || hasRevealedQuickActions) ? (
    <div
      className={cn(
        'absolute left-2 top-2 z-30 transition-opacity duration-150',
        alwaysShowSelectionControl ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100',
      )}
      data-no-select-drag="true"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Checkbox
        checked={selected}
        tabIndex={-1}
        aria-label={t({ ko: '{name} 선택', en: 'Select {name}' }, { name: displayName })}
        className="relative size-5 rounded-[5px] border-white/85 bg-black/45 shadow-[0_2px_8px_rgba(0,0,0,0.45)] backdrop-blur-sm before:absolute before:-inset-2.5 before:content-[''] hover:border-white data-[state=checked]:border-primary"
        onClick={(event) => {
          event.stopPropagation()
          event.preventDefault()
          onToggleSelect(image, imageId, { shiftKey: event.shiftKey })
        }}
      />
    </div>
  ) : null

  const quickActions = showDefaultQuickActions && !selectionMode ? (
    <div
      className="absolute right-2 top-2 z-30 flex items-center gap-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {hasRevealedQuickActions ? <ImageEditAction image={image} /> : null}
      {renderOverlay}
    </div>
  ) : renderOverlay ? <div className="absolute right-2 top-2 z-30">{renderOverlay}</div> : null

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={cn(
        'theme-list-shadow image-list-selectable group relative isolate block w-full select-none rounded-sm bg-surface-low text-left transition-transform duration-300 [-webkit-touch-callout:none] focus:outline-none focus:ring-2 focus:ring-primary/60 hover:z-10 focus-within:z-10',
        selected && 'is-selected',
        selectionMode || !interactive ? 'cursor-default' : 'cursor-pointer',
      )}
      data-image-id={imageId}
      data-selected={selected ? 'true' : 'false'}
      aria-label={interactive ? `${displayName} ${selectionMode ? t({ ko: '선택', en: 'select' }) : t({ ko: '상세', en: 'detail' })}` : displayName}
      aria-pressed={selected}
      draggable={false}
      onDragStart={preventNativeDrag}
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
        <div className={cn('transition duration-300', blurPreview && 'scale-[1.03] blur-2xl saturate-[0.55]')}>
          {content}
        </div>
        {blurPreview ? <div className="pointer-events-none absolute inset-0 z-10 bg-black/18" /> : null}
      </div>
      {renderPersistentOverlay ? <div className="image-list-persistent-overlay absolute inset-x-0 bottom-0 z-30 p-2">{renderPersistentOverlay}</div> : null}
      {quickActions}
      {selectionControl}
      <div className="image-list-selection-frame pointer-events-none absolute inset-0 z-20 rounded-sm" />
    </div>
  )
})

ImageListItemComponent.displayName = 'ImageListItem'

export { ImageListItemComponent as ImageListItem }
