import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAutoFolderGroupFileCounts,
  getGroupFileCounts,
  getGroupImages,
  getGroupsHierarchyAll,
} from '@/lib/api'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'
import { createEmptyGroupFileCounts, getDownloadCountsFromImages, type GroupSourceDefinition } from './group-page-shared'

/** Own query loading, invalidation helpers, and lightweight derived data for the group page. */
export function useGroupPageQueries({
  selectedSource,
  selectedGroupId,
  isCustomSource,
  isWideLayout,
  groupImageCollectionFilter,
  selectedGroupImageIds,
  downloadScope,
}: {
  selectedSource: GroupSourceDefinition
  selectedGroupId: number | undefined
  isCustomSource: boolean
  isWideLayout: boolean
  groupImageCollectionFilter: 'all' | 'manual' | 'auto'
  selectedGroupImageIds: string[]
  downloadScope: 'group' | 'selection' | null
}) {
  const queryClient = useQueryClient()

  const appearanceQuery = useGlobalAppearanceSettingsQuery()

  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', selectedSource.key],
    queryFn: selectedSource.getAllGroups,
  })

  const assignableCustomGroupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', 'assignable-custom'],
    queryFn: getGroupsHierarchyAll,
  })

  const selectedGroupQuery = useQuery({
    queryKey: ['group-detail', selectedSource.key, selectedGroupId],
    queryFn: () => selectedSource.getGroup(selectedGroupId!),
    enabled: Number.isFinite(selectedGroupId),
  })

  const breadcrumbQuery = useQuery({
    queryKey: ['group-breadcrumb', selectedSource.key, selectedGroupId],
    queryFn: () => selectedSource.getBreadcrumb(selectedGroupId!),
    enabled: Number.isFinite(selectedGroupId) && isWideLayout,
  })

  const groupImagesQuery = useInfiniteQuery({
    queryKey: ['group-images', selectedSource.key, selectedGroupId, isCustomSource ? groupImageCollectionFilter : 'all'],
    queryFn: ({ pageParam }) =>
      isCustomSource
        ? getGroupImages(selectedGroupId!, { page: pageParam, limit: 40, collectionType: groupImageCollectionFilter })
        : selectedSource.getImages(selectedGroupId!, { page: pageParam, limit: 40 }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination
      return page < totalPages ? page + 1 : undefined
    },
    enabled: Number.isFinite(selectedGroupId),
  })

  const groupFileCountsQuery = useQuery({
    queryKey: ['group-file-counts', selectedSource.key, selectedGroupId],
    queryFn: () => (isCustomSource ? getGroupFileCounts(selectedGroupId!) : getAutoFolderGroupFileCounts(selectedGroupId!)),
    enabled: Number.isFinite(selectedGroupId),
  })

  const refreshCustomGroupQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all', 'custom'] }),
      queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom'] }),
      queryClient.invalidateQueries({ queryKey: ['group-breadcrumb', 'custom'] }),
      queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
      queryClient.invalidateQueries({ queryKey: ['group-file-counts', 'custom'] }),
    ])
  }

  const refreshFolderGroupQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all', 'folders'] }),
      queryClient.invalidateQueries({ queryKey: ['group-detail', 'folders'] }),
      queryClient.invalidateQueries({ queryKey: ['group-breadcrumb', 'folders'] }),
      queryClient.invalidateQueries({ queryKey: ['group-images', 'folders'] }),
      queryClient.invalidateQueries({ queryKey: ['group-file-counts', 'folders'] }),
    ])
  }

  const groupExplorerCardStyle = appearanceQuery.data?.groupExplorerCardStyle ?? DEFAULT_APPEARANCE_SETTINGS.groupExplorerCardStyle
  const allGroups = groupsQuery.data ?? []
  const selectedGroupHierarchy = allGroups.find((group) => group.id === selectedGroupId) ?? null
  const rootGroups = allGroups.filter((group) => group.parent_id == null)
  const childGroups = allGroups.filter((group) => group.parent_id === selectedGroupId)
  const parentGroupHierarchy = allGroups.find((group) => group.id === selectedGroupHierarchy?.parent_id) ?? null
  const backNavigationGroup = selectedGroupHierarchy
    ? parentGroupHierarchy ?? {
        ...selectedGroupHierarchy,
        id: 0,
        name: selectedSource.rootTitle,
        image_count: rootGroups.length,
        child_count: rootGroups.length,
        has_children: true,
      }
    : null
  const groupImages = (groupImagesQuery.data?.pages ?? []).flatMap((page) => page.images)
  const selectedGroupImages = groupImages.filter((image) => selectedGroupImageIds.includes(String(image.composite_hash ?? image.id)))
  const selectedGroupCompositeHashes = selectedGroupImages
    .map((image) => image.composite_hash)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  const selectedDownloadCounts = getDownloadCountsFromImages(selectedGroupImages)
  const activeDownloadCounts = downloadScope === 'selection'
    ? selectedDownloadCounts
    : groupFileCountsQuery.data ?? createEmptyGroupFileCounts()
  const selectableDownloadCount = selectedGroupImages.filter((image) => image.original_file_path || image.thumbnail_url).length

  return {
    appearanceQuery,
    groupsQuery,
    assignableCustomGroupsQuery,
    selectedGroupQuery,
    breadcrumbQuery,
    groupImagesQuery,
    groupFileCountsQuery,
    refreshCustomGroupQueries,
    refreshFolderGroupQueries,
    groupExplorerCardStyle,
    allGroups,
    selectedGroupHierarchy,
    rootGroups,
    childGroups,
    parentGroupHierarchy,
    backNavigationGroup,
    groupImages,
    selectedGroupImages,
    selectedGroupCompositeHashes,
    selectedDownloadCounts,
    activeDownloadCounts,
    selectableDownloadCount,
  }
}
