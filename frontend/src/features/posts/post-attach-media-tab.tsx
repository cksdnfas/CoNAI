import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Images, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/loading-state'
import { GroupTree } from '@/features/groups/components/group-tree'
import { buildGroupCountMaps, getGroupHierarchyTotalCount } from '@/features/groups/group-count-utils'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { SEARCH_AI_TOOL_OPTIONS } from '@/features/search/search-constants'
import { useI18n } from '@/i18n'
import { getGroupImages, getGroupsHierarchyAll } from '@/lib/api-groups'
import { getImages, searchImagesComplex } from '@/lib/api-images'
import { getErrorMessage } from '@/lib/error-message'
import type { ImageRecord } from '@/types/image'
import type { GroupWithHierarchy } from '@/types/group'
import { AttachPanes, AttachToolbar, attachKey, type AttachItem } from './post-attach-shared'

type Kind = 'all' | 'image' | 'video'

const matchesKind = (item: ImageRecord, kind: Kind) => kind === 'all' || (kind === 'video' ? item.mime_type?.startsWith('video/') : !item.mime_type?.startsWith('video/'))

/** Library media: the group tree on the left (its row menu inserts a whole group), the masonry on the right. */
export function AttachMediaTab({ selected, setSelected }: { selected: AttachItem[]; setSelected: Dispatch<SetStateAction<AttachItem[]>> }) {
  const { t, formatNumber } = useI18n()
  const groupsQuery = useQuery({ queryKey: ['groups-hierarchy-all', 'post-attach'], queryFn: getGroupsHierarchyAll, staleTime: 30_000 })
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])
  const countMaps = useMemo(() => buildGroupCountMaps(groups), [groups])
  const [groupId, setGroupId] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [tool, setTool] = useState('')
  const [order, setOrder] = useState<'ASC' | 'DESC'>('DESC')
  const [kind, setKind] = useState<Kind>('all')

  // The group listing takes no search, tool or order: searching goes back to the whole library, a group clears them.
  const query = useInfiniteQuery({
    queryKey: ['post-attach-media', groupId, search, tool, order],
    initialPageParam: { page: 1, cursorOrderIndex: null as number | null, cursorAddedDate: null as string | null, cursorHash: null as string | null },
    queryFn: async ({ pageParam, signal }) => {
      if (groupId !== null) {
        const result = await getGroupImages(groupId, { ...pageParam, limit: 48, includeChildren: true })
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
    .filter((item) => item.composite_hash && matchesKind(item, kind))
    .map((item) => [item.composite_hash, item])).values()], [query.data, kind])
  // A kind filter can leave pages nearly empty: fetch further pages (bounded) until there is enough to show.
  const loadedPages = query.data?.pages.length ?? 0
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (kind !== 'all' && items.length < 24 && hasNextPage && !isFetchingNextPage && loadedPages < 20) void fetchNextPage()
  }, [kind, items.length, hasNextPage, isFetchingNextPage, fetchNextPage, loadedPages])
  const safety = useImageFeedSafety({ items, hasMore: query.hasNextPage, isLoading: query.isPending, isError: query.isError, isLoadingMore: query.isFetchingNextPage, onLoadMore: query.fetchNextPage })

  const orderByKey = useMemo(() => new Map(selected.map((item, index) => [item.key, index + 1])), [selected])
  const selectedHashes = useMemo(() => selected.flatMap((item) => item.kind === 'media' ? [item.hash] : []), [selected])
  const byHash = useMemo(() => new Map(items.map((item) => [item.composite_hash as string, item])), [items])
  // Keep the order things were picked in: new ids go to the end, dropped ones leave.
  const changeSelection = useCallback((ids: string[]) => {
    const next = new Set(ids)
    setSelected((current) => {
      const kept = current.filter((item) => item.kind !== 'media' || next.has(item.hash))
      const have = new Set(kept.flatMap((item) => item.kind === 'media' ? [item.hash] : []))
      const added = ids.flatMap((hash): AttachItem[] => {
        const record = byHash.get(hash)
        return !have.has(hash) && record ? [{ kind: 'media', key: attachKey.media(hash), hash, mimeType: record.mime_type ?? null }] : []
      })
      return [...kept, ...added]
    })
  }, [byHash, setSelected])
  const renderOrder = useCallback((image: ImageRecord) => {
    const position = image.composite_hash ? orderByKey.get(attachKey.media(image.composite_hash)) : undefined
    return position ? <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground tabular-nums shadow-key">{position}</span> : null
  }, [orderByKey])

  const toggleGroup = (group: GroupWithHierarchy) => setSelected((current) => current.some((item) => item.key === attachKey.group(group.id))
    ? current.filter((item) => item.key !== attachKey.group(group.id))
    : [...current, { kind: 'group', key: attachKey.group(group.id), id: group.id, name: group.name }])
  const pickedGroupIds = new Set(selected.flatMap((item) => item.kind === 'group' ? [item.id] : []))
  const getGroupMenu = (group: GroupWithHierarchy): ActionMenuEntry[] => {
    const picked = orderByKey.has(attachKey.group(group.id))
    return [{ key: 'insert-group', icon: picked ? X : Plus, label: picked ? t({ ko: '그룹 빼기', en: 'Remove group' }) : t({ ko: '그룹째 넣기', en: 'Insert whole group' }), onSelect: () => toggleGroup(group) }]
  }
  const side = (
    <div className="space-y-1">
      <Button variant="nav" size="sm" className="w-full px-2" data-active={groupId === null ? 'true' : undefined} aria-current={groupId === null ? 'true' : undefined} onClick={() => setGroupId(null)}>
        <Images className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-left">{t({ ko: '전체 미디어', en: 'All media' })}</span>
      </Button>
      {groups.length ? <div className="border-t border-line pt-1">
        <GroupTree groups={groups} countMaps={countMaps} selectedGroupId={groupId ?? undefined} onSelectGroup={(id) => { setGroupId(id); setSearch(''); setInput(''); setTool('') }} getGroupMenu={getGroupMenu} pickedGroupIds={pickedGroupIds} />
      </div> : null}
    </div>
  )

  const selectedGroup = groupId !== null ? groups.find((group) => group.id === groupId) : undefined
  return (
    <AttachPanes side={side}>
      <AttachToolbar>
        <form className="flex min-w-40 flex-1 items-center gap-1" onSubmit={(event) => { event.preventDefault(); setSearch(input.trim()); if (input.trim()) setGroupId(null) }}>
          <Input className="flex-1" value={input} onChange={(event) => setInput(event.target.value)} maxLength={300}
            aria-label={t({ ko: '프롬프트·태그 검색', en: 'Search prompts and tags' })} placeholder={t({ ko: '프롬프트·태그', en: 'Prompts and tags' })} />
          <IconButton type="submit" variant="ghost" label={t({ ko: '검색 (Enter)', en: 'Search (Enter)' })}><Search /></IconButton>
        </form>
        <SegmentedControl ariaLabel={t({ ko: '종류', en: 'Kind' })} value={kind} onChange={(value) => setKind(value as Kind)} items={[
          { value: 'all', label: t({ ko: '전체', en: 'All' }) },
          { value: 'image', label: t({ ko: '이미지', en: 'Images' }) },
          { value: 'video', label: t({ ko: '영상', en: 'Videos' }) },
        ]} />
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
      </AttachToolbar>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-2">
        {query.isPending ? <div className="flex flex-1 items-center justify-center"><Spinner label={t({ ko: '불러오는 중', en: 'Loading' })} /></div>
          : query.isError && !items.length ? <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-destructive">
            {getErrorMessage(query.error, t({ ko: '미디어를 불러오지 못했어.', en: 'Could not load media.' }))}
            <Button variant="ghost" onClick={() => void query.refetch()}>{t({ ko: '다시 시도', en: 'Retry' })}</Button>
          </div>
          : safety.visibleItems.length ? <ImageList
            items={safety.visibleItems} resetKey={`${groupId}:${search}:${tool}:${order}:${kind}`} layout="masonry" activationMode="none"
            selectable forceSelectionMode selectedIds={selectedHashes} onSelectedIdsChange={changeSelection}
            hasMore={query.hasNextPage} isLoadingMore={query.isFetchingNextPage} onLoadMore={() => void query.fetchNextPage()}
            scrollMode="container" viewportHeight="100%" className="min-h-0 flex-1" minColumnWidth={150} columnGap={6} rowGap={6}
            showDefaultQuickActions={false} shouldBlurItemPreview={safety.shouldBlurItemPreview} renderItemPersistentOverlay={safety.renderItemPersistentOverlay} renderItemOverlay={renderOrder}
          />
          : <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t({ ko: '맞는 미디어 없음', en: 'No matching media' })}</p>}
      </div>
    </AttachPanes>
  )
}
