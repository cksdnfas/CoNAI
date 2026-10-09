import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { ImageOff, RotateCcw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldInfo } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { getImageListDisplayName } from '@/features/images/components/image-list/image-list-utils'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { SEARCH_AI_TOOL_OPTIONS } from '@/features/search/search-constants'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import type { ChatMediaAttachment } from '@/lib/api-codex-chat'
import { getGroupImages, getGroupsHierarchyAll } from '@/lib/api-groups'
import { getImage, getImageDetailQueryKey, getImages, searchImagesComplex } from '@/lib/api-images'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'

/** Search the full library on the server; selection survives filters and page changes. */
export function ChatMediaPicker({ initial, maxCount, onPick, onClose, title, applyLabel, note, initialGroupPath, imagesOnly = false, videosOnly = false }: {
  initial: ChatMediaAttachment[]; maxCount: number; onPick: (items: ChatMediaAttachment[]) => void; onClose: () => void
  /** Defaults are worded for chat attachments; `note: null` drops the attachment note. */
  title?: string; applyLabel?: string; note?: string | null
  initialGroupPath?: string
  imagesOnly?: boolean
  /** Only videos (the sprite tab). Like imagesOnly it keeps loading pages until the filtered list has enough. */
  videosOnly?: boolean
}) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const { showSnackbar } = useSnackbar()
  const groupsQuery = useQuery({ queryKey: ['groups-hierarchy-all', 'chat-media-picker'], queryFn: getGroupsHierarchyAll, enabled: canViewImages, staleTime: 30_000 })
  const groups = useMemo(() => {
    const entries = groupsQuery.data ?? []
    const byId = new Map(entries.map((group) => [group.id, group]))
    return entries.map((group) => {
      const names = [group.name]
      const seen = new Set([group.id])
      let parent = group.parent_id ? byId.get(group.parent_id) : undefined
      while (parent && !seen.has(parent.id)) { names.unshift(parent.name); seen.add(parent.id); parent = parent.parent_id ? byId.get(parent.parent_id) : undefined }
      return { id: group.id, path: names.join('/') }
    })
  }, [groupsQuery.data])
  const [chosenGroupId, setChosenGroupId] = useState<number | null | undefined>(undefined)
  const groupId = chosenGroupId === undefined ? groups.find((group) => group.path === initialGroupPath)?.id ?? null : chosenGroupId
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [tool, setTool] = useState('')
  const [order, setOrder] = useState<'ASC' | 'DESC'>('DESC')
  const [selected, setSelected] = useState(() => new Map(initial.map((item) => [item.compositeHash, item])))
  const query = useInfiniteQuery({
    queryKey: ['chat-media-picker', groupId, search, tool, order],
    initialPageParam: { page: 1, cursorOrderIndex: null as number | null, cursorAddedDate: null as string | null, cursorHash: null as string | null },
    enabled: canViewImages && (!initialGroupPath || !groupsQuery.isPending),
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
  const kindOnly = imagesOnly || videosOnly
  const items = useMemo(() => [...new Map((query.data?.pages.flatMap((page) => page.images) ?? [])
    .filter((item) => (!imagesOnly || item.mime_type?.startsWith('image/')) && (!videosOnly || item.mime_type?.startsWith('video/')))
    .map((item) => [item.composite_hash, item])).values()], [query.data, imagesOnly, videosOnly])
  // A media-kind filter can leave pages nearly empty: fetch further pages (bounded) until there is enough to show.
  const loadedPages = query.data?.pages.length ?? 0
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (kindOnly && items.length < 24 && hasNextPage && !isFetchingNextPage && loadedPages < 20) void fetchNextPage()
  }, [kindOnly, items.length, hasNextPage, isFetchingNextPage, fetchNextPage, loadedPages])
  const safety = useImageFeedSafety({ items, hasMore: query.hasNextPage, isLoading: query.isPending, isError: query.isError, isLoadingMore: query.isFetchingNextPage, onLoadMore: query.fetchNextPage })
  const select = (ids: string[]) => {
    if (kindOnly && maxCount === 1) ids = ids.slice(-1)
    if (ids.length > maxCount) {
      showSnackbar({ tone: 'error', message: t({ ko: '미디어는 {count}개까지 선택할 수 있어. 전체 첨부 한도는 20개야.', en: 'Select up to {count} media items. The total attachment limit is 20.' }, { count: maxCount }) })
      return
    }
    const available = new Map(selected)
    for (const item of items) {
      if (item.composite_hash) available.set(item.composite_hash, { compositeHash: item.composite_hash, name: getImageListDisplayName(item), mimeType: item.mime_type ?? null })
    }
    setSelected(new Map(ids.flatMap((id) => available.has(id) ? [[id, available.get(id)!] as const] : [])))
  }
  return <Modal open title={title ?? t({ ko: '앱 미디어에서 고르기', en: 'Choose app media' })} onClose={onClose} widthClassName="max-w-4xl" height="tall">
    <ModalBody className="space-y-3">
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(input.trim()) }}>
        <Select className="max-w-full w-auto" aria-label={t({ ko: '그룹', en: 'Group' })} value={groupId ?? ''} onChange={(event) => setChosenGroupId(event.target.value ? Number(event.target.value) : null)}>
          <option value="">{t({ ko: '전체', en: 'All groups' })}</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.path}</option>)}
        </Select>
        {groupId === null ? <>
          <Input className="min-w-40 flex-1" value={input} onChange={(event) => setInput(event.target.value)} aria-label={t({ ko: '프롬프트·태그 검색', en: 'Search prompts and tags' })} placeholder={t({ ko: '전체 미디어의 프롬프트·태그 검색', en: 'Search prompts and tags across the library' })} maxLength={300} />
          <IconButton type="submit" variant="secondary" label={t({ ko: '검색 (Enter)', en: 'Search (Enter)' })}><Search /></IconButton>
          <Select className="w-auto" aria-label={t({ ko: '생성 도구', en: 'Generation tool' })} value={tool} onChange={(event) => setTool(event.target.value)}>
            <option value="">{t({ ko: '모든 도구', en: 'All tools' })}</option>
            {SEARCH_AI_TOOL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === 'other' ? t({ ko: '기타', en: 'Other' }) : option.label}</option>)}
          </Select>
          <Select className="w-auto" aria-label={t({ ko: '정렬', en: 'Sort order' })} value={order} onChange={(event) => setOrder(event.target.value as 'ASC' | 'DESC')}>
            <option value="DESC">{t({ ko: '최신순', en: 'Newest first' })}</option>
            <option value="ASC">{t({ ko: '오래된순', en: 'Oldest first' })}</option>
          </Select>
        </> : null}
        <IconButton variant="ghost" label={t({ ko: '필터 초기화', en: 'Reset filters' })} onClick={() => { setChosenGroupId(null); setInput(''); setSearch(''); setTool(''); setOrder('DESC') }}><RotateCcw /></IconButton>
      </form>
      {query.isPending ? <div className="flex justify-center py-6"><Spinner label={t({ ko: '불러오는 중', en: 'Loading' })} /></div> : safety.visibleItems.length ? <ImageList
        items={safety.visibleItems} resetKey={`${groupId}:${search}:${tool}:${order}`} layout={kindOnly ? 'masonry' : 'grid'} activationMode="none"
        selectable forceSelectionMode selectedIds={[...selected.keys()]} onSelectedIdsChange={select}
        scrollMode="container" viewportHeight="min(48vh, 480px)" minColumnWidth={130} gridItemHeight={145} columnGap={8} rowGap={8}
        showDefaultQuickActions={false} shouldBlurItemPreview={safety.shouldBlurItemPreview} renderItemPersistentOverlay={safety.renderItemPersistentOverlay}
      /> : !query.isError ? <p className="py-3 text-center text-xs text-muted-foreground">{t({ ko: '맞는 미디어 없음', en: 'No matching media' })}</p> : null}
      {query.isError ? <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
        {getErrorMessage(query.error, t({ ko: '미디어를 불러오지 못했어.', en: 'Could not load media.' }))}
        <Button variant="ghost" onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>{t({ ko: '다시 시도', en: 'Retry' })}</Button>
      </div> : null}
      {query.hasNextPage ? <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t({ ko: '더 보기', en: 'Load more' })}</Button> : null}
    </ModalBody>
    <ModalFooter>
      <span className="mr-auto flex items-center gap-1 text-sm text-muted-foreground">
        {t({ ko: '{count}개 선택', en: '{count} selected' }, { count: selected.size })}
        {note === null ? null : <FieldInfo>{note ?? t({ ko: '원본을 참조해 첨부해. 이미지 이해에는 이미지 보기 도구와 비전 모델이 필요하고, 영상·오디오 내용 분석은 지원하지 않아.', en: 'Attachments reference the originals. Image understanding requires the image tool and a vision model; video/audio analysis is not supported.' })}</FieldInfo>}
      </span>
      <IconButton variant="ghost" disabled={!selected.size} label={t({ ko: '선택 해제', en: 'Clear selection' })} onClick={() => setSelected(new Map())}><X /></IconButton>
      <Button disabled={selected.size > maxCount || (kindOnly && !selected.size)} onClick={() => onPick([...selected.values()])}>{applyLabel ?? t({ ko: '첨부 적용', en: 'Apply attachments' })}</Button>
    </ModalFooter>
  </Modal>
}

/** Resolve current metadata/visibility for thumbnails; removed originals stay recognizable by name. */
export function ChatMediaAttachments({ items = [], onRemove, disabled = false }: {
  items?: ChatMediaAttachment[]; onRemove?: (hash: string) => void; disabled?: boolean
}) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const viewer = useImageViewModal()
  const queries = useQueries({ queries: items.map((item) => ({ enabled: canViewImages, queryKey: getImageDetailQueryKey(item.compositeHash), queryFn: ({ signal }: { signal: AbortSignal }) => getImage(item.compositeHash, { signal }), retry: false })) })
  const images = queries.flatMap((query) => query.data ? [query.data] : [])
  const safety = useImageFeedSafety({ items: images, enabled: items.length > 0 })
  const visible = new Map(safety.visibleItems.map((image) => [image.composite_hash, image]))
  if (!items.length) return null
  return <div className={cn('flex flex-wrap gap-2', onRemove ? 'mb-2' : 'mt-2 justify-end')}>
    {items.map((item) => {
      const image: ImageRecord | undefined = canViewImages ? visible.get(item.compositeHash) : undefined
      return <div key={item.compositeHash} className="relative flex w-24 flex-col overflow-hidden rounded-sm bg-surface-high">
        <Button variant="ghost" className="h-20 w-full overflow-hidden p-0" disabled={!image || !viewer} aria-label={item.name} onClick={() => viewer?.openImageView({ compositeHash: item.compositeHash, sourceItems: image ? [image] : [] })}>
          {image ? <img src={buildApiUrl(`/api/images/${encodeURIComponent(item.compositeHash)}/thumbnail`)} alt={item.name} loading="lazy" className={cn('size-full object-cover', safety.shouldBlurItemPreview(image) && 'blur-md')} /> : <ImageOff className="size-5 text-muted-foreground" />}
        </Button>
        <Tip content={item.name}><span className="truncate px-1 py-1 text-2xs">{item.name}</span></Tip>
        {onRemove ? <IconButton variant="secondary" size="icon-xs" className="absolute right-0.5 top-0.5" disabled={disabled} label={t({ ko: '첨부 빼기', en: 'Remove attachment' })} onClick={() => onRemove(item.compositeHash)}><X /></IconButton> : null}
      </div>
    })}
  </div>
}
