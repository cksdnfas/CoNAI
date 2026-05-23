import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useHomeSearch } from '@/features/home/home-search-context'
import { buildComplexFilterPayload } from '@/features/search/search-utils'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { getHomeFeedProgressSummary } from '@/features/home/home-feed-progress'
import { useHomeScrollRestoration } from '@/features/home/use-home-scroll-restoration'
import { useI18n } from '@/i18n'
import { addImagesToGroup, getGroupsHierarchyAll } from '@/lib/api-groups'
import { deleteImagesBulk, downloadImageSelection, getImages, searchImagesComplex } from '@/lib/api-images'

interface UseHomePageDataOptions {
  /** Show a success/info snackbar for Home page actions. */
  notifyInfo: (message: string) => void
  /** Show an error snackbar for Home page actions. */
  notifyError: (message: string) => void
}

/** Collect Home page auth state, image feed data, selection, and group actions. */
export function useHomePageData({ notifyInfo, notifyError }: UseHomePageDataOptions) {
  const queryClient = useQueryClient()
  const { t, formatNumber } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const { appliedChips } = useHomeSearch()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isDownloading, setIsDownloading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)

  const canViewHome = hasAuthPermission(authStatusQuery.data?.permissionKeys, 'page.home.view')
  const canDeleteImages = authStatusQuery.data?.isAdmin === true
  const hasCredentials = authStatusQuery.data?.hasCredentials === true
  const isAuthenticated = authStatusQuery.data?.authenticated === true
  const isAnonymousSession = hasCredentials && !isAuthenticated
  const isSearchMode = !isAnonymousSession && appliedChips.length > 0
  const imageListResetKey = useMemo(() => {
    if (isAnonymousSession) {
      return 'anonymous'
    }

    if (appliedChips.length === 0) {
      return 'home'
    }

    return `search:${appliedChips
      .map((chip) => [chip.scope, chip.operator, chip.conditionType ?? '', chip.value, chip.minScore ?? '', chip.maxScore ?? ''].join('::'))
      .join('|')}`
  }, [appliedChips, isAnonymousSession])

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
      notifyError(error instanceof Error ? error.message : t('useHomePageData.failedToAssignGroup'))
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

  const feedProgress = useMemo(
    () => getHomeFeedProgressSummary(imagesQuery.data?.pages, visibleImages.length),
    [imagesQuery.data?.pages, visibleImages.length],
  )

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

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedCompositeHashes = useMemo(
    () =>
      visibleImages
        .filter((image) => selectedIdSet.has(String(image.composite_hash ?? image.id)))
        .map((image) => image.composite_hash)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    [visibleImages, selectedIdSet],
  )

  const emptyStateTitle = isSearchMode ? t('useHomePageData.noSearchResults') : t('useHomePageData.noImagesToShowYet')
  const emptyStateDescription = hasOnlyHiddenItems
    ? t('useHomePageData.itemsAreHiddenInThis')
    : isSearchMode
      ? t('useHomePageData.tryChangingTheSearchFilters')
      : t('useHomePageData.checkTheUploadOrData')
  const errorTitle = isSearchMode ? t('useHomePageData.failedToLoadSearchResults') : t('useHomePageData.failedToLoadTheHome')
  const loadMoreErrorMessage =
    imagesQuery.error instanceof Error
      ? imagesQuery.error.message
      : t('useHomePageData.somethingWentWrongWhileLoading')

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

  const handleDeleteSelected = async () => {
    if (!canDeleteImages) {
      notifyError(t('useHomePageData.onlyAdminAccountsCanDelete'))
      return
    }

    if (selectedCompositeHashes.length === 0 || isDeleting) {
      return
    }

    const selectedCount = formatNumber(selectedCompositeHashes.length)
    const confirmed = window.confirm(t({ ko: '선택한 {count}개 항목을 휴지통으로 보낼까?', en: 'Move {count} selected items to the Recycle Bin?' }, { count: selectedCount }))
    if (!confirmed) {
      return
    }

    try {
      setIsDeleting(true)
      const result = await deleteImagesBulk(selectedCompositeHashes)
      setSelectedIds([])
      notifyInfo(result.details.failed > 0
        ? t({ ko: '{deleted}개 삭제, {failed}개 실패했어.', en: '{deleted} deleted, {failed} failed.' }, {
            deleted: formatNumber(result.details.deleted),
            failed: formatNumber(result.details.failed),
          })
        : t({ ko: '{deleted}개를 RecycleBin으로 보냈어.', en: '{deleted} moved to the Recycle Bin.' }, { deleted: formatNumber(result.details.deleted) }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['home-images'] }),
        queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
      ])
    } catch (error) {
      notifyError(error instanceof Error ? error.message : t('useHomePageData.failedToDeleteSelectedItems'))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleOpenAssignModal = () => {
    if (selectedCompositeHashes.length === 0) {
      return
    }

    if (groupsQuery.isPending) {
      notifyInfo(t('useHomePageData.loadingCustomGroups'))
      return
    }

    if (groupsQuery.isError) {
      notifyError(groupsQuery.error instanceof Error ? groupsQuery.error.message : t('useHomePageData.failedToLoadGroupList'))
      return
    }

    if ((groupsQuery.data?.length ?? 0) === 0) {
      notifyError(t('useHomePageData.createACustomGroupFirst'))
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
    canDeleteImages,
    isAnonymousSession,
    imagesQuery,
    groupsQuery,
    assignToGroupMutation,
    visibleImages,
    imageListResetKey,
    feedProgress,
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
  }
}
