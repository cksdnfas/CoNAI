import { ImagePermissionNotice } from '@/features/images/components/image-permission-notice'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { FolderPlus, ImageOff, SearchX, Trash2, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { CountSummary } from '@/components/ui/count-summary'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { PageToolbar } from '@/components/common/page-toolbar'
import { Section } from '@/components/ui/section'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { AuthStatusErrorState } from '@/features/auth/require-auth-permission'
import { useAuthPermissionRedirect } from '@/features/auth/use-auth-permission-redirect'
import { GroupAssignModal } from '@/features/groups/components/group-assign-modal'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { ImageBatchResizeAction } from '@/features/images/components/image-batch-resize-action'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { ImageListFeedFooter } from '@/features/images/components/image-list/image-list-feed-footer'
import { ImageListColumnFloatingControl } from '@/features/images/components/image-list/image-list-column-floating-control'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import { SelectionBarAction } from '@/components/common/selection-action-bar'
import { SearchChipStrip } from '@/features/search/components/search-chip-strip'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatPageDataPermissions } from '@/features/codex-chat/use-chat-page-permissions'
import { COUNT_UNITS } from '@/lib/count-display'
import { cn } from '@/lib/utils'
import type { ImageViewModalAccessOptions } from '@/features/images/components/detail/image-view-modal-context'
import type { ImageRecord } from '@/types/image'
import { HomeSortMenu } from './components/home-sort-menu'
import { useHomeSearch } from './home-search-context'
import { useHomePageData } from './use-home-page-data'

/** Library images can be deleted from the viewer (still admin-only). Module constant keeps ImageList memoized. */
const HOME_VIEWER_ACCESS_OPTIONS: ImageViewModalAccessOptions = { allowDeleteAction: true }
// Signed-out visitors only look: no delete, group assignment or editing from the viewer.
const ANONYMOUS_VIEWER_ACCESS_OPTIONS: ImageViewModalAccessOptions = { allowGroupAssignAction: false, allowEditAction: false }

/** Keep item href identity stable so memoized image cells skip keystroke re-renders. */
function getHomeImageHref(image: ImageRecord) {
  return image.composite_hash ? `/images/${image.composite_hash}` : undefined
}

function getHomeImageSelectionId(image: ImageRecord) {
  return String(image.composite_hash ?? image.id)
}

/** Render the Home page with the reusable image list and header-driven search results. */
export function HomePage() {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const { appliedChips, removeAppliedChip, cycleAppliedChipOperator, clearAppliedChips, searchScope, searchInput, setSearchInput, addScopedTextChip } = useHomeSearch()
  const {
    columnCount: homeColumnCount,
    setColumnCount: setHomeColumnCount,
    resetColumnCount: resetHomeColumnCount,
    defaultColumnCount: defaultHomeColumnCount,
    minColumnCount: minHomeColumnCount,
    maxColumnCount: maxHomeColumnCount,
    viewportClass,
  } = useImageListColumnPreference('home')
  const {
    authStatusQuery,
    canViewHome,
    canAssignGroups,
    canDeleteImages,
    isAnonymousSession,
    imagesQuery,
    groupsQuery,
    assignToGroupMutation,
    visibleImages,
    imageListResetKey,
    sortOrder,
    setSortOrder,
    canAutoLoadMore,
    feedCountState,
    feedSequenceTotal,
    renderItemPersistentOverlay,
    shouldBlurItemPreview,
    selectedIds,
    setSelectedIds,
    selectedCompositeHashes,
    isDownloading,
    isDeleting,
    isAssignModalOpen,
    setIsAssignModalOpen,
    emptyStateTitle,
    emptyStateDescription,
    errorTitle,
    handleRetryInitialLoad,
    handleRetryNextPage,
    handleDownloadSelected,
    handleDeleteSelected,
    handleOpenAssignModal,
    handleAssignToGroup,
  } = useHomePageData({
    notifyInfo: (message) => showSnackbar({ message, tone: 'info' }),
    notifyError: (message) => showSnackbar({ message, tone: 'error' }),
  })

  const isAuthStatusUnavailable = authStatusQuery.isError && !canViewHome
  const { canViewImages: canOpenImages, canCreateImageCopies } = useImagePermissions()
  const firstSelectedImage = selectedCompositeHashes.length > 0
    ? visibleImages.find((image) => image.composite_hash === selectedCompositeHashes[0]) ?? null
    : null
  // A failed next page or background refetch keeps the loaded images on screen; only a failed first load replaces them.
  const hasFeedData = (imagesQuery.data?.pages.length ?? 0) > 0
  const isInitialLoadError = imagesQuery.isError && !hasFeedData

  useAuthPermissionRedirect({
    enabled: !authStatusQuery.isLoading && !isAuthStatusUnavailable && !canViewHome,
    permissionKey: 'page.home.view',
  })

  const chatCanReadImages = useChatPageDataPermissions().canReadImages
  const navigate = useNavigate()
  const chatOpenableHashes = chatCanReadImages ? visibleImages.slice(0, 100).map((image) => image.composite_hash ?? '').filter(Boolean) : []
  useChatPageRegistration(canViewHome && !isAnonymousSession ? {
    kind: 'library', title: t({ ko: '이미지 라이브러리', en: 'Image library' }), resourceId: `library:${viewportClass}`,
    fields: [
      { id: 'sortOrder', label: t({ ko: '정렬 (newest: 최신순, oldest: 오래된순)', en: 'Sort (newest or oldest)' }), type: 'select', value: sortOrder, options: ['newest', 'oldest'] },
      { id: 'searchInput', label: t({ ko: '검색어 입력 (Enter로 검색 실행)', en: 'Search draft (press Enter to search)' }), type: 'text', value: searchInput },
      { id: 'searchScope', label: t({ ko: '검색 범위', en: 'Search scope' }), type: 'text', value: searchScope, editable: false },
      { id: 'columns', label: t({ ko: '한 줄의 이미지 수', en: 'Images per row' }), type: 'number', value: homeColumnCount, min: minHomeColumnCount, max: maxHomeColumnCount, integer: true },
    ],
    data: { filters: JSON.parse(JSON.stringify(appliedChips)), selected: { imageIds: selectedIds }, images: chatCanReadImages ? visibleImages.slice(0, 100).map((image) => ({ hash: image.composite_hash ?? '', width: image.width ?? 0, height: image.height ?? 0 })) : [] },
    actions: [
      pageAction('library.search', t({ ko: '검색 실행', en: 'Run a search' }), t({ ko: '검색어를 넣고 바로 검색해. 결과 화면이 돌아와.', en: 'Search right away; the results come back.' }), pageObject({ query: pageText(500) }, ['query'])),
      ...(chatOpenableHashes.length ? [pageAction('library.select', t({ ko: '이미지 선택', en: 'Select images' }), t({ ko: '목록(data.images)의 이미지를 선택해. 빈 목록이면 선택을 풀어. 선택한 이미지로 하단 작업줄(그룹 담기·다운로드)을 쓸 수 있어.', en: 'Select listed images (data.images); an empty list clears the selection.' }), pageObject({ hashes: pageArray(pageChoice(chatOpenableHashes), 100) }, ['hashes']))] : []),
      ...(chatOpenableHashes.length ? [pageAction('library.open', t({ ko: '이미지 열기', en: 'Open image' }), t({ ko: '목록(data.images)의 이미지 상세를 열어.', en: 'Open a listed image (data.images).' }), pageObject({ hash: pageChoice(chatOpenableHashes) }, ['hash']))] : []),
    ],
    applyAction: (id, args, assertCurrent) => {
      assertCurrent()
      // Applied straight away with the search drawer closed, so the chat panel stays where it is.
      if (id === 'library.search') {
        if (!addScopedTextChip(searchScope === 'rating' || searchScope === 'tool' ? 'positive' : searchScope, String(args.query), { apply: true })) throw new Error('검색어가 비었어.')
        return
      }
      if (id === 'library.open') { void navigate(`/images/${encodeURIComponent(String(args.hash))}`); return }
      if (id === 'library.select' && Array.isArray(args.hashes)) {
        const wanted = new Set(args.hashes.map(String))
        setSelectedIds(visibleImages.filter((image) => wanted.has(image.composite_hash ?? '')).map(getHomeImageSelectionId))
        return
      }
      throw new Error('라이브러리에 없는 작업이야.')
    },
    apply: (patch) => {
      if (patch.searchInput !== undefined) setSearchInput(String(patch.searchInput))
      if (patch.sortOrder !== undefined) setSortOrder(patch.sortOrder === 'oldest' ? 'oldest' : 'newest')
      if (patch.columns !== undefined) setHomeColumnCount(Number(patch.columns))
    },
  } : null, { preserveOnSearchChange: true })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-fill animate-pulse" />
  }

  if (isAuthStatusUnavailable) {
    return (
      <AuthStatusErrorState
        error={authStatusQuery.error}
        isRetrying={authStatusQuery.isFetching}
        onRetry={() => void authStatusQuery.refetch()}
      />
    )
  }

  if (!canViewHome) {
    return <div className="min-h-[40vh] rounded-sm bg-fill animate-pulse" />
  }

  if (!canOpenImages) return <ImagePermissionNotice />

  return (
    // Leave room under the list for the fixed selection bar while it is up.
    <div className={cn('space-y-4', selectedIds.length > 0 && 'pb-24')}>
      <PageToolbar
        start={hasFeedData ? (
          <div className="flex items-center gap-3 text-sm">
            {/* The one count on Home: the real total ("계산 중" until the deferred count arrives). */}
            <CountSummary {...feedCountState} unit={COUNT_UNITS.images} className="font-semibold text-foreground" />
            {imagesQuery.isRefetching && !imagesQuery.isFetchingNextPage ? (
              <LoadingState variant="inline" spinnerSize="sm" label={t({ ko: '새로고침 중…', en: 'Refreshing…' })} className="text-xs text-muted-foreground" />
            ) : null}
          </div>
        ) : undefined}
        actions={(
          <>
            {!isAnonymousSession && appliedChips.length > 0 ? (
              <IconButton size="icon-sm" variant="ghost" label={t({ ko: '필터 모두 지우기', en: 'Clear all filters' })} onClick={clearAppliedChips}>
                <X className="size-4" />
              </IconButton>
            ) : null}
            <HomeSortMenu value={sortOrder} onChange={setSortOrder} />
          </>
        )}
      >
        {!isAnonymousSession && appliedChips.length > 0 ? (
          <SearchChipStrip chips={appliedChips} onCycleOperator={cycleAppliedChipOperator} onRemove={removeAppliedChip} />
        ) : null}
      </PageToolbar>

      {isAnonymousSession ? (
        <Section
          heading={t('homePage.anonymousMode')}
          actions={
            <>
              <Button asChild>
                <Link to="/login">{t('homePage.signIn')}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/login">{t('homePage.createGuestAccount')}</Link>
              </Button>
            </>
          }
        />
      ) : null}

      {isInitialLoadError ? (
        <ErrorState
          title={errorTitle}
          error={imagesQuery.error}
          onRetry={handleRetryInitialLoad}
          isRetrying={imagesQuery.isFetching}
        />
      ) : null}

      {imagesQuery.isPending ? (
        <section className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="mb-4 break-inside-avoid overflow-hidden rounded-sm">
              <Skeleton className="min-h-[280px] w-full rounded-sm" />
            </div>
          ))}
        </section>
      ) : null}

      {hasFeedData && visibleImages.length === 0 ? (
        <EmptyState
          icon={appliedChips.length > 0 ? SearchX : ImageOff}
          title={emptyStateTitle}
          description={emptyStateDescription}
          action={!isAnonymousSession && appliedChips.length > 0 ? (
            <Button size="sm" variant="secondary" onClick={clearAppliedChips}>
              {t({ ko: '필터 모두 지우기', en: 'Clear all filters' })}
            </Button>
          ) : undefined}
        />
      ) : null}

      {hasFeedData && visibleImages.length > 0 ? (
        <>
          {/* 스크롤을 따라다니는 칼럼 설정. 선택 바가 떠 있으면 그 위로 비켜 선다. */}
          <ImageListColumnFloatingControl
            value={homeColumnCount}
            defaultValue={defaultHomeColumnCount}
            min={minHomeColumnCount}
            max={maxHomeColumnCount}
            onChange={setHomeColumnCount}
            onReset={resetHomeColumnCount}
            className={selectedIds.length > 0 ? 'bottom-24' : undefined}
          />

          <ImageList
            items={visibleImages}
            resetKey={imageListResetKey}
            layout="masonry"
            activationMode={canOpenImages ? 'modal' : 'none'}
            getItemHref={canOpenImages ? getHomeImageHref : undefined}
            selectable={!isAnonymousSession}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            hasMore={canAutoLoadMore}
            isLoadingMore={imagesQuery.isFetchingNextPage}
            onLoadMore={imagesQuery.fetchNextPage}
            minColumnWidth={300}
            preferredColumnCount={homeColumnCount}
            columnGap={12}
            rowGap={12}
            gridItemHeight={280}
            renderItemPersistentOverlay={renderItemPersistentOverlay}
            shouldBlurItemPreview={shouldBlurItemPreview}
            sequenceTotal={feedSequenceTotal}
            modalAccessOptions={isAnonymousSession ? ANONYMOUS_VIEWER_ACCESS_OPTIONS : HOME_VIEWER_ACCESS_OPTIONS}
          />

          <ImageListFeedFooter
            itemCount={visibleImages.length}
            hasMore={Boolean(imagesQuery.hasNextPage)}
            isLoadingMore={imagesQuery.isFetchingNextPage}
            loadMoreError={imagesQuery.isFetchNextPageError ? imagesQuery.error : null}
            onRetry={handleRetryNextPage}
          />
        </>
      ) : null}

      {!isAnonymousSession ? (
        <>
          <ImageSelectionBar
            selectedCount={selectedIds.length}
            downloadableCount={selectedCompositeHashes.length}
            isDownloading={isDownloading}
            extraActions={canAssignGroups || canCreateImageCopies ? (
              <>
                {canAssignGroups ? (
                  <SelectionBarAction
                    icon={FolderPlus}
                    label={assignToGroupMutation.isPending ? t('homePage.addingToGroup') : t('homePage.addToGroup')}
                    onClick={handleOpenAssignModal}
                    disabled={assignToGroupMutation.isPending || groupsQuery.isPending}
                  />
                ) : null}
                {canCreateImageCopies ? (
                  <ImageBatchResizeAction compositeHashes={selectedCompositeHashes} referenceSize={firstSelectedImage} />
                ) : null}
              </>
            ) : null}
            trailingActions={canDeleteImages ? (
              <SelectionBarAction
                icon={Trash2}
                label={isDeleting ? t({ ko: '삭제 중', en: 'Deleting' }) : t({ ko: '선택 삭제', en: 'Delete selection' })}
                variant="destructive"
                onClick={() => void handleDeleteSelected()}
                disabled={isDeleting || selectedCompositeHashes.length === 0}
              />
            ) : undefined}
            onDownloadSelect={handleDownloadSelected}
            onClear={() => setSelectedIds([])}
            loadedCount={visibleImages.length}
            onSelectAllLoaded={() => setSelectedIds(visibleImages.map(getHomeImageSelectionId))}
          />

          <GroupAssignModal
            open={isAssignModalOpen}
            groups={groupsQuery.data ?? []}
            selectedCount={selectedCompositeHashes.length}
            isSubmitting={assignToGroupMutation.isPending}
            onClose={() => setIsAssignModalOpen(false)}
            onSubmit={handleAssignToGroup}
          />
        </>
      ) : null}
    </div>
  )
}
