import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageList } from '@/features/images/components/image-list/image-list'
import type { ImageRecord } from '@/types/image'

interface RelatedImageGallerySectionProps {
  title: string
  items: ImageRecord[]
  isLoading: boolean
  errorMessage: string | null
  emptyMessage: string
  actions?: ReactNode
}

export function RelatedImageGallerySection({
  title,
  items,
  isLoading,
  errorMessage,
  emptyMessage,
  actions,
}: RelatedImageGallerySectionProps) {
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
        <ImageList
          items={items}
          layout="grid"
          getItemHref={(relatedImage) => (relatedImage.composite_hash ? `/images/${relatedImage.composite_hash}` : undefined)}
          minColumnWidth={220}
          columnGap={16}
          rowGap={16}
          gridItemHeight={220}
        />
      ) : null}

      {!isLoading && !errorMessage && items.length === 0 ? (
        <Card className="bg-surface-container">
          <CardContent className="p-6 text-sm text-muted-foreground">{emptyMessage}</CardContent>
        </Card>
      ) : null}
    </section>
  )
}
