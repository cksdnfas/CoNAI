import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageList } from '@/features/images/components/image-list/image-list'
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
}: GroupImageSectionProps) {
  const shouldShowCollectionCounts = group.manual_added_count !== undefined || group.auto_collected_count !== undefined

  return (
    <section className={presentation === 'drawer' ? 'flex h-full min-h-0 flex-col gap-4' : 'space-y-4'}>
      {!hideHeader ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">이미지</h2>
            <p className="text-sm text-muted-foreground">{group.image_count.toLocaleString('ko-KR')}개 항목</p>
          </div>
          {shouldShowCollectionCounts ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline">manual {group.manual_added_count?.toLocaleString('ko-KR') ?? 0}</Badge>
              <Badge variant="outline">auto {group.auto_collected_count?.toLocaleString('ko-KR') ?? 0}</Badge>
            </div>
          ) : null}
        </div>
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

      {!isLoading && !isError && groupImages.length > 0 ? (
        <ImageList
          items={groupImages}
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
        />
      ) : null}

      {!isLoading && !isError && groupImages.length === 0 ? (
        <Card className="bg-surface-container">
          <CardContent className="p-6 text-sm text-muted-foreground">이 그룹에는 아직 표시할 이미지가 없어.</CardContent>
        </Card>
      ) : null}
    </section>
  )
}
