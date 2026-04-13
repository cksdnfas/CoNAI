import { useEffect, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { ImageRatingSafetyBadge, resolveImageFeedSafety } from '@/features/images/components/image-list/image-rating-safety'
import { getRatingTiers } from '@/lib/api-search'
import type { GroupRecord } from '@/types/group'
import type { ImageRecord } from '@/types/image'

interface GroupImageSectionProps {
  group: GroupRecord
  groupImages: ImageRecord[]
  isLoading: boolean
  isError: boolean
  errorMessage: string | null
  hasMore: boolean
  isLoadingMore: boolean
  onLoadMore: () => void
  hideHeader?: boolean
  presentation?: 'page' | 'drawer'
  selectable?: boolean
  selectedIds?: string[]
  onSelectedIdsChange?: (selectedIds: string[]) => void
  renderItemOverlay?: (image: ImageRecord) => ReactNode
}

export function GroupImageSection({
  group,
  groupImages,
  isLoading,
  isError,
  errorMessage,
  hasMore,
  isLoadingMore,
  onLoadMore,
  hideHeader = false,
  presentation = 'page',
  selectable = false,
  selectedIds = [],
  onSelectedIdsChange,
  renderItemOverlay,
}: GroupImageSectionProps) {
  const shouldShowCollectionCounts = group.manual_added_count !== undefined || group.auto_collected_count !== undefined
  const ratingTiersQuery = useQuery({
    queryKey: ['rating-tiers'],
    queryFn: getRatingTiers,
    staleTime: 60_000,
  })

  const imageFeedSafetyById = useMemo(
    () => new Map(groupImages.map((image) => [String(image.composite_hash ?? image.id), resolveImageFeedSafety(image, ratingTiersQuery.data)])),
    [groupImages, ratingTiersQuery.data],
  )

  const visibleGroupImages = useMemo(
    () => groupImages.filter((image) => imageFeedSafetyById.get(String(image.composite_hash ?? image.id))?.visibility !== 'hide'),
    [groupImages, imageFeedSafetyById],
  )

  useEffect(() => {
    if (isLoading || isError || isLoadingMore) {
      return
    }

    if (groupImages.length === 0 || visibleGroupImages.length > 0 || !hasMore) {
      return
    }

    onLoadMore()
  }, [groupImages.length, hasMore, isError, isLoading, isLoadingMore, onLoadMore, visibleGroupImages.length])

  return (
    <section className={presentation === 'drawer' ? 'flex h-full min-h-0 flex-col gap-4' : 'space-y-4'}>
      {!hideHeader ? (
        <SectionHeading
          heading="이미지"
          description={`${visibleGroupImages.length.toLocaleString('ko-KR')}개 항목`}
          actions={shouldShowCollectionCounts ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline">manual {group.manual_added_count?.toLocaleString('ko-KR') ?? 0}</Badge>
              <Badge variant="outline">auto {group.auto_collected_count?.toLocaleString('ko-KR') ?? 0}</Badge>
            </div>
          ) : undefined}
        />
      ) : null}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[260px] w-full rounded-sm" />
          ))}
        </div>
      ) : null}

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>그룹 이미지를 불러오지 못했어</AlertTitle>
          <AlertDescription>{errorMessage ?? '알 수 없는 오류가 발생했어.'}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !isError && visibleGroupImages.length > 0 ? (
        <ImageList
          items={visibleGroupImages}
          layout="masonry"
          activationMode="modal"
          getItemHref={(image) => (image.composite_hash ? `/images/${image.composite_hash}` : undefined)}
          selectable={selectable}
          selectedIds={selectedIds}
          onSelectedIdsChange={onSelectedIdsChange}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={onLoadMore}
          minColumnWidth={presentation === 'drawer' ? 180 : 280}
          columnGap={presentation === 'drawer' ? 12 : 20}
          rowGap={presentation === 'drawer' ? 12 : 20}
          gridItemHeight={presentation === 'drawer' ? 220 : 260}
          scrollMode={presentation === 'drawer' ? 'container' : 'window'}
          viewportHeight={presentation === 'drawer' ? '100%' : undefined}
          className={presentation === 'drawer' ? 'min-h-0 flex-1' : undefined}
          selectionAreaClass={presentation === 'drawer' ? 'image-list-selection-area-hidden' : 'image-list-selection-area'}
          renderItemOverlay={renderItemOverlay}
          renderItemPersistentOverlay={(image) => {
            const safety = imageFeedSafetyById.get(String(image.composite_hash ?? image.id))
            return safety?.tier ? <ImageRatingSafetyBadge tier={safety.tier} visibility={safety.visibility} /> : null
          }}
          shouldBlurItemPreview={(image) => imageFeedSafetyById.get(String(image.composite_hash ?? image.id))?.visibility === 'blur'}
        />
      ) : null}

      {!isLoading && !isError && visibleGroupImages.length === 0 ? (
        <Card >
          <CardContent className="text-sm text-muted-foreground">
            {groupImages.length > 0 ? '현재 등급 표시 정책 때문에 이 목록에서는 숨겨진 상태야.' : '표시할 이미지가 없어.'}
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}
