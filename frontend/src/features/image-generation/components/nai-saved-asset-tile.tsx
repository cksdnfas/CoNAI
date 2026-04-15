import { type KeyboardEvent, useEffect, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImagePreviewMedia } from '@/features/images/components/image-preview-media'
import { getImagePreviewStateLabel, resolveImagePreviewState } from '@/features/images/components/image-preview-state'
import { ImagePreviewPlaceholder } from '@/features/images/components/image-preview-placeholder'
import { buildPreviewImageRecord } from '@/features/images/components/inline-media-preview'

type NaiSavedAssetTileProps = {
  title: string
  subtitle?: string
  imageUrl?: string
  mimeType?: string
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}

export function NaiSavedAssetTile({
  title,
  subtitle,
  imageUrl,
  mimeType,
  onSelect,
  onEdit,
  onDelete,
}: NaiSavedAssetTileProps) {
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
      className="group relative isolate h-60 overflow-hidden rounded-sm border border-border bg-surface-container text-left transition-transform duration-300 hover:-translate-y-0.5 hover:bg-surface-high"
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
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="h-8 w-8 rounded-full border border-white/12 bg-black/45 text-white hover:bg-black/60"
          onClick={(event) => {
            event.stopPropagation()
            onEdit()
          }}
          aria-label="수정"
          title="수정"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="h-8 w-8 rounded-full border border-white/12 bg-black/45 text-white hover:bg-black/60"
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          aria-label="삭제"
          title="삭제"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 space-y-1 p-3">
        <p className="truncate text-sm font-semibold text-white">{title}</p>
        {subtitle ? <p className="truncate text-[11px] text-white/82">{subtitle}</p> : null}
      </div>
    </div>
  )
}
