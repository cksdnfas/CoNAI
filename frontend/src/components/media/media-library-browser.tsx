import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, FolderTree, Images, Search, SlidersHorizontal } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { SearchField } from '@/components/common/search-field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { Spinner } from '@/components/ui/loading-state'
import { GroupTree } from '@/features/groups/components/group-tree'
import { buildGroupCountMaps, getGroupHierarchyTotalCount } from '@/features/groups/group-count-utils'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { SEARCH_AI_TOOL_OPTIONS } from '@/features/search/search-constants'
import { useI18n } from '@/i18n'
import { getGroupImages, getGroupsHierarchyAll } from '@/lib/api-groups'
import { getImages, searchImagesComplex } from '@/lib/api-images'
import type { ImageRecord } from '@/types/image'
import type { GroupWithHierarchy } from '@/types/group'

export type MediaLibraryKind = 'all' | 'image' | 'video'

interface MediaLibraryBrowserProps {
  selectedIds: string[]
  /** Records from the current visible page set; callers retain metadata for earlier selections. */
  onSelectedIdsChange: (ids: string[], items: ImageRecord[]) => void
  mediaKind?: MediaLibraryKind
  maxCount?: number
  initialGroupPath?: string
  disabled?: boolean
  /** Posts number media together with their other attachment tabs. */
  selectionOrder?: ReadonlyMap<string, number>
  getGroupMenu?: (group: GroupWithHierarchy) => ActionMenuEntry[]
  pickedGroupIds?: ReadonlySet<number>
}

/** The app's library selector: group tree, server search, filters and the shared virtualized media list. */
export function MediaLibraryBrowser({
  selectedIds, onSelectedIdsChange, mediaKind = 'all', maxCount = Infinity, initialGroupPath,
  disabled = false, selectionOrder, getGroupMenu, pickedGroupIds,
}: MediaLibraryBrowserProps) {
  const { t, formatNumber } = useI18n()
  const { canViewImages } = useImagePermissions()
  const { showSnackbar } = useSnackbar()
  const [groupOpen, setGroupOpen] = useState(false)
  const groupsQuery = useQuery({ queryKey: ['groups-hierarchy-all', 'custom'], queryFn: getGroupsHierarchyAll, enabled: canViewImages, staleTime: 30_000 })
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])
  const countMaps = useMemo(() => buildGroupCountMaps(groups), [groups])
  const groupPaths = useMemo(() => {
    const byId = new Map(groups.map((group) => [group.id, group]))
    return groups.map((group) => {
      const names = [group.name]
      const seen = new Set([group.id])
      let parent = group.parent_id ? byId.get(group.parent_id) : undefined
      while (parent && !seen.has(parent.id)) {
        names.unshift(parent.name)
        seen.add(parent.id)
        parent = parent.parent_id ? byId.get(parent.parent_id) : undefined
      }
      return { id: group.id, path: names.join('/') }
    })
  }, [groups])
  const [chosenGroupId, setGroupId] = useState<number | null | undefined>(undefined)
  const groupId = chosenGroupId === undefined ? groupPaths.find((group) => group.path === initialGroupPath)?.id ?? null : chosenGroupId
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [tool, setTool] = useState('')
  const [order, setOrder] = useState<'ASC' | 'DESC'>('DESC')
  const [kindFilter, setKind] = useState<MediaLibraryKind>('all')
  const kind = mediaKind === 'all' ? kindFilter : mediaKind

  // The group listing takes no search, tool or order: searching goes back to the whole library, a group clears them.
  const query = useInfiniteQuery({
    queryKey: groupId === null ? ['home-images', 'media-library', search, tool, order] : ['group-images', 'custom', groupId, 'media-library'],
    enabled: canViewImages && (!initialGroupPath || !groupsQuery.isPending),
    initialPageParam: { page: 1, cursorOrderIndex: null as number | null, cursorAddedDate: null as string | null, cursorHash: null as string | null },
    queryFn: async ({ pageParam, signal }) => {
      if (groupId !== null) {
        const result = await getGroupImages(groupId, { ...pageParam, limit: 48, includeChildren: true }, { signal })
        return { images: result.images, hasMore: result.pagination.hasMore ?? result.pagination.page < result.pagination.totalPages, cursorOrderIndex: result.pagination.nextCursorOrderIndex ?? null, cursorAddedDate: result.pagination.nextCursorAddedDate ?? null, cursorHash: result.pagination.nextCursorHash ?? null }
      }
      const result = await (search || tool ? searchImagesComplex({
        complex_filter: {
          or_group: search ? [
            { category: 'positive_prompt', type: 'prompt_contains', value: search },
            { category: 'auto_tag', type: 'auto_tag_any', value: search, min_score: 0, max_score: 1 },
          ] : [],
          and_group: tool ? [{ category: 'basic', type: 'ai_tool_group', value: tool }] : [],
        },
        page: pageParam.page, limit: 48, sortBy: 'first_seen_date', sortOrder: order,
      }, { signal }) : getImages({ page: pageParam.page, limit: 48, sortOrder: order }, { signal }))
      return { images: result.images, hasMore: result.hasMore, cursorOrderIndex: null, cursorAddedDate: null, cursorHash: null }
    },
    getNextPageParam: (lastPage, pages) => lastPage.hasMore ? { page: pages.length + 1, cursorOrderIndex: lastPage.cursorOrderIndex, cursorAddedDate: lastPage.cursorAddedDate, cursorHash: lastPage.cursorHash } : undefined,
  })
  const items = useMemo(() => [...new Map((query.data?.pages.flatMap((page) => page.images) ?? [])
    .filter((item) => item.composite_hash && (kind === 'all' || item.mime_type?.startsWith(kind === 'image' ? 'image/' : 'video/')))
    .map((item) => [item.composite_hash, item])).values()], [query.data, kind])
  // A kind filter can leave pages nearly empty: fetch further pages (bounded) until there is enough to show.
  const loadedPages = query.data?.pages.length ?? 0
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = query
  useEffect(() => {
    if (canViewImages && !isError && kind !== 'all' && items.length < 24 && hasNextPage && !isFetchingNextPage && loadedPages < 20) void fetchNextPage({ cancelRefetch: false })
  }, [canViewImages, isError, kind, items.length, hasNextPage, isFetchingNextPage, fetchNextPage, loadedPages])
  const safety = useImageFeedSafety({ items, enabled: canViewImages, hasMore: canViewImages && loadedPages < 20 && query.hasNextPage, isLoading: query.isPending, isError: query.isError, isLoadingMore: query.isFetchingNextPage, onLoadMore: () => query.fetchNextPage({ cancelRefetch: false }) })

  const orderByHash = selectionOrder ?? new Map(selectedIds.map((hash, index) => [hash, index + 1]))
  const changeSelection = (ids: string[]) => {
    if (disabled || !canViewImages) return
    if (maxCount === 1) ids = ids.slice(-1)
    if (ids.length > maxCount) {
      showSnackbar({ tone: 'error', message: t({ ko: '미디어는 {count}개까지 선택할 수 있어.', en: 'Select up to {count} media items.' }, { count: maxCount }) })
      return
    }
    onSelectedIdsChange(ids, safety.visibleItems)
  }
  const renderOrder = (image: ImageRecord) => {
    const position = image.composite_hash ? orderByHash.get(image.composite_hash) : undefined
    return position ? <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground tabular-nums shadow-key">{position}</span> : null
  }
  const selectGroup = (id: number | null) => {
    setGroupId(id)
    setSearch('')
    setInput('')
    setTool('')
    setGroupOpen(false)
  }
  const loadMore = () => {
    if (canViewImages && hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage({ cancelRefetch: false })
  }
  const side = (
    <div className="space-y-1">
      <Button variant="nav" size="sm" className="w-full px-2" data-active={groupId === null ? 'true' : undefined} aria-current={groupId === null ? 'true' : undefined} onClick={() => selectGroup(null)}>
        <Images className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left">{t({ ko: '전체 미디어', en: 'All media' })}</span>
      </Button>
      {groupsQuery.isError ? <ErrorState size="compact" title={t({ ko: '그룹을 불러오지 못했어.', en: 'Could not load groups.' })} error={groupsQuery.error} onRetry={() => void groupsQuery.refetch()} /> : null}
      {groups.length ? <div className="border-t border-line pt-1">
        <GroupTree groups={groups} countMaps={countMaps} selectedGroupId={groupId ?? undefined} onSelectGroup={selectGroup} getGroupMenu={getGroupMenu} pickedGroupIds={pickedGroupIds} />
      </div> : null}
    </div>
  )

  const selectedGroup = groupId !== null ? groups.find((group) => group.id === groupId) : undefined
  if (!canViewImages) return <EmptyState title={t({ ko: '미디어 보기 권한이 필요해.', en: 'Media viewing permission is required.' })} />
  return (
    <div className="-mx-4 flex min-h-0 flex-1 border-y border-line md:-mx-5">
      <nav aria-label={t({ ko: '미디어 그룹', en: 'Media groups' })} className="hidden w-60 shrink-0 overflow-y-auto border-r border-line p-2 sm:block">{side}</nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2.5">
          <Popover open={groupOpen} onOpenChange={setGroupOpen}>
            <PopoverTrigger asChild><IconButton className="sm:hidden" variant="ghost" label={t({ ko: '미디어 그룹', en: 'Media groups' })}><FolderTree /></IconButton></PopoverTrigger>
            <PopoverContent align="start" className="max-h-[60vh] overflow-y-auto p-2">{side}</PopoverContent>
          </Popover>
          <div className="flex min-w-40 flex-1 items-center gap-1">
            <SearchField value={input} onChange={setInput} maxLength={300}
              onSubmit={() => { setSearch(input.trim()); if (input.trim()) setGroupId(null) }}
              onClear={() => { setInput(''); setSearch('') }}
              placeholder={t({ ko: '프롬프트·태그', en: 'Prompts and tags' })} />
            <IconButton variant="ghost" label={t({ ko: '검색 (Enter)', en: 'Search (Enter)' })} onClick={() => { setSearch(input.trim()); if (input.trim()) setGroupId(null) }}><Search /></IconButton>
          </div>
          {mediaKind === 'all' ? <SegmentedControl ariaLabel={t({ ko: '종류', en: 'Kind' })} value={kind} onChange={(value) => setKind(value as MediaLibraryKind)} items={[
            { value: 'all', label: t({ ko: '전체', en: 'All' }) },
            { value: 'image', label: t({ ko: '이미지', en: 'Images' }) },
            { value: 'video', label: t({ ko: '영상', en: 'Videos' }) },
          ]} /> : null}
          {groupId === null ? <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton variant="ghost" active={tool !== ''} label={tool ? SEARCH_AI_TOOL_OPTIONS.find((option) => option.value === tool)?.label ?? tool : t({ ko: '생성 도구', en: 'Generation tool' })}><SlidersHorizontal /></IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={tool} onValueChange={setTool}>
                  <DropdownMenuRadioItem value="">{t({ ko: '모든 도구', en: 'All tools' })}</DropdownMenuRadioItem>
                  {SEARCH_AI_TOOL_OPTIONS.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.value === 'other' ? t({ ko: '기타', en: 'Other' }) : option.label}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton variant="ghost" label={order === 'DESC' ? t({ ko: '최신순', en: 'Newest first' }) : t({ ko: '오래된순', en: 'Oldest first' })} onClick={() => setOrder(order === 'DESC' ? 'ASC' : 'DESC')}>
              {order === 'DESC' ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
            </IconButton>
          </> : <span className="text-xs tabular-nums text-muted-foreground">{selectedGroup ? formatNumber(getGroupHierarchyTotalCount(selectedGroup, countMaps)) : null}</span>}
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-3 pb-2">
          {query.isPending ? <div className="flex flex-1 items-center justify-center"><Spinner label={t({ ko: '불러오는 중', en: 'Loading' })} /></div>
            : query.isError && !items.length ? <ErrorState size="compact" className="mt-2" title={t({ ko: '미디어를 불러오지 못했어.', en: 'Could not load media.' })} error={query.error} onRetry={() => void query.refetch()} />
            : safety.visibleItems.length ? <ImageList
              items={safety.visibleItems} resetKey={`${groupId}:${search}:${tool}:${order}:${kind}`} layout="masonry" activationMode="none"
              selectable forceSelectionMode selectedIds={selectedIds} onSelectedIdsChange={changeSelection}
              hasMore={query.hasNextPage && !query.isError} isLoadingMore={query.isFetchingNextPage} onLoadMore={loadMore}
              scrollMode="container" viewportHeight="100%" className="min-h-0 flex-1" minColumnWidth={150} columnGap={6} rowGap={6}
              showDefaultQuickActions={false} shouldBlurItemPreview={safety.shouldBlurItemPreview} renderItemPersistentOverlay={safety.renderItemPersistentOverlay} renderItemOverlay={renderOrder}
            />
            : <EmptyState className="flex-1" title={t({ ko: '맞는 미디어 없음', en: 'No matching media' })} />}
          {query.isError && items.length > 0 ? <ErrorState size="compact" title={t({ ko: '미디어를 불러오지 못했어.', en: 'Could not load media.' })} error={query.error} onRetry={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())} /> : null}
          {!query.isError && query.hasNextPage && !safety.visibleItems.length ? <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={loadMore}>{t({ ko: '더 보기', en: 'Load more' })}</Button> : null}
        </div>
      </div>
    </div>
  )
}
