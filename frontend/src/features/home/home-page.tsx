import { FolderPlus, ImageOff, SearchX, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CountSummary } from '@/components/ui/count-summary'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { PageHeader } from '@/components/common/page-header'
import { Inset } from '@/components/ui/inset'
import { Section } from '@/components/ui/section'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { AuthStatusErrorState } from '@/features/auth/require-auth-permission'
import { useAuthPermissionRedirect } from '@/features/auth/use-auth-permission-redirect'
import { GroupAssignModal } from '@/features/groups/components/group-assign-modal'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { ImageListFeedFooter } from '@/features/images/components/image-list/image-list-feed-footer'
import { ImageListColumnControl } from '@/features/images/components/image-list/image-list-column-control'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import { SelectionBarAction } from '@/components/common/selection-action-bar'
import { SearchChipList } from '@/features/search/components/search-chip-list'
import { useI18n } from '@/i18n'
import { COUNT_UNITS } from '@/lib/count-display'
import { cn } from '@/lib/utils'
import type { ImageViewModalAccessOptions } from '@/features/images/components/detail/image-view-modal-context'
import type { ImageRecord } from '@/types/image'
import { HomeSortMenu } from './components/home-sort-menu'
import { useHomeSearch } from './home-search-context'
import { useHomePageData } from './use-home-page-data'

/** Library images can be deleted from the viewer (still admin-only). Module constant keeps ImageList memoized. */
const HOME_VIEWER_ACCESS_OPTIONS: ImageViewModalAccessOptions = { allowDeleteAction: true }

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
  const { appliedChips, removeAppliedChip, cycleAppliedChipOperator, clearAppliedChips } = useHomeSearch()
  const {
    columnCount: homeColumnCount,
    setColumnCount: setHomeColumnCount,
    resetColumnCount: resetHomeColumnCount,
    defaultColumnCount: defaultHomeColumnCount,
    minColumnCount: minHomeColumnCount,
    maxColumnCount: maxHomeColumnCount,
  } = useImageListColumnPreference('home')
  const {
    authStatusQuery,
    canViewHome,
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
  // A failed next page or background refetch keeps the loaded images on screen; only a failed first load replaces them.
  const hasFeedData = (imagesQuery.data?.pages.length ?? 0) > 0
  const isInitialLoadError = imagesQuery.isError && !hasFeedData

  useAuthPermissionRedirect({
    enabled: !authStatusQuery.isLoading && !isAuthStatusUnavailable && !canViewHome,
    permissionKey: 'page.home.view',
  })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
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
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  return (
    // Leave room under the list for the fixed selection bar while it is up.
    <div className={cn('space-y-6', selectedIds.length > 0 && 'pb-24')}>
      <PageHeader eyebrow={isAnonymousSession ? t({ ko: '공개', en: 'Public' }) : undefined} title={t('pageAccessCatalog.home')} />

      {isAnonymousSession ? (
        <Section
          heading={t('homePage.anonymousMode')}
          description={t('homePage.onlyThePublicHomeView')}
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

      {!isAnonymousSession && appliedChips.length > 0 ? (
        <Inset className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t({ ko: '적용된 필터', en: 'Active filters' })}</div>
            <Button size="sm" variant="ghost" onClick={clearAppliedChips}>
              {t({ ko: '모두 지우기', en: 'Clear all' })}
            </Button>
          </div>
          <SearchChipList chips={appliedChips} title={null} onCycleOperator={cycleAppliedChipOperator} onRemove={removeAppliedChip} />
        </Inset>
      ) : null}

      {isInitialLoadError ? (
        <ErrorState
          title={errorTitle}
          description={t({ ko: '잠시 뒤에 다시 시도해 줘.', en: 'Try again in a moment.' })}
          error={imagesQuery.error}
          onRetry={handleRetryInitialLoad}
          isRetrying={imagesQuery.isFetching}
        />
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
          <Inset className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              {/* The one count on Home: the real total ("계산 중" until the deferred count arrives). */}
              <CountSummary {...feedCountState} unit={COUNT_UNITS.images} className="text-sm font-medium text-foreground" />
              {imagesQuery.isRefetching && !imagesQuery.isFetchingNextPage ? (
                <LoadingState variant="inline" spinnerSize="sm" label={t({ ko: '새로고침 중…', en: 'Refreshing…' })} className="text-xs" />
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <HomeSortMenu value={sortOrder} onChange={setSortOrder} />
              <ImageListColumnControl
                value={homeColumnCount}
                defaultValue={defaultHomeColumnCount}
                min={minHomeColumnCount}
                max={maxHomeColumnCount}
                onChange={setHomeColumnCount}
                onReset={resetHomeColumnCount}
              />
            </div>
          </Inset>

          <ImageList
            items={visibleImages}
            resetKey={imageListResetKey}
            layout="masonry"
            activationMode={isAnonymousSession ? 'none' : 'modal'}
            getItemHref={isAnonymousSession ? undefined : getHomeImageHref}
            selectable={!isAnonymousSession}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            hasMore={canAutoLoadMore}
            isLoadingMore={imagesQuery.isFetchingNextPage}
            onLoadMore={imagesQuery.fetchNextPage}
            minColumnWidth={300}
            preferredColumnCount={homeColumnCount}
            columnGap={24}
            rowGap={24}
            gridItemHeight={280}
            renderItemPersistentOverlay={renderItemPersistentOverlay}
            shouldBlurItemPreview={shouldBlurItemPreview}
            sequenceTotal={feedSequenceTotal}
            modalAccessOptions={HOME_VIEWER_ACCESS_OPTIONS}
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
            extraActions={
              <SelectionBarAction
                icon={FolderPlus}
                label={assignToGroupMutation.isPending ? t('homePage.addingToGroup') : t('homePage.addToGroup')}
                onClick={handleOpenAssignModal}
                disabled={assignToGroupMutation.isPending || groupsQuery.isPending}
              />
            }
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
