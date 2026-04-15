import { FolderPlus, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthPermissionRedirect } from '@/features/auth/use-auth-permission-redirect'
import { GroupAssignModal } from '@/features/groups/components/group-assign-modal'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { ImageListColumnFloatingControl } from '@/features/images/components/image-list/image-list-column-floating-control'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import { useHomePageData } from './use-home-page-data'

/** Render the Home page with the reusable image list and header-driven search results. */
export function HomePage() {
  const { showSnackbar } = useSnackbar()
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
    isAnonymousSession,
    imagesQuery,
    groupsQuery,
    assignToGroupMutation,
    visibleImages,
    renderItemPersistentOverlay,
    shouldBlurItemPreview,
    selectedIds,
    setSelectedIds,
    selectedCompositeHashes,
    isDownloading,
    isAssignModalOpen,
    setIsAssignModalOpen,
    emptyStateTitle,
    emptyStateDescription,
    errorTitle,
    loadMoreErrorMessage,
    handleRetryInitialLoad,
    handleRetryNextPage,
    handleDownloadSelected,
    handleOpenAssignModal,
    handleAssignToGroup,
  } = useHomePageData({
    notifyInfo: (message) => showSnackbar({ message, tone: 'info' }),
    notifyError: (message) => showSnackbar({ message, tone: 'error' }),
  })

  useAuthPermissionRedirect({
    enabled: !authStatusQuery.isLoading && !canViewHome,
    permissionKey: 'page.home.view',
  })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  if (!canViewHome) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  return (
    <div className="space-y-8">
      {isAnonymousSession ? (
        <Card>
          <CardHeader className="gap-4">
            <div className="space-y-2">
              <CardTitle>익명 모드</CardTitle>
              <CardDescription>지금은 공개로 열어둔 홈만 볼 수 있어. 계속 쓰려면 로그인하면 돼.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/login">로그인</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/login">게스트 계정 만들기</Link>
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      {imagesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{errorTitle}</AlertTitle>
          <AlertDescription className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{imagesQuery.error instanceof Error ? imagesQuery.error.message : '알 수 없는 오류가 발생했어.'}</span>
            <Button size="sm" variant="outline" onClick={handleRetryInitialLoad}>
              다시 시도
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
        <Card>
          <CardHeader>
            <CardTitle>{emptyStateTitle}</CardTitle>
            <CardDescription>{emptyStateDescription}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!imagesQuery.isPending && !imagesQuery.isError && visibleImages.length > 0 ? (
        <>
          <ImageList
            items={visibleImages}
            layout="masonry"
            activationMode={isAnonymousSession ? 'navigate' : 'modal'}
            getItemHref={isAnonymousSession ? undefined : ((image) => (image.composite_hash ? `/images/${image.composite_hash}` : undefined))}
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
          />

          <div className="flex flex-col items-center gap-3 pb-6">
            {imagesQuery.isFetchingNextPage ? (
              <div className="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-container/92 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>이미지를 더 불러오는 중…</span>
              </div>
            ) : null}

            {imagesQuery.isFetchNextPageError ? (
              <div className="flex flex-col items-center gap-2 rounded-sm border border-border bg-surface-container/92 px-5 py-4 text-center shadow-sm backdrop-blur-sm">
                <p className="text-sm font-semibold">목록을 끝까지 불러오지 못했어</p>
                <p className="max-w-xl text-xs text-muted-foreground">{loadMoreErrorMessage}</p>
                <Button size="sm" variant="outline" onClick={handleRetryNextPage}>
                  다음 묶음 다시 시도
                </Button>
              </div>
            ) : null}
          </div>
          <ImageListColumnFloatingControl
            value={homeColumnCount}
            defaultValue={defaultHomeColumnCount}
            min={minHomeColumnCount}
            max={maxHomeColumnCount}
            title="홈 한 줄 카드 수"
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
                size="sm"
                variant="secondary"
                onClick={handleOpenAssignModal}
                disabled={assignToGroupMutation.isPending || groupsQuery.isPending}
                data-no-select-drag="true"
              >
                <FolderPlus className="h-4 w-4" />
                {assignToGroupMutation.isPending ? '그룹 추가 중…' : '그룹에 추가'}
              </Button>
            }
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
