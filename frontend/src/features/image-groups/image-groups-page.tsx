import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderTree, Loader2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BreadcrumbItem, GroupWithHierarchy, GroupWithStats } from '@conai/shared'
import type { ImageRecord, PageSize } from '@/types/image'
import { groupApi } from '@/services/group-api'
import GroupCreateEditModal from '@/features/image-groups/components/group-create-edit-modal'
import { GroupBreadcrumb } from '@/features/image-groups/components/group-breadcrumb'
import { GroupExplorerLayout } from '@/features/image-groups/components/group-explorer-layout'
import { GroupExplorerImageBrowser } from '@/features/image-groups/components/group-explorer-image-browser'
import { GroupExplorerImagePanel } from '@/features/image-groups/components/group-explorer-image-panel'
import AutoFolderGroupsContent from '@/features/image-groups/components/auto-folder-groups-content'
import { GroupCard } from '@/features/image-groups/components/group-card'
import { ImageViewCard } from '@/features/image-groups/components/image-view-card'
import GroupImageGridModal from '@/features/image-groups/components/group-image-grid-modal'
import { useRootGroups, useChildGroups } from '@/hooks/use-groups'
import { useImageListSettings } from '@/hooks/use-image-list-settings'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning'
type GroupTabValue = 'custom' | 'auto-folder'
type NavigableGroup = GroupWithHierarchy

export function ImageGroupsPage() {
  const { t } = useTranslation(['imageGroups', 'common'])
  const { settings: groupModalSettings } = useImageListSettings('group_modal')

  const [tabValue, setTabValue] = useState<GroupTabValue>('custom')
  const [selectedGroup, setSelectedGroup] = useState<GroupWithHierarchy | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [snackbar, setSnackbar] = useState<{
    open: boolean
    message: string
    severity: SnackbarSeverity
  }>({
    open: false,
    message: '',
    severity: 'success',
  })

  const [isGroupListView, setIsGroupListView] = useState(true)
  const [currentParentId, setCurrentParentId] = useState<number | null>(null)
  const [currentGroupInfo, setCurrentGroupInfo] = useState<GroupWithStats | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([])

  const { data: rootGroupsData, isLoading: rootGroupsLoading } = useRootGroups(currentParentId)
  const { data: childGroupsData, isLoading: childGroupsLoading } = useChildGroups(currentParentId)
  const groups = useMemo(
    () => ((currentParentId === null ? rootGroupsData : childGroupsData) || []) as NavigableGroup[],
    [childGroupsData, currentParentId, rootGroupsData],
  )
  const loading = currentParentId === null ? rootGroupsLoading : childGroupsLoading

  const [mobileImageSheetOpen, setMobileImageSheetOpen] = useState(false)
  const [selectedGroupForImages, setSelectedGroupForImages] = useState<GroupWithStats | null>(null)
  const [groupImages, setGroupImages] = useState<ImageRecord[]>([])
  const [groupImagesLoading, setGroupImagesLoading] = useState(false)
  const [groupImagesPage, setGroupImagesPage] = useState(1)
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1)
  const [groupImagesTotal, setGroupImagesTotal] = useState(0)
  const [groupImagesPageSize, setGroupImagesPageSize] = useState<PageSize>((groupModalSettings.pageSize as PageSize) || 25)

  useEffect(() => {
    if (groupModalSettings.pageSize && groupModalSettings.pageSize !== groupImagesPageSize) {
      setGroupImagesPageSize(groupModalSettings.pageSize as PageSize)
    }
  }, [groupImagesPageSize, groupModalSettings.pageSize])

  const loadBreadcrumb = async (groupId: number) => {
    try {
      const response = await groupApi.getBreadcrumbPath(groupId)
      if (response.success && response.data) {
        setBreadcrumb(response.data)
      }
    } catch (error) {
      console.error('Error loading breadcrumb:', error)
    }
  }

  const navigateToGroup = useCallback(async (groupId: number | null) => {
    setCurrentParentId(groupId)
    if (groupId === null) {
      setBreadcrumb([])
      setCurrentGroupInfo(null)
      return
    }

    await loadBreadcrumb(groupId)

    try {
      const groupResponse = await groupApi.getGroup(groupId)
      if (groupResponse.success && groupResponse.data) {
        setCurrentGroupInfo(groupResponse.data as GroupWithStats)
      }
    } catch (error) {
      console.error('Error loading current group info:', error)
    }
  }, [setCurrentParentId])

  const handleBreadcrumbNavigate = (groupId: number | null) => {
    if (groupId === null) {
      setIsGroupListView(true)
      setCurrentParentId(null)
      setCurrentGroupInfo(null)
      setBreadcrumb([])
      return
    }

    void navigateToGroup(groupId)
  }

  const showSnackbar = (message: string, severity: SnackbarSeverity) => {
    setSnackbar({ open: true, message, severity })
  }

  useEffect(() => {
    if (!snackbar.open) return

    const timeoutId = window.setTimeout(() => {
      setSnackbar((previous) => ({ ...previous, open: false }))
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [snackbar.open])

  const fetchGroupImages = useCallback(async (groupId: number, page = 1, pageSize?: PageSize, append = false) => {
    try {
      setGroupImagesLoading(true)
      const actualPageSize = pageSize || groupImagesPageSize
      const response = await groupApi.getGroupImages(groupId, page, actualPageSize)

      if (response.success && response.data) {
        if (append) {
          setGroupImages((prev) => [...prev, ...response.data.images])
        } else {
          setGroupImages(response.data.images || [])
        }
        setGroupImagesPage(response.data.pagination?.page || 1)
        setGroupImagesTotalPages(response.data.pagination?.totalPages || 1)
        setGroupImagesTotal(response.data.pagination?.total || 0)
      } else {
        showSnackbar(t('imageGroups:messages.imageLoadFailed'), 'error')
        if (!append) setGroupImages([])
      }
    } catch (error) {
      console.error('Error fetching group images:', error)
      showSnackbar(t('imageGroups:messages.imageLoadFailed'), 'error')
      if (!append) setGroupImages([])
    } finally {
      setGroupImagesLoading(false)
    }
  }, [groupImagesPageSize, t])

  useEffect(() => {
    if (groupModalSettings.activeScrollMode === 'pagination' && selectedGroupForImages) {
      void fetchGroupImages(selectedGroupForImages.id, groupImagesPage, groupImagesPageSize, false)
    }
  }, [fetchGroupImages, groupImagesPage, groupImagesPageSize, groupModalSettings.activeScrollMode, selectedGroupForImages])

  useEffect(() => {
    if (groups.length === 1 && currentParentId !== null) {
      const singleGroup = groups[0]
      if (singleGroup.image_count === 0 && singleGroup.child_count === 1) {
        const currentGroupName = currentGroupInfo?.name || t('imageGroups:defaultGroupName')
        showSnackbar(t('imageGroups:autoNavigate', { from: currentGroupName, to: singleGroup.name }), 'info')
        void navigateToGroup(singleGroup.id)
      }
    }
  }, [currentGroupInfo?.name, currentParentId, groups, navigateToGroup, t])

  const handleGroupCreated = () => {
    setIsCreateModalOpen(false)
    showSnackbar(t('imageGroups:created'), 'info')
  }

  const handleGroupUpdated = () => {
    setIsEditModalOpen(false)
    setSelectedGroup(null)
    showSnackbar(t('imageGroups:updated'), 'info')
  }

  const handleGroupClick = (group: NavigableGroup) => {
    if (isGroupListView) {
      setIsGroupListView(false)
      setCurrentParentId(group.id)
      void navigateToGroup(group.id)
      return
    }

    if ((group.child_count ?? 0) > 0) {
      void navigateToGroup(group.id)
      return
    }

    if (group.image_count > 0) {
      openGroupImagePanel(group)
      return
    }

    showSnackbar(t('imageGroups:messages.emptyGroup'), 'info')
  }

  const handleGroupSettings = (groupId: number) => {
    const group = groups.find((entry) => entry.id === groupId)
    if (group) {
      setSelectedGroup(group)
      setIsEditModalOpen(true)
    }
  }

  const handleGroupImagesModalClose = () => {
    setMobileImageSheetOpen(false)
    setSelectedGroupForImages(null)
    setGroupImages([])
    setGroupImagesPage(1)
  }

  const openGroupImagePanel = (group: GroupWithStats) => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
    setSelectedGroupForImages(group)
    setMobileImageSheetOpen(isMobile)
    setGroupImagesPage(1)
    void fetchGroupImages(group.id, 1, groupImagesPageSize, false)
  }

  const handleGroupImagesPageChange = (page: number) => {
    if (!selectedGroupForImages) return

    setGroupImagesPage(page)
    void fetchGroupImages(selectedGroupForImages.id, page, groupImagesPageSize, false)
  }

  const handleGroupImagesLoadMore = () => {
    if (!selectedGroupForImages || groupImagesPage >= groupImagesTotalPages) return

    const nextPage = groupImagesPage + 1
    void fetchGroupImages(selectedGroupForImages.id, nextPage, groupImagesPageSize, true)
  }

  const handleGroupImagesPageSizeChange = (size: PageSize) => {
    setGroupImagesPageSize(size)
    if (!selectedGroupForImages) return

    setGroupImagesPage(1)
    void fetchGroupImages(selectedGroupForImages.id, 1, size, false)
  }

  const handleImagesRemoved = async (manualImageIds: string[]) => {
    if (!selectedGroupForImages) return

    try {
      if (manualImageIds.length === 0) {
        showSnackbar(t('imageGroups:messages.removeWarning'), 'warning')
        return
      }

      const result = await groupApi.removeImagesFromGroup(selectedGroupForImages.id, manualImageIds)

      if (result.success) {
        showSnackbar(t('imageGroups:messages.removeSuccess', { count: result.removed }), 'success')
      } else {
        showSnackbar(
          t('imageGroups:messages.removePartialSuccess', {
            removed: result.removed,
            failed: result.errors.length,
          }),
          'warning',
        )
      }

      const isInfinite = groupModalSettings.activeScrollMode === 'infinite'
      if (isInfinite) {
        setGroupImagesPage(1)
        await fetchGroupImages(selectedGroupForImages.id, 1, groupImagesPageSize, false)
        return
      }

      const updatedResult = await groupApi.getGroupImages(selectedGroupForImages.id, groupImagesPage, groupImagesPageSize)
      if (updatedResult.success && updatedResult.data) {
        const hasImages = Boolean(updatedResult.data.images && updatedResult.data.images.length > 0)
        const hasPreviousPage = groupImagesPage > 1

        if (!hasImages && hasPreviousPage) {
          setGroupImagesPage(groupImagesPage - 1)
          await fetchGroupImages(selectedGroupForImages.id, groupImagesPage - 1, groupImagesPageSize, false)
        } else {
          setGroupImages(updatedResult.data.images || [])
        }
      } else {
        await fetchGroupImages(selectedGroupForImages.id, groupImagesPage, groupImagesPageSize, false)
      }
    } catch (error) {
      console.error('Error removing images:', error)
      showSnackbar(t('imageGroups:messages.removeError'), 'error')
    }
  }

  const handleImagesAssigned = async (targetGroupId: number, selectedImageIds: string[]) => {
    try {
      const response = await groupApi.addImagesToGroup(targetGroupId, selectedImageIds)

      if (response.success && response.data) {
        const { added_count, converted_count, skipped_count } = response.data
        showSnackbar(
          t('imageGroups:messages.assignSuccess', {
            added: added_count,
            converted: converted_count,
            skipped: skipped_count,
          }),
          'success',
        )
      } else {
        showSnackbar(response.error || t('imageGroups:messages.assignFailed'), 'error')
      }
    } catch (error) {
      console.error('Error assigning images:', error)
      showSnackbar(t('imageGroups:messages.assignError'), 'error')
    }
  }

  const hasVisibleCards =
    (!isGroupListView && currentParentId !== null && currentGroupInfo && currentGroupInfo.image_count > 0) || groups.length > 0

  return (
    <div className="w-full space-y-4">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('imageGroups:page.title')}</h1>

        <Tabs value={tabValue} onValueChange={(value) => setTabValue(value as GroupTabValue)}>
          <TabsList>
            <TabsTrigger value="custom">{t('imageGroups:page.customGroupsTab')}</TabsTrigger>
            <TabsTrigger value="auto-folder">{t('imageGroups:page.autoFolderGroupsTab')}</TabsTrigger>
          </TabsList>

          <TabsContent value="custom" className="space-y-4 pt-2">
            <GroupExplorerLayout
              breadcrumb={!isGroupListView ? (
                <GroupBreadcrumb breadcrumb={breadcrumb} onNavigate={handleBreadcrumbNavigate} showGroupListRoot={true} />
              ) : undefined}
              loading={loading}
              explorerTitle="그룹 탐색"
              explorerDescription="폴더처럼 그룹을 따라 내려가며 이미지를 여나이다."
              emptyTitle={isGroupListView ? t('imageGroups:emptyState.noGroups') : t('imageGroups:emptyState.noSubgroups')}
              emptyDescription={isGroupListView ? t('imageGroups:emptyState.createPrompt') : t('imageGroups:emptyState.noSubgroupsHelp')}
              hasVisibleCards={hasVisibleCards}
              cards={
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {!isGroupListView && currentParentId !== null && currentGroupInfo && currentGroupInfo.image_count > 0 ? (
                    <ImageViewCard
                      key={`image-view-${currentParentId}`}
                      group={currentGroupInfo}
                      onClick={() => openGroupImagePanel(currentGroupInfo)}
                    />
                  ) : null}

                  {groups.map((group) => (
                    <GroupCard key={group.id} group={group} onClick={() => handleGroupClick(group)} onSettingsClick={handleGroupSettings} />
                  ))}
                </div>
              }
              desktopPanel={
                <GroupExplorerImagePanel
                  title="이미지 탐색 패널"
                  description="좌측에서 그룹을 고르면 이곳에 기존 이미지 목록이 펼쳐지나이다."
                  content={selectedGroupForImages ? (
                    <GroupImageGridModal
                      key={`group-panel-${selectedGroupForImages.id}-${groupImagesPage}`}
                      open={true}
                      embedded={true}
                      onClose={handleGroupImagesModalClose}
                      images={groupImages}
                      loading={groupImagesLoading}
                      currentGroup={selectedGroupForImages}
                      allGroups={groups}
                      pageSize={groupImagesPageSize}
                      onPageSizeChange={handleGroupImagesPageSizeChange}
                      currentPage={groupImagesPage}
                      totalPages={groupImagesTotalPages}
                      total={groupImagesTotal}
                      onPageChange={handleGroupImagesPageChange}
                      infiniteScroll={{
                        hasMore: groupImagesPage < groupImagesTotalPages,
                        loadMore: handleGroupImagesLoadMore,
                      }}
                      onImagesRemoved={handleImagesRemoved}
                      onImagesAssigned={handleImagesAssigned}
                      groupType="custom"
                      onShowSnackbar={showSnackbar}
                    />
                  ) : null}
                />
              }
              mobileSheetOpen={mobileImageSheetOpen}
              onMobileSheetOpenChange={(open) => {
                if (!open) {
                  handleGroupImagesModalClose()
                } else {
                  setMobileImageSheetOpen(true)
                }
              }}
              mobileSheetContent={
                <GroupExplorerImageBrowser
                  panelKey={`group-mobile-panel-${selectedGroupForImages?.id ?? 'none'}-${groupImagesPage}`}
                  currentGroup={selectedGroupForImages}
                  allGroups={groups}
                  images={groupImages}
                  loading={groupImagesLoading}
                  pageSize={groupImagesPageSize}
                  currentPage={groupImagesPage}
                  totalPages={groupImagesTotalPages}
                  total={groupImagesTotal}
                  onClose={handleGroupImagesModalClose}
                  onPageSizeChange={handleGroupImagesPageSizeChange}
                  onPageChange={handleGroupImagesPageChange}
                  hasMore={groupImagesPage < groupImagesTotalPages}
                  onLoadMore={handleGroupImagesLoadMore}
                  onImagesRemoved={handleImagesRemoved}
                  onImagesAssigned={handleImagesAssigned}
                  groupType="custom"
                  onShowSnackbar={showSnackbar}
                />
              }
            />

            <Button
              className="fixed right-6 bottom-6 z-40 h-12 w-12 rounded-full p-0 shadow-lg"
              onClick={() => setIsCreateModalOpen(true)}
              aria-label="add group"
            >
              <Plus className="h-5 w-5" />
            </Button>

            <GroupCreateEditModal
              key={`create-${isCreateModalOpen ? 'open' : 'closed'}`}
              open={isCreateModalOpen}
              onClose={() => setIsCreateModalOpen(false)}
              onSuccess={handleGroupCreated}
            />

            {selectedGroup ? (
              <GroupCreateEditModal
                key={`edit-${selectedGroup.id}-${isEditModalOpen ? 'open' : 'closed'}`}
                open={isEditModalOpen}
                onClose={() => {
                  setIsEditModalOpen(false)
                  setSelectedGroup(null)
                }}
                onSuccess={handleGroupUpdated}
                group={selectedGroup}
              />
            ) : null}
          </TabsContent>

          <TabsContent value="auto-folder" className="pt-2">
            <AutoFolderGroupsContent onShowSnackbar={showSnackbar} />
          </TabsContent>
        </Tabs>
      </div>

      {snackbar.open ? (
        <div className="fixed right-4 bottom-4 z-50 w-[min(420px,calc(100%-2rem))]">
          <Alert variant={snackbar.severity === 'error' ? 'destructive' : 'default'}>
            <AlertTitle>
              {snackbar.severity === 'success'
                ? t('common:messages.success')
                : snackbar.severity === 'error'
                  ? t('common:messages.error')
                  : snackbar.severity === 'warning'
                    ? t('common:warning')
                    : t('common:info')}
            </AlertTitle>
            <AlertDescription>{snackbar.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}
    </div>
  )
}
