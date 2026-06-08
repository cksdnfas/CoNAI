import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleDot, Filter, FolderPlus, FolderTree, Loader2, RotateCw, Search, Sigma, Star, Tags, Undo2, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { PageHeader } from '@/components/common/page-header'
import { PageInset, PageSection } from '@/components/common/page-surface'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { useAuthPermissionRedirect } from '@/features/auth/use-auth-permission-redirect'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { buildComplexFilterPayload } from '@/features/search/search-utils'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { GroupAssignModal } from '@/features/groups/components/group-assign-modal'
import { addImagesToGroup, getGroupsHierarchyAll } from '@/lib/api-groups'
import { batchTagImages, getImages, getSimilarImages, searchImagesComplex } from '@/lib/api-images'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import {
  buildMediaReviewSearchChips,
  filterMediaReviewImages,
  getMediaReviewSignals,
  getMediaReviewSignalSummary,
  type MediaReviewQueueKey,
} from './media-review-utils'

type ReviewImagesPageParam = number | {
  cursorDate?: string | null
  cursorHash?: string | null
}

const REVIEW_QUEUE_OPTIONS: Array<{ value: MediaReviewQueueKey; icon: typeof Filter; label: { ko: string; en: string } }> = [
  { value: 'all', icon: Filter, label: { ko: '전체', en: 'All' } },
  { value: 'needs-review', icon: CheckCircle2, label: { ko: '검토 대기', en: 'Needs review' } },
  { value: 'reviewed', icon: CheckCircle2, label: { ko: '검토 완료', en: 'Reviewed' } },
  { value: 'ungrouped', icon: FolderTree, label: { ko: '그룹 없음', en: 'Ungrouped' } },
  { value: 'missing-tags', icon: Tags, label: { ko: '태그 없음', en: 'No tags' } },
  { value: 'sparse-tags', icon: Sigma, label: { ko: '태그 부족', en: 'Sparse tags' } },
  { value: 'unrated', icon: Star, label: { ko: '평가 없음', en: 'Unrated' } },
  { value: 'similar', icon: CircleDot, label: { ko: '유사', en: 'Similar' } },
  { value: 'recoverable', icon: Undo2, label: { ko: '복구 점검', en: 'Recover' } },
]

function getImageListId(image: ImageRecord) {
  return String(image.composite_hash ?? image.id)
}

function getImageCompositeHash(image: ImageRecord | null | undefined) {
  return typeof image?.composite_hash === 'string' && image.composite_hash.length > 0 ? image.composite_hash : null
}

function SignalTile({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Filter }) {
  return (
    <PageInset className="flex items-center gap-3 px-3 py-2">
      <Icon className="h-4 w-4 text-primary" />
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold text-foreground">{value}</div>
      </div>
    </PageInset>
  )
}

function BatchReviewPreview({
  selectedCount,
  selectedCompositeCount,
  reviewedCount,
  recoverableCount,
}: {
  selectedCount: number
  selectedCompositeCount: number
  reviewedCount: number
  recoverableCount: number
}) {
  const { t, formatNumber } = useI18n()

  return (
    <PageInset className="space-y-2 text-xs text-muted-foreground" data-media-review-batch-preview="true">
      <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
        <Badge>{t({ ko: '{count}개 선택', en: '{count} selected' }, { count: formatNumber(selectedCount) })}</Badge>
        <Badge variant="outline">{t({ ko: '활성 적용 가능 {count}', en: '{count} active actionable' }, { count: formatNumber(selectedCompositeCount) })}</Badge>
        {reviewedCount > 0 ? <Badge variant="outline">{t({ ko: '검토 완료 {count}', en: '{count} reviewed' }, { count: formatNumber(reviewedCount) })}</Badge> : null}
        {recoverableCount > 0 ? <Badge variant="outline">{t({ ko: '복구 점검 {count}', en: '{count} recovery checks' }, { count: formatNumber(recoverableCount) })}</Badge> : null}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <div>{t({ ko: '그룹: 선택 항목을 기존 사용자 그룹에 추가해. 삭제나 이동은 하지 않아.', en: 'Group: add selected items to an existing custom group without deleting or moving files.' })}</div>
        <div>{t({ ko: '태그/등급: 기존 태거 경로로 auto_tags와 rating_score를 다시 계산해.', en: 'Tags/rating: rerun the existing tagger path to refresh auto_tags and rating_score.' })}</div>
        <div>{t({ ko: '복구: 누락/삭제 상태는 정리하지 않고 검토 신호로만 남겨.', en: 'Recovery: missing/deleted states stay as review signals; this does not clean them up.' })}</div>
      </div>
    </PageInset>
  )
}

function ReviewSignalOverlay({ image, similarHashSet, reviewedIdSet }: { image: ImageRecord; similarHashSet: ReadonlySet<string>; reviewedIdSet: ReadonlySet<string> }) {
  const { t, formatNumber } = useI18n()
  const signals = getMediaReviewSignals(image, similarHashSet)
  const imageId = getImageListId(image)
  const tagLabel = signals.tagQuality === 'missing'
    ? t({ ko: '태그 없음', en: 'no tags' })
    : signals.tagQuality === 'sparse'
      ? t({ ko: '태그 {count}', en: '{count} tags' }, { count: formatNumber(signals.tagCount) })
      : t({ ko: '태그 {count}', en: '{count} tags' }, { count: formatNumber(signals.tagCount) })
  const ratingLabel = signals.ratingLabel ?? (signals.ratingScore === null ? t({ ko: '평가 없음', en: 'unrated' }) : formatNumber(signals.ratingScore))
  const recoveryLabel = signals.recoverabilityState === 'deleted'
    ? t({ ko: '휴지통 기록', en: 'recycled' })
    : signals.recoverabilityState === 'missing'
      ? t({ ko: '파일 누락', en: 'missing file' })
      : null

  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap gap-1">
      <Badge variant={signals.groupCount > 0 ? 'secondary' : 'outline'}>{t({ ko: '그룹 {count}', en: 'group {count}' }, { count: formatNumber(signals.groupCount) })}</Badge>
      <Badge variant={signals.tagQuality === 'ready' ? 'secondary' : 'outline'}>{tagLabel}</Badge>
      <Badge variant={signals.ratingScore === null && signals.ratingLabel === null ? 'outline' : 'secondary'}>{ratingLabel}</Badge>
      {signals.isSimilarMatch ? <Badge>{t({ ko: '유사', en: 'similar' })}</Badge> : null}
      {recoveryLabel ? <Badge variant="outline">{recoveryLabel}</Badge> : null}
      {reviewedIdSet.has(imageId) ? <Badge>{t({ ko: '검토 완료', en: 'reviewed' })}</Badge> : null}
    </div>
  )
}

/** Render a non-destructive media review workspace that combines existing search, group, tag, rating, and similarity signals. */
export function MediaReviewPage() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const canViewReview = hasAuthPermission(authStatusQuery.data?.permissionKeys, 'page.home.view')
  const [searchText, setSearchText] = useState('')
  const [appliedSearchText, setAppliedSearchText] = useState('')
  const [activeQueue, setActiveQueue] = useState<MediaReviewQueueKey>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [reviewedIds, setReviewedIds] = useState<string[]>([])
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)

  useAuthPermissionRedirect({
    enabled: !authStatusQuery.isLoading && !canViewReview,
    permissionKey: 'page.home.view',
  })

  const searchChips = useMemo(() => buildMediaReviewSearchChips(appliedSearchText), [appliedSearchText])
  const isSearchMode = searchChips.length > 0

  const imagesQuery = useInfiniteQuery({
    queryKey: ['media-review-images', searchChips],
    initialPageParam: (isSearchMode ? 1 : {}) as ReviewImagesPageParam,
    queryFn: ({ pageParam }) => {
      const typedPageParam = pageParam as ReviewImagesPageParam

      if (isSearchMode) {
        return searchImagesComplex({
          complex_filter: buildComplexFilterPayload(searchChips),
          page: typeof typedPageParam === 'number' ? typedPageParam : 1,
          limit: 48,
          sortBy: 'upload_date',
          sortOrder: 'DESC',
        })
      }

      const cursor = typeof typedPageParam === 'number' ? {} : typedPageParam
      return getImages({
        pagination: 'cursor',
        limit: 48,
        cursorDate: cursor.cursorDate,
        cursorHash: cursor.cursorHash,
      })
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) {
        return undefined
      }

      if (isSearchMode) {
        return lastPage.page + 1
      }

      if (!lastPage.nextCursorDate || !lastPage.nextCursorHash) {
        return undefined
      }

      return {
        cursorDate: lastPage.nextCursorDate,
        cursorHash: lastPage.nextCursorHash,
      }
    },
    enabled: canViewReview,
  })

  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', 'media-review'],
    queryFn: getGroupsHierarchyAll,
    enabled: canViewReview,
  })

  const loadedImages = useMemo(
    () => (imagesQuery.data?.pages ?? []).flatMap((page) => page.images),
    [imagesQuery.data?.pages],
  )
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const reviewedIdSet = useMemo(() => new Set(reviewedIds), [reviewedIds])
  const selectedAnchorImage = useMemo(
    () => loadedImages.find((image) => selectedIdSet.has(getImageListId(image))) ?? null,
    [loadedImages, selectedIdSet],
  )
  const selectedAnchorHash = getImageCompositeHash(selectedAnchorImage)

  const similarImagesQuery = useQuery({
    queryKey: ['media-review-similar-images', selectedAnchorHash],
    queryFn: ({ signal }) => getSimilarImages(selectedAnchorHash!, { threshold: 18, limit: 48, includeColorSimilarity: true }, { signal }),
    enabled: canViewReview && Boolean(selectedAnchorHash),
  })
  const similarHashSet = useMemo(
    () => new Set((similarImagesQuery.data?.similar ?? []).map((item) => item.image.composite_hash).filter((value): value is string => typeof value === 'string' && value.length > 0)),
    [similarImagesQuery.data?.similar],
  )
  const sourceSummary = useMemo(() => getMediaReviewSignalSummary(loadedImages, similarHashSet), [loadedImages, similarHashSet])
  const filteredImages = useMemo(
    () => filterMediaReviewImages(loadedImages, activeQueue, similarHashSet, reviewedIdSet),
    [activeQueue, loadedImages, reviewedIdSet, similarHashSet],
  )
  const {
    visibleItems,
    hasOnlyHiddenItems,
    renderItemPersistentOverlay: renderSafetyOverlay,
    shouldBlurItemPreview,
  } = useImageFeedSafety({
    items: filteredImages,
    enabled: canViewReview,
    hasMore: Boolean(imagesQuery.hasNextPage),
    isLoading: imagesQuery.isPending,
    isError: imagesQuery.isError,
    isLoadingMore: imagesQuery.isFetchingNextPage,
    onLoadMore: imagesQuery.fetchNextPage,
  })
  const visibleSummary = useMemo(() => getMediaReviewSignalSummary(visibleItems, similarHashSet), [similarHashSet, visibleItems])
  const selectedImages = useMemo(
    () => visibleItems.filter((image) => selectedIdSet.has(getImageListId(image))),
    [selectedIdSet, visibleItems],
  )
  const selectedActionableImages = useMemo(
    () => selectedImages.filter((image) => image.file_status !== 'missing' && image.file_status !== 'deleted'),
    [selectedImages],
  )
  const selectedCompositeHashes = useMemo(
    () => selectedActionableImages
      .map((image) => image.composite_hash)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
    [selectedActionableImages],
  )
  const selectedReviewedCount = useMemo(
    () => selectedImages.filter((image) => reviewedIdSet.has(getImageListId(image))).length,
    [reviewedIdSet, selectedImages],
  )
  const selectedRecoverableCount = selectedImages.length - selectedActionableImages.length

  const assignToGroupMutation = useMutation({
    mutationFn: ({ groupId, compositeHashes }: { groupId: number; compositeHashes: string[] }) => addImagesToGroup(groupId, compositeHashes),
    onSuccess: async (result) => {
      setIsAssignModalOpen(false)
      setSelectedIds([])
      showSnackbar({ message: result.message, tone: 'info' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all'] }),
        queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['media-review-images'] }),
      ])
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '선택 항목을 그룹에 추가하지 못했어.', en: 'Failed to add selected items to the group.' }), tone: 'error' })
    },
  })

  const batchTagMutation = useMutation({
    mutationFn: (compositeHashes: string[]) => batchTagImages(compositeHashes),
    onSuccess: async (result) => {
      setSelectedIds([])
      showSnackbar({
        message: result.fail_count > 0
          ? t({ ko: '태그/등급 재점검: 성공 {success}개, 실패 {failed}개', en: 'Tag/rating recheck: {success} succeeded, {failed} failed' }, { success: formatNumber(result.success_count), failed: formatNumber(result.fail_count) })
          : t({ ko: '태그/등급 {count}개 재점검 완료', en: '{count} tag/rating checks completed' }, { count: formatNumber(result.success_count) }),
        tone: result.fail_count > 0 ? 'error' : 'info',
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['media-review-images'] }),
        queryClient.invalidateQueries({ queryKey: ['home-images'] }),
        queryClient.invalidateQueries({ queryKey: ['image-detail'] }),
      ])
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '선택 항목 태그/등급 재점검에 실패했어.', en: 'Failed to recheck selected item tags and ratings.' }), tone: 'error' })
    },
  })

  const handleSubmitSearch = () => {
    setSelectedIds([])
    setAppliedSearchText(searchText.trim())
  }

  const handleClearSearch = () => {
    setSearchText('')
    setAppliedSearchText('')
    setSelectedIds([])
  }

  const handleOpenAssignModal = () => {
    if (selectedCompositeHashes.length === 0) {
      return
    }

    if (groupsQuery.isPending) {
      showSnackbar({ message: t({ ko: '사용자 그룹을 불러오는 중이야.', en: 'Loading custom groups.' }), tone: 'info' })
      return
    }

    if (groupsQuery.isError) {
      showSnackbar({ message: groupsQuery.error instanceof Error ? groupsQuery.error.message : t({ ko: '그룹 목록을 불러오지 못했어.', en: 'Failed to load groups.' }), tone: 'error' })
      return
    }

    if ((groupsQuery.data?.length ?? 0) === 0) {
      showSnackbar({ message: t({ ko: '먼저 사용자 그룹을 만들어야 해.', en: 'Create a custom group first.' }), tone: 'error' })
      return
    }

    setIsAssignModalOpen(true)
  }

  const handleAssignToGroup = async (groupId: number) => {
    await assignToGroupMutation.mutateAsync({
      groupId,
      compositeHashes: selectedCompositeHashes,
    })
  }

  const handleBatchTagSelected = () => {
    if (selectedCompositeHashes.length === 0 || batchTagMutation.isPending) {
      return
    }

    const confirmed = window.confirm(t({ ko: '선택한 {count}개 항목의 태그와 등급을 다시 계산할까?', en: 'Recalculate tags and ratings for {count} selected items?' }, { count: formatNumber(selectedCompositeHashes.length) }))
    if (!confirmed) {
      return
    }

    batchTagMutation.mutate(selectedCompositeHashes)
  }

  const handleMarkReviewed = () => {
    if (selectedIds.length === 0) {
      return
    }

    setReviewedIds((current) => Array.from(new Set([...current, ...selectedIds])))
    setSelectedIds([])
    showSnackbar({ message: t({ ko: '선택 항목을 검토 완료로 표시했어.', en: 'Marked selected items as reviewed.' }), tone: 'info' })
  }

  const handleReopenReview = () => {
    if (selectedIds.length === 0) {
      return
    }

    const selectedIdSnapshot = new Set(selectedIds)
    setReviewedIds((current) => current.filter((imageId) => !selectedIdSnapshot.has(imageId)))
    setSelectedIds([])
    showSnackbar({ message: t({ ko: '선택 항목을 검토 대기로 돌렸어.', en: 'Moved selected items back to needs review.' }), tone: 'info' })
  }

  const renderReviewOverlay = (image: ImageRecord): ReactNode => {
    const safetyOverlay = renderSafetyOverlay(image)

    return (
      <>
        {safetyOverlay}
        <ReviewSignalOverlay image={image} similarHashSet={similarHashSet} reviewedIdSet={reviewedIdSet} />
      </>
    )
  }

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  if (!canViewReview) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t({ ko: '미디어', en: 'Media' })}
        title={t('pageAccessCatalog.review')}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/groups">{t({ ko: '그룹으로 이동', en: 'Open groups' })}</Link>
          </Button>
        }
      />

      <PageSection
        title={t({ ko: '리뷰 큐', en: 'Review queue' })}
        actions={
          <form
            className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
            onSubmit={(event) => {
              event.preventDefault()
              handleSubmitSearch()
            }}
          >
            <div className="relative min-w-[min(22rem,100%)]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9 pr-9"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder={t({ ko: '프롬프트, 태그, 모델 검색', en: 'Search prompt, tag, model' })}
              />
              {searchText || appliedSearchText ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-high hover:text-foreground"
                  onClick={handleClearSearch}
                  aria-label={t({ ko: '검색 지우기', en: 'Clear search' })}
                  title={t({ ko: '검색 지우기', en: 'Clear search' })}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <Button type="submit" size="sm">{t({ ko: '검색', en: 'Search' })}</Button>
          </form>
        }
      >
        <SegmentedTabBar
          value={activeQueue}
          items={REVIEW_QUEUE_OPTIONS.map(({ value, icon: Icon, label }) => ({
            value,
            label: t(label),
            icon: Icon,
          }))}
          onChange={(value) => {
            setActiveQueue(value as MediaReviewQueueKey)
            setSelectedIds([])
          }}
          size="sm"
          fullWidth
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <SignalTile label={t({ ko: '표시', en: 'Showing' })} value={`${formatNumber(visibleItems.length)} / ${formatNumber(filteredImages.length)}`} icon={Filter} />
          <SignalTile label={t({ ko: '그룹 없음', en: 'Ungrouped' })} value={formatNumber(visibleSummary.ungroupedCount)} icon={FolderTree} />
          <SignalTile label={t({ ko: '태그 점검', en: 'Tag review' })} value={formatNumber(visibleSummary.missingTagCount + visibleSummary.sparseTagCount)} icon={Tags} />
          <SignalTile label={t({ ko: '유사 매칭', en: 'Similar matches' })} value={formatNumber(visibleSummary.similarCount)} icon={CircleDot} />
          <SignalTile label={t({ ko: '복구 점검', en: 'Recovery checks' })} value={formatNumber(visibleSummary.recoverableCount)} icon={Undo2} />
        </div>

        <PageInset className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t({ ko: '로드 {count}', en: '{count} loaded' }, { count: formatNumber(sourceSummary.totalCount) })}</span>
            <span>{t({ ko: '전체 그룹 {count}', en: '{count} groups' }, { count: formatNumber(groupsQuery.data?.length ?? 0) })}</span>
            <span>{t({ ko: '평가 없음 {count}', en: '{count} unrated' }, { count: formatNumber(sourceSummary.unratedCount) })}</span>
            {appliedSearchText ? <Badge variant="outline">{appliedSearchText}</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedAnchorHash ? (
              <Badge>{t({ ko: '유사 기준 선택됨', en: 'similarity anchor selected' })}</Badge>
            ) : (
              <Badge variant="outline">{t({ ko: '유사 기준 없음', en: 'no similarity anchor' })}</Badge>
            )}
            {similarImagesQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          </div>
        </PageInset>

        <PageInset className="text-xs text-muted-foreground" data-media-review-cleanup-guardrail="true">
          {t({
            ko: '이 화면의 일괄 작업은 그룹 추가, 태그/등급 재점검, 검토 상태 표시까지만 수행해. 파일 삭제, 휴지통 비우기, 영구 정리는 여기서 실행하지 않아.',
            en: 'Batch actions here only add groups, recheck tags/ratings, or mark review state. File deletion, recycle-bin emptying, and permanent cleanup do not run from this workspace.',
          })}
        </PageInset>
      </PageSection>

      {imagesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t({ ko: '리뷰 항목을 불러오지 못했어', en: 'Could not load review items' })}</AlertTitle>
          <AlertDescription className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{imagesQuery.error instanceof Error ? imagesQuery.error.message : t({ ko: '알 수 없는 오류가 발생했어.', en: 'An unknown error occurred.' })}</span>
            <Button size="sm" variant="outline" onClick={() => void imagesQuery.refetch()}>
              {t({ ko: '다시 시도', en: 'Retry' })}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {imagesQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-[260px] rounded-sm" />
          ))}
        </div>
      ) : null}

      {!imagesQuery.isPending && !imagesQuery.isError && visibleItems.length === 0 ? (
        <PageInset className="text-sm text-muted-foreground">
          {hasOnlyHiddenItems
            ? t({ ko: '현재 등급 표시 정책 때문에 이 큐에서는 숨겨진 상태야.', en: 'Items are hidden in this queue by the current rating visibility policy.' })
            : activeQueue === 'similar' && !selectedAnchorHash
              ? t({ ko: '유사도 기준으로 삼을 이미지를 먼저 선택해.', en: 'Select an image to use as the similarity anchor.' })
              : t({ ko: '이 큐에 표시할 항목이 없어.', en: 'No items in this queue.' })}
        </PageInset>
      ) : null}

      {!imagesQuery.isPending && !imagesQuery.isError && visibleItems.length > 0 ? (
        <>
          {selectedIds.length > 0 ? (
            <BatchReviewPreview
              selectedCount={selectedIds.length}
              selectedCompositeCount={selectedCompositeHashes.length}
              reviewedCount={selectedReviewedCount}
              recoverableCount={selectedRecoverableCount}
            />
          ) : null}

          <ImageList
            items={visibleItems}
            resetKey={`media-review:${activeQueue}:${appliedSearchText}`}
            layout="grid"
            activationMode="modal"
            getItemId={getImageListId}
            getItemHref={(image) => (image.composite_hash ? `/images/${image.composite_hash}` : undefined)}
            selectable
            forceSelectionMode
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            hasMore={Boolean(imagesQuery.hasNextPage)}
            isLoadingMore={imagesQuery.isFetchingNextPage}
            onLoadMore={imagesQuery.fetchNextPage}
            minColumnWidth={220}
            columnGap={16}
            rowGap={16}
            gridItemHeight={250}
            renderItemPersistentOverlay={renderReviewOverlay}
            shouldBlurItemPreview={shouldBlurItemPreview}
          />

          <div className="flex flex-col items-center gap-3 pb-6">
            {imagesQuery.isFetchingNextPage ? (
              <PageInset className="inline-flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t('homePage.loadingMoreImages')}</span>
              </PageInset>
            ) : null}

            {Boolean(imagesQuery.hasNextPage) && !imagesQuery.isFetchingNextPage ? (
              <Button size="sm" variant="outline" onClick={() => void imagesQuery.fetchNextPage()}>
                {t({ ko: '더 보기', en: 'Load more' })}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      <ImageSelectionBar
        selectedCount={selectedIds.length}
        downloadableCount={selectedCompositeHashes.length}
        showDownloadAction={false}
        statusText={t({ ko: '활성 항목에만 그룹, 태그/등급, 검토 상태 적용. 삭제/정리 없음', en: 'Apply group, tag/rating, and review state to active items only. No deletion or cleanup.' })}
        extraActions={
          <>
            <Button
              size="icon-sm"
              variant="secondary"
              onClick={handleOpenAssignModal}
              disabled={assignToGroupMutation.isPending || groupsQuery.isPending || selectedCompositeHashes.length === 0}
              title={assignToGroupMutation.isPending ? t({ ko: '그룹 추가 중', en: 'Adding to group' }) : t({ ko: '그룹에 추가', en: 'Add to group' })}
              aria-label={assignToGroupMutation.isPending ? t({ ko: '그룹 추가 중', en: 'Adding to group' }) : t({ ko: '그룹에 추가', en: 'Add to group' })}
              data-no-select-drag="true"
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="secondary"
              onClick={handleBatchTagSelected}
              disabled={batchTagMutation.isPending || selectedCompositeHashes.length === 0}
              title={batchTagMutation.isPending ? t({ ko: '재점검 중', en: 'Rechecking' }) : t({ ko: '태그/등급 재점검', en: 'Recheck tags and ratings' })}
              aria-label={batchTagMutation.isPending ? t({ ko: '재점검 중', en: 'Rechecking' }) : t({ ko: '태그/등급 재점검', en: 'Recheck tags and ratings' })}
              data-no-select-drag="true"
            >
              {batchTagMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            </Button>
            <Button
              size="icon-sm"
              variant="secondary"
              onClick={handleMarkReviewed}
              disabled={selectedIds.length === 0}
              title={t({ ko: '검토 완료 표시', en: 'Mark reviewed' })}
              aria-label={t({ ko: '검토 완료 표시', en: 'Mark reviewed' })}
              data-no-select-drag="true"
            >
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          </>
        }
        trailingActions={selectedReviewedCount > 0 ? (
          <Button
            size="icon-sm"
            variant="outline"
            onClick={handleReopenReview}
            title={t({ ko: '검토 대기로 되돌리기', en: 'Move back to needs review' })}
            aria-label={t({ ko: '검토 대기로 되돌리기', en: 'Move back to needs review' })}
            data-no-select-drag="true"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        ) : undefined}
        onClear={() => setSelectedIds([])}
      />

      <GroupAssignModal
        open={isAssignModalOpen}
        groups={groupsQuery.data ?? []}
        selectedCount={selectedCompositeHashes.length}
        isSubmitting={assignToGroupMutation.isPending}
        onClose={() => setIsAssignModalOpen(false)}
        onSubmit={handleAssignToGroup}
      />
    </div>
  )
}
