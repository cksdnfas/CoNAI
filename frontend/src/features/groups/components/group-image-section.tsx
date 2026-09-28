import { useEffect, type ReactNode } from 'react'
import { Bot, ImageOff, Images, Pencil } from 'lucide-react'
import { Inset } from '@/components/ui/inset'
import { BottomDrawerNotice } from '@/components/ui/bottom-drawer-sheet'
import { CountSummary } from '@/components/ui/count-summary'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { ImageListColumnControl } from '@/features/images/components/image-list/image-list-column-control'
import { ImageListFeedFooter } from '@/features/images/components/image-list/image-list-feed-footer'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import type { GroupRecord } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import type { ImageViewModalAccessOptions, ImageViewSequenceTotal } from '@/features/images/components/detail/image-view-modal-context'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Heading } from '@/components/ui/heading'
import { useI18n } from '@/i18n'
import { COUNT_UNITS, type CountState } from '@/lib/count-display'
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
}

/** Module-level so the memoized image cells keep a stable href getter. */
function getGroupImageHref(image: ImageRecord) {
  return image.composite_hash ? `/images/${image.composite_hash}` : undefined
}

/** Library images can be deleted from the viewer (still admin-only). Module constant keeps ImageList memoized. */
const GROUP_VIEWER_ACCESS_OPTIONS: ImageViewModalAccessOptions = { allowDeleteAction: true }

const COLLECTION_FILTER_OPTIONS = [
  { value: 'all', icon: Images, labelKey: 'groups.components.group.image.section.all.images' },
  { value: 'manual', icon: Pencil, labelKey: 'groups.components.group.image.section.manual.only' },
  { value: 'auto', icon: Bot, labelKey: 'groups.components.group.image.section.auto.collected.only' },
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
}: GroupImageSectionProps) {
  const { t } = useI18n()
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
  // The one count in this section: the list's own server total for the active filter (never
  // loaded-so-far, never the group record's raw membership counts), pending while it loads.
  const countState: CountState = feedProgress.isTotalKnown
    ? { total: feedProgress.totalCount, status: 'known', hidden: feedProgress.hiddenCount }
    : { total: null, status: isError ? 'error' : 'pending', hidden: feedProgress.hiddenCount }
  const sequenceTotal: ImageViewSequenceTotal = feedProgress.isTotalKnown
    ? { status: 'known', count: feedProgress.totalCount }
    : { status: isError ? 'unavailable' : 'pending' }

  return (
    <section className={presentation === 'drawer' ? 'flex h-full min-h-0 flex-col gap-3' : 'space-y-4'}>
      {!hideHeader ? (
        <Inset className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Heading level={3} as="h2">{t('groups.components.group.image.section.images')}</Heading>
            <CountSummary {...countState} unit={COUNT_UNITS.images} className="text-sm text-muted-foreground" />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {typeof onCollectionFilterChange === 'function' ? (
              <SegmentedControl
                value={collectionFilter ?? 'all'}
                size="sm"
                ariaLabel={t({ ko: '이미지 출처 필터', en: 'Image source filter' })}
                items={COLLECTION_FILTER_OPTIONS.map(({ value, icon: Icon, labelKey }) => ({
                  value,
                  label: (
                    <>
                      <Icon className="h-4 w-4" />
                      {t(labelKey)}
                    </>
                  ),
                }))}
                onChange={(value) => onCollectionFilterChange(value as typeof COLLECTION_FILTER_OPTIONS[number]['value'])}
              />
            ) : null}
            {preferredColumnCount !== undefined && onColumnCountChange ? (
              <ImageListColumnControl
                value={preferredColumnCount}
                defaultValue={defaultColumnCount}
                min={minColumnCount}
                max={maxColumnCount}
                onChange={onColumnCountChange}
                onReset={onColumnCountReset}
              />
            ) : null}
            {toolbarActions}
          </div>
        </Inset>
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
          description={t({ ko: '잠시 뒤에 다시 시도해 줘.', en: 'Try again in a moment.' })}
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
