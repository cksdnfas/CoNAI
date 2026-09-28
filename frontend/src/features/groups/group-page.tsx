import { CheckCheck, FolderMinus, FolderPlus, FolderTree, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ErrorState } from '@/components/ui/error-state'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Skeleton } from '@/components/ui/skeleton'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import type { CountState } from '@/lib/count-display'
import { GroupExplorerSidebarPanel } from './components/group-explorer-sidebar-panel'
import { GroupRootOverview } from './components/group-root-overview'
import { GroupSubgroupStrip } from './components/group-subgroup-strip'
import { GroupViewHeader } from './components/group-view-header'
import { GroupEditorModal } from './components/group-editor-modal'
import { GroupAssignModal } from './components/group-assign-modal'
import { GroupImageSection } from './components/group-image-section'
import { GroupDownloadModal } from './components/group-download-modal'
import { SelectionBarAction } from '@/components/common/selection-action-bar'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import { buildGroupCountMaps } from './group-count-utils'
import { writeGroupImageDrag } from './group-image-drag'
import { buildGroupPathItems, countAutoCollectConditions, groupSources, normalizeGroupSourceKey, type GroupEditorState } from './group-page-shared'
import { useGroupPageQueries, type GroupCollectionFilter } from './use-group-page-queries'
import { useGroupPageActions } from './use-group-page-actions'
import { useI18n } from '@/i18n'

export function GroupPage() {
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
  const [isExplorerOpen, setIsExplorerOpen] = useState(false)
  const [groupImageCollectionFilter, setGroupImageCollectionFilter] = useState<GroupCollectionFilter>('all')
  const isWideLayout = useDesktopPageLayout()
  const selectedSourceKey = normalizeGroupSourceKey(searchParams.get('tab'))
  const selectedSource = groupSources[selectedSourceKey]
  const selectedGroupId = groupId ? Number(groupId) : undefined
  const isCustomSource = selectedSource.key === 'custom'
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
    deleteGroupMutation,
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
    handleDeleteSelectedGroup,
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
    selectedGroupHierarchy,
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
    setIsAssignModalOpen,
    setDownloadScope,
    refreshCustomGroupQueries,
    refreshFolderGroupQueries,
  })

  useEffect(() => {
    setSelectedGroupImageIds([])
    setIsAssignModalOpen(false)
    setDownloadScope(null)
    setIsExplorerOpen(false)
    setGroupImageCollectionFilter('all')
  }, [selectedGroupId, selectedSource.key])

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

  const renderSidebar = (embedded: boolean) => (
    <GroupExplorerSidebarPanel
      embedded={embedded}
      isWideLayout={!embedded && isWideLayout}
      sourceKey={selectedSource.key}
      groups={allGroups}
      countMaps={groupCountMaps}
      selectedGroupId={selectedGroupId}
      isLoading={groupsQuery.isLoading}
      isError={groupsQuery.isError}
      errorMessage={groupsQuery.error instanceof Error ? groupsQuery.error.message : null}
      onSelectSource={(nextSourceKey) => {
        setIsExplorerOpen(false)
        handleSelectSource(nextSourceKey)
      }}
      onSelectGroup={(nextGroupId) => {
        setIsExplorerOpen(false)
        handleOpenGroup(nextGroupId)
      }}
      onCreateGroup={isCustomSource ? () => {
        setIsExplorerOpen(false)
        handleOpenCreateModal()
      } : undefined}
      onDropImages={isCustomSource && !embedded ? handleDropImages : undefined}
    />
  )

  const rootActions = (
    <>
      {!isWideLayout ? (
        <IconButton label={t({ ko: '그룹 트리', en: 'Group tree' })} variant="subtle" size="icon-sm" onClick={() => setIsExplorerOpen(true)}>
          <FolderTree />
        </IconButton>
      ) : null}
      {isCustomSource ? (
        <>
          <IconButton
            label={autoCollectAllMutation.isPending ? t('groups.group.page.running.all.auto.collect.jobs') : t('groups.group.page.auto.collect.all')}
            variant="subtle"
            size="icon-sm"
            onClick={() => void handleRunAutoCollectAll()}
            disabled={autoCollectAllMutation.isPending}
          >
            <Play />
          </IconButton>
          <Button type="button" size="sm" onClick={handleOpenCreateModal}>
            <Plus />
            {t('groups.group.page.new.group')}
          </Button>
        </>
      ) : (
        <IconButton
          label={rebuildAutoFolderGroupsMutation.isPending ? t('groups.group.page.rebuilding.watched.folders') : t('groups.group.page.rebuild.watched.folders')}
          variant="subtle"
          size="icon-sm"
          onClick={() => void handleRebuildAutoFolderGroups()}
          disabled={rebuildAutoFolderGroupsMutation.isPending}
        >
          <RotateCcw />
        </IconButton>
      )}
    </>
  )

  return (
    // Leave room under the list for the fixed selection bar while it is up.
    <div className={cn(selectedGroupImageIds.length > 0 && 'pb-24')}>
      <div className={cn('grid gap-6', isWideLayout ? 'grid-cols-[264px_minmax(0,1fr)]' : 'grid-cols-1')}>
        {isWideLayout ? renderSidebar(false) : null}

        <section className="min-w-0 space-y-5">
          {!selectedGroupId ? (
            <GroupRootOverview
              title={rootLabel}
              groups={rootGroups}
              countMaps={groupCountMaps}
              sourceKey={selectedSource.key}
              loadPreviewImages={selectedSource.getPreviewImages}
              actions={rootActions}
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
              <GroupViewHeader
                name={selectedGroupQuery.data.name}
                color={selectedGroupHierarchy?.color ?? selectedGroupQuery.data.color}
                pathItems={groupPathItems}
                rootLabel={rootLabel}
                countState={headerCountState}
                isCustomSource={isCustomSource}
                autoCollect={isCustomSource ? {
                  enabled: Boolean(selectedGroupQuery.data.auto_collect_enabled),
                  conditionCount: countAutoCollectConditions(selectedGroupQuery.data.auto_collect_conditions),
                } : undefined}
                compact={!isWideLayout}
                isAutoCollectPending={autoCollectMutation.isPending}
                isDownloadPending={downloadGroupArchiveMutation.isPending && downloadScope === 'group'}
                isDeletePending={deleteGroupMutation.isPending}
                onOpenRoot={handleOpenRoot}
                onOpenGroup={handleOpenGroup}
                onOpenTree={!isWideLayout ? () => setIsExplorerOpen(true) : undefined}
                onRunAutoCollect={() => void handleRunAutoCollect()}
                onCreateSubgroup={handleOpenCreateModal}
                onEdit={handleOpenEditModal}
                onDownload={handleOpenGroupDownloadModal}
                onDelete={() => void handleDeleteSelectedGroup()}
              />

              <GroupSubgroupStrip
                groups={childGroups}
                countMaps={groupCountMaps}
                sourceKey={selectedSource.key}
                loadPreviewImages={selectedSource.getPreviewImages}
                onOpenGroup={handleOpenGroup}
              />

              <GroupImageSection
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
              />
            </>
          ) : null}
        </section>
      </div>

      {!isWideLayout ? (
        <BottomDrawerSheet
          open={isExplorerOpen}
          title={t({ ko: '그룹', en: 'Groups' })}
          ariaLabel={t({ ko: '그룹 트리', en: 'Group tree' })}
          closeLabel={t({ ko: '닫기', en: 'Close' })}
          onClose={() => setIsExplorerOpen(false)}
        >
          {renderSidebar(true)}
        </BottomDrawerSheet>
      ) : null}

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
        title={downloadScope === 'selection' ? t('groups.group.page.download.selected.images') : t('groups.group.page.download.current.group')}
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
        />
      ) : null}
    </div>
  )
}
