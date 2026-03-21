import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'
import { getImageListDisplayName, getImageListItemId, getImageListPreviewUrl } from './image-list-utils'

interface ImageListItemProps {
  image: ImageRecord
  href?: string
  selected?: boolean
}

/** Render a reusable image list cell that works in virtualized masonry layouts. */
export function ImageListItem({ image, href, selected = false }: ImageListItemProps) {
  const previewUrl = getImageListPreviewUrl(image)
  const imageId = getImageListItemId(image)
  const content = previewUrl ? (
    <img
      src={previewUrl}
      alt={getImageListDisplayName(image)}
      className="w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
      loading="lazy"
      draggable={false}
    />
  ) : (
    <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">미리보기 없음</div>
  )

  const className = cn(
    'image-list-item group block overflow-hidden rounded-sm bg-surface-low shadow-[0_0_40px_rgba(14,14,14,0.18)] transition-transform duration-300',
    selected && 'ring-2 ring-primary/70 ring-offset-2 ring-offset-background',
  )

  const inner = <div className="bg-surface-lowest">{content}</div>

  if (!href) {
    return (
      <div className={className} data-image-id={imageId} data-selected={selected ? 'true' : 'false'}>
        {inner}
      </div>
    )
  }

  return (
    <Link
      to={href}
      className={className}
      data-image-id={imageId}
      data-selected={selected ? 'true' : 'false'}
      aria-label={`${getImageListDisplayName(image)} detail`}
    >
      {inner}
    </Link>
  )
}
