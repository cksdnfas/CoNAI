import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { GroupAssignModal } from '@/features/groups/components/group-assign-modal'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useHomeSearch } from '@/features/home/home-search-context'
import { buildComplexFilterPayload } from '@/features/search/search-utils'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { ImageRatingSafetyBadge, resolveImageFeedSafety } from '@/features/images/components/image-list/image-rating-safety'
import { useHomeScrollRestoration } from '@/features/home/use-home-scroll-restoration'
import { addImagesToGroup, downloadImageSelection, getGroupsHierarchyAll, getImages, searchImagesComplex } from '@/lib/api'
import { getRatingTiers } from '@/lib/api-search'

/** Render the Home page with the reusable image list and header-driven search results. */
export function HomePage() {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const authStatusQuery = useAuthStatusQuery()
  const { appliedChips } = useHomeSearch()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isDownloading, setIsDownloading] = useState(false)
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)

  const canViewHome = hasAuthPermission(authStatusQuery.data?.permissionKeys, 'page.home.view')
  const hasCredentials = authStatusQuery.data?.hasCredentials === true
  const isAuthenticated = authStatusQuery.data?.authenticated === true
  const isAnonymousSession = hasCredentials && !isAuthenticated
  const isSearchMode = !isAnonymousSession && appliedChips.length > 0

  const imagesQuery = useInfiniteQuery({
    queryKey: ['home-images', appliedChips],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      isSearchMode
        ? searchImagesComplex({
            complex_filter: buildComplexFilterPayload(appliedChips),
            page: pageParam,
            limit: 40,
            sortBy: 'upload_date',
            sortOrder: 'DESC',
          })
        : getImages({ page: pageParam, limit: 40 }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
    enabled: canViewHome,
  })

  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', 'custom'],
    queryFn: getGroupsHierarchyAll,
    enabled: canViewHome && !isAnonymousSession,
  })

  const ratingTiersQuery = useQuery({
    queryKey: ['rating-tiers'],
    queryFn: getRatingTiers,
    enabled: canViewHome,
    staleTime: 60_000,
  })

  const assignToGroupMutation = useMutation({
    mutationFn: ({ groupId, compositeHashes }: { groupId: number; compositeHashes: string[] }) => addImagesToGroup(groupId, compositeHashes),
    onSuccess: async (result) => {
      setIsAssignModalOpen(false)
      setSelectedIds([])
      showSnackbar({ message: result.message, tone: 'info' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
      ])
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '그룹 할당에 실패했어.', tone: 'error' })
    },
  })

  const images = useMemo(
    () => (imagesQuery.data?.pages ?? []).flatMap((page) => page.images),
    [imagesQuery.data?.pages],
  )

  const imageFeedSafetyById = useMemo(
    () => new Map(images.map((image) => [String(image.composite_hash ?? image.id), resolveImageFeedSafety(image, ratingTiersQuery.data)])),
    [images, ratingTiersQuery.data],
  )

  const visibleImages = useMemo(
    () => images.filter((image) => imageFeedSafetyById.get(String(image.composite_hash ?? image.id))?.visibility !== 'hide'),
    [imageFeedSafetyById, images],
  )

  useEffect(() => {
    setSelectedIds([])
  }, [appliedChips])

  useEffect(() => {
    if (imagesQuery.isPending || imagesQuery.isError || imagesQuery.isFetchingNextPage) {
      return
    }

    if (images.length === 0 || visibleImages.length > 0 || !imagesQuery.hasNextPage) {
      return
    }

    void imagesQuery.fetchNextPage()
  }, [images.length, imagesQuery.fetchNextPage, imagesQuery.hasNextPage, imagesQuery.isError, imagesQuery.isFetchingNextPage, imagesQuery.isPending, visibleImages.length])

  useHomeScrollRestoration({
    enabled: !imagesQuery.isPending && !imagesQuery.isError,
    itemCount: visibleImages.length,
    canLoadMore: Boolean(imagesQuery.hasNextPage),
    isLoadingMore: imagesQuery.isFetchingNextPage,
    onLoadMore: imagesQuery.fetchNextPage,
  })

  const selectedCompositeHashes = useMemo(
    () =>
      visibleImages
        .filter((image) => selectedIds.includes(String(image.composite_hash ?? image.id)))
        .map((image) => image.composite_hash)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    [visibleImages, selectedIds],
  )

  const loadMoreErrorMessage =
    imagesQuery.error instanceof Error
      ? imagesQuery.error.message
      : '다음 이미지 묶음을 불러오는 중 문제가 생겼어.'

  const handleRetryInitialLoad = () => {
    void imagesQuery.refetch()
  }

  const handleRetryNextPage = () => {
    void imagesQuery.fetchNextPage()
  }

  const handleDownloadSelected = async () => {
    if (selectedCompositeHashes.length === 0 || isDownloading) {
      return
    }

    try {
      setIsDownloading(true)
      await downloadImageSelection(selectedCompositeHashes)
    } finally {
      setIsDownloading(false)
    }
  }

  const handleOpenAssignModal = () => {
    if (selectedCompositeHashes.length === 0) {
      return
    }

    if (groupsQuery.isPending) {
      showSnackbar({ message: '커스텀 그룹 목록을 불러오는 중이야.', tone: 'info' })
      return
    }

    if (groupsQuery.isError) {
      showSnackbar({ message: groupsQuery.error instanceof Error ? groupsQuery.error.message : '그룹 목록을 불러오지 못했어.', tone: 'error' })
      return
    }

    if ((groupsQuery.data?.length ?? 0) === 0) {
      showSnackbar({ message: '먼저 커스텀 그룹을 하나 만들어줘.', tone: 'error' })
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

  const emptyStateTitle = isSearchMode ? '검색 결과가 없어' : '표시할 이미지가 아직 없어'
  const emptyStateDescription = images.length > 0 && visibleImages.length === 0
    ? '현재 등급 표시 정책 때문에 이 목록에서는 숨겨진 상태야.'
    : isSearchMode
      ? '검색 조건을 바꿔봐.'
      : '업로드나 데이터 상태를 확인해.'

  const errorTitle = isSearchMode ? '검색 결과를 불러오지 못했어' : '홈 피드를 불러오지 못했어'

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  if (!canViewHome) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>승인 대기 중</CardTitle>
          <CardDescription>관리자가 페이지 권한을 열어야 해.</CardDescription>
        </CardHeader>
      </Card>
    )
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
        <Card >
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
            columnGap={24}
            rowGap={24}
            gridItemHeight={280}
            renderItemPersistentOverlay={(image) => {
              const safety = imageFeedSafetyById.get(String(image.composite_hash ?? image.id))
              return safety?.tier ? <ImageRatingSafetyBadge tier={safety.tier} visibility={safety.visibility} /> : null
            }}
            shouldBlurItemPreview={(image) => imageFeedSafetyById.get(String(image.composite_hash ?? image.id))?.visibility === 'blur'}
          />

          <div className="flex flex-col items-center gap-3 pb-6">
            {imagesQuery.isFetchingNextPage ? (
              <div className="theme-floating-panel rounded-full px-4 py-2 text-xs text-muted-foreground">
                이미지를 더 불러오는 중…
              </div>
            ) : null}

            {imagesQuery.isFetchNextPageError ? (
              <div className="theme-floating-panel flex flex-col items-center gap-2 rounded-2xl px-5 py-4 text-center">
                <p className="text-sm font-semibold">목록을 끝까지 불러오지 못했어</p>
                <p className="max-w-xl text-xs text-muted-foreground">{loadMoreErrorMessage}</p>
                <Button size="sm" variant="outline" onClick={handleRetryNextPage}>
                  다음 묶음 다시 시도
                </Button>
              </div>
            ) : null}
          </div>
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
            onDownload={handleDownloadSelected}
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
