import { useEffect, type ReactNode } from 'react'
import { ImageOff } from 'lucide-react'
import { BottomDrawerNotice } from '@/components/ui/bottom-drawer-sheet'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { ImageListColumnFloatingControl } from '@/features/images/components/image-list/image-list-column-floating-control'
import { ImageListFeedFooter } from '@/features/images/components/image-list/image-list-feed-footer'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import type { GroupRecord } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import type { ImageViewModalAccessOptions, ImageViewSequenceTotal } from '@/features/images/components/detail/image-view-modal-context'
import { SegmentedControl } from '@/components/common/segmented-control'
import { useI18n } from '@/i18n'
import { getGroupImageFeedProgressSummary } from '../group-image-feed-progress'

interface GroupImageSectionProps {
  group: GroupRecord
  groupImages: ImageRecord[]
  resetKey?: string
  isLoading: boolean
  isError: boolean
  errorMessage: string | null
  /** Retry the first page after `isError`. */
  onRetry?: () => void
  isRetrying?: boolean
  hasMore: boolean
  isLoadingMore: boolean
  /** Failed next-page request; pauses auto-loading until the retry succeeds. */
  loadMoreError?: unknown
  totalCount?: number
  onLoadMore: () => void
  hideHeader?: boolean
  presentation?: 'page' | 'drawer'
  preferredColumnCount?: number
  defaultColumnCount?: number
  minColumnCount?: number
  maxColumnCount?: number
  onColumnCountChange?: (value: number) => void
  onColumnCountReset?: () => void
  toolbarActions?: ReactNode
  selectable?: boolean
  selectedIds?: string[]
  onSelectedIdsChange?: (selectedIds: string[]) => void
  /** Ids of the loaded images the list actually shows (rating-hidden ones excluded), for "select all loaded". */
  onVisibleItemIdsChange?: (itemIds: string[]) => void
  renderItemOverlay?: (image: ImageRecord) => ReactNode
  collectionFilter?: 'all' | 'manual' | 'auto'
  onCollectionFilterChange?: (value: 'all' | 'manual' | 'auto') => void
  /** Real totals per filter segment; a missing entry shows no number. */
  collectionFilterCounts?: Partial<Record<'all' | 'manual' | 'auto', number>>
  /** Desktop drag-out of a held tile (see ImageList). */
  onItemDragStart?: (itemId: string, event: DragEvent) => void
}

/** Module-level so the memoized image cells keep a stable href getter. */
function getGroupImageHref(image: ImageRecord) {
  return image.composite_hash ? `/images/${image.composite_hash}` : undefined
}

/** Library images can be deleted from the viewer (still admin-only). Module constant keeps ImageList memoized. */
const GROUP_VIEWER_ACCESS_OPTIONS: ImageViewModalAccessOptions = { allowDeleteAction: true }

const COLLECTION_FILTER_OPTIONS = [
  { value: 'all', label: { ko: '전체', en: 'All' } },
  { value: 'manual', label: { ko: '수동', en: 'Manual' } },
  { value: 'auto', label: { ko: '자동', en: 'Auto' } },
] as const

export function GroupImageSection({
  groupImages,
  resetKey,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  isRetrying = false,
  hasMore,
  isLoadingMore,
  loadMoreError = null,
  totalCount,
  onLoadMore,
  hideHeader = false,
  presentation = 'page',
  preferredColumnCount,
  defaultColumnCount,
  minColumnCount = 1,
  maxColumnCount = 8,
  onColumnCountChange,
  onColumnCountReset,
  toolbarActions,
  selectable = false,
  selectedIds = [],
  onSelectedIdsChange,
  onVisibleItemIdsChange,
  renderItemOverlay,
  collectionFilter,
  onCollectionFilterChange,
  collectionFilterCounts,
  onItemDragStart,
}: GroupImageSectionProps) {
  const { t, formatNumber } = useI18n()
  const hasLoadMoreError = loadMoreError !== null && loadMoreError !== undefined
  // Stop auto-loading after a failed page; the footer's retry is the manual fallback.
  const canAutoLoadMore = hasMore && !hasLoadMoreError
  const {
    visibleItems: visibleGroupImages,
    hasOnlyHiddenItems,
    renderItemPersistentOverlay,
    shouldBlurItemPreview,
  } = useImageFeedSafety({
    items: groupImages,
    hasMore: canAutoLoadMore,
    isLoading,
    isError,
    isLoadingMore,
    onLoadMore,
  })
  useEffect(() => {
    onVisibleItemIdsChange?.(visibleGroupImages.map((image) => String(image.composite_hash ?? image.id)))
  }, [onVisibleItemIdsChange, visibleGroupImages])

  const feedProgress = getGroupImageFeedProgressSummary({
    loadedCount: groupImages.length,
    visibleCount: visibleGroupImages.length,
    totalCount,
  })
  const sequenceTotal: ImageViewSequenceTotal = feedProgress.isTotalKnown
    ? { status: 'known', count: feedProgress.totalCount }
    : { status: isError ? 'unavailable' : 'pending' }

  return (
    <section className={presentation === 'drawer' ? 'flex h-full min-h-0 flex-col gap-3' : 'space-y-4'}>
      {preferredColumnCount !== undefined && onColumnCountChange ? (
        <ImageListColumnFloatingControl
          value={preferredColumnCount}
          defaultValue={defaultColumnCount ?? preferredColumnCount}
          min={minColumnCount}
          max={maxColumnCount}
          onChange={onColumnCountChange}
          onReset={onColumnCountReset}
          className={selectedIds.length > 0 ? 'bottom-24' : undefined}
        />
      ) : null}

      {!hideHeader && (typeof onCollectionFilterChange === 'function' || toolbarActions) ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {typeof onCollectionFilterChange === 'function' ? (
            <SegmentedControl
              value={collectionFilter ?? 'all'}
              size="xs"
              ariaLabel={t({ ko: '이미지 출처 필터', en: 'Image source filter' })}
              items={COLLECTION_FILTER_OPTIONS.map(({ value, label }) => {
                const count = collectionFilterCounts?.[value]
                return {
                  value,
                  label: (
                    <>
                      {t(label)}
                      {count !== undefined ? <span className="tabular-nums font-normal text-muted-foreground">{formatNumber(count)}</span> : null}
                    </>
                  ),
                }
              })}
              onChange={(value) => onCollectionFilterChange(value as typeof COLLECTION_FILTER_OPTIONS[number]['value'])}
            />
          ) : <span />}
          {toolbarActions ? <div className="flex items-center gap-1">{toolbarActions}</div> : null}
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
        <ErrorState
          title={t('groups.components.group.image.section.group.images.failed.to.load')}
          error={errorMessage ?? undefined}
          onRetry={onRetry}
          isRetrying={isRetrying}
        />
      ) : null}

      {!isLoading && !isError && visibleGroupImages.length > 0 ? (
        <>
          <ImageList
            items={visibleGroupImages}
            resetKey={resetKey}
            layout="masonry"
            activationMode="modal"
            getItemHref={getGroupImageHref}
            selectable={selectable}
            selectedIds={selectedIds}
            onSelectedIdsChange={onSelectedIdsChange}
            hasMore={canAutoLoadMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={onLoadMore}
            minColumnWidth={presentation === 'drawer' ? 180 : 280}
            preferredColumnCount={preferredColumnCount}
            columnGap={presentation === 'drawer' ? 12 : 20}
            rowGap={presentation === 'drawer' ? 12 : 20}
            gridItemHeight={presentation === 'drawer' ? 220 : 260}
            scrollMode={presentation === 'drawer' ? 'container' : 'window'}
            viewportHeight={presentation === 'drawer' ? '100%' : undefined}
            className={presentation === 'drawer' ? 'min-h-0 flex-1' : undefined}
            selectionAreaClass={presentation === 'drawer' ? 'image-list-selection-area-hidden' : 'image-list-selection-area'}
            renderItemOverlay={renderItemOverlay}
            renderItemPersistentOverlay={renderItemPersistentOverlay}
            shouldBlurItemPreview={shouldBlurItemPreview}
            sequenceTotal={sequenceTotal}
            modalAccessOptions={GROUP_VIEWER_ACCESS_OPTIONS}
            onItemDragStart={onItemDragStart}
          />

          <ImageListFeedFooter
            itemCount={visibleGroupImages.length}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            loadMoreError={loadMoreError}
            onRetry={onLoadMore}
            className={presentation === 'drawer' ? 'pb-3' : undefined}
          />
        </>
      ) : null}

      {!isLoading && !isError && visibleGroupImages.length === 0 ? (
        presentation === 'drawer' ? (
          <BottomDrawerNotice>
            {hasOnlyHiddenItems ? t('groups.components.group.image.section.hidden.here.by.the.current.rating.visibility') : t('groups.components.group.image.section.no.images.to.show')}
          </BottomDrawerNotice>
        ) : (
          <EmptyState
            icon={ImageOff}
            title={hasOnlyHiddenItems ? t('groups.components.group.image.section.hidden.here.by.the.current.rating.visibility') : t('groups.components.group.image.section.no.images.to.show')}
          />
        )
      ) : null}
    </section>
  )
}
