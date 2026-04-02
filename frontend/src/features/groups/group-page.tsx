import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FolderMinus, FolderPlus, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/common/page-header'
import { SegmentedControl } from '@/components/common/segmented-control'
import {
  addImagesToGroup,
  createGroup,
  deleteGroup,
  downloadAutoFolderGroupArchive,
  downloadGroupArchive,
  getAppSettings,
  getAutoFolderGroup,
  getAutoFolderGroupBreadcrumb,
  getAutoFolderGroupFileCounts,
  getAutoFolderGroupImages,
  getAutoFolderGroupPreviewImage,
  getAutoFolderGroupsHierarchyAll,
  getGroup,
  getGroupBreadcrumb,
  getGroupFileCounts,
  getGroupImages,
  getGroupPreviewImage,
  getGroupsHierarchyAll,
  rebuildAutoFolderGroups,
  removeImagesFromGroup,
  runAllGroupsAutoCollect,
  runGroupAutoCollect,
  updateGroup,
} from '@/lib/api'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import type { GroupDownloadType, GroupFileCounts, GroupMutationInput, GroupRecord } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import type { GroupExplorerCardStyle } from '@/types/settings'
import { GroupBreadcrumbs } from './components/group-breadcrumbs'
import { GroupChildCard } from './components/group-child-card'
import { GroupExplorerSidebarPanel } from './components/group-explorer-sidebar-panel'
import { GroupNavigationGridSection } from './components/group-navigation-grid-section'
import { GroupRootGridSection } from './components/group-root-grid-section'
import { GroupEditorModal } from './components/group-editor-modal'
import { GroupAssignModal } from './components/group-assign-modal'
import { GroupImageSection } from './components/group-image-section'
import { GroupDownloadModal } from './components/group-download-modal'
import { GroupDetailHeaderCard } from './components/group-detail-header-card'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'

const groupSources = {
  custom: {
    key: 'custom',
    tabLabel: '커스텀 그룹',
    rootTitle: '사용자 커스텀 그룹',
    rootSectionTitle: '루트 그룹',
    getAllGroups: getGroupsHierarchyAll,
    getGroup,
    getBreadcrumb: getGroupBreadcrumb,
    getImages: getGroupImages,
    getPreviewImage: getGroupPreviewImage,
  },
  folders: {
    key: 'folders',
    tabLabel: '감시폴더 그룹',
    rootTitle: '감시폴더 그룹',
    rootSectionTitle: '감시폴더 루트',
    getAllGroups: getAutoFolderGroupsHierarchyAll,
    getGroup: getAutoFolderGroup,
    getBreadcrumb: getAutoFolderGroupBreadcrumb,
    getImages: getAutoFolderGroupImages,
    getPreviewImage: getAutoFolderGroupPreviewImage,
  },
} as const

type GroupSourceKey = keyof typeof groupSources

type GroupEditorState =
  | {
    mode: 'create'
    defaultParentId: number | null
  }
  | {
    mode: 'edit'
    group: GroupRecord
  }

function normalizeGroupSourceKey(value: string | null): GroupSourceKey {
  return value === 'folders' ? 'folders' : 'custom'
}

/** Read the current group's collection type from the enriched image payload. */
function getImageCollectionType(image: ImageRecord) {
  return image.groups?.[0]?.collection_type ?? 'manual'
}

/** Format a backend timestamp into a compact Korean label for group metadata. */
function formatGroupTimestamp(value?: string | null) {
  if (!value) {
    return '아직 없음'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('ko-KR')
}

function createEmptyGroupFileCounts(): GroupFileCounts {
  return {
    thumbnail: 0,
    original: 0,
    video: 0,
  }
}

/** Resolve the group-navigation grid layout for the selected card style. */
function getGroupCardGridClassName(cardStyle: GroupExplorerCardStyle) {
  return cardStyle === 'media-tile'
    ? 'grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
    : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'
}

function getDownloadCountsFromImages(images: ImageRecord[]): GroupFileCounts {
  const counts = createEmptyGroupFileCounts()

  for (const image of images) {
    if (image.thumbnail_url) {
      counts.thumbnail += 1
    }

    const ext = image.original_file_path?.split('.').pop()?.toLowerCase() ?? ''
    const isVideoOrAnimated = image.file_type === 'video' || image.file_type === 'animated' || ['gif', 'mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)

    if (isVideoOrAnimated) {
      counts.video += 1
      continue
    }

    if (image.original_file_path || image.thumbnail_url) {
      counts.original += 1
    }
  }

  return counts
}

export function GroupPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { groupId } = useParams<{ groupId?: string }>()
  const [searchParams] = useSearchParams()
  const [editorState, setEditorState] = useState<GroupEditorState | null>(null)
  const [selectedGroupImageIds, setSelectedGroupImageIds] = useState<string[]>([])
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [downloadScope, setDownloadScope] = useState<'group' | 'selection' | null>(null)
  const [groupImageCollectionFilter, setGroupImageCollectionFilter] = useState<'all' | 'manual' | 'auto'>('all')
  const isWideLayout = useDesktopPageLayout()
  const selectedSourceKey = normalizeGroupSourceKey(searchParams.get('tab'))
  const selectedSource = groupSources[selectedSourceKey]
  const selectedGroupId = groupId ? Number(groupId) : undefined
  const isCustomSource = selectedSource.key === 'custom'

  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })
  const groupExplorerCardStyle = settingsQuery.data?.appearance.groupExplorerCardStyle ?? DEFAULT_APPEARANCE_SETTINGS.groupExplorerCardStyle

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
    ])
  }

  const createGroupMutation = useMutation({
    mutationFn: createGroup,
    onSuccess: async (result) => {
      setEditorState(null)
      showSnackbar({ message: '커스텀 그룹을 만들었어.', tone: 'info' })
      await refreshCustomGroupQueries()
      navigate(`/groups/${result.id}?tab=custom`)
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '커스텀 그룹 생성에 실패했어.', tone: 'error' })
    },
  })

  const updateGroupMutation = useMutation({
    mutationFn: ({ groupId: targetGroupId, input }: { groupId: number; input: GroupMutationInput }) => updateGroup(targetGroupId, input),
    onSuccess: async () => {
      setEditorState(null)
      showSnackbar({ message: '커스텀 그룹 설정을 저장했어.', tone: 'info' })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '커스텀 그룹 저장에 실패했어.', tone: 'error' })
    },
  })

  const deleteGroupMutation = useMutation({
    mutationFn: ({ groupId: targetGroupId, cascade }: { groupId: number; cascade: boolean }) => deleteGroup(targetGroupId, { cascade }),
    onSuccess: async () => {
      showSnackbar({ message: '커스텀 그룹을 삭제했어.', tone: 'info' })
      await refreshCustomGroupQueries()
      navigate('/groups?tab=custom')
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '커스텀 그룹 삭제에 실패했어.', tone: 'error' })
    },
  })

  const autoCollectMutation = useMutation({
    mutationFn: runGroupAutoCollect,
    onSuccess: async (result) => {
      showSnackbar({
        message: `자동수집 실행 완료: ${result.images_added.toLocaleString('ko-KR')}개 추가, ${result.images_removed.toLocaleString('ko-KR')}개 정리`,
        tone: 'info',
      })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '자동수집 실행에 실패했어.', tone: 'error' })
    },
  })

  const autoCollectAllMutation = useMutation({
    mutationFn: runAllGroupsAutoCollect,
    onSuccess: async (result) => {
      showSnackbar({
        message: `전체 자동수집 완료: ${result.total_groups.toLocaleString('ko-KR')}개 그룹, ${result.total_images_added.toLocaleString('ko-KR')}개 추가, ${result.total_images_removed.toLocaleString('ko-KR')}개 정리`,
        tone: 'info',
      })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '전체 자동수집 실행에 실패했어.', tone: 'error' })
    },
  })

  const rebuildAutoFolderGroupsMutation = useMutation({
    mutationFn: rebuildAutoFolderGroups,
    onSuccess: async () => {
      showSnackbar({ message: '감시폴더 그룹을 다시 읽어왔어.', tone: 'info' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all', 'folders'] }),
        queryClient.invalidateQueries({ queryKey: ['group-detail', 'folders'] }),
        queryClient.invalidateQueries({ queryKey: ['group-breadcrumb', 'folders'] }),
        queryClient.invalidateQueries({ queryKey: ['group-images', 'folders'] }),
        queryClient.invalidateQueries({ queryKey: ['group-file-counts', 'folders'] }),
      ])
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '감시폴더 그룹 재구축에 실패했어.', tone: 'error' })
    },
  })

  const downloadGroupArchiveMutation = useMutation({
    mutationFn: async ({ type, scope }: { type: GroupDownloadType; scope: 'group' | 'selection' }) => {
      if (!selectedGroupId) {
        throw new Error('다운로드할 그룹이 선택되지 않았어.')
      }

      if (scope === 'selection' && selectedGroupCompositeHashes.length === 0) {
        throw new Error('다운로드할 이미지를 먼저 선택해줘.')
      }

      const compositeHashes = scope === 'selection' ? selectedGroupCompositeHashes : undefined

      if (isCustomSource) {
        return downloadGroupArchive(selectedGroupId, { type, compositeHashes })
      }

      return downloadAutoFolderGroupArchive(selectedGroupId, { type, compositeHashes })
    },
    onSuccess: (_, variables) => {
      setDownloadScope(null)
      showSnackbar({
        message: variables.scope === 'selection' ? '선택한 이미지 다운로드를 준비했어.' : '현재 그룹 다운로드를 준비했어.',
        tone: 'info',
      })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '그룹 다운로드에 실패했어.', tone: 'error' })
    },
  })

  const assignToGroupMutation = useMutation({
    mutationFn: ({ groupId: targetGroupId, compositeHashes }: { groupId: number; compositeHashes: string[] }) => addImagesToGroup(targetGroupId, compositeHashes),
    onSuccess: async (result) => {
      setIsAssignModalOpen(false)
      setSelectedGroupImageIds([])
      showSnackbar({ message: result.message, tone: 'info' })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '그룹 추가에 실패했어.', tone: 'error' })
    },
  })

  const removeGroupImagesMutation = useMutation({
    mutationFn: ({ groupId: targetGroupId, compositeHashes }: { groupId: number; compositeHashes: string[] }) => removeImagesFromGroup(targetGroupId, compositeHashes),
    onSuccess: async (result) => {
      setSelectedGroupImageIds([])
      showSnackbar({ message: result.message, tone: 'info' })
      await refreshCustomGroupQueries()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '그룹 이미지 제거에 실패했어.', tone: 'error' })
    },
  })

  useEffect(() => {
    setSelectedGroupImageIds([])
    setIsAssignModalOpen(false)
    setDownloadScope(null)
    setGroupImageCollectionFilter('all')
  }, [selectedGroupId, selectedSource.key])

  const allGroups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])
  const selectedGroupHierarchy = useMemo(
    () => allGroups.find((group) => group.id === selectedGroupId) ?? null,
    [allGroups, selectedGroupId],
  )
  const rootGroups = useMemo(() => allGroups.filter((group) => group.parent_id == null), [allGroups])
  const childGroups = useMemo(() => allGroups.filter((group) => group.parent_id === selectedGroupId), [allGroups, selectedGroupId])
  const parentGroupHierarchy = useMemo(
    () => allGroups.find((group) => group.id === selectedGroupHierarchy?.parent_id) ?? null,
    [allGroups, selectedGroupHierarchy?.parent_id],
  )
  const backNavigationGroup = useMemo(() => {
    if (!selectedGroupHierarchy) {
      return null
    }

    if (parentGroupHierarchy) {
      return parentGroupHierarchy
    }

    return {
      ...selectedGroupHierarchy,
      id: 0,
      name: selectedSource.rootTitle,
      image_count: rootGroups.length,
      child_count: rootGroups.length,
      has_children: true,
    }
  }, [parentGroupHierarchy, rootGroups.length, selectedGroupHierarchy, selectedSource.rootTitle])
  const groupImages = useMemo(() => (groupImagesQuery.data?.pages ?? []).flatMap((page) => page.images), [groupImagesQuery.data?.pages])
  const selectedGroupImages = useMemo(
    () => groupImages.filter((image) => selectedGroupImageIds.includes(String(image.composite_hash ?? image.id))),
    [groupImages, selectedGroupImageIds],
  )
  const selectedGroupCompositeHashes = useMemo(
    () =>
      selectedGroupImages
        .map((image) => image.composite_hash)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    [selectedGroupImages],
  )
  const selectedDownloadCounts = useMemo(() => getDownloadCountsFromImages(selectedGroupImages), [selectedGroupImages])
  const activeDownloadCounts = downloadScope === 'selection'
    ? selectedDownloadCounts
    : groupFileCountsQuery.data ?? createEmptyGroupFileCounts()
  const selectableDownloadCount = useMemo(
    () => selectedGroupImages.filter((image) => image.original_file_path || image.thumbnail_url).length,
    [selectedGroupImages],
  )

  const handleOpenGroup = (nextGroupId: number) => {
    navigate(`/groups/${nextGroupId}?tab=${selectedSource.key}`)
  }

  const handleOpenRoot = () => {
    navigate(`/groups?tab=${selectedSource.key}`)
  }

  const handleSelectSource = (nextSource: GroupSourceKey) => {
    setEditorState(null)
    navigate(`/groups?tab=${nextSource}`)
  }

  const handleOpenCreateModal = () => {
    setEditorState({
      mode: 'create',
      defaultParentId: isCustomSource ? (selectedGroupId ?? null) : null,
    })
  }

  const handleOpenEditModal = () => {
    if (!selectedGroupQuery.data || !isCustomSource) {
      return
    }

    setEditorState({
      mode: 'edit',
      group: selectedGroupQuery.data,
    })
  }

  const handleSubmitGroup = async (input: GroupMutationInput) => {
    if (!editorState) {
      return
    }

    if (editorState.mode === 'create') {
      await createGroupMutation.mutateAsync(input)
      return
    }

    await updateGroupMutation.mutateAsync({
      groupId: editorState.group.id,
      input,
    })
  }

  const handleDeleteSelectedGroup = async () => {
    if (!selectedGroupQuery.data || !selectedGroupId || !isCustomSource) {
      return
    }

    const hasChildren = Boolean(selectedGroupHierarchy?.has_children)
    const confirmed = window.confirm(
      hasChildren
        ? `정말 ${selectedGroupQuery.data.name} 그룹을 삭제할까? 하위 그룹은 기본적으로 루트로 올라가.`
        : `정말 ${selectedGroupQuery.data.name} 그룹을 삭제할까?`,
    )
    if (!confirmed) {
      return
    }

    const cascade = hasChildren
      ? window.confirm('하위 그룹까지 전부 같이 삭제할까?\n확인 = 하위 그룹도 함께 삭제\n취소 = 현재 그룹만 삭제하고 하위 그룹은 유지')
      : false

    await deleteGroupMutation.mutateAsync({
      groupId: selectedGroupId,
      cascade,
    })
  }

  const handleRunAutoCollect = async () => {
    if (!selectedGroupId || !isCustomSource) {
      return
    }

    await autoCollectMutation.mutateAsync(selectedGroupId)
  }

  const handleRunAutoCollectAll = async () => {
    const confirmed = window.confirm('현재 커스텀 그룹 전체에 자동수집을 한 번 돌릴까?')
    if (!confirmed) {
      return
    }

    await autoCollectAllMutation.mutateAsync()
  }

  const handleRebuildAutoFolderGroups = async () => {
    const confirmed = window.confirm('감시폴더 그룹 구조를 다시 읽어와서 재구축할까?')
    if (!confirmed) {
      return
    }

    await rebuildAutoFolderGroupsMutation.mutateAsync()
  }

  const handleOpenGroupDownloadModal = () => {
    if (!selectedGroupId) {
      return
    }

    setDownloadScope('group')
  }

  const handleOpenSelectionDownloadModal = () => {
    if (selectedGroupCompositeHashes.length === 0) {
      return
    }

    setDownloadScope('selection')
  }

  const handleDownloadArchive = async (type: GroupDownloadType) => {
    if (!downloadScope) {
      return
    }

    await downloadGroupArchiveMutation.mutateAsync({ type, scope: downloadScope })
  }

  const handleOpenAssignModal = () => {
    if (selectedGroupCompositeHashes.length === 0) {
      return
    }

    if (assignableCustomGroupsQuery.isPending) {
      showSnackbar({ message: '커스텀 그룹 목록을 불러오는 중이야.', tone: 'info' })
      return
    }

    if (assignableCustomGroupsQuery.isError) {
      showSnackbar({ message: assignableCustomGroupsQuery.error instanceof Error ? assignableCustomGroupsQuery.error.message : '그룹 목록을 불러오지 못했어.', tone: 'error' })
      return
    }

    if ((assignableCustomGroupsQuery.data?.length ?? 0) === 0) {
      showSnackbar({ message: '먼저 커스텀 그룹을 하나 만들어줘.', tone: 'error' })
      return
    }

    setIsAssignModalOpen(true)
  }

  const handleAssignSelectedImages = async (targetGroupId: number) => {
    await assignToGroupMutation.mutateAsync({
      groupId: targetGroupId,
      compositeHashes: selectedGroupCompositeHashes,
    })
  }

  const handleRemoveSelectedImages = async () => {
    if (!selectedGroupId || !isCustomSource || selectedGroupCompositeHashes.length === 0) {
      return
    }

    const confirmed = window.confirm(`선택한 ${selectedGroupCompositeHashes.length.toLocaleString('ko-KR')}개 이미지를 현재 그룹에서 제거할까?`)
    if (!confirmed) {
      return
    }

    await removeGroupImagesMutation.mutateAsync({
      groupId: selectedGroupId,
      compositeHashes: selectedGroupCompositeHashes,
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isWideLayout ? 'Image' : undefined}
        title="Groups"
        actions={
          <>
            {isCustomSource ? (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={() => void handleRunAutoCollectAll()} disabled={autoCollectAllMutation.isPending}>
                  <Play className="h-4 w-4" />
                  {autoCollectAllMutation.isPending ? '전체 자동수집 실행 중…' : '전체 자동수집'}
                </Button>
                <Button type="button" size="sm" onClick={handleOpenCreateModal}>
                  <FolderPlus className="h-4 w-4" />
                  {selectedGroupId ? '하위 그룹 추가' : '새 그룹'}
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="secondary" onClick={() => void handleRebuildAutoFolderGroups()} disabled={rebuildAutoFolderGroupsMutation.isPending}>
                <RotateCcw className="h-4 w-4" />
                {rebuildAutoFolderGroupsMutation.isPending ? '감시폴더 재구축 중…' : '감시폴더 재구축'}
              </Button>
            )}
          </>
        }
      />

      <div className="border-b border-border/70 pb-2">
        <SegmentedControl
          value={selectedSource.key}
          items={Object.values(groupSources).map((source) => ({ value: source.key, label: source.tabLabel }))}
          onChange={(nextSourceKey) => handleSelectSource(nextSourceKey as GroupSourceKey)}
        />
      </div>

      <div className={cn('grid gap-8', isWideLayout ? 'grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-1')}>
        <GroupExplorerSidebarPanel
          isWideLayout={isWideLayout}
          groups={allGroups}
          selectedGroupId={selectedGroupId}
          isLoading={groupsQuery.isLoading}
          isError={groupsQuery.isError}
          errorMessage={groupsQuery.error instanceof Error ? groupsQuery.error.message : null}
          onSelectGroup={handleOpenGroup}
        />

        <section className="space-y-8">
          {isWideLayout && selectedGroupId ? (
            <GroupBreadcrumbs
              items={breadcrumbQuery.data ?? []}
              selectedGroupId={selectedGroupId}
              onOpenGroup={handleOpenGroup}
              onOpenRoot={handleOpenRoot}
            />
          ) : null}

          {!selectedGroupId ? (
            <GroupRootGridSection
              title={selectedSource.rootSectionTitle}
              groups={rootGroups}
              cardStyle={groupExplorerCardStyle}
              gridClassName={getGroupCardGridClassName(groupExplorerCardStyle)}
              previewSourceKey={selectedSource.key}
              loadPreviewImage={selectedSource.getPreviewImage}
              onOpenGroup={handleOpenGroup}
            />
          ) : null}

          {selectedGroupId && selectedGroupQuery.isLoading ? <Skeleton className="h-28 w-full rounded-sm" /> : null}

          {selectedGroupId && selectedGroupQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>그룹 정보를 불러오지 못했어</AlertTitle>
              <AlertDescription>
                {selectedGroupQuery.error instanceof Error ? selectedGroupQuery.error.message : '알 수 없는 오류가 발생했어.'}
              </AlertDescription>
            </Alert>
          ) : null}

          {selectedGroupId && selectedGroupQuery.data ? (
            <div className="space-y-8">
              <GroupDetailHeaderCard
                group={selectedGroupQuery.data}
                selectedGroupHierarchy={selectedGroupHierarchy}
                isCustomSource={isCustomSource}
                groupImageCollectionFilter={groupImageCollectionFilter}
                isGroupFileCountsLoading={groupFileCountsQuery.isLoading}
                isDownloadingGroup={downloadGroupArchiveMutation.isPending && downloadScope === 'group'}
                isAutoCollectPending={autoCollectMutation.isPending}
                isDeletePending={deleteGroupMutation.isPending}
                lastAutoCollectLabel={formatGroupTimestamp(selectedGroupQuery.data.auto_collect_last_run)}
                parentGroupLabel={selectedGroupHierarchy?.parent_id == null ? '루트 그룹' : '하위 그룹으로 연결됨'}
                onOpenDownload={handleOpenGroupDownloadModal}
                onOpenCreateModal={handleOpenCreateModal}
                onOpenEditModal={handleOpenEditModal}
                onRunAutoCollect={() => void handleRunAutoCollect()}
                onDeleteGroup={() => void handleDeleteSelectedGroup()}
                onFilterChange={setGroupImageCollectionFilter}
              />

              {backNavigationGroup ? (
                <GroupNavigationGridSection
                  backNavigationGroup={backNavigationGroup}
                  parentGroupHierarchy={parentGroupHierarchy}
                  rootTitle={selectedSource.rootTitle}
                  childGroups={childGroups}
                  cardStyle={groupExplorerCardStyle}
                  gridClassName={getGroupCardGridClassName(groupExplorerCardStyle)}
                  previewSourceKey={selectedSource.key}
                  loadPreviewImage={selectedSource.getPreviewImage}
                  onOpenGroup={handleOpenGroup}
                  onOpenRoot={handleOpenRoot}
                />
              ) : null}

              <GroupImageSection
                group={selectedGroupQuery.data}
                groupImages={groupImages}
                isLoading={groupImagesQuery.isLoading}
                isError={groupImagesQuery.isError}
                errorMessage={groupImagesQuery.error instanceof Error ? groupImagesQuery.error.message : null}
                hasMore={Boolean(groupImagesQuery.hasNextPage)}
                isLoadingMore={groupImagesQuery.isFetchingNextPage}
                onLoadMore={() => void groupImagesQuery.fetchNextPage()}
                hideHeader
                selectable={true}
                selectedIds={selectedGroupImageIds}
                onSelectedIdsChange={setSelectedGroupImageIds}
              />
            </div>
          ) : null}
        </section>
      </div>

      <ImageSelectionBar
        selectedCount={selectedGroupImageIds.length}
        downloadableCount={selectableDownloadCount}
        showDownloadAction={true}
        isDownloading={downloadGroupArchiveMutation.isPending && downloadScope === 'selection'}
        extraActions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleOpenAssignModal}
              disabled={assignToGroupMutation.isPending || assignableCustomGroupsQuery.isPending}
              data-no-select-drag="true"
            >
              <FolderPlus className="h-4 w-4" />
              {assignToGroupMutation.isPending ? '그룹 추가 중…' : '커스텀 그룹에 추가'}
            </Button>
            {isCustomSource ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleRemoveSelectedImages()}
                disabled={removeGroupImagesMutation.isPending}
                data-no-select-drag="true"
              >
                <FolderMinus className="h-4 w-4" />
                {removeGroupImagesMutation.isPending ? '제거 중…' : '현재 그룹에서 제거'}
              </Button>
            ) : null}
          </>
        }
        onDownload={handleOpenSelectionDownloadModal}
        onClear={() => setSelectedGroupImageIds([])}
      />

      <GroupDownloadModal
        open={downloadScope !== null}
        title={downloadScope === 'selection' ? '선택한 이미지 다운로드' : '현재 그룹 다운로드'}
        description={downloadScope === 'selection' ? `선택한 ${selectedGroupCompositeHashes.length.toLocaleString('ko-KR')}개 기준으로 내려받을 파일 종류를 골라줘.` : '현재 그룹 전체에서 내려받을 파일 종류를 골라줘.'}
        counts={activeDownloadCounts}
        isLoading={downloadScope === 'group' ? groupFileCountsQuery.isLoading : false}
        isDownloading={downloadGroupArchiveMutation.isPending}
        onClose={() => setDownloadScope(null)}
        onDownload={handleDownloadArchive}
      />

      <GroupAssignModal
        open={isAssignModalOpen}
        groups={assignableCustomGroupsQuery.data ?? []}
        selectedCount={selectedGroupCompositeHashes.length}
        isSubmitting={assignToGroupMutation.isPending}
        onClose={() => setIsAssignModalOpen(false)}
        onSubmit={handleAssignSelectedImages}
      />

      {isCustomSource ? (
        <GroupEditorModal
          open={editorState !== null}
          mode={editorState?.mode ?? 'create'}
          groups={allGroups}
          group={editorState?.mode === 'edit' ? editorState.group : null}
          defaultParentId={editorState?.mode === 'create' ? editorState.defaultParentId : null}
          isSubmitting={createGroupMutation.isPending || updateGroupMutation.isPending}
          onClose={() => setEditorState(null)}
          onSubmit={handleSubmitGroup}
        />
      ) : null}
    </div>
  )
}
