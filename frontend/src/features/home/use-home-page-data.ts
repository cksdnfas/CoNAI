import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useHomeSearch } from '@/features/home/home-search-context'
import { buildComplexFilterPayload } from '@/features/search/search-utils'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useHomeScrollRestoration } from '@/features/home/use-home-scroll-restoration'
import { addImagesToGroup, downloadImageSelection, getGroupsHierarchyAll, getImages, searchImagesComplex } from '@/lib/api'

interface UseHomePageDataOptions {
  /** Show a success/info snackbar for Home page actions. */
  notifyInfo: (message: string) => void
  /** Show an error snackbar for Home page actions. */
  notifyError: (message: string) => void
}

/** Collect Home page auth state, image feed data, selection, and group actions. */
export function useHomePageData({ notifyInfo, notifyError }: UseHomePageDataOptions) {
  const queryClient = useQueryClient()
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

  const assignToGroupMutation = useMutation({
    mutationFn: ({ groupId, compositeHashes }: { groupId: number; compositeHashes: string[] }) => addImagesToGroup(groupId, compositeHashes),
    onSuccess: async (result) => {
      setIsAssignModalOpen(false)
      setSelectedIds([])
      notifyInfo(result.message)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
      ])
    },
    onError: (error) => {
      notifyError(error instanceof Error ? error.message : '그룹 할당에 실패했어.')
    },
  })

  const images = useMemo(
    () => (imagesQuery.data?.pages ?? []).flatMap((page) => page.images),
    [imagesQuery.data?.pages],
  )

  const {
    visibleItems: visibleImages,
    hasOnlyHiddenItems,
    renderItemPersistentOverlay,
    shouldBlurItemPreview,
  } = useImageFeedSafety({
    items: images,
    enabled: canViewHome,
    hasMore: Boolean(imagesQuery.hasNextPage),
    isLoading: imagesQuery.isPending,
    isError: imagesQuery.isError,
    isLoadingMore: imagesQuery.isFetchingNextPage,
    onLoadMore: imagesQuery.fetchNextPage,
  })

  useEffect(() => {
    setSelectedIds([])
  }, [appliedChips])

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

  const emptyStateTitle = isSearchMode ? '검색 결과가 없어' : '표시할 이미지가 아직 없어'
  const emptyStateDescription = hasOnlyHiddenItems
    ? '현재 등급 표시 정책 때문에 이 목록에서는 숨겨진 상태야.'
    : isSearchMode
      ? '검색 조건을 바꿔봐.'
      : '업로드나 데이터 상태를 확인해.'
  const errorTitle = isSearchMode ? '검색 결과를 불러오지 못했어' : '홈 피드를 불러오지 못했어'
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

  const handleDownloadSelected = async (type: 'thumbnail' | 'original') => {
    if (selectedCompositeHashes.length === 0 || isDownloading) {
      return
    }

    try {
      setIsDownloading(true)
      await downloadImageSelection(selectedCompositeHashes, type)
    } finally {
      setIsDownloading(false)
    }
  }

  const handleOpenAssignModal = () => {
    if (selectedCompositeHashes.length === 0) {
      return
    }

    if (groupsQuery.isPending) {
      notifyInfo('커스텀 그룹 목록을 불러오는 중이야.')
      return
    }

    if (groupsQuery.isError) {
      notifyError(groupsQuery.error instanceof Error ? groupsQuery.error.message : '그룹 목록을 불러오지 못했어.')
      return
    }

    if ((groupsQuery.data?.length ?? 0) === 0) {
      notifyError('먼저 커스텀 그룹을 하나 만들어줘.')
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

  return {
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
  }
}
