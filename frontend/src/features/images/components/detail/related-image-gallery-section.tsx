import { useCallback, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { useI18n } from '@/i18n'
import { ImageListItem } from '@/features/images/components/image-list/image-list-item'
import type { ImageRecord } from '@/types/image'
import type { RelatedImageCardAspectRatio } from '@/types/settings'

interface RelatedImageGallerySectionProps {
  title: string
  items: ImageRecord[]
  isLoading: boolean
  errorMessage: string | null
  emptyMessage: string
  actions?: ReactNode
  activationMode?: 'navigate' | 'modal' | 'modal-single'
  mobileCardColumns?: number
  desktopCardColumns?: number
  cardAspectRatio?: RelatedImageCardAspectRatio
  renderItemPersistentOverlay?: (image: ImageRecord) => ReactNode
}

function getRelatedImageCardAspectRatioValue(ratio: RelatedImageCardAspectRatio): string | undefined {
  switch (ratio) {
    case 'square':
      return '1 / 1'
    case 'portrait':
      return '4 / 5'
    case 'landscape':
      return '3 / 2'
    case 'original':
    default:
      return undefined
  }
}

export function RelatedImageGallerySection({
  title,
  items,
  isLoading,
  errorMessage,
  emptyMessage,
  actions,
  activationMode = 'navigate',
  mobileCardColumns = 1,
  desktopCardColumns = 3,
  cardAspectRatio = 'square',
  renderItemPersistentOverlay,
}: RelatedImageGallerySectionProps) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const imageViewModal = useImageViewModal()
  const itemCompositeHashes = useMemo(
    () => items.map((item) => item.composite_hash).filter((value): value is string => typeof value === 'string' && value.length > 0),
    [items],
  )
  const cardAspectRatioValue = useMemo(() => getRelatedImageCardAspectRatioValue(cardAspectRatio), [cardAspectRatio])

  /** Activate a related image in either modal or route-navigation mode. */
  const handleActivate = useCallback((_image: ImageRecord, imageId: string, href?: string) => {
    if ((activationMode === 'modal' || activationMode === 'modal-single') && imageViewModal) {
      imageViewModal.openImageView(
        activationMode === 'modal'
          ? {
            compositeHash: imageId,
            compositeHashes: itemCompositeHashes,
          }
          : {
            compositeHash: imageId,
          },
      )
      return
    }

    if (href) {
      navigate(href)
    }
  }, [activationMode, imageViewModal, itemCompositeHashes, navigate])

  const resolvedMobileCardColumns = Math.min(Math.max(mobileCardColumns, 1), 6)
  const resolvedDesktopCardColumns = Math.min(Math.max(desktopCardColumns, 1), 6)
  const gridStyle = useMemo(
    () => ({
      ['--related-image-grid-columns-base' as string]: String(resolvedMobileCardColumns),
      ['--related-image-grid-columns-md' as string]: String(resolvedDesktopCardColumns),
      ['--related-image-grid-columns-xl' as string]: String(resolvedDesktopCardColumns),
    }),
    [resolvedMobileCardColumns, resolvedDesktopCardColumns],
  )
  const skeletonCount = Math.max(resolvedMobileCardColumns, resolvedDesktopCardColumns)

  return (
    <section className="space-y-4">
      <SectionHeading heading={title} actions={actions} />

      {isLoading ? (
        <div className="related-image-gallery-grid" style={gridStyle}>
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <Skeleton
              key={index}
              className="w-full rounded-sm"
              style={cardAspectRatioValue ? { aspectRatio: cardAspectRatioValue } : { aspectRatio: '1 / 1', minHeight: 220 }}
            />
          ))}
        </div>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: '{title}를 불러오지 못했어', en: 'Failed to load {title}' }, { title })}</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !errorMessage && items.length > 0 ? (
        <div className="related-image-gallery-grid" style={gridStyle}>
          {items.map((relatedImage) => (
            <ImageListItem
              key={String(relatedImage.composite_hash ?? relatedImage.id)}
              image={relatedImage}
              href={relatedImage.composite_hash ? `/images/${relatedImage.composite_hash}` : undefined}
              gridItemAspectRatio={cardAspectRatioValue}
              onActivate={handleActivate}
              renderPersistentOverlay={renderItemPersistentOverlay?.(relatedImage)}
            />
          ))}
        </div>
      ) : null}

      {!isLoading && !errorMessage && items.length === 0 ? (
        <Card >
          <CardContent className="text-sm text-muted-foreground">{emptyMessage}</CardContent>
        </Card>
      ) : null}
    </section>
  )
}
