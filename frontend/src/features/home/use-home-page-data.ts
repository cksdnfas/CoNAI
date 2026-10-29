import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Fragment, createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { getHomeFeedKeys, useHomeSearch } from '@/features/home/home-search-context'
import { buildComplexSearchPayload } from '@/features/search/search-utils'
import { VectorScoreOverlay } from '@/features/images/components/detail/similarity-score-overlay'
import type { ImageListPayload, ImageRecord } from '@/types/image'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import type { ImageViewSequenceTotal } from '@/features/images/components/detail/image-view-modal-context'
import { getHomeFeedProgressSummary } from '@/features/home/home-feed-progress'
import { useHomeScrollRestoration } from '@/features/home/use-home-scroll-restoration'
import { useHomeHiddenGroupIds } from '@/features/home/home-hidden-groups'
import { buildHomeSearchString, readHomeSortParam, readSearchChipsParam, type HomeSortOrder } from '@/features/home/home-search-url'
import { useI18n } from '@/i18n'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { addImagesToGroup, getGroupsHierarchyAll, GROUPS_HIERARCHY_ALL_QUERY_KEY } from '@/lib/api-groups'
import { withChatMediaDeleteWarning } from '@/features/images/chat-media-delete-warning'
import { removeBulkDeletedImagesFromListCaches } from '@/features/images/image-list-cache'
import { useImageDeleteUndo } from '@/features/images/use-image-delete-undo'
import { deleteImagesBulk, downloadImageSelection, getImages, getImagesCount, searchImagesComplex } from '@/lib/api-images'
import { formatGroupBulkAddNotice } from '@/features/groups/group-bulk-result-messages'
import { collectGroupSubtreeIds } from '@/features/groups/group-option-utils'
import { countStateFromQuery, type CountState } from '@/lib/count-display'

interface UseHomePageDataOptions {
  /** Show a success/info snackbar for Home page actions. */
  notifyInfo: (message: string) => void
  /** Show an error snackbar for Home page actions. */
  notifyError: (message: string) => void
}

type HomeImagesPageParam = number | {
  cursorDate?: string | null
  cursorHash?: string | null
  cursorValue?: string | number | null
}

/** Collect Home page auth state, image feed data, selection, and group actions. */
export function useHomePageData({ notifyInfo, notifyError }: UseHomePageDataOptions) {
  const queryClient = useQueryClient()
  const { t, formatNumber } = useI18n()
  const confirm = useConfirm()
  const notifyImageDeleted = useImageDeleteUndo()
  const authStatusQuery = useAuthStatusQuery()
  const { appliedChips } = useHomeSearch()
  const location = useLocation()
  const navigate = useNavigate()
  const sortOrder = readHomeSortParam(location.search)
  const apiSortOrder = sortOrder === 'oldest' ? 'ASC' : 'DESC'
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isDownloading, setIsDownloading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)

  const canViewHome = hasAuthPermission(authStatusQuery.data?.permissionKeys, 'page.home.view')
  const { canViewImages, canDeleteImages, canAssignGroups } = useImagePermissions()
  const hasCredentials = authStatusQuery.data?.hasCredentials === true
  const isAuthenticated = authStatusQuery.data?.authenticated === true
  const isAnonymousSession = hasCredentials && !isAuthenticated
  const isSearchMode = !isAnonymousSession && appliedChips.length > 0
  const { feedScopeKey, meaningText, imageListResetKey: searchResetKey } = getHomeFeedKeys(appliedChips, sortOrder, isAnonymousSession)
  const { hiddenGroupIds, setHiddenGroupIds, hidingEnabled, setHidingEnabled } = useHomeHiddenGroupIds()
  // Signed-out visitors have no options menu, so hidden groups only shape a signed-in feed; the switch turns hiding
  // off without losing the ticked groups.
  const excludeGroupIds = isAnonymousSession || !hidingEnabled ? [] : hiddenGroupIds
  const hiddenGroupsKey = excludeGroupIds.join(',')
  const excludeGroupPayload = excludeGroupIds.length > 0 ? { exclude_group_ids: excludeGroupIds } : {}
  const imageListResetKey = hiddenGroupsKey ? `${searchResetKey}|hide:${hiddenGroupsKey}` : searchResetKey

  /** Change the order in the URL (next to `q`) and start the reordered list from the top. */
  const setSortOrder = useCallback((nextSortOrder: HomeSortOrder) => {
    if (nextSortOrder === sortOrder) {
      return
    }

    navigate(
      { pathname: location.pathname, search: buildHomeSearchString(readSearchChipsParam(location.search), nextSortOrder) },
      { replace: true },
    )
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [location.pathname, location.search, navigate, sortOrder])

  const imagesQuery = useInfiniteQuery({
    // Key on the id-free chip signature: chip ids embed Date.now()/Math.random(),
    // so keying on the chips themselves would never hit the query cache.
    // The search key stays the second element so a re-applied search can refresh it by prefix.
    queryKey: ['home-images', searchResetKey, hiddenGroupsKey],
    initialPageParam: {} as HomeImagesPageParam,
    queryFn: ({ pageParam, signal }) => {
      const typedPageParam = pageParam as HomeImagesPageParam

      if (isSearchMode) {
        return searchImagesComplex({
          ...buildComplexSearchPayload(appliedChips),
          ...excludeGroupPayload,
          page: 1,
          limit: 40,
          sortBy: 'first_seen_date',
          sortOrder: apiSortOrder,
          pagination: 'cursor',
          cursorValue: typeof typedPageParam === 'number' ? null : typedPageParam.cursorValue,
          cursorHash: typeof typedPageParam === 'number' ? null : typedPageParam.cursorHash,
          // Counting the match set is the expensive half of the query. The grid does
          // not need it to render, so it is fetched separately once the feed is up.
          includeTotal: false,
        }, { signal })
      }

      const cursor = typeof typedPageParam === 'number' ? {} : typedPageParam
      return getImages({
        pagination: 'cursor',
        limit: 40,
        cursorDate: cursor.cursorDate,
        cursorHash: cursor.cursorHash,
        includeTotal: false,
        sortOrder: apiSortOrder,
        excludeGroupIds,
      }, { signal })
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) {
        return undefined
      }

      if (isSearchMode) {
        if (!lastPage.nextCursorHash || lastPage.nextCursorValue === undefined) {
          return undefined
        }
        return {
          cursorValue: lastPage.nextCursorValue,
          cursorHash: lastPage.nextCursorHash,
        }
      }

      if (!lastPage.nextCursorDate || !lastPage.nextCursorHash) {
        return undefined
      }

      return {
        cursorDate: lastPage.nextCursorDate,
        cursorHash: lastPage.nextCursorHash,
      }
    },
    enabled: canViewHome && canViewImages,
  })

  const hasFirstFeedPage = (imagesQuery.data?.pages.length ?? 0) > 0

  /**
   * Exact feed total, requested only after the first page has rendered.
   *
   * Home used to ask for the total inline with the first page, which made every
   * visit pay for a full-library count before a single image appeared. The counter
   * is a status line, not layout, so it can arrive late without disturbing the grid.
   */
  const feedTotalQuery = useQuery({
    queryKey: ['home-images-total', feedScopeKey, hiddenGroupsKey],
    queryFn: async ({ signal }) => {
      if (isSearchMode) {
        const result = await searchImagesComplex({
          ...buildComplexSearchPayload(appliedChips),
          ...excludeGroupPayload,
          page: 1,
          limit: 1,
          sortBy: 'first_seen_date',
          sortOrder: 'DESC',
          includeTotal: true,
        }, { signal })
        return result.totalKnown === false ? null : result.total
      }

      const result = await getImagesCount(excludeGroupIds, { signal })
      return result.total
    },
    enabled: canViewHome && canViewImages && hasFirstFeedPage,
    staleTime: 60_000,
  })

  const groupsQuery = useQuery({
    queryKey: GROUPS_HIERARCHY_ALL_QUERY_KEY,
    queryFn: getGroupsHierarchyAll,
    enabled: canViewHome && canViewImages && !isAnonymousSession,
  })

  const assignToGroupMutation = useMutation({
    mutationFn: ({ groupId, compositeHashes }: { groupId: number; compositeHashes: string[] }) => addImagesToGroup(groupId, compositeHashes),
    onSuccess: async (result, { groupId, compositeHashes }) => {
      setIsAssignModalOpen(false)
      setSelectedIds([])
      const notice = formatGroupBulkAddNotice(result, t, formatNumber)
      if (notice.tone === 'error') {
        notifyError(notice.message)
      } else {
        notifyInfo(notice.message)
      }
      // Images just added to a hidden group leave the gallery: drop them from the loaded pages instead of reloading
      // every page. Failed adds are not named per image, so then the feed is fetched again.
      const feedKey = ['home-images', searchResetKey, hiddenGroupsKey]
      const leavesFeed = collectGroupSubtreeIds(groupsQuery.data ?? [], excludeGroupIds).has(groupId)
      if (leavesFeed && !result.errors?.length) {
        const added = new Set(compositeHashes)
        queryClient.setQueryData<InfiniteData<ImageListPayload>>(feedKey, (data) => data && {
          ...data,
          pages: data.pages.map((page) => ({ ...page, images: page.images.filter((image) => !added.has(image.composite_hash ?? '')) })),
        })
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: GROUPS_HIERARCHY_ALL_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom'] }),
        queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
        ...(leavesFeed ? [queryClient.invalidateQueries({ queryKey: ['home-images-total', feedScopeKey, hiddenGroupsKey] })] : []),
        ...(leavesFeed && result.errors?.length ? [queryClient.invalidateQueries({ queryKey: feedKey })] : []),
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
    renderItemPersistentOverlay: renderSafetyOverlay,
    shouldBlurItemPreview,
  } = useImageFeedSafety({
    items: images,
    enabled: canViewHome && canViewImages,
    hasMore: Boolean(imagesQuery.hasNextPage),
    isLoading: imagesQuery.isPending,
    isError: imagesQuery.isError,
    isLoadingMore: imagesQuery.isFetchingNextPage,
    onLoadMore: imagesQuery.fetchNextPage,
  })

  // Description search: each tile also carries its match score. Elements are cached per tile so memoized cells keep
  // the same props while more pages load.
  const meaningOverlayCacheRef = useRef(new Map<string, { score: number; safety: ReactNode; element: ReactNode }>())
  const renderItemPersistentOverlay = useCallback((image: ImageRecord) => {
    const safety = renderSafetyOverlay(image)
    const score = image.meaning_score
    if (!meaningText || typeof score !== 'number') {
      return safety
    }

    const key = image.composite_hash ?? String(image.id)
    const cached = meaningOverlayCacheRef.current.get(key)
    if (cached && cached.score === score && cached.safety === safety) {
      return cached.element
    }

    const element = createElement(Fragment, null, createElement(VectorScoreOverlay, { score, basis: 'meaning' }), safety)
    meaningOverlayCacheRef.current.set(key, { score, safety, element })
    return element
  }, [meaningText, renderSafetyOverlay])

  const feedProgress = useMemo(
    () => getHomeFeedProgressSummary(imagesQuery.data?.pages, visibleImages.length, {
      deferredTotal: feedTotalQuery.data ?? null,
    }),
    [imagesQuery.data?.pages, visibleImages.length, feedTotalQuery.data],
  )

  // Viewer counter denominator: the real feed total, pending while it is counted, and
  // unavailable when the count failed or a search could not report an exact total.
  const isFeedTotalUnavailable = feedTotalQuery.isError || (feedTotalQuery.isSuccess && feedTotalQuery.data === null)
  // The one count Home shows: the server total (never loaded-so-far), plus rating-hidden loaded items.
  const feedCountState = useMemo<CountState>(() => countStateFromQuery({
    total: feedProgress.isTotalKnown ? feedProgress.totalCount : null,
    isError: isFeedTotalUnavailable,
    hidden: feedProgress.hiddenCount,
  }), [feedProgress.hiddenCount, feedProgress.isTotalKnown, feedProgress.totalCount, isFeedTotalUnavailable])

  const feedSequenceTotal = useMemo<ImageViewSequenceTotal>(() => {
    if (feedProgress.isTotalKnown) {
      return { status: 'known', count: feedProgress.totalCount }
    }

    return isFeedTotalUnavailable ? { status: 'unavailable' } : { status: 'pending' }
  }, [feedProgress.isTotalKnown, feedProgress.totalCount, isFeedTotalUnavailable])

  useEffect(() => {
    setSelectedIds([])
  }, [appliedChips])

  // Auto-loading stops after a failed page so a broken server is not hammered; the retry button takes over.
  const canAutoLoadMore = Boolean(imagesQuery.hasNextPage) && !imagesQuery.isFetchNextPageError

  useHomeScrollRestoration({
    enabled: !imagesQuery.isPending && !imagesQuery.isError,
    itemCount: visibleImages.length,
    canLoadMore: canAutoLoadMore,
    isLoadingMore: imagesQuery.isFetchingNextPage,
    onLoadMore: imagesQuery.fetchNextPage,
  })

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedDownloadImages = useMemo(
    () => visibleImages.filter((image) => (
      selectedIdSet.has(String(image.composite_hash ?? image.id))
      && typeof image.composite_hash === 'string'
      && image.composite_hash.length > 0
    )),
    [visibleImages, selectedIdSet],
  )
  const selectedCompositeHashes = useMemo(
    () => selectedDownloadImages
      .map((image) => image.composite_hash)
      .filter((compositeHash): compositeHash is string => typeof compositeHash === 'string'),
    [selectedDownloadImages],
  )

  // Hidden groups that still exist (stored ids of deleted groups match nothing).
  const hiddenGroupIdSet = new Set(hiddenGroupIds)
  const hiddenGroups = (groupsQuery.data ?? []).filter((group) => hiddenGroupIdSet.has(group.id))

  const hiddenGroupsEmpty = !hasOnlyHiddenItems && excludeGroupIds.length > 0 && hiddenGroups.length > 0
  const emptyStateTitle = hasOnlyHiddenItems
    ? t('useHomePageData.itemsAreHiddenInThis')
    : hiddenGroupsEmpty
      ? isSearchMode
        ? t({ ko: '숨긴 그룹을 제외하면 검색 결과가 없어', en: 'No search results outside hidden groups' })
        : t({ ko: '숨긴 그룹을 제외하면 이미지가 없어', en: 'No images outside hidden groups' })
      : isSearchMode ? t('useHomePageData.noSearchResults') : t('useHomePageData.noImagesToShowYet')
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
      const selectedImage = selectedDownloadImages.length === 1 ? selectedDownloadImages[0] : null
      await downloadImageSelection(selectedCompositeHashes, type, selectedImage ? {
        originalFilePath: selectedImage.original_file_path,
        contentType: selectedImage.mime_type,
      } : undefined)
    } catch (error) {
      notifyError(error instanceof Error ? error.message : t('useHomePageData.failedToDownloadSelectedItems'))
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
    const confirmed = await confirm({
      title: t({ ko: '선택 항목 삭제', en: 'Delete selected items' }),
      description: await withChatMediaDeleteWarning(t({ ko: '선택한 {count}개 항목을 삭제할까? 삭제 보호가 켜져 있으면 휴지통으로 보내고 되돌릴 수 있어. 꺼져 있으면 영구 삭제돼.', en: 'Delete {count} selected items? With deletion protection on, files move to the Recycle Bin and can be undone. Otherwise they are permanently deleted.' }, { count: selectedCount }), selectedCompositeHashes, t),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (!confirmed) {
      return
    }

    try {
      setIsDeleting(true)
      const result = await deleteImagesBulk(selectedCompositeHashes)
      setSelectedIds([])
      await removeBulkDeletedImagesFromListCaches(queryClient, selectedCompositeHashes, result.details.errors)
      notifyImageDeleted(result.details)
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
    canViewImages,
    canAssignGroups,
    canDeleteImages,
    isAnonymousSession,
    imagesQuery,
    feedTotalQuery,
    groupsQuery,
    assignToGroupMutation,
    visibleImages,
    imageListResetKey,
    sortOrder,
    setSortOrder,
    hiddenGroupIds,
    hiddenGroups,
    setHiddenGroupIds,
    hidingEnabled,
    setHidingEnabled,
    isMeaningSearch: meaningText !== null,
    canAutoLoadMore,
    feedProgress,
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
    hiddenGroupsEmpty,
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
