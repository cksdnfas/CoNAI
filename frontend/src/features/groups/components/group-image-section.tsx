import type { ReactNode } from 'react'
import { Bot, Images, LayoutGrid, Loader2, Minus, Pencil, Plus, RotateCcw } from 'lucide-react'
import { PageInset } from '@/components/common/page-surface'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { BottomDrawerNotice } from '@/components/ui/bottom-drawer-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import type { GroupRecord } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import { useI18n } from '@/i18n'
import { getGroupImageFeedProgressSummary } from '../group-image-feed-progress'

interface GroupImageSectionProps {
  group: GroupRecord
  groupImages: ImageRecord[]
  resetKey?: string
  isLoading: boolean
  isError: boolean
  errorMessage: string | null
  hasMore: boolean
  isLoadingMore: boolean
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
  renderItemOverlay?: (image: ImageRecord) => ReactNode
  collectionFilter?: 'all' | 'manual' | 'auto'
  onCollectionFilterChange?: (value: 'all' | 'manual' | 'auto') => void
}

const COLLECTION_FILTER_OPTIONS = [
  { value: 'all', icon: Images, labelKey: 'groups.components.group.image.section.all.images' },
  { value: 'manual', icon: Pencil, labelKey: 'groups.components.group.image.section.manual.only' },
  { value: 'auto', icon: Bot, labelKey: 'groups.components.group.image.section.auto.collected.only' },
] as const

export function GroupImageSection({
  group,
  groupImages,
  resetKey,
  isLoading,
  isError,
  errorMessage,
  hasMore,
  isLoadingMore,
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
  renderItemOverlay,
  collectionFilter,
  onCollectionFilterChange,
}: GroupImageSectionProps) {
  const { t, formatNumber } = useI18n()
  const shouldShowCollectionCounts = group.manual_added_count !== undefined || group.auto_collected_count !== undefined
  const {
    visibleItems: visibleGroupImages,
    hasOnlyHiddenItems,
    renderItemPersistentOverlay,
    shouldBlurItemPreview,
  } = useImageFeedSafety({
    items: groupImages,
    hasMore,
    isLoading,
    isError,
    isLoadingMore,
    onLoadMore,
  })
  const feedProgress = getGroupImageFeedProgressSummary({
    loadedCount: groupImages.length,
    visibleCount: visibleGroupImages.length,
    totalCount,
  })
  const shouldShowFeedProgress = !isLoading && !isError && visibleGroupImages.length > 0 && (
    isLoadingMore || feedProgress.hiddenCount > 0 || feedProgress.loadedCount < feedProgress.totalCount
  )

  return (
    <section className={presentation === 'drawer' ? 'flex h-full min-h-0 flex-col gap-3' : 'space-y-4'}>
      {!hideHeader ? (
        <PageInset className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-base font-semibold tracking-tight text-foreground">{t('groups.components.group.image.section.images')}</h2>
            <Badge variant="secondary">
              {t({ ko: '전체 {count}', en: '{count} total' }, { count: formatNumber(feedProgress.totalCount) })}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {typeof onCollectionFilterChange === 'function' ? (
              <div className="flex flex-wrap items-center gap-2">
                {COLLECTION_FILTER_OPTIONS.map(({ value, icon: Icon, labelKey }) => {
                  const translatedLabel = t(labelKey)
                  return (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={collectionFilter === value ? 'default' : 'secondary'}
                    onClick={() => onCollectionFilterChange(value)}
                    aria-label={translatedLabel}
                    title={translatedLabel}
                  >
                    <Icon className="h-4 w-4" />
                    {translatedLabel}
                  </Button>
                  )
                })}
              </div>
            ) : shouldShowCollectionCounts ? (
              <>
                <Badge variant="outline">{t({ ko: '직접 추가 {count}', en: 'Manual {count}' }, { count: formatNumber(group.manual_added_count ?? 0) })}</Badge>
                <Badge variant="outline">{t({ ko: '자동 수집 {count}', en: 'Auto-collected {count}' }, { count: formatNumber(group.auto_collected_count ?? 0) })}</Badge>
              </>
            ) : null}
            {preferredColumnCount !== undefined && onColumnCountChange ? (
              <div className="inline-flex items-center gap-1 rounded-sm border border-border/80 bg-surface-container px-1 py-1" aria-label={t({ ko: '한 줄 이미지 수', en: 'Images per row' })}>
                <LayoutGrid className="mx-1 h-4 w-4 text-muted-foreground" />
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => onColumnCountChange(Math.max(minColumnCount, preferredColumnCount - 1))}
                  disabled={preferredColumnCount <= minColumnCount}
                  aria-label={t({ ko: '열 수 줄이기', en: 'Decrease columns' })}
                  title={t({ ko: '열 수 줄이기', en: 'Decrease columns' })}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="min-w-6 text-center text-xs font-semibold tabular-nums text-foreground">{preferredColumnCount}</span>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => onColumnCountChange(Math.min(maxColumnCount, preferredColumnCount + 1))}
                  disabled={preferredColumnCount >= maxColumnCount}
                  aria-label={t({ ko: '열 수 늘리기', en: 'Increase columns' })}
                  title={t({ ko: '열 수 늘리기', en: 'Increase columns' })}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                {onColumnCountReset && defaultColumnCount !== undefined && preferredColumnCount !== defaultColumnCount ? (
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    onClick={onColumnCountReset}
                    aria-label={t({ ko: '기본 열 수로 복원', en: 'Reset columns' })}
                    title={t({ ko: '기본 열 수로 복원', en: 'Reset columns' })}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            ) : null}
            {toolbarActions}
          </div>
        </PageInset>
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
          <AlertTitle>{t('groups.components.group.image.section.group.images.failed.to.load')}</AlertTitle>
          <AlertDescription>{errorMessage ?? t('groups.components.group.image.section.an.unknown.error.occurred')}</AlertDescription>
        </Alert>
      ) : null}

      {shouldShowFeedProgress ? (
        <PageInset className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {t(
                { ko: '표시 {visible} / 로드 {loaded}', en: 'Showing {visible} / loaded {loaded}' },
                { visible: formatNumber(feedProgress.visibleCount), loaded: formatNumber(feedProgress.loadedCount) },
              )}
            </span>
            <span>
              {t(
                { ko: '전체 {total}', en: '{total} total' },
                { total: formatNumber(feedProgress.totalCount) },
              )}
            </span>
            {feedProgress.hiddenCount > 0 ? (
              <span>
                {t(
                  { ko: '숨김 {count}', en: '{count} hidden' },
                  { count: formatNumber(feedProgress.hiddenCount) },
                )}
              </span>
            ) : null}
          </div>
        </PageInset>
      ) : null}

      {!isLoading && !isError && visibleGroupImages.length > 0 ? (
        <>
          <ImageList
            items={visibleGroupImages}
            resetKey={resetKey}
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
          />

          <div className="flex flex-col items-center gap-3 pb-3">
            {isLoadingMore ? (
              <PageInset className="inline-flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t('homePage.loadingMoreImages')}</span>
              </PageInset>
            ) : null}

            {hasMore && !isLoadingMore ? (
              <Button size="sm" variant="outline" onClick={onLoadMore}>
                {t({ ko: '더 보기', en: 'Load more' })}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      {!isLoading && !isError && visibleGroupImages.length === 0 ? (
        presentation === 'drawer' ? (
          <BottomDrawerNotice>
            {hasOnlyHiddenItems ? t('groups.components.group.image.section.hidden.here.by.the.current.rating.visibility') : t('groups.components.group.image.section.no.images.to.show')}
          </BottomDrawerNotice>
        ) : (
          <PageInset className="text-sm text-muted-foreground">
            {hasOnlyHiddenItems ? t('groups.components.group.image.section.hidden.here.by.the.current.rating.visibility') : t('groups.components.group.image.section.no.images.to.show')}
          </PageInset>
        )
      ) : null}
    </section>
  )
}
