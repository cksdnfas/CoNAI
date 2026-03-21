import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { downloadImageSelection, getImages } from '@/lib/api'

const curatedFilters = ['All Works', 'Cinematic', 'Architectural', 'Portrait', 'Abstract']

/** Render the Home page with the reusable virtualized image list module. */
export function HomePage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isDownloading, setIsDownloading] = useState(false)

  const imagesQuery = useInfiniteQuery({
    queryKey: ['home-images'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => getImages({ page: pageParam, limit: 40 }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  })

  const images = useMemo(
    () => (imagesQuery.data?.pages ?? []).flatMap((page) => page.images),
    [imagesQuery.data?.pages],
  )

  const downloadableCompositeHashes = useMemo(
    () =>
      images
        .filter((image) => selectedIds.includes(String(image.composite_hash ?? image.id)))
        .map((image) => image.composite_hash)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    [images, selectedIds],
  )

  const handleDownloadSelected = async () => {
    if (downloadableCompositeHashes.length === 0 || isDownloading) {
      return
    }

    try {
      setIsDownloading(true)
      await downloadImageSelection(downloadableCompositeHashes)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-3">
          {curatedFilters.map((filter, index) => (
            <span
              key={filter}
              className={index === 0 ? 'cursor-default rounded-sm bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground' : 'cursor-default rounded-sm bg-surface-highest px-4 py-1.5 text-xs font-medium text-muted-foreground'}
            >
              {filter}
            </span>
          ))}
        </div>
      </section>

      {imagesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>홈 피드를 불러오지 못했어</AlertTitle>
          <AlertDescription>
            {imagesQuery.error instanceof Error ? imagesQuery.error.message : '알 수 없는 오류가 발생했어.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {imagesQuery.isPending ? (
        <section className="columns-1 gap-6 sm:columns-2 xl:columns-3 2xl:columns-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="mb-6 break-inside-avoid overflow-hidden rounded-sm bg-surface-low">
              <Skeleton className="min-h-[280px] w-full rounded-none" />
            </div>
          ))}
        </section>
      ) : null}

      {!imagesQuery.isPending && !imagesQuery.isError && images.length === 0 ? (
        <Card className="bg-surface-container">
          <CardHeader>
            <CardTitle>표시할 이미지가 아직 없어</CardTitle>
            <CardDescription>업로드를 연결하거나 백엔드 데이터 상태를 먼저 확인하면 돼.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!imagesQuery.isPending && !imagesQuery.isError && images.length > 0 ? (
        <ImageList
          items={images}
          getItemHref={(image) => (image.composite_hash ? `/images/${image.composite_hash}` : undefined)}
          selectable={true}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          hasMore={Boolean(imagesQuery.hasNextPage)}
          isLoadingMore={imagesQuery.isFetchingNextPage}
          onLoadMore={imagesQuery.fetchNextPage}
          columnWidth={320}
          columnGutter={24}
          rowGutter={24}
          itemHeightEstimate={320}
          overscanBy={2}
        />
      ) : null}

      <ImageSelectionBar
        selectedCount={selectedIds.length}
        downloadableCount={downloadableCompositeHashes.length}
        isDownloading={isDownloading}
        onDownload={handleDownloadSelected}
      />
    </div>
  )
}
