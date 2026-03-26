import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { PageHeader } from '@/components/common/page-header'
import { getGroup, getGroupBreadcrumb, getGroupImages, getGroupsHierarchyAll } from '@/lib/api'
import { GroupBreadcrumbs } from './components/group-breadcrumbs'
import { GroupChildCard } from './components/group-child-card'
import { GroupImageSection } from './components/group-image-section'
import { GroupTree } from './components/group-tree'

export function GroupPage() {
  const navigate = useNavigate()
  const { groupId } = useParams<{ groupId?: string }>()
  const selectedGroupId = groupId ? Number(groupId) : undefined

  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all'],
    queryFn: getGroupsHierarchyAll,
  })

  const selectedGroupQuery = useQuery({
    queryKey: ['group-detail', selectedGroupId],
    queryFn: () => getGroup(selectedGroupId!),
    enabled: Number.isFinite(selectedGroupId),
  })

  const breadcrumbQuery = useQuery({
    queryKey: ['group-breadcrumb', selectedGroupId],
    queryFn: () => getGroupBreadcrumb(selectedGroupId!),
    enabled: Number.isFinite(selectedGroupId),
  })

  const groupImagesQuery = useInfiniteQuery({
    queryKey: ['group-images', selectedGroupId],
    queryFn: ({ pageParam }) => getGroupImages(selectedGroupId!, { page: pageParam, limit: 40 }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination
      return page < totalPages ? page + 1 : undefined
    },
    enabled: Number.isFinite(selectedGroupId),
  })

  const allGroups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])
  const rootGroups = useMemo(() => allGroups.filter((group) => group.parent_id == null), [allGroups])
  const childGroups = useMemo(() => allGroups.filter((group) => group.parent_id === selectedGroupId), [allGroups, selectedGroupId])
  const groupImages = useMemo(() => (groupImagesQuery.data?.pages ?? []).flatMap((page) => page.images), [groupImagesQuery.data?.pages])

  const handleOpenGroup = (nextGroupId: number) => {
    navigate(`/groups/${nextGroupId}`)
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Groups"
        title={selectedGroupQuery.data?.name ?? '그룹 탐색'}
        description={
          selectedGroupQuery.data?.description ||
          '백엔드 계층 그룹을 기준으로 이미지 묶음을 탐색하고, 현재 그룹의 이미지들을 바로 확인한다.'
        }
      />

      <div className="grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)]">
        <ExplorerSidebar title="Explorer" badge={<Badge variant="outline">{allGroups.length}</Badge>} className="xl:sticky xl:top-24 xl:self-start">
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
          {selectedGroupId ? (
            <GroupBreadcrumbs
              items={breadcrumbQuery.data ?? []}
              selectedGroupId={selectedGroupId}
              onOpenGroup={handleOpenGroup}
              onOpenRoot={() => navigate('/groups')}
            />
          ) : null}

          {!selectedGroupId ? (
            <Card className="bg-surface-container">
              <CardHeader>
                <CardTitle>루트 그룹</CardTitle>
                <CardDescription>먼저 탐색할 그룹을 하나 골라. 그룹 안으로 들어가면 하위 그룹과 이미지 목록을 같이 보여줄게.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {rootGroups.map((group) => (
                  <GroupChildCard key={group.id} group={group} onOpen={handleOpenGroup} />
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
                      <GroupChildCard key={group.id} group={group} onOpen={handleOpenGroup} />
                    ))}
                  </div>
                </section>
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
              />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
