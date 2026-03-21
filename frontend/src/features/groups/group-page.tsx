import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/common/page-header'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { getGroup, getGroupBreadcrumb, getGroupImages, getGroupsHierarchyAll, getGroupThumbnailUrl } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { GroupWithHierarchy } from '@/types/group'

interface GroupTreeProps {
  groups: GroupWithHierarchy[]
  selectedGroupId?: number
  onSelectGroup: (groupId: number) => void
}

/** Render a recursive group tree for the left explorer panel. */
function GroupTree({ groups, selectedGroupId, onSelectGroup }: GroupTreeProps) {
  const groupsByParentId = useMemo(() => {
    const map = new Map<number | null, GroupWithHierarchy[]>()

    for (const group of groups) {
      const parentId = group.parent_id ?? null
      const siblings = map.get(parentId) ?? []
      siblings.push(group)
      map.set(parentId, siblings)
    }

    for (const siblings of map.values()) {
      siblings.sort((left, right) => left.name.localeCompare(right.name))
    }

    return map
  }, [groups])

  /** Render nested group rows from a given parent. */
  const renderNodes = (parentId: number | null, depth: number) => {
    const nodes = groupsByParentId.get(parentId) ?? []
    if (nodes.length === 0) return null

    return (
      <div className="space-y-1">
        {nodes.map((group) => {
          const isSelected = group.id === selectedGroupId
          const hasChildren = (groupsByParentId.get(group.id) ?? []).length > 0

          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => onSelectGroup(group.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm transition-colors',
                  isSelected
                    ? 'bg-surface-container text-primary'
                    : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
                )}
                style={{ paddingLeft: `${12 + depth * 14}px` }}
              >
                {hasChildren ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                <span className="truncate">{group.name}</span>
              </button>
              {renderNodes(group.id, depth + 1)}
            </div>
          )
        })}
      </div>
    )
  }

  return renderNodes(null, 0)
}

/** Render a simple thumbnail card for a child group. */
function GroupChildCard({ group, onOpen }: { group: GroupWithHierarchy; onOpen: (groupId: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(group.id)}
      className="group flex w-full items-center gap-4 rounded-sm bg-surface-low p-4 text-left transition-colors hover:bg-surface-high"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-lowest">
        <img
          src={getGroupThumbnailUrl(group.id)}
          alt={group.name}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{group.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{group.image_count.toLocaleString('ko-KR')} images</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

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
  const rootGroups = useMemo(
    () => allGroups.filter((group) => group.parent_id == null),
    [allGroups],
  )
  const childGroups = useMemo(
    () => allGroups.filter((group) => group.parent_id === selectedGroupId),
    [allGroups, selectedGroupId],
  )
  const groupImages = useMemo(
    () => (groupImagesQuery.data?.pages ?? []).flatMap((page) => page.images),
    [groupImagesQuery.data?.pages],
  )

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
        <aside className="rounded-sm bg-surface-lowest p-4 xl:sticky xl:top-24 xl:self-start">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">Explorer</h2>
            <Badge variant="outline">{allGroups.length}</Badge>
          </div>

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
        </aside>

        <section className="space-y-8">
          {selectedGroupId && breadcrumbQuery.data && breadcrumbQuery.data.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <button type="button" onClick={() => navigate('/groups')} className="hover:text-foreground">
                Groups
              </button>
              {breadcrumbQuery.data.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4" />
                  <button
                    type="button"
                    onClick={() => handleOpenGroup(item.id)}
                    className={cn('hover:text-foreground', item.id === selectedGroupId && 'text-primary')}
                  >
                    {item.name}
                  </button>
                </div>
              ))}
            </div>
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

              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-foreground">이미지</h2>
                    <p className="text-sm text-muted-foreground">
                      {selectedGroupQuery.data.image_count.toLocaleString('ko-KR')}개 항목
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      manual {selectedGroupQuery.data.manual_added_count?.toLocaleString('ko-KR') ?? 0}
                    </Badge>
                    <Badge variant="outline">
                      auto {selectedGroupQuery.data.auto_collected_count?.toLocaleString('ko-KR') ?? 0}
                    </Badge>
                  </div>
                </div>

                {groupImagesQuery.isLoading ? (
                  <div className="grid gap-4 md:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <Skeleton key={index} className="h-[260px] w-full rounded-sm" />
                    ))}
                  </div>
                ) : null}

                {groupImagesQuery.isError ? (
                  <Alert variant="destructive">
                    <AlertTitle>그룹 이미지를 불러오지 못했어</AlertTitle>
                    <AlertDescription>
                      {groupImagesQuery.error instanceof Error ? groupImagesQuery.error.message : '알 수 없는 오류가 발생했어.'}
                    </AlertDescription>
                  </Alert>
                ) : null}

                {!groupImagesQuery.isLoading && !groupImagesQuery.isError && groupImages.length > 0 ? (
                  <ImageList
                    items={groupImages}
                    layout="masonry"
                    getItemHref={(image) => (image.composite_hash ? `/images/${image.composite_hash}` : undefined)}
                    hasMore={Boolean(groupImagesQuery.hasNextPage)}
                    isLoadingMore={groupImagesQuery.isFetchingNextPage}
                    onLoadMore={groupImagesQuery.fetchNextPage}
                    minColumnWidth={280}
                    columnGap={20}
                    rowGap={20}
                    gridItemHeight={260}
                  />
                ) : null}

                {!groupImagesQuery.isLoading && !groupImagesQuery.isError && groupImages.length === 0 ? (
                  <Card className="bg-surface-container">
                    <CardContent className="p-6 text-sm text-muted-foreground">
                      이 그룹에는 아직 표시할 이미지가 없어.
                    </CardContent>
                  </Card>
                ) : null}
              </section>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
