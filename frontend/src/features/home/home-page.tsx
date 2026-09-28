import { FolderPlus, Loader2, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { ImageListColumnFloatingControl } from '@/features/images/components/image-list/image-list-column-floating-control'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import { SearchChipList } from '@/features/search/components/search-chip-list'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import { useHomeSearch } from './home-search-context'
import { useHomePageData } from './use-home-page-data'

/** Keep item href identity stable so memoized image cells skip keystroke re-renders. */
function getHomeImageHref(image: ImageRecord) {
  return image.composite_hash ? `/images/${image.composite_hash}` : undefined
}

/** Render the Home page with the reusable image list and header-driven search results. */
export function HomePage() {
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
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
    feedProgress,
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
    loadMoreErrorMessage,
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
    <div className="space-y-6">
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
              <Button asChild variant="outline">
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

      {imagesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{errorTitle}</AlertTitle>
          <AlertDescription className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{imagesQuery.error instanceof Error ? imagesQuery.error.message : t('homePage.anUnknownErrorOccurred')}</span>
            <Button size="sm" variant="outline" onClick={handleRetryInitialLoad}>
              {t({ ko: '다시 시도', en: 'Retry' })}
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

      {!imagesQuery.isPending && !imagesQuery.isError && visibleImages.length === 0 ? (
        <Section heading={emptyStateTitle} description={emptyStateDescription} />
      ) : null}

      {!imagesQuery.isPending && !imagesQuery.isError && visibleImages.length > 0 ? (
        <>
          <Inset className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {t(
                  { ko: '표시 {visible} / 로드 {loaded}', en: 'Showing {visible} / loaded {loaded}' },
                  { visible: formatNumber(feedProgress.visibleCount), loaded: formatNumber(feedProgress.loadedCount) },
                )}
              </span>
              <span>
                {/* The exact total arrives after the grid renders, so show the loaded
                    count with a "+" until it does instead of blocking on the count. */}
                {feedProgress.isTotalKnown
                  ? t(
                      { ko: '전체 {total}', en: '{total} total' },
                      { total: formatNumber(feedProgress.totalCount) },
                    )
                  : t(
                      { ko: '전체 {total}+', en: '{total}+ total' },
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
            {imagesQuery.isRefetching && !imagesQuery.isFetchingNextPage ? (
              <span>{t({ ko: '새로고침 중…', en: 'Refreshing…' })}</span>
            ) : null}
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
            hasMore={Boolean(imagesQuery.hasNextPage)}
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
          />

          <div className="flex flex-col items-center gap-3 pb-6">
            {imagesQuery.isFetchingNextPage ? (
              <Inset className="inline-flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t('homePage.loadingMoreImages')}</span>
              </Inset>
            ) : null}

            {Boolean(imagesQuery.hasNextPage) && !imagesQuery.isFetchingNextPage && !imagesQuery.isFetchNextPageError ? (
              <Button size="sm" variant="outline" onClick={() => void imagesQuery.fetchNextPage()}>
                {t({ ko: '더 보기', en: 'Load more' })}
              </Button>
            ) : null}

            {imagesQuery.isFetchNextPageError ? (
              <Section
                heading={t('homePage.couldNotLoadTheRest')}
                description={loadMoreErrorMessage}
                className="w-full max-w-xl"
                actions={
                  <Button size="sm" variant="outline" onClick={handleRetryNextPage}>
                    {t({ ko: '다음 묶음 다시 시도', en: 'Retry next batch' })}
                  </Button>
                }
              />
            ) : null}
          </div>
          <ImageListColumnFloatingControl
            value={homeColumnCount}
            defaultValue={defaultHomeColumnCount}
            min={minHomeColumnCount}
            max={maxHomeColumnCount}
            title={t('homePage.homeCardsPerRow')}
            onChange={setHomeColumnCount}
            onReset={resetHomeColumnCount}
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
              <Button
                size="icon-sm"
                variant="secondary"
                onClick={handleOpenAssignModal}
                disabled={assignToGroupMutation.isPending || groupsQuery.isPending}
                title={assignToGroupMutation.isPending ? t('homePage.addingToGroup') : t('homePage.addToGroup')}
                aria-label={assignToGroupMutation.isPending ? t('homePage.addingToGroup') : t('homePage.addToGroup')}
                data-no-select-drag="true"
              >
                <FolderPlus className="h-4 w-4" />
              </Button>
            }
            trailingActions={canDeleteImages ? (
              <Button
                size="icon-sm"
                variant="destructive"
                onClick={() => void handleDeleteSelected()}
                disabled={isDeleting || selectedCompositeHashes.length === 0}
                title={isDeleting ? t({ ko: '삭제 중', en: 'Deleting' }) : t({ ko: '선택 삭제', en: 'Delete selection' })}
                aria-label={isDeleting ? t({ ko: '삭제 중', en: 'Deleting' }) : t({ ko: '선택 삭제', en: 'Delete selection' })}
                data-no-select-drag="true"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : undefined}
            onDownloadSelect={handleDownloadSelected}
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
        </>
      ) : null}
    </div>
  )
}
