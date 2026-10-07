import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useMemo } from 'react'
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAutoFolderGroupFileCounts } from '@/lib/api-auto-folder-groups'
import {
  getGroupFileCounts,
  getGroupImages,
  getGroupsHierarchyAll,
} from '@/lib/api-groups'
import type { GroupImagesPayload, GroupWithHierarchy } from '@/types/group'
import { createEmptyGroupFileCounts, getDownloadCountsFromImages, type GroupSourceDefinition } from './group-page-shared'

const EMPTY_GROUP_HIERARCHY_LIST: GroupWithHierarchy[] = []
export type GroupCollectionFilter = 'all' | 'manual' | 'auto'
const COLLECTION_FILTERS: GroupCollectionFilter[] = ['all', 'manual', 'auto']
type GroupImagesPageParam = {
  cursorOrderIndex?: number | null
  cursorAddedDate?: string | null
  cursorDate?: string | null
  cursorHash?: string | null
}

/** Own query loading, invalidation helpers, and lightweight derived data for the group page. */
export function useGroupPageQueries({
  selectedSource,
  selectedGroupId,
  isCustomSource,
  groupImageCollectionFilter,
  selectedGroupImageIds,
  downloadScope,
}: {
  selectedSource: GroupSourceDefinition
  selectedGroupId: number | undefined
  isCustomSource: boolean
  groupImageCollectionFilter: GroupCollectionFilter
  selectedGroupImageIds: string[]
  downloadScope: 'group' | 'selection' | null
}) {
  const { canViewImages } = useImagePermissions()
  const queryClient = useQueryClient()

  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', selectedSource.key],
    enabled: canViewImages,
    queryFn: selectedSource.getAllGroups,
  })

  const assignableCustomGroupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', 'assignable-custom'],
    enabled: canViewImages,
    queryFn: getGroupsHierarchyAll,
  })

  const selectedGroupQuery = useQuery({
    queryKey: ['group-detail', selectedSource.key, selectedGroupId],
    queryFn: () => selectedSource.getGroup(selectedGroupId!),
    enabled: canViewImages && Number.isFinite(selectedGroupId),
  })

  const groupImagesQuery = useInfiniteQuery({
    queryKey: ['group-images', selectedSource.key, selectedGroupId, isCustomSource ? groupImageCollectionFilter : 'all'],
    queryFn: async ({ pageParam }): Promise<GroupImagesPayload> => (
      isCustomSource
        ? getGroupImages(selectedGroupId!, { ...pageParam, limit: 40, collectionType: groupImageCollectionFilter, includeChildren: true })
        : selectedSource.getImages(selectedGroupId!, { ...pageParam, limit: 40, includeChildren: true })
    ),
    initialPageParam: {} as GroupImagesPageParam,
    getNextPageParam: (lastPage): GroupImagesPageParam | undefined => {
      if (!lastPage.pagination.hasMore || !lastPage.pagination.nextCursorHash) {
        return undefined
      }
      return {
        cursorOrderIndex: lastPage.pagination.nextCursorOrderIndex,
        cursorAddedDate: lastPage.pagination.nextCursorAddedDate,
        cursorDate: lastPage.pagination.nextCursorDate,
        cursorHash: lastPage.pagination.nextCursorHash,
      }
    },
    enabled: canViewImages && Number.isFinite(selectedGroupId),
  })

  // Real per-filter totals for the 전체/수동/자동 segments (one-row pages; the server counts the same way as the list).
  const collectionFilterTotalQueries = useQueries({
    queries: COLLECTION_FILTERS.map((collectionType) => ({
      queryKey: ['group-images', 'custom', selectedGroupId, 'filter-total', collectionType],
      queryFn: () => getGroupImages(selectedGroupId!, { limit: 1, collectionType, includeChildren: true }),
      enabled: canViewImages && isCustomSource && Number.isFinite(selectedGroupId) && collectionType !== groupImageCollectionFilter,
      staleTime: 30_000,
    })),
  })
  const activeFilterPagination = groupImagesQuery.data?.pages[0]?.pagination
  const collectionFilterTotals: Partial<Record<GroupCollectionFilter, number>> = {}
  COLLECTION_FILTERS.forEach((collectionType, index) => {
    const pagination = collectionType === groupImageCollectionFilter
      ? activeFilterPagination
      : collectionFilterTotalQueries[index]?.data?.pagination
    if (pagination && pagination.totalKnown !== false) {
      collectionFilterTotals[collectionType] = pagination.total
    }
  })

  const groupFileCountsQuery = useQuery({
    queryKey: ['group-file-counts', selectedSource.key, selectedGroupId],
    queryFn: () => (isCustomSource
      ? getGroupFileCounts(selectedGroupId!, { includeChildren: true })
      : getAutoFolderGroupFileCounts(selectedGroupId!, { includeChildren: true })),
    // File counts inspect every candidate path on disk. Defer that expensive work
    // until the secondary download dialog is actually opened.
    enabled: canViewImages && Number.isFinite(selectedGroupId) && downloadScope === 'group',
  })

  const refreshCustomGroupQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all', 'custom'] }),
      queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom'] }),
      queryClient.invalidateQueries({ queryKey: ['group-breadcrumb', 'custom'] }),
      queryClient.invalidateQueries({ queryKey: ['group-images', 'custom'] }),
      queryClient.invalidateQueries({ queryKey: ['group-file-counts', 'custom'] }),
      queryClient.invalidateQueries({ queryKey: ['group-cover-images', 'custom'] }),
    ])
  }

  const refreshFolderGroupQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all', 'folders'] }),
      queryClient.invalidateQueries({ queryKey: ['group-detail', 'folders'] }),
      queryClient.invalidateQueries({ queryKey: ['group-breadcrumb', 'folders'] }),
      queryClient.invalidateQueries({ queryKey: ['group-images', 'folders'] }),
      queryClient.invalidateQueries({ queryKey: ['group-file-counts', 'folders'] }),
      queryClient.invalidateQueries({ queryKey: ['group-cover-images', 'folders'] }),
    ])
  }

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
    groupsQuery,
    assignableCustomGroupsQuery,
    selectedGroupQuery,
    groupImagesQuery,
    collectionFilterTotals,
    groupFileCountsQuery,
    refreshCustomGroupQueries,
    refreshFolderGroupQueries,
    allGroups,
    selectedGroupHierarchy,
    rootGroups,
    childGroups,
    parentGroupHierarchy,
    groupImages,
    selectedGroupImages,
    selectedGroupCompositeHashes,
    selectedDownloadCounts,
    activeDownloadCounts,
    selectableDownloadCount,
  }
}
