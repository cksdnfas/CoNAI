import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { PageHeader } from '@/components/common/page-header'
import {
  getAutoFolderGroup,
  getAutoFolderGroupBreadcrumb,
  getAutoFolderGroupImages,
  getAutoFolderGroupsHierarchyAll,
  getAutoFolderGroupThumbnailUrl,
  getGroup,
  getGroupBreadcrumb,
  getGroupImages,
  getGroupsHierarchyAll,
  getGroupThumbnailUrl,
} from '@/lib/api'
import { useMinWidth } from '@/lib/use-min-width'
import { GroupBreadcrumbs } from './components/group-breadcrumbs'
import { GroupChildCard } from './components/group-child-card'
import { GroupImageDrawer } from './components/group-image-drawer'
import { GroupImageSection } from './components/group-image-section'
import { GroupTree } from './components/group-tree'

const groupSources = {
  custom: {
    key: 'custom',
    tabLabel: '사용자 커스텀 그룹',
    rootTitle: '사용자 커스텀 그룹',
    rootSectionTitle: '루트 그룹',
    getAllGroups: getGroupsHierarchyAll,
    getGroup,
    getBreadcrumb: getGroupBreadcrumb,
    getImages: getGroupImages,
    getThumbnailUrl: getGroupThumbnailUrl,
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
    getThumbnailUrl: getAutoFolderGroupThumbnailUrl,
  },
} as const

type GroupSourceKey = keyof typeof groupSources

function normalizeGroupSourceKey(value: string | null): GroupSourceKey {
  return value === 'folders' ? 'folders' : 'custom'
}

export function GroupPage() {
  const navigate = useNavigate()
  const { groupId } = useParams<{ groupId?: string }>()
  const [searchParams] = useSearchParams()
  const [isImageDrawerOpen, setIsImageDrawerOpen] = useState(false)
  const isWideLayout = useMinWidth(1280)
  const selectedSourceKey = normalizeGroupSourceKey(searchParams.get('tab'))
  const selectedSource = groupSources[selectedSourceKey]
  const selectedGroupId = groupId ? Number(groupId) : undefined

  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', selectedSource.key],
    queryFn: selectedSource.getAllGroups,
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
    queryKey: ['group-images', selectedSource.key, selectedGroupId],
    queryFn: ({ pageParam }) => selectedSource.getImages(selectedGroupId!, { page: pageParam, limit: 40 }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination
      return page < totalPages ? page + 1 : undefined
    },
    enabled: Number.isFinite(selectedGroupId),
  })

  useEffect(() => {
    if (isWideLayout) {
      setIsImageDrawerOpen(false)
    }
  }, [isWideLayout])

  const allGroups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])
  const rootGroups = useMemo(() => allGroups.filter((group) => group.parent_id == null), [allGroups])
  const childGroups = useMemo(() => allGroups.filter((group) => group.parent_id === selectedGroupId), [allGroups, selectedGroupId])
  const groupImages = useMemo(() => (groupImagesQuery.data?.pages ?? []).flatMap((page) => page.images), [groupImagesQuery.data?.pages])

  const handleOpenGroup = (nextGroupId: number) => {
    if (!isWideLayout) {
      setIsImageDrawerOpen(true)
    }
    navigate(`/groups/${nextGroupId}?tab=${selectedSource.key}`)
  }

  const handleOpenRoot = () => {
    setIsImageDrawerOpen(false)
    navigate(`/groups?tab=${selectedSource.key}`)
  }

  const handleSelectSource = (nextSource: GroupSourceKey) => {
    setIsImageDrawerOpen(false)
    navigate(`/groups?tab=${nextSource}`)
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={isWideLayout ? 'Groups' : undefined}
        title={selectedGroupQuery.data?.name ?? selectedSource.rootTitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {Object.values(groupSources).map((source) => (
              <Button
                key={source.key}
                type="button"
                variant={selectedSource.key === source.key ? 'default' : 'secondary'}
                size="sm"
                onClick={() => handleSelectSource(source.key)}
              >
                {source.tabLabel}
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)]">
        <ExplorerSidebar
          title="Explorer"
          badge={<Badge variant="outline">{allGroups.length}</Badge>}
          className="xl:sticky xl:top-24 xl:self-start xl:flex xl:max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] xl:flex-col"
          bodyClassName="xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1"
        >
          {groupsQuery.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-9 w-full rounded-sm" />
              ))}
            </div>
          ) : null}

          {groupsQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>그룹 트리를 불러오지 못했어</AlertTitle>
              <AlertDescription>
                {groupsQuery.error instanceof Error ? groupsQuery.error.message : '알 수 없는 오류가 발생했어.'}
              </AlertDescription>
            </Alert>
          ) : null}

          {!groupsQuery.isLoading && !groupsQuery.isError ? (
            <GroupTree groups={allGroups} selectedGroupId={selectedGroupId} onSelectGroup={handleOpenGroup} />
          ) : null}
        </ExplorerSidebar>

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
            <Card className="bg-surface-container">
              <CardHeader>
                <CardTitle>{selectedSource.rootSectionTitle}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {rootGroups.map((group) => (
                  <GroupChildCard
                    key={group.id}
                    group={group}
                    thumbnailUrl={selectedSource.getThumbnailUrl(group.id)}
                    onOpen={handleOpenGroup}
                  />
                ))}
              </CardContent>
            </Card>
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
              {childGroups.length > 0 ? (
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold tracking-tight text-foreground">하위 그룹</h2>
                    <Badge variant="secondary">{childGroups.length.toLocaleString('ko-KR')}</Badge>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {childGroups.map((group) => (
                      <GroupChildCard
                        key={group.id}
                        group={group}
                        thumbnailUrl={selectedSource.getThumbnailUrl(group.id)}
                        onOpen={handleOpenGroup}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {isWideLayout ? (
                <GroupImageSection
                  group={selectedGroupQuery.data}
                  groupImages={groupImages}
                  isLoading={groupImagesQuery.isLoading}
                  isError={groupImagesQuery.isError}
                  errorMessage={groupImagesQuery.error instanceof Error ? groupImagesQuery.error.message : null}
                  hasMore={Boolean(groupImagesQuery.hasNextPage)}
                  isLoadingMore={groupImagesQuery.isFetchingNextPage}
                  onLoadMore={() => void groupImagesQuery.fetchNextPage()}
                />
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {!isWideLayout && selectedGroupId && selectedGroupQuery.data && selectedGroupQuery.data.image_count > 0 ? (
        <>
          <div className="fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4">
            <Button type="button" size="sm" className="theme-floating-panel w-[30vw] min-w-[112px] max-w-[180px] shadow-[0_18px_48px_rgba(0,0,0,0.35)]" onClick={() => setIsImageDrawerOpen(true)}>
              이미지 보기
            </Button>
          </div>

          <GroupImageDrawer
            open={isImageDrawerOpen}
            group={selectedGroupQuery.data}
            groupImages={groupImages}
            isLoading={groupImagesQuery.isLoading}
            isError={groupImagesQuery.isError}
            errorMessage={groupImagesQuery.error instanceof Error ? groupImagesQuery.error.message : null}
            hasMore={Boolean(groupImagesQuery.hasNextPage)}
            isLoadingMore={groupImagesQuery.isFetchingNextPage}
            onLoadMore={() => void groupImagesQuery.fetchNextPage()}
            onClose={() => setIsImageDrawerOpen(false)}
          />
        </>
      ) : null}
    </div>
  )
}
