import { useMemo } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAutoFolderGroupFileCounts } from '@/lib/api-auto-folder-groups'
import {
  getGroupFileCounts,
  getGroupImages,
  getGroupsHierarchyAll,
} from '@/lib/api-groups'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'
import type { GroupWithHierarchy } from '@/types/group'
import { createEmptyGroupFileCounts, getDownloadCountsFromImages, type GroupSourceDefinition } from './group-page-shared'

const EMPTY_GROUP_HIERARCHY_LIST: GroupWithHierarchy[] = []

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
  const allGroups = groupsQuery.data ?? EMPTY_GROUP_HIERARCHY_LIST
  const groupHierarchyLookups = useMemo(() => {
    const groupById = new Map<number, GroupWithHierarchy>()
    const childrenByParentId = new Map<number | null, GroupWithHierarchy[]>()

    for (const group of allGroups) {
      groupById.set(group.id, group)
      const parentId = group.parent_id ?? null
      const siblings = childrenByParentId.get(parentId)
      if (siblings) {
        siblings.push(group)
      } else {
        childrenByParentId.set(parentId, [group])
      }
    }

    return { groupById, childrenByParentId }
  }, [allGroups])
  const selectedGroupHierarchy = selectedGroupId == null ? null : groupHierarchyLookups.groupById.get(selectedGroupId) ?? null
  const rootGroups = groupHierarchyLookups.childrenByParentId.get(null) ?? EMPTY_GROUP_HIERARCHY_LIST
  const childGroups = selectedGroupId == null ? EMPTY_GROUP_HIERARCHY_LIST : groupHierarchyLookups.childrenByParentId.get(selectedGroupId) ?? EMPTY_GROUP_HIERARCHY_LIST
  const parentGroupHierarchy = selectedGroupHierarchy?.parent_id == null ? null : groupHierarchyLookups.groupById.get(selectedGroupHierarchy.parent_id) ?? null
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
  const groupImages = useMemo(
    () => (groupImagesQuery.data?.pages ?? []).flatMap((page) => page.images),
    [groupImagesQuery.data?.pages],
  )
  const selectedGroupImageIdSet = useMemo(() => new Set(selectedGroupImageIds), [selectedGroupImageIds])
  const selectedGroupImages = useMemo(
    () => groupImages.filter((image) => selectedGroupImageIdSet.has(String(image.composite_hash ?? image.id))),
    [groupImages, selectedGroupImageIdSet],
  )
  const selectedGroupCompositeHashes = useMemo(
    () => selectedGroupImages
      .map((image) => image.composite_hash)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
    [selectedGroupImages],
  )
  const selectedDownloadCounts = useMemo(
    () => getDownloadCountsFromImages(selectedGroupImages),
    [selectedGroupImages],
  )
  const activeDownloadCounts = downloadScope === 'selection'
    ? selectedDownloadCounts
    : groupFileCountsQuery.data ?? createEmptyGroupFileCounts()
  const selectableDownloadCount = useMemo(
    () => selectedGroupImages.filter((image) => image.original_file_path || image.thumbnail_url).length,
    [selectedGroupImages],
  )

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
