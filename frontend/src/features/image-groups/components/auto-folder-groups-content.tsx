import { useCallback, useEffect, useMemo, useState } from 'react'
import { FolderTree, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AutoFolderGroupWithStats, GroupWithStats } from '@conai/shared'
import type { ImageRecord, PageSize } from '@/types/image'
import { autoFolderGroupsApi } from '@/services/auto-folder-groups-api'
import { useAutoFolderChildGroups, useAutoFolderRootGroups, useRebuildAutoFolderGroups } from '@/hooks/use-auto-folder-groups'
import { useImageListSettings } from '@/hooks/use-image-list-settings'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { GroupBreadcrumb } from './group-breadcrumb'
import { AutoFolderGroupCard } from './auto-folder-group-card'
import { AutoFolderImageViewCard } from './auto-folder-image-view-card'
import GroupImageGridModal from './group-image-grid-modal'

interface AutoFolderGroupsContentProps {
  onShowSnackbar: (message: string, severity: 'success' | 'error' | 'info' | 'warning') => void
}

function normalizePageSize(value: number | undefined): PageSize {
  if (value === 25 || value === 50 || value === 100) {
    return value
  }
  return 25
}

function toModalGroup(group: AutoFolderGroupWithStats): GroupWithStats {
  return {
    id: group.id,
    name: group.display_name,
    description: group.folder_path,
    color: group.color,
    parent_id: group.parent_id ?? undefined,
    created_date: group.created_date,
    updated_date: group.last_updated,
    auto_collect_enabled: false,
    auto_collect_conditions: undefined,
    auto_collect_last_run: undefined,
    image_count: group.image_count,
    auto_collected_count: group.image_count,
    manual_added_count: 0,
  }
}

export default function AutoFolderGroupsContent({ onShowSnackbar }: AutoFolderGroupsContentProps) {
  const { t } = useTranslation(['imageGroups', 'common'])
  const { settings: groupModalSettings } = useImageListSettings('group_modal')

  const [isGroupListView, setIsGroupListView] = useState(true)
  const [currentParentId, setCurrentParentId] = useState<number | null>(null)
  const [currentGroupInfo, setCurrentGroupInfo] = useState<AutoFolderGroupWithStats | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<Array<{ id: number; name: string }>>([])

  const { data: rootGroupsData, isLoading: rootGroupsLoading } = useAutoFolderRootGroups()
  const { data: childGroupsData, isLoading: childGroupsLoading } = useAutoFolderChildGroups(currentParentId)
  const rebuildMutation = useRebuildAutoFolderGroups()

  const groups = useMemo(
    () => (currentParentId === null ? rootGroupsData : childGroupsData) || [],
    [childGroupsData, currentParentId, rootGroupsData],
  )
  const loading = currentParentId === null ? rootGroupsLoading : childGroupsLoading

  const [mobileImageSheetOpen, setMobileImageSheetOpen] = useState(false)
  const [selectedGroupForImages, setSelectedGroupForImages] = useState<AutoFolderGroupWithStats | null>(null)
  const [groupImages, setGroupImages] = useState<ImageRecord[]>([])
  const [groupImagesLoading, setGroupImagesLoading] = useState(false)
  const [groupImagesPage, setGroupImagesPage] = useState(1)
  const [groupImagesTotalPages, setGroupImagesTotalPages] = useState(1)
  const [groupImagesTotal, setGroupImagesTotal] = useState(0)
  const [groupImagesPageSize, setGroupImagesPageSize] = useState<PageSize>(normalizePageSize(groupModalSettings.pageSize))

  useEffect(() => {
    const next = normalizePageSize(groupModalSettings.pageSize)
    if (next !== groupImagesPageSize) {
      setGroupImagesPageSize(next)
    }
  }, [groupImagesPageSize, groupModalSettings.pageSize])

  const loadBreadcrumb = useCallback(async (groupId: number) => {
    try {
      const response = await autoFolderGroupsApi.getBreadcrumbPath(groupId)
      if (response.success && response.data) {
        setBreadcrumb(response.data.map((item) => ({ id: item.id, name: item.name })))
      }
    } catch (error) {
      console.error('Error loading auto-folder breadcrumb:', error)
    }
  }, [])

  const fetchGroupImages = useCallback(
    async (groupId: number, page = 1, pageSize?: PageSize, append = false) => {
      try {
        setGroupImagesLoading(true)
        const actualPageSize = pageSize || groupImagesPageSize
        const response = await autoFolderGroupsApi.getGroupImages(groupId, page, actualPageSize)

        if (response.success && response.data) {
          if (append) {
            setGroupImages((prev) => [...prev, ...(response.data?.items || [])])
          } else {
            setGroupImages(response.data.items || [])
          }
          setGroupImagesPage(response.data.pagination.page || 1)
          setGroupImagesTotalPages(response.data.pagination.totalPages || 1)
          setGroupImagesTotal(response.data.pagination.total || 0)
        } else {
          onShowSnackbar(t('imageGroups:messages.imageLoadFailed'), 'error')
          if (!append) setGroupImages([])
        }
      } catch (error) {
        console.error('Error loading auto-folder group images:', error)
        onShowSnackbar(t('imageGroups:messages.imageLoadFailed'), 'error')
        if (!append) setGroupImages([])
      } finally {
        setGroupImagesLoading(false)
      }
    },
    [groupImagesPageSize, onShowSnackbar, t],
  )

  const navigateToGroup = useCallback(
    async (group: AutoFolderGroupWithStats) => {
      setIsGroupListView(false)
      setCurrentParentId(group.id)
      setCurrentGroupInfo(group)
      await loadBreadcrumb(group.id)
    },
    [loadBreadcrumb],
  )

  const handleBreadcrumbNavigate = useCallback(
    async (groupId: number | null) => {
      if (groupId === null) {
        setIsGroupListView(true)
        setCurrentParentId(null)
        setCurrentGroupInfo(null)
        setBreadcrumb([])
        return
      }

      setIsGroupListView(false)
      setCurrentParentId(groupId)
      await loadBreadcrumb(groupId)

      try {
        const response = await autoFolderGroupsApi.getGroup(groupId)
        if (response.success && response.data) {
          setCurrentGroupInfo(response.data)
        }
      } catch (error) {
        console.error('Error loading auto-folder group details:', error)
      }
    },
    [loadBreadcrumb],
  )

  useEffect(() => {
    if (groups.length === 1 && currentParentId !== null) {
      const singleGroup = groups[0]
      if (singleGroup.image_count === 0 && (singleGroup.child_count || 0) === 1) {
        onShowSnackbar(
          t('imageGroups:autoNavigate', {
            from: currentGroupInfo?.display_name || t('imageGroups:defaultGroupName'),
            to: singleGroup.display_name,
          }),
          'info',
        )
        void navigateToGroup(singleGroup)
      }
    }
  }, [currentGroupInfo?.display_name, currentParentId, groups, navigateToGroup, onShowSnackbar, t])

  const handleRebuild = useCallback(async () => {
    try {
      const data = await rebuildMutation.mutateAsync()
      onShowSnackbar(
        `${t('imageGroups:autoFolder.refresh')}: ${data.groups_created} groups, ${data.images_assigned} images`,
        'success',
      )
      setIsGroupListView(true)
      setCurrentParentId(null)
      setCurrentGroupInfo(null)
      setBreadcrumb([])
    } catch (error) {
      console.error('Error rebuilding auto-folder groups:', error)
      onShowSnackbar(t('common:messages.error'), 'error')
    }
  }, [onShowSnackbar, rebuildMutation, t])

  const handleGroupClick = useCallback(
    (group: AutoFolderGroupWithStats) => {
      if (isGroupListView) {
        void navigateToGroup(group)
        return
      }

      if ((group.child_count || 0) > 0) {
        void navigateToGroup(group)
        return
      }

      if (group.image_count > 0) {
        openGroupImagePanel(group)
        return
      }

      onShowSnackbar(t('imageGroups:messages.emptyGroup'), 'info')
    },
    [fetchGroupImages, groupImagesPageSize, isGroupListView, navigateToGroup, onShowSnackbar, t],
  )

  const handleGroupImagesModalClose = () => {
    setMobileImageSheetOpen(false)
    setSelectedGroupForImages(null)
    setGroupImages([])
    setGroupImagesPage(1)
  }

  const openGroupImagePanel = (group: AutoFolderGroupWithStats) => {
    const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
    setSelectedGroupForImages(group)
    setMobileImageSheetOpen(isMobile)
    setGroupImagesPage(1)
    void fetchGroupImages(group.id, 1, groupImagesPageSize, false)
  }

  const handleGroupImagesLoadMore = () => {
    if (!selectedGroupForImages || groupImagesPage >= groupImagesTotalPages) return

    const nextPage = groupImagesPage + 1
    void fetchGroupImages(selectedGroupForImages.id, nextPage, groupImagesPageSize, true)
  }

  const handleGroupImagesPageChange = (page: number) => {
    if (!selectedGroupForImages) return
    setGroupImagesPage(page)
    void fetchGroupImages(selectedGroupForImages.id, page, groupImagesPageSize, false)
  }

  const handleGroupImagesPageSizeChange = (size: PageSize) => {
    setGroupImagesPageSize(size)
    if (!selectedGroupForImages) return

    setGroupImagesPage(1)
    void fetchGroupImages(selectedGroupForImages.id, 1, size, false)
  }

  const modalCurrentGroup = useMemo(
    () => (selectedGroupForImages ? toModalGroup(selectedGroupForImages) : null),
    [selectedGroupForImages],
  )

  const handleImagesRemoved = () => {}
  const handleImagesAssigned = () => {}

  const hasVisibleCards =
    (!isGroupListView && currentParentId !== null && currentGroupInfo && currentGroupInfo.image_count > 0) || groups.length > 0

  return (
    <Sheet
      open={mobileImageSheetOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleGroupImagesModalClose()
        } else {
          setMobileImageSheetOpen(true)
        }
      }}
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Alert>
            <AlertDescription>{t('imageGroups:autoFolder.readOnlyMessage')}</AlertDescription>
          </Alert>

          <Button onClick={() => void handleRebuild()} disabled={rebuildMutation.isPending}>
            {rebuildMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {rebuildMutation.isPending ? t('imageGroups:autoFolder.rebuilding') : t('imageGroups:autoFolder.refresh')}
          </Button>
        </div>

        {!isGroupListView ? (
          <GroupBreadcrumb breadcrumb={breadcrumb} onNavigate={handleBreadcrumbNavigate} showGroupListRoot={true} />
        ) : null}

        {loading ? (
          <div className="flex min-h-[220px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid min-h-[640px] gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
            <div className="min-h-0 rounded-lg border bg-card">
              <div className="border-b px-4 py-3">
                <p className="text-sm font-semibold text-foreground">그룹 탐색</p>
                <p className="text-xs text-muted-foreground">자동 분류된 폴더 그룹을 따라 내려가며 이미지를 여나이다.</p>
              </div>
              <ScrollArea className="h-full max-h-[calc(100vh-260px)]">
                <div className="space-y-4 p-4">
                  {hasVisibleCards ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {!isGroupListView && currentParentId !== null && currentGroupInfo && currentGroupInfo.image_count > 0 ? (
                        <AutoFolderImageViewCard
                          key={`auto-folder-image-view-${currentParentId}`}
                          group={currentGroupInfo}
                          onClick={() => openGroupImagePanel(currentGroupInfo)}
                        />
                      ) : null}

                      {groups.map((group) => (
                        <AutoFolderGroupCard key={group.id} group={group} onClick={() => handleGroupClick(group)} />
                      ))}
                    </div>
                  ) : (
                    <div className="py-10 text-center">
                      <FolderTree className="mx-auto mb-2 h-12 w-12 text-muted-foreground" />
                      <p className="text-base text-muted-foreground">
                        {isGroupListView ? t('imageGroups:autoFolder.emptyState.noGroups') : t('imageGroups:autoFolder.emptyState.noSubfolders')}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {isGroupListView ? t('imageGroups:autoFolder.emptyState.refreshPrompt') : t('imageGroups:autoFolder.emptyState.noSubfoldersHelp')}
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="hidden min-h-0 lg:block">
              {!selectedGroupForImages ? (
                <div className="mb-3 rounded-lg border border-dashed bg-muted/10 px-4 py-3">
                  <p className="text-sm font-semibold text-foreground">이미지 탐색 패널</p>
                  <p className="text-xs text-muted-foreground">좌측에서 그룹을 고르면 이곳에 기존 이미지 목록이 펼쳐지나이다.</p>
                </div>
              ) : null}
              {selectedGroupForImages ? (
                <GroupImageGridModal
                  key={`auto-folder-panel-${selectedGroupForImages.id}-${groupImagesPage}`}
                  open={true}
                  embedded={true}
                  onClose={handleGroupImagesModalClose}
                  images={groupImages}
                  loading={groupImagesLoading}
                  currentGroup={modalCurrentGroup}
                  allGroups={[]}
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
                  readOnly={true}
                  groupType="auto-folder"
                  onShowSnackbar={onShowSnackbar}
                />
              ) : (
                <div className="flex h-full min-h-[640px] items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
                  <div className="space-y-2">
                    <FolderTree className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="text-base font-medium">{t('imageGroups:page.autoFolderGroupsTab')}</p>
                    <p className="text-sm text-muted-foreground">그룹을 고르시면 우측에서 이미지를 탐색할 수 있나이다.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <SheetContent side="bottom" className="flex h-[85vh] max-h-[85vh] flex-col rounded-t-2xl p-0 lg:hidden" showCloseButton={true}>
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted" />
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold text-foreground">이미지 탐색</p>
          <p className="text-xs text-muted-foreground">선택한 그룹의 이미지를 아래 패널에서 탐색하나이다.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-3">
          {selectedGroupForImages ? (
            <GroupImageGridModal
              key={`auto-folder-mobile-panel-${selectedGroupForImages.id}-${groupImagesPage}`}
              open={true}
              embedded={true}
              onClose={handleGroupImagesModalClose}
              images={groupImages}
              loading={groupImagesLoading}
              currentGroup={modalCurrentGroup}
              allGroups={[]}
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
              readOnly={true}
              groupType="auto-folder"
              onShowSnackbar={onShowSnackbar}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
