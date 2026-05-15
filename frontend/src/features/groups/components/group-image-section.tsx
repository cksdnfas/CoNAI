import type { ReactNode } from 'react'
import { Bot, Images, Loader2, Pencil } from 'lucide-react'
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

  return (
    <section className={presentation === 'drawer' ? 'flex h-full min-h-0 flex-col gap-3' : 'space-y-4'}>
      {!hideHeader ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{t('groups.components.group.image.section.images')}</h2>
            <div className="mt-1 text-sm text-muted-foreground">{t({ ko: '{count}개 항목', en: '{count} items' }, { count: formatNumber(visibleGroupImages.length) })}</div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {typeof onCollectionFilterChange === 'function' ? (
              <div className="flex flex-wrap items-center gap-2">
                {COLLECTION_FILTER_OPTIONS.map(({ value, icon: Icon, labelKey }) => {
                  const translatedLabel = t(labelKey)
                  return (
                  <Button
                    key={value}
                    type="button"
                    size="icon-sm"
                    variant={collectionFilter === value ? 'default' : 'secondary'}
                    onClick={() => onCollectionFilterChange(value)}
                    aria-label={translatedLabel}
                    title={translatedLabel}
                  >
                    <Icon className="h-4 w-4" />
                  </Button>
                  )
                })}
              </div>
            ) : shouldShowCollectionCounts ? (
              <>
                <Badge variant="outline">manual {formatNumber(group.manual_added_count ?? 0)}</Badge>
                <Badge variant="outline">auto {formatNumber(group.auto_collected_count ?? 0)}</Badge>
              </>
            ) : null}
          </div>
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
          <AlertTitle>{t('groups.components.group.image.section.group.images.failed.to.load')}</AlertTitle>
          <AlertDescription>{errorMessage ?? t('groups.components.group.image.section.an.unknown.error.occurred')}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !isError && visibleGroupImages.length > 0 ? (
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
