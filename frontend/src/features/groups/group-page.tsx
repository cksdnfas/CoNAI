import { FolderMinus, FolderPlus, FolderTree, Play, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Skeleton } from '@/components/ui/skeleton'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { PageHeader } from '@/components/common/page-header'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { GroupBreadcrumbs } from './components/group-breadcrumbs'
import { GroupExplorerSidebarPanel } from './components/group-explorer-sidebar-panel'
import { GroupNavigationGridSection } from './components/group-navigation-grid-section'
import { GroupRootGridSection } from './components/group-root-grid-section'
import { GroupEditorModal } from './components/group-editor-modal'
import { GroupAssignModal } from './components/group-assign-modal'
import { GroupImageSection } from './components/group-image-section'
import { GroupDownloadModal } from './components/group-download-modal'
import { GroupDetailHeaderCard } from './components/group-detail-header-card'
import { ImageSelectionBar } from '@/features/images/components/image-selection-bar'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import { buildGroupCountMaps, getGroupHierarchyCountLabel } from './group-count-utils'
import { buildGroupPathItems, formatGroupTimestamp, getGroupCardGridClassName, groupSources, normalizeGroupSourceKey, type GroupEditorState, type GroupSourceKey } from './group-page-shared'
import { useGroupPageQueries } from './use-group-page-queries'
import { useGroupPageActions } from './use-group-page-actions'
import { useI18n } from '@/i18n'

export function GroupPage() {
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber, formatDateTime } = useI18n()
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
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [downloadScope, setDownloadScope] = useState<'group' | 'selection' | null>(null)
  const [isExplorerOpen, setIsExplorerOpen] = useState(false)
  const [groupImageCollectionFilter, setGroupImageCollectionFilter] = useState<'all' | 'manual' | 'auto'>('all')
  const isWideLayout = useDesktopPageLayout()
  const selectedSourceKey = normalizeGroupSourceKey(searchParams.get('tab'))
  const selectedSource = groupSources[selectedSourceKey]
  const selectedGroupId = groupId ? Number(groupId) : undefined
  const isCustomSource = selectedSource.key === 'custom'
  const getSourceLabel = (source: typeof selectedSource, part: 'tab' | 'root' | 'rootSection') => {
    if (source.key === 'folders') {
      return part === 'tab'
        ? t({ ko: '감시폴더 그룹', en: 'Watched-folder groups' })
        : part === 'root'
          ? t({ ko: '감시폴더 그룹', en: 'Watched-folder groups' })
          : t({ ko: '감시폴더 루트', en: 'Watched-folder root' })
    }

    return part === 'tab'
      ? t({ ko: '커스텀 그룹', en: 'Custom groups' })
      : part === 'root'
        ? t({ ko: '사용자 커스텀 그룹', en: 'User custom groups' })
        : t({ ko: '루트 그룹', en: 'Root groups' })
  }

  const {
    groupsQuery,
    assignableCustomGroupsQuery,
    selectedGroupQuery,
    groupImagesQuery,
    groupFileCountsQuery,
    refreshCustomGroupQueries,
    refreshFolderGroupQueries,
    groupExplorerCardStyle,
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
    isWideLayout,
    groupImageCollectionFilter,
    selectedGroupImageIds,
    downloadScope,
  })

  const groupCountMaps = useMemo(() => buildGroupCountMaps(allGroups), [allGroups])
  const groupPathItems = useMemo(() => buildGroupPathItems(allGroups, selectedGroupId), [allGroups, selectedGroupId])
  const selectedGroupCountLabel = selectedGroupHierarchy ? getGroupHierarchyCountLabel(selectedGroupHierarchy, groupCountMaps, formatNumber) : formatNumber(selectedGroupQuery.data?.image_count ?? 0)
  const selectedGroupImageTotalCount = groupImagesQuery.data?.pages[0]?.pagination.total ?? selectedGroupQuery.data?.image_count ?? 0

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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isWideLayout ? 'Image' : undefined}
        title={t({ ko: '그룹', en: 'Groups' })}
        actions={!selectedGroupId && isCustomSource ? (
          <>
            <Button type="button" size="sm" variant="secondary" onClick={() => void handleRunAutoCollectAll()} disabled={autoCollectAllMutation.isPending}>
              <Play className="h-4 w-4" />
              {autoCollectAllMutation.isPending ? t('groups.group.page.running.all.auto.collect.jobs') : t('groups.group.page.auto.collect.all')}
            </Button>
            <Button type="button" size="sm" onClick={handleOpenCreateModal}>
              <FolderPlus className="h-4 w-4" />
              {t('groups.group.page.new.group')}
            </Button>
          </>
        ) : !selectedGroupId && !isCustomSource ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => void handleRebuildAutoFolderGroups()} disabled={rebuildAutoFolderGroupsMutation.isPending}>
            <RotateCcw className="h-4 w-4" />
            {rebuildAutoFolderGroupsMutation.isPending ? t('groups.group.page.rebuilding.watched.folders') : t('groups.group.page.rebuild.watched.folders')}
          </Button>
        ) : undefined}
      />

      <SegmentedTabBar
        value={selectedSource.key}
        items={Object.values(groupSources).map((source) => ({ value: source.key, label: getSourceLabel(source, 'tab') }))}
        onChange={(nextSourceKey) => handleSelectSource(nextSourceKey as GroupSourceKey)}
      />

      {!isWideLayout ? (
        <Button type="button" variant="outline" className="w-full justify-between" onClick={() => setIsExplorerOpen(true)}>
          <span className="inline-flex min-w-0 items-center gap-2">
            <FolderTree className="h-4 w-4 shrink-0" />
            <span className="truncate">{t({ ko: '폴더 탐색', en: 'Browse folders' })}</span>
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">{formatNumber(allGroups.length)}</span>
        </Button>
      ) : null}

      <div className={cn('grid gap-6', isWideLayout ? 'grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-1')}>
        {isWideLayout ? (
          <GroupExplorerSidebarPanel
            isWideLayout={isWideLayout}
            groups={allGroups}
            countMaps={groupCountMaps}
            selectedGroupId={selectedGroupId}
            isLoading={groupsQuery.isLoading}
            isError={groupsQuery.isError}
            errorMessage={groupsQuery.error instanceof Error ? groupsQuery.error.message : null}
            onSelectGroup={handleOpenGroup}
          />
        ) : null}

        <section className="space-y-6">
          {selectedGroupId ? (
            <GroupBreadcrumbs
              items={groupPathItems}
              selectedGroupId={selectedGroupId}
              rootLabel={getSourceLabel(selectedSource, 'root')}
              compact={!isWideLayout}
              onOpenGroup={handleOpenGroup}
              onOpenRoot={handleOpenRoot}
            />
          ) : null}

          {!selectedGroupId ? (
            <GroupRootGridSection
              title={getSourceLabel(selectedSource, 'rootSection')}
              groups={rootGroups}
              countMaps={groupCountMaps}
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
              <AlertTitle>{t('groups.group.page.failed.to.load.group.information')}</AlertTitle>
              <AlertDescription>
                {selectedGroupQuery.error instanceof Error ? selectedGroupQuery.error.message : t('groups.group.page.an.unknown.error.occurred')}
              </AlertDescription>
            </Alert>
          ) : null}

          {selectedGroupId && selectedGroupQuery.data ? (
            <div className="space-y-6">
              <GroupDetailHeaderCard
                  group={selectedGroupQuery.data}
                  selectedGroupHierarchy={selectedGroupHierarchy}
                  isCustomSource={isCustomSource}
                  isWideLayout={isWideLayout}
                  isGroupFileCountsLoading={groupFileCountsQuery.isLoading}
                  isDownloadingGroup={downloadGroupArchiveMutation.isPending && downloadScope === 'group'}
                  isAutoCollectPending={autoCollectMutation.isPending}
                  isDeletePending={deleteGroupMutation.isPending}
                  lastAutoCollectLabel={formatGroupTimestamp(selectedGroupQuery.data.auto_collect_last_run, { emptyLabel: t({ ko: '아직 없음', en: 'Not yet' }), formatDateTime })}
                  parentGroupLabel={selectedGroupHierarchy?.parent_id == null ? t('groups.group.page.root.group') : t('groups.group.page.linked.as.a.child.group')}
                  imageCountLabel={selectedGroupCountLabel}
                  onOpenDownload={handleOpenGroupDownloadModal}
                  onOpenCreateModal={handleOpenCreateModal}
                  onOpenEditModal={handleOpenEditModal}
                  onRunAutoCollect={() => void handleRunAutoCollect()}
                  onDeleteGroup={() => void handleDeleteSelectedGroup()}
              />

              {childGroups.length > 0 ? (
                <GroupNavigationGridSection
                  childGroups={childGroups}
                  countMaps={groupCountMaps}
                  cardStyle={groupExplorerCardStyle}
                  gridClassName={getGroupCardGridClassName(groupExplorerCardStyle)}
                  previewSourceKey={selectedSource.key}
                  loadPreviewImage={selectedSource.getPreviewImage}
                  onOpenGroup={handleOpenGroup}
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
                totalCount={selectedGroupImageTotalCount}
                onLoadMore={() => void groupImagesQuery.fetchNextPage()}
                preferredColumnCount={groupColumnCount}
                defaultColumnCount={defaultGroupColumnCount}
                minColumnCount={minGroupColumnCount}
                maxColumnCount={maxGroupColumnCount}
                onColumnCountChange={setGroupColumnCount}
                onColumnCountReset={resetGroupColumnCount}
                selectable={true}
                selectedIds={selectedGroupImageIds}
                onSelectedIdsChange={setSelectedGroupImageIds}
                collectionFilter={isCustomSource ? groupImageCollectionFilter : undefined}
                onCollectionFilterChange={isCustomSource ? setGroupImageCollectionFilter : undefined}
              />

            </div>
          ) : null}
        </section>
      </div>

      {!isWideLayout ? (
        <BottomDrawerSheet
          open={isExplorerOpen}
          title={t({ ko: '폴더 탐색', en: 'Folder explorer' })}
          subtitle={getSourceLabel(selectedSource, 'root')}
          ariaLabel={t({ ko: '그룹 폴더 탐색', en: 'Group folder explorer' })}
          closeLabel={t({ ko: '탐색기 닫기', en: 'Close explorer' })}
          headerActions={selectedGroupId ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => {
              setIsExplorerOpen(false)
              handleOpenRoot()
            }}>
              {t({ ko: '루트로 이동', en: 'Go to root' })}
            </Button>
          ) : undefined}
          onClose={() => setIsExplorerOpen(false)}
        >
          <GroupExplorerSidebarPanel
            embedded
            isWideLayout={false}
            groups={allGroups}
            countMaps={groupCountMaps}
            selectedGroupId={selectedGroupId}
            isLoading={groupsQuery.isLoading}
            isError={groupsQuery.isError}
            errorMessage={groupsQuery.error instanceof Error ? groupsQuery.error.message : null}
            onSelectGroup={(nextGroupId) => {
              setIsExplorerOpen(false)
              handleOpenGroup(nextGroupId)
            }}
          />
        </BottomDrawerSheet>
      ) : null}

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
              {assignToGroupMutation.isPending ? t('groups.group.page.adding.to.group') : t('groups.group.page.add.to.custom.group')}
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
                {removeGroupImagesMutation.isPending ? t('groups.group.page.removing') : t('groups.group.page.remove.from.current.group')}
              </Button>
            ) : null}
          </>
        }
        trailingActions={canDeleteImages ? (
          <Button
            size="icon-sm"
            variant="destructive"
            onClick={() => void handleDeleteSelectedImages()}
            disabled={deleteSelectedImagesMutation.isPending || selectedGroupCompositeHashes.length === 0}
            title={deleteSelectedImagesMutation.isPending ? t('groups.group.page.deleting') : t('groups.group.page.delete.selected')}
            aria-label={deleteSelectedImagesMutation.isPending ? t('groups.group.page.deleting') : t('groups.group.page.delete.selected')}
            data-no-select-drag="true"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : undefined}
        onDownload={handleOpenSelectionDownloadModal}
        onClear={() => setSelectedGroupImageIds([])}
      />

      <GroupDownloadModal
        open={downloadScope !== null}
        title={downloadScope === 'selection' ? t('groups.group.page.download.selected.images') : t('groups.group.page.download.current.group')}
        description={downloadScope === 'selection' ? t({ ko: '선택한 {count}개 기준으로 내려받을 파일 종류를 골라줘.', en: 'Selected {count} items. Choose which file type to download.' }, { count: formatNumber(selectedGroupCompositeHashes.length) }) : t('groups.group.page.choose.which.file.type.to.download.from')}
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
