import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { ImageListItem } from '@/features/images/components/image-list/image-list-item'
import { ImageList } from '@/features/images/components/image-list/image-list'
import type { ImageRecord } from '@/types/image'

interface RelatedImageGallerySectionProps {
  title: string
  items: ImageRecord[]
  isLoading: boolean
  errorMessage: string | null
  emptyMessage: string
  actions?: ReactNode
  activationMode?: 'navigate' | 'modal' | 'modal-single'
  useStaticGrid?: boolean
}

export function RelatedImageGallerySection({
  title,
  items,
  isLoading,
  errorMessage,
  emptyMessage,
  actions,
  activationMode = 'navigate',
  useStaticGrid = false,
}: RelatedImageGallerySectionProps) {
  const navigate = useNavigate()
  const imageViewModal = useImageViewModal()
  const itemCompositeHashes = useMemo(
    () => items.map((item) => item.composite_hash).filter((value): value is string => typeof value === 'string' && value.length > 0),
    [items],
  )

  /** Activate a related image in either modal or route-navigation mode. */
  const handleActivate = (imageId: string, href?: string) => {
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
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {actions}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-[220px] w-full rounded-sm" />
          ))}
        </div>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>{title}를 불러오지 못했어</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !errorMessage && items.length > 0 ? (
        useStaticGrid ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((relatedImage) => (
              <ImageListItem
                key={String(relatedImage.composite_hash ?? relatedImage.id)}
                image={relatedImage}
                href={relatedImage.composite_hash ? `/images/${relatedImage.composite_hash}` : undefined}
                gridItemHeight={220}
                onActivate={handleActivate}
              />
            ))}
          </div>
        ) : (
          <ImageList
            items={items}
            layout="grid"
            activationMode={activationMode}
            getItemHref={(relatedImage) => (relatedImage.composite_hash ? `/images/${relatedImage.composite_hash}` : undefined)}
            minColumnWidth={220}
            columnGap={16}
            rowGap={16}
            gridItemHeight={220}
          />
        )
      ) : null}

      {!isLoading && !errorMessage && items.length === 0 ? (
        <Card className="bg-surface-container">
          <CardContent className="p-6 text-sm text-muted-foreground">{emptyMessage}</CardContent>
        </Card>
      ) : null}
    </section>
  )
}
