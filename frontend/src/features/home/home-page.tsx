import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useHomeSearch } from '@/features/home/home-search-context'
import { buildComplexFilterPayload } from '@/features/home/search-utils'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useHomeScrollRestoration } from '@/features/home/use-home-scroll-restoration'
import { downloadImageSelection, getImages, searchImagesComplex } from '@/lib/api'

/** Render the Home page with the reusable image list and header-driven search results. */
export function HomePage() {
  const { appliedChips } = useHomeSearch()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isDownloading, setIsDownloading] = useState(false)

  const isSearchMode = appliedChips.length > 0

  const imagesQuery = useInfiniteQuery({
    queryKey: ['home-images', appliedChips],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      isSearchMode
        ? searchImagesComplex({
            complex_filter: buildComplexFilterPayload(appliedChips),
            page: pageParam,
            limit: 40,
            sortBy: 'upload_date',
            sortOrder: 'DESC',
          })
        : getImages({ page: pageParam, limit: 40 }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  })

  const images = useMemo(
    () => (imagesQuery.data?.pages ?? []).flatMap((page) => page.images),
    [imagesQuery.data?.pages],
  )

  useEffect(() => {
    setSelectedIds([])
  }, [appliedChips])

  useHomeScrollRestoration({
    enabled: !imagesQuery.isPending && !imagesQuery.isError,
    itemCount: images.length,
    canLoadMore: Boolean(imagesQuery.hasNextPage),
    isLoadingMore: imagesQuery.isFetchingNextPage,
    onLoadMore: imagesQuery.fetchNextPage,
  })

  const downloadableCompositeHashes = useMemo(
    () =>
      images
        .filter((image) => selectedIds.includes(String(image.composite_hash ?? image.id)))
        .map((image) => image.composite_hash)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    [images, selectedIds],
  )

  const loadMoreErrorMessage =
    imagesQuery.error instanceof Error
      ? imagesQuery.error.message
      : '다음 이미지 묶음을 불러오는 중 문제가 생겼어.'

  const handleRetryInitialLoad = () => {
    void imagesQuery.refetch()
  }

  const handleRetryNextPage = () => {
    void imagesQuery.fetchNextPage()
  }

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

  const emptyStateTitle = isSearchMode ? '검색 결과가 없어' : '표시할 이미지가 아직 없어'
  const emptyStateDescription = isSearchMode
    ? '상단 검색창을 눌러 필터를 바꾸거나 히스토리를 다시 불러와봐.'
    : '업로드를 연결하거나 백엔드 데이터 상태를 먼저 확인하면 돼.'

  const errorTitle = isSearchMode ? '검색 결과를 불러오지 못했어' : '홈 피드를 불러오지 못했어'

  return (
    <div className="space-y-8">
      {imagesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{errorTitle}</AlertTitle>
          <AlertDescription className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{imagesQuery.error instanceof Error ? imagesQuery.error.message : '알 수 없는 오류가 발생했어.'}</span>
            <Button size="sm" variant="outline" onClick={handleRetryInitialLoad}>
              다시 시도
            </Button>
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
            <CardTitle>{emptyStateTitle}</CardTitle>
            <CardDescription>{emptyStateDescription}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!imagesQuery.isPending && !imagesQuery.isError && images.length > 0 ? (
        <>
          <ImageList
            items={images}
            layout="masonry"
            getItemHref={(image) => (image.composite_hash ? `/images/${image.composite_hash}` : undefined)}
            selectable={true}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            hasMore={Boolean(imagesQuery.hasNextPage)}
            isLoadingMore={imagesQuery.isFetchingNextPage}
            onLoadMore={imagesQuery.fetchNextPage}
            minColumnWidth={300}
            columnGap={24}
            rowGap={24}
            gridItemHeight={280}
          />

          <div className="flex flex-col items-center gap-3 pb-6">
            {imagesQuery.isFetchingNextPage ? (
              <div className="rounded-full bg-surface-low/88 px-4 py-2 text-xs text-muted-foreground shadow-[0_0_24px_rgba(14,14,14,0.16)] backdrop-blur-sm">
                이미지를 더 불러오는 중…
              </div>
            ) : null}

            {imagesQuery.isFetchNextPageError ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface-container/92 px-5 py-4 text-center shadow-[0_0_32px_rgba(14,14,14,0.22)] backdrop-blur-sm">
                <p className="text-sm font-semibold">목록을 끝까지 불러오지 못했어</p>
                <p className="max-w-xl text-xs text-muted-foreground">{loadMoreErrorMessage}</p>
                <Button size="sm" variant="outline" onClick={handleRetryNextPage}>
                  다음 묶음 다시 시도
                </Button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <ImageSelectionBar
        selectedCount={selectedIds.length}
        downloadableCount={downloadableCompositeHashes.length}
        isDownloading={isDownloading}
        onDownload={handleDownloadSelected}
        onClear={() => setSelectedIds([])}
      />
    </div>
  )
}
