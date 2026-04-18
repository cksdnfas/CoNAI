import { Download, FolderMinus, FolderPlus, Pencil, Play, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/common/page-header'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
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
import { ImageListColumnFloatingControl } from '@/features/images/components/image-list/image-list-column-floating-control'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import { formatGroupTimestamp, getGroupCardGridClassName, groupSources, normalizeGroupSourceKey, type GroupEditorState, type GroupSourceKey } from './group-page-shared'
import { useGroupPageQueries } from './use-group-page-queries'
import { useGroupPageActions } from './use-group-page-actions'

export function GroupPage() {
  const navigate = useNavigate()
  const { showSnackbar } = useSnackbar()
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
  const [groupImageCollectionFilter, setGroupImageCollectionFilter] = useState<'all' | 'manual' | 'auto'>('all')
  const isWideLayout = useDesktopPageLayout()
  const selectedSourceKey = normalizeGroupSourceKey(searchParams.get('tab'))
  const selectedSource = groupSources[selectedSourceKey]
  const selectedGroupId = groupId ? Number(groupId) : undefined
  const isCustomSource = selectedSource.key === 'custom'

  const {
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
    setGroupImageCollectionFilter('all')
  }, [selectedGroupId, selectedSource.key])

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={isWideLayout ? 'Image' : undefined}
        title="Groups"
        actions={!selectedGroupId && !isCustomSource ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => void handleRebuildAutoFolderGroups()} disabled={rebuildAutoFolderGroupsMutation.isPending}>
            <RotateCcw className="h-4 w-4" />
            {rebuildAutoFolderGroupsMutation.isPending ? '감시폴더 재구축 중…' : '감시폴더 재구축'}
          </Button>
        ) : undefined}
      />

      <SegmentedTabBar
        value={selectedSource.key}
        items={Object.values(groupSources).map((source) => ({ value: source.key, label: source.tabLabel }))}
        onChange={(nextSourceKey) => handleSelectSource(nextSourceKey as GroupSourceKey)}
      />

      <div className={cn('grid gap-6', isWideLayout ? 'grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-1')}>
        <GroupExplorerSidebarPanel
          isWideLayout={isWideLayout}
          groups={allGroups}
          selectedGroupId={selectedGroupId}
          isLoading={groupsQuery.isLoading}
          isError={groupsQuery.isError}
          errorMessage={groupsQuery.error instanceof Error ? groupsQuery.error.message : null}
          headerExtra={isCustomSource ? (
            <div className="flex flex-wrap justify-end gap-2 border-b border-white/5 pb-3">
              {selectedGroupId ? (
                <>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="bg-surface-low"
                    onClick={handleOpenGroupDownloadModal}
                    disabled={groupFileCountsQuery.isLoading || (downloadGroupArchiveMutation.isPending && downloadScope === 'group')}
                    aria-label="현재 그룹 다운로드"
                    title={downloadGroupArchiveMutation.isPending && downloadScope === 'group' ? '다운로드 준비 중…' : '현재 그룹 다운로드'}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="bg-surface-low"
                    onClick={handleOpenEditModal}
                    aria-label="현재 그룹 편집"
                    title="현재 그룹 편집"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                className="bg-surface-low"
                onClick={() => void handleRunAutoCollectAll()}
                disabled={autoCollectAllMutation.isPending}
                aria-label="전체 자동수집"
                title={autoCollectAllMutation.isPending ? '전체 자동수집 실행 중…' : '전체 자동수집'}
              >
                <Play className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                className="bg-surface-low"
                onClick={handleOpenCreateModal}
                aria-label="새 그룹"
                title="새 그룹"
              >
                <FolderPlus className="h-4 w-4" />
              </Button>
            </div>
          ) : undefined}
          onSelectGroup={handleOpenGroup}
        />

        <section className="space-y-6">
          {isWideLayout && selectedGroupId && !isCustomSource ? (
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
            <div className="space-y-6">
              {isCustomSource ? null : (
                <GroupDetailHeaderCard
                  group={selectedGroupQuery.data}
                  selectedGroupHierarchy={selectedGroupHierarchy}
                  isCustomSource={isCustomSource}
                  isWideLayout={isWideLayout}
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
                />
              )}

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
                  isWideLayout={isWideLayout}
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
                preferredColumnCount={groupColumnCount}
                selectable={true}
                selectedIds={selectedGroupImageIds}
                onSelectedIdsChange={setSelectedGroupImageIds}
                collectionFilter={isCustomSource ? groupImageCollectionFilter : undefined}
                onCollectionFilterChange={isCustomSource ? setGroupImageCollectionFilter : undefined}
              />

              {groupImages.length > 0 ? (
                <ImageListColumnFloatingControl
                  value={groupColumnCount}
                  defaultValue={defaultGroupColumnCount}
                  min={minGroupColumnCount}
                  max={maxGroupColumnCount}
                  title="그룹 한 줄 카드 수"
                  onChange={setGroupColumnCount}
                  onReset={resetGroupColumnCount}
                />
              ) : null}
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
