import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ImagePermissionNotice } from '@/features/images/components/image-permission-notice'
import { CheckCheck, FolderInput, FolderMinus, FolderPlus, ListChecks, Pencil, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { GroupDeleteDialog } from './components/group-delete-dialog'
import { GroupManageView } from './components/group-manage-view'
import { GroupMoveDialog } from './components/group-move-dialog'
import type { GroupWithHierarchy } from '@/types/group'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Skeleton } from '@/components/ui/skeleton'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import type { CountState } from '@/lib/count-display'
import { GroupExplorerSidebarPanel } from './components/group-explorer-sidebar-panel'
import { GroupRootOverview } from './components/group-root-overview'
import { GroupSubgroupStrip } from './components/group-subgroup-strip'
import { GroupViewHeader } from './components/group-view-header'
import { GroupEditorModal } from './components/group-editor-modal'
import { GroupAssignModal } from './components/group-assign-modal'
import { GroupEmoticonSection } from './components/group-emoticon-section'
import { GroupImageSection } from './components/group-image-section'
import { SegmentedControl } from '@/components/common/segmented-control'
import { GroupDownloadModal } from './components/group-download-modal'
import { SelectionBarAction } from '@/components/common/selection-action-bar'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { ImageBatchResizeAction } from '@/features/images/components/image-batch-resize-action'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import { buildGroupCountMaps } from './group-count-utils'
import { writeGroupImageDrag } from './group-image-drag'
import { buildGroupPathItems, countAutoCollectConditions, groupSources, normalizeGroupSourceKey, type GroupEditorState } from './group-page-shared'
import { useGroupPageQueries, type GroupCollectionFilter } from './use-group-page-queries'
import { useGroupPageActions } from './use-group-page-actions'
import { useI18n } from '@/i18n'
import { useGroupChatPage } from './use-group-chat-page'
import { GroupLinkedResources } from './components/group-linked-resources'

export function GroupPage() {
  const { canViewImages, canCreateImageCopies } = useImagePermissions()
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const {
    columnCount: groupColumnCount,
    setColumnCount: setGroupColumnCount,
    resetColumnCount: resetGroupColumnCount,
    defaultColumnCount: defaultGroupColumnCount,
    minColumnCount: minGroupColumnCount,
    maxColumnCount: maxGroupColumnCount,
  } = useImageListColumnPreference('group')
  const { groupId } = useParams<{ groupId?: string }>()
  const [searchParams] = useSearchParams()
  const [editorState, setEditorState] = useState<GroupEditorState | null>(null)
  const [selectedGroupImageIds, setSelectedGroupImageIds] = useState<string[]>([])
  const [visibleGroupImageIds, setVisibleGroupImageIds] = useState<string[]>([])
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [downloadScope, setDownloadScope] = useState<'group' | 'selection' | null>(null)
  const [groupImageCollectionFilter, setGroupImageCollectionFilter] = useState<GroupCollectionFilter>('all')
  // Root view only: the checkable group list for deleting / moving many groups at once.
  const [isManagingGroups, setIsManagingGroups] = useState(false)
  const [managedGroupIds, setManagedGroupIds] = useState<number[]>([])
  const isWideLayout = useDesktopPageLayout()
  const selectedSourceKey = normalizeGroupSourceKey(searchParams.get('tab'))
  const selectedSource = groupSources[selectedSourceKey]
  const selectedGroupId = groupId ? Number(groupId) : undefined
  const isCustomSource = selectedSource.key === 'custom'
  // Emoticon groups open on their keyword sheet; the usual image list stays one switch away.
  const [emoticonView, setEmoticonView] = useState<'keywords' | 'images'>('keywords')
  const rootLabel = isCustomSource ? t({ ko: '모든 그룹', en: 'All groups' }) : t({ ko: '감시폴더', en: 'Watched folders' })

  const {
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
    groupImages,
    selectedGroupCompositeHashes,
    activeDownloadCounts,
    selectableDownloadCount,
  } = useGroupPageQueries({
    selectedSource,
    selectedGroupId,
    isCustomSource,
    groupImageCollectionFilter,
    selectedGroupImageIds,
    downloadScope,
  })

  const groupCountMaps = useMemo(() => buildGroupCountMaps(allGroups), [allGroups])
  const groupPathItems = useMemo(() => buildGroupPathItems(allGroups, selectedGroupId), [allGroups, selectedGroupId])
  // Only the image list's own total is shown; the group record's raw membership count used to
  // fill in while loading and then jump to the filtered total. Undefined renders as pending.
  const selectedGroupImagePagination = groupImagesQuery.data?.pages[0]?.pagination
  const selectedGroupImageTotalCount = selectedGroupImagePagination && selectedGroupImagePagination.totalKnown !== false
    ? selectedGroupImagePagination.total
    : undefined
  // Header count: the unfiltered list total (custom groups keep it across filter switches).
  const headerTotalCount = isCustomSource ? collectionFilterTotals.all : selectedGroupImageTotalCount
  const headerCountState: CountState = headerTotalCount !== undefined
    ? { total: headerTotalCount, status: 'known' }
    : { total: null, status: groupImagesQuery.isError ? 'error' : 'pending' }
  const fetchNextGroupImagesPage = groupImagesQuery.fetchNextPage
  // Keep the load-more identity stable so the list's IntersectionObserver is not rebuilt every render.
  const handleLoadMoreGroupImages = useCallback(() => {
    void fetchNextGroupImagesPage()
  }, [fetchNextGroupImagesPage])
  const groupImageListResetKey = `${selectedSource.key}:${selectedGroupId ?? 'root'}:${isCustomSource ? groupImageCollectionFilter : 'all'}`

  const {
    createGroupMutation,
    updateGroupMutation,
    deleteGroupsMutation,
    moveGroupsMutation,
    autoCollectMutation,
    autoCollectAllMutation,
    rebuildAutoFolderGroupsMutation,
    downloadGroupArchiveMutation,
    assignToGroupMutation,
    removeGroupImagesMutation,
    deleteSelectedImagesMutation,
    canDeleteImages,
    handleOpenGroup,
    handleOpenRoot,
    handleSelectSource,
    handleOpenCreateModal,
    handleOpenEditModal,
    handleSubmitGroup,
    openCreateSubgroup,
    openEditGroup,
    groupDialog,
    openDeleteGroups,
    openMoveGroups,
    closeGroupDialog,
    handleConfirmDeleteGroups,
    handleConfirmMoveGroups,
    handleRunAutoCollect,
    handleRunAutoCollectAll,
    handleRebuildAutoFolderGroups,
    handleOpenGroupDownloadModal,
    handleOpenSelectionDownloadModal,
    handleDownloadArchive,
    handleDeleteSelectedImages,
    handleOpenAssignModal,
    handleAssignSelectedImages,
    handleDropImagesToGroup,
    handleRemoveSelectedImages,
  } = useGroupPageActions({
    navigate,
    showSnackbar,
    selectedSource,
    isCustomSource,
    selectedGroupId,
    selectedGroup: selectedGroupQuery.data,
    allGroups,
    selectedGroupCompositeHashes,
    assignableCustomGroupsState: {
      isPending: assignableCustomGroupsQuery.isPending,
      isError: assignableCustomGroupsQuery.isError,
      error: assignableCustomGroupsQuery.error,
      count: assignableCustomGroupsQuery.data?.length ?? 0,
    },
    editorState,
    setEditorState,
    setSelectedGroupImageIds,
    setManagedGroupIds,
    setIsAssignModalOpen,
    setDownloadScope,
    refreshCustomGroupQueries,
    refreshFolderGroupQueries,
  })

  useGroupChatPage({
    sourceKey: selectedSource.key,
    isCustomSource,
    groups: allGroups,
    selectedGroupId,
    selectedGroup: selectedGroupQuery.data,
    selectedImageIds: selectedGroupImageIds,
    images: groupImages,
    fields: [
      { id: 'collectionFilter', label: t({ ko: '수집 유형', en: 'Collection type' }), type: 'select', value: groupImageCollectionFilter, options: ['all', 'manual', 'auto'] },
      { id: 'columns', label: t({ ko: '한 줄의 이미지 수', en: 'Images per row' }), type: 'number', value: groupColumnCount, min: minGroupColumnCount, max: maxGroupColumnCount, integer: true },
      { id: 'emoticonView', label: t({ ko: '이모티콘 표시', en: 'Emoticon view' }), type: 'select', value: emoticonView, options: ['keywords', 'images'] },
    ],
    apply: (patch) => { if (patch.collectionFilter !== undefined) setGroupImageCollectionFilter(patch.collectionFilter as GroupCollectionFilter); if (patch.columns !== undefined) setGroupColumnCount(Number(patch.columns)); if (patch.emoticonView !== undefined) setEmoticonView(patch.emoticonView as 'keywords' | 'images') },
    openGroup: handleOpenGroup,
    createGroup: (input) => createGroupMutation.mutateAsync(input),
    updateGroup: (targetGroupId, input) => updateGroupMutation.mutateAsync({ groupId: targetGroupId, input }),
    runAutoCollect: (targetGroupId) => autoCollectMutation.mutateAsync(targetGroupId),
    moveGroups: (ids, parentId) => moveGroupsMutation.mutateAsync({ ids, parentId }),
    deleteGroups: (ids, cascade) => deleteGroupsMutation.mutateAsync({ ids, cascade }),
  })

  useEffect(() => {
    setSelectedGroupImageIds([])
    setIsAssignModalOpen(false)
    setDownloadScope(null)
    setGroupImageCollectionFilter('all')
    setIsManagingGroups(false)
    setManagedGroupIds([])
  }, [selectedGroupId, selectedSource.key])

  const groupById = useMemo(() => new Map(allGroups.map((group) => [group.id, group] as const)), [allGroups])
  const dialogGroups = (groupDialog?.ids ?? [])
    .map((id) => groupById.get(id))
    .filter((group): group is GroupWithHierarchy => group !== undefined)
  const showManageView = isCustomSource && !selectedGroupId && isManagingGroups

  const getGroupMenu = (group: GroupWithHierarchy): ActionMenuEntry[] => [
    { key: 'edit', label: t({ ko: '편집', en: 'Edit' }), icon: Pencil, onSelect: () => openEditGroup(group) },
    { key: 'subgroup', label: t({ ko: '하위 그룹 추가', en: 'Add subgroup' }), icon: FolderPlus, onSelect: () => openCreateSubgroup(group.id) },
    { key: 'move', label: t({ ko: '다른 위치로 옮기기', en: 'Move to…' }), icon: FolderInput, onSelect: () => openMoveGroups([group.id]) },
    '-',
    canDeleteImages ? { key: 'delete', label: t({ ko: '그룹 삭제', en: 'Delete group' }), icon: Trash2, destructive: true, onSelect: () => openDeleteGroups([group.id]) } : null,
  ]

  // Drag-out payload: the whole selection when the held tile is part of it, otherwise just that tile.
  const handleImageDragStart = useCallback((itemId: string, event: DragEvent) => {
    const itemIds = selectedGroupImageIds.includes(itemId) ? selectedGroupImageIds : [itemId]
    const itemIdSet = new Set(itemIds)
    const compositeHashes = groupImages
      .filter((image) => itemIdSet.has(String(image.composite_hash ?? image.id)))
      .map((image) => image.composite_hash)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    if (compositeHashes.length === 0) {
      event.preventDefault()
      return
    }
    writeGroupImageDrag(event, compositeHashes, t({ ko: '{count}장', en: '{count} images' }, { count: formatNumber(compositeHashes.length) }))
  }, [formatNumber, groupImages, selectedGroupImageIds, t])

  const groupNameById = useMemo(() => new Map(allGroups.map((group) => [group.id, group.name] as const)), [allGroups])
  const handleDropImages = useCallback((targetGroupId: number, compositeHashes: string[]) => {
    handleDropImagesToGroup(targetGroupId, groupNameById.get(targetGroupId) ?? '', compositeHashes)
  }, [groupNameById, handleDropImagesToGroup])

  const allVisibleSelected = visibleGroupImageIds.length > 0 && visibleGroupImageIds.every((id) => selectedGroupImageIds.includes(id))
  const selectAllLabel = allVisibleSelected ? t({ ko: '선택 해제', en: 'Clear selection' }) : t({ ko: '모두 선택', en: 'Select all' })

  const sidebar = (
    <GroupExplorerSidebarPanel
      sourceKey={selectedSource.key}
      groups={allGroups}
      countMaps={groupCountMaps}
      selectedGroupId={selectedGroupId}
      isLoading={groupsQuery.isLoading}
      isError={groupsQuery.isError}
      errorMessage={groupsQuery.error instanceof Error ? groupsQuery.error.message : null}
      onSelectSource={handleSelectSource}
      onSelectGroup={handleOpenGroup}
      onCreateGroup={isCustomSource ? handleOpenCreateModal : undefined}
      onDropImages={isCustomSource && isWideLayout ? handleDropImages : undefined}
      getGroupMenu={isCustomSource ? getGroupMenu : undefined}
    />
  )

  const rootActions = (
    <>
      {isCustomSource ? (
        <>
          <IconButton
            label={autoCollectAllMutation.isPending ? t('groups.group.page.running.all.auto.collect.jobs') : t('groups.group.page.auto.collect.all')}
            variant="ghost"
            size="icon-sm"
            onClick={() => void handleRunAutoCollectAll()}
            disabled={autoCollectAllMutation.isPending}
          >
            <Play />
          </IconButton>
          <IconButton
            label={isManagingGroups ? t({ ko: '그룹 관리 끝내기', en: 'Done managing groups' }) : t({ ko: '그룹 관리 (여러 개 삭제·이동)', en: 'Manage groups (delete or move many)' })}
            variant="ghost"
            size="icon-sm"
            active={isManagingGroups}
            onClick={() => {
              setIsManagingGroups((current) => !current)
              setManagedGroupIds([])
            }}
          >
            <ListChecks />
          </IconButton>
          <IconButton label={t('groups.group.page.new.group')} variant="ghost" size="icon-sm" onClick={handleOpenCreateModal}>
            <Plus />
          </IconButton>
        </>
      ) : (
        <IconButton
          label={rebuildAutoFolderGroupsMutation.isPending ? t('groups.group.page.rebuilding.watched.folders') : t('groups.group.page.rebuild.watched.folders')}
          variant="ghost"
          size="icon-sm"
          onClick={() => void handleRebuildAutoFolderGroups()}
          disabled={rebuildAutoFolderGroupsMutation.isPending}
        >
          <RotateCcw />
        </IconButton>
      )}
    </>
  )

  const groupHeader = selectedGroupId && selectedGroupQuery.data ? (
    <GroupViewHeader
      name={selectedGroupQuery.data.name}
      color={selectedGroupHierarchy?.color ?? selectedGroupQuery.data.color}
      pathItems={groupPathItems}
      rootLabel={rootLabel}
      countState={headerCountState}
      isCustomSource={isCustomSource}
      canDelete={canDeleteImages}
      autoCollect={isCustomSource ? {
        enabled: Boolean(selectedGroupQuery.data.auto_collect_enabled),
        conditionCount: countAutoCollectConditions(selectedGroupQuery.data.auto_collect_conditions),
      } : undefined}
      compact={!isWideLayout}
      isAutoCollectPending={autoCollectMutation.isPending}
      isDownloadPending={downloadGroupArchiveMutation.isPending && downloadScope === 'group'}
      isDeletePending={deleteGroupsMutation.isPending}
      onOpenRoot={handleOpenRoot}
      onOpenGroup={handleOpenGroup}
      onRunAutoCollect={() => void handleRunAutoCollect()}
      onCreateSubgroup={handleOpenCreateModal}
      onEdit={handleOpenEditModal}
      onDownload={handleOpenGroupDownloadModal}
      onMove={() => openMoveGroups([selectedGroupId])}
      onDelete={() => openDeleteGroups([selectedGroupId])}
    />
  ) : selectedGroupId ? (
    <PageToolbar />
  ) : (
    <PageToolbar title={rootLabel} actions={rootActions} />
  )

  if (!canViewImages) return <ImagePermissionNotice />

  return (
    <PageWithSidebar
      storageKey="groups"
      sidebar={sidebar}
      sidebarLabel={t({ ko: '그룹', en: 'Groups' })}
      sidebarWidth={248}
      toolbar={groupHeader}
      // Leave room under the list for the fixed selection bar while it is up.
      contentClassName={cn((selectedGroupImageIds.length > 0 || (showManageView && managedGroupIds.length > 0)) && 'pb-24')}
    >
        <section className="min-w-0 space-y-5">
          {showManageView ? (
            <GroupManageView
              groups={allGroups}
              countMaps={groupCountMaps}
              selectedIds={managedGroupIds}
              onSelectedIdsChange={setManagedGroupIds}
              onOpenGroup={handleOpenGroup}
            />
          ) : null}

          {!selectedGroupId && !showManageView ? (
            <GroupRootOverview
              groups={rootGroups}
              countMaps={groupCountMaps}
              sourceKey={selectedSource.key}
              loadPreviewImages={selectedSource.getPreviewImages}
              onOpenGroup={handleOpenGroup}
              isLoading={groupsQuery.isLoading}
              error={groupsQuery.isError && allGroups.length === 0 ? groupsQuery.error : null}
              onRetry={() => void groupsQuery.refetch()}
            />
          ) : null}

          {selectedGroupId && selectedGroupQuery.isLoading ? <Skeleton className="h-20 w-full rounded-sm" /> : null}

          {selectedGroupId && selectedGroupQuery.isError ? (
            <ErrorState
              title={t('groups.group.page.failed.to.load.group.information')}
              error={selectedGroupQuery.error}
              onRetry={() => void selectedGroupQuery.refetch()}
              isRetrying={selectedGroupQuery.isFetching}
            />
          ) : null}

          {selectedGroupId && selectedGroupQuery.data ? (
            <>
              <GroupSubgroupStrip
                groups={childGroups}
                countMaps={groupCountMaps}
                sourceKey={selectedSource.key}
                loadPreviewImages={selectedSource.getPreviewImages}
                onOpenGroup={handleOpenGroup}
              />

              {isCustomSource && selectedGroupQuery.data.emoticon_enabled ? (
                <SegmentedControl
                  size="xs"
                  value={emoticonView}
                  onChange={(value) => setEmoticonView(value === 'images' ? 'images' : 'keywords')}
                  items={[
                    { value: 'keywords', label: t({ ko: '이모티콘 키워드', en: 'Emoticon keywords' }) },
                    { value: 'images', label: t({ ko: '이미지', en: 'Images' }) },
                  ]}
                  ariaLabel={t({ ko: '보기', en: 'View' })}
                />
              ) : null}

              {isCustomSource && selectedGroupId ? <GroupLinkedResources key={selectedGroupId} groupId={selectedGroupId} /> : null}
              {isCustomSource && selectedGroupQuery.data.emoticon_enabled && emoticonView === 'keywords' ? (
                <GroupEmoticonSection group={selectedGroupQuery.data} />
              ) : <GroupImageSection
                group={selectedGroupQuery.data}
                groupImages={groupImages}
                resetKey={groupImageListResetKey}
                isLoading={groupImagesQuery.isLoading}
                isError={groupImagesQuery.isError && groupImages.length === 0 && !groupImagesQuery.isFetchNextPageError}
                errorMessage={groupImagesQuery.error instanceof Error ? groupImagesQuery.error.message : null}
                onRetry={() => void groupImagesQuery.refetch()}
                isRetrying={groupImagesQuery.isRefetching}
                hasMore={Boolean(groupImagesQuery.hasNextPage)}
                isLoadingMore={groupImagesQuery.isFetchingNextPage}
                loadMoreError={groupImagesQuery.isFetchNextPageError ? groupImagesQuery.error : null}
                totalCount={selectedGroupImageTotalCount}
                onLoadMore={handleLoadMoreGroupImages}
                preferredColumnCount={groupColumnCount}
                defaultColumnCount={defaultGroupColumnCount}
                minColumnCount={minGroupColumnCount}
                maxColumnCount={maxGroupColumnCount}
                onColumnCountChange={setGroupColumnCount}
                onColumnCountReset={resetGroupColumnCount}
                toolbarActions={visibleGroupImageIds.length > 0 ? (
                  <IconButton
                    label={selectAllLabel}
                    variant="ghost"
                    size="icon-sm"
                    active={allVisibleSelected}
                    onClick={() => setSelectedGroupImageIds(allVisibleSelected ? [] : visibleGroupImageIds)}
                  >
                    <CheckCheck />
                  </IconButton>
                ) : undefined}
                selectable={true}
                selectedIds={selectedGroupImageIds}
                onSelectedIdsChange={setSelectedGroupImageIds}
                onVisibleItemIdsChange={setVisibleGroupImageIds}
                collectionFilter={isCustomSource ? groupImageCollectionFilter : undefined}
                onCollectionFilterChange={isCustomSource ? setGroupImageCollectionFilter : undefined}
                collectionFilterCounts={isCustomSource ? collectionFilterTotals : undefined}
                onItemDragStart={isCustomSource && isWideLayout ? handleImageDragStart : undefined}
              />}
            </>
          ) : null}
        </section>

      <ImageSelectionBar
        selectedCount={selectedGroupImageIds.length}
        downloadableCount={selectableDownloadCount}
        showDownloadAction={true}
        isDownloading={downloadGroupArchiveMutation.isPending && downloadScope === 'selection'}
        extraActions={
          <>
            <SelectionBarAction
              icon={FolderPlus}
              label={assignToGroupMutation.isPending ? t('groups.group.page.adding.to.group') : t('groups.group.page.add.to.custom.group')}
              onClick={handleOpenAssignModal}
              disabled={assignToGroupMutation.isPending || assignableCustomGroupsQuery.isPending}
            />
            {isCustomSource ? (
              <SelectionBarAction
                icon={FolderMinus}
                label={removeGroupImagesMutation.isPending ? t('groups.group.page.removing') : t('groups.group.page.remove.from.current.group')}
                onClick={() => void handleRemoveSelectedImages()}
                disabled={removeGroupImagesMutation.isPending}
              />
            ) : null}
            {canCreateImageCopies ? (
              <ImageBatchResizeAction
                compositeHashes={selectedGroupCompositeHashes}
                referenceSize={groupImages.find((image) => image.composite_hash === selectedGroupCompositeHashes[0]) ?? null}
              />
            ) : null}
          </>
        }
        trailingActions={canDeleteImages ? (
          <SelectionBarAction
            icon={Trash2}
            label={deleteSelectedImagesMutation.isPending ? t('groups.group.page.deleting') : t('groups.group.page.delete.selected')}
            variant="destructive"
            onClick={() => void handleDeleteSelectedImages()}
            disabled={deleteSelectedImagesMutation.isPending || selectedGroupCompositeHashes.length === 0}
          />
        ) : undefined}
        onDownload={handleOpenSelectionDownloadModal}
        onClear={() => setSelectedGroupImageIds([])}
        loadedCount={visibleGroupImageIds.length}
        onSelectAllLoaded={() => setSelectedGroupImageIds(visibleGroupImageIds)}
      />

      <GroupDownloadModal
        open={downloadScope !== null}
        description={downloadScope === 'selection'
          ? t({ ko: '선택한 {count}장', en: '{count} selected' }, { count: formatNumber(selectedGroupCompositeHashes.length) })
          : selectedGroupQuery.data?.name}
        counts={activeDownloadCounts}
        isLoading={downloadScope === 'group' ? groupFileCountsQuery.isLoading : false}
        isDownloading={downloadGroupArchiveMutation.isPending}
        onClose={() => setDownloadScope(null)}
        onDownload={(type) => void handleDownloadArchive(type, downloadScope)}
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
          onDelete={editorState?.mode === 'edit' && canDeleteImages ? () => openDeleteGroups([editorState.group.id]) : undefined}
        />
      ) : null}

      {showManageView ? (
        <SelectionActionBar
          selectedCount={managedGroupIds.length}
          summary={t({ ko: '그룹 {count}개 선택됨', en: '{count} groups selected' }, { count: formatNumber(managedGroupIds.length) })}
          onClear={() => setManagedGroupIds([])}
          responsiveActions
          actions={(
            <>
              <SelectionBarAction icon={FolderInput} label={t({ ko: '다른 위치로 옮기기', en: 'Move to…' })} onClick={() => openMoveGroups(managedGroupIds)} />
              {canDeleteImages ? (
                <SelectionBarAction icon={Trash2} label={t({ ko: '선택한 그룹 삭제', en: 'Delete selected groups' })} variant="destructive" onClick={() => openDeleteGroups(managedGroupIds)} />
              ) : null}
            </>
          )}
        />
      ) : null}

      {isCustomSource ? (
        <>
          <GroupDeleteDialog
            key={groupDialog?.kind === 'delete' ? `delete:${groupDialog.ids.join(',')}` : 'delete'}
            open={groupDialog?.kind === 'delete' && dialogGroups.length > 0}
            targets={dialogGroups}
            allGroups={allGroups}
            isDeleting={deleteGroupsMutation.isPending}
            onClose={closeGroupDialog}
            onConfirm={handleConfirmDeleteGroups}
          />
          <GroupMoveDialog
            key={groupDialog?.kind === 'move' ? `move:${groupDialog.ids.join(',')}` : 'move'}
            open={groupDialog?.kind === 'move' && dialogGroups.length > 0}
            targets={dialogGroups}
            allGroups={allGroups}
            countMaps={groupCountMaps}
            isMoving={moveGroupsMutation.isPending}
            onClose={closeGroupDialog}
            onConfirm={handleConfirmMoveGroups}
          />
        </>
      ) : null}
    </PageWithSidebar>
  )
}
