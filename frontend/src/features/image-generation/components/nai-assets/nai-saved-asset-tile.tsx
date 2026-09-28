import { type KeyboardEvent, useEffect, useState } from 'react'
import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { getImagePreviewStateLabel, resolveImagePreviewState } from '@/features/images/components/image-preview-state'
import { ImagePreviewPlaceholder } from '@/features/images/components/image-preview-placeholder'
import { buildPreviewImageRecord } from '@/features/images/components/inline-media-preview'

export type NaiSavedAssetTileProps = {
  title: string
  subtitle?: string
  imageUrl?: string
  mimeType?: string
  /** Pin state; the pin toggle only renders when `onTogglePin` is set. */
  isPinned?: boolean
  onSelect: () => void
  onEdit?: () => void
  onDelete?: () => void
  onTogglePin?: () => void
}

// On-media control: the image behind it has no theme tone, so it sits on the backdrop scrim (no Button variant for this yet).
const ON_MEDIA_BUTTON_CLASS = 'bg-backdrop text-white hover:bg-backdrop hover:text-white'

/** Render one saved vibe/reference as an image tile; click loads it, corner buttons pin/edit/delete. */
export function NaiSavedAssetTile({
  title,
  subtitle,
  imageUrl,
  mimeType,
  isPinned = false,
  onSelect,
  onEdit,
  onDelete,
  onTogglePin,
}: NaiSavedAssetTileProps) {
  const { t } = useI18n()
  const editLabel = t('image-generation.components.nai.saved.asset.tile.edit')
  const deleteLabel = t('image-generation.components.nai.saved.asset.tile.delete')
  const pinLabel = isPinned ? t({ ko: '핀 해제', en: 'Unpin' }) : t({ ko: '핀', en: 'Pin' })
  const previewImage = buildPreviewImageRecord({
    src: imageUrl,
    mimeType,
    fileName: title,
    alt: title,
  })
  const [hasPreviewError, setHasPreviewError] = useState(false)

  useEffect(() => {
    setHasPreviewError(false)
  }, [imageUrl, mimeType, title])

  const previewState = resolveImagePreviewState({
    image: previewImage,
    hasPreviewUrl: Boolean(imageUrl),
    hasPreviewError,
  })

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className="group relative isolate h-60 overflow-hidden rounded-sm bg-surface-container text-left outline-none transition-transform duration-300 hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      {previewImage && previewState === 'ready' ? (
        <ImagePreviewMedia
          image={previewImage}
          alt={title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          onError={() => setHasPreviewError(true)}
        />
      ) : (
        <ImagePreviewPlaceholder
          label={getImagePreviewStateLabel(previewState)}
          className="absolute inset-0 bg-gradient-to-b from-surface-lowest to-surface-high text-xs text-muted-foreground"
          iconClassName="h-10 w-10"
          labelClassName="text-xs"
          compact
        />
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/84 via-black/42 to-transparent" />

      <div className="absolute right-2 top-2 z-10 flex gap-1.5">
        {onTogglePin ? (
          <IconButton
            size="icon-sm"
            variant="ghost"
            className={ON_MEDIA_BUTTON_CLASS}
            onClick={(event) => {
              event.stopPropagation()
              onTogglePin()
            }}
            label={pinLabel}
          >
            {isPinned ? <PinOff /> : <Pin />}
          </IconButton>
        ) : null}
        {onEdit ? (
          <IconButton
            size="icon-sm"
            variant="ghost"
            className={ON_MEDIA_BUTTON_CLASS}
            onClick={(event) => {
              event.stopPropagation()
              onEdit()
            }}
            label={editLabel}
          >
            <Pencil />
          </IconButton>
        ) : null}
        {onDelete ? (
          <IconButton
            size="icon-sm"
            variant="ghost"
            className={ON_MEDIA_BUTTON_CLASS}
            onClick={(event) => {
              event.stopPropagation()
              onDelete()
            }}
            label={deleteLabel}
          >
            <Trash2 />
          </IconButton>
        ) : null}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 space-y-1 p-3">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
          {isPinned ? <Pin className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
          <span className="truncate">{title}</span>
        </p>
        {subtitle ? <p className="truncate text-2xs text-white/82">{subtitle}</p> : null}
      </div>
    </div>
  )
}
