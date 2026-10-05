import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQueries } from '@tanstack/react-query'
import { ImageOff, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { getImageListDisplayName } from '@/features/images/components/image-list/image-list-utils'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { SEARCH_AI_TOOL_OPTIONS } from '@/features/search/search-constants'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import type { ChatMediaAttachment } from '@/lib/api-codex-chat'
import { getImage, getImageDetailQueryKey, getImages, searchImagesComplex } from '@/lib/api-images'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import type { ImageRecord } from '@/types/image'

/** Search the full library on the server; selection survives filters and page changes. */
export function ChatMediaPicker({ initial, maxCount, onPick, onClose }: {
  initial: ChatMediaAttachment[]; maxCount: number; onPick: (items: ChatMediaAttachment[]) => void; onClose: () => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [tool, setTool] = useState('')
  const [order, setOrder] = useState<'ASC' | 'DESC'>('DESC')
  const [selected, setSelected] = useState(() => new Map(initial.map((item) => [item.compositeHash, item])))
  const query = useInfiniteQuery({
    queryKey: ['chat-media-picker', search, tool, order],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => search || tool ? searchImagesComplex({
      complex_filter: {
        or_group: search ? [
          { category: 'positive_prompt', type: 'prompt_contains', value: search },
          { category: 'auto_tag', type: 'auto_tag_any', value: search, min_score: 0, max_score: 1 },
        ] : [],
        and_group: tool ? [{ category: 'basic', type: 'ai_tool_group', value: tool }] : [],
      },
      page: pageParam, limit: 48, sortBy: 'first_seen_date', sortOrder: order,
    }, { signal }) : getImages({ page: pageParam, limit: 48, sortOrder: order }, { signal }),
    getNextPageParam: (lastPage, pages) => lastPage.hasMore ? pages.length + 1 : undefined,
  })
  const items = useMemo(() => [...new Map((query.data?.pages.flatMap((page) => page.images) ?? []).map((item) => [item.composite_hash, item])).values()], [query.data])
  const safety = useImageFeedSafety({ items, hasMore: query.hasNextPage, isLoading: query.isPending, isError: query.isError, isLoadingMore: query.isFetchingNextPage, onLoadMore: query.fetchNextPage })
  const select = (ids: string[]) => {
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
  return <Modal open title={t({ ko: '앱 미디어에서 고르기', en: 'Choose app media' })} onClose={onClose} widthClassName="max-w-4xl">
    <ModalBody className="space-y-3">
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(input.trim()) }}>
        <Input className="min-w-40 flex-1" value={input} onChange={(event) => setInput(event.target.value)} aria-label={t({ ko: '프롬프트·태그 검색', en: 'Search prompts and tags' })} placeholder={t({ ko: '전체 미디어의 프롬프트·태그 검색', en: 'Search prompts and tags across the library' })} maxLength={300} />
        <Button type="submit" variant="secondary"><Search />{t({ ko: '검색', en: 'Search' })}</Button>
        <Select className="w-auto" aria-label={t({ ko: '생성 도구', en: 'Generation tool' })} value={tool} onChange={(event) => setTool(event.target.value)}>
          <option value="">{t({ ko: '모든 도구', en: 'All tools' })}</option>
          {SEARCH_AI_TOOL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === 'other' ? t({ ko: '기타', en: 'Other' }) : option.label}</option>)}
        </Select>
        <Select className="w-auto" aria-label={t({ ko: '정렬', en: 'Sort order' })} value={order} onChange={(event) => setOrder(event.target.value as 'ASC' | 'DESC')}>
          <option value="DESC">{t({ ko: '최신순', en: 'Newest first' })}</option>
          <option value="ASC">{t({ ko: '오래된순', en: 'Oldest first' })}</option>
        </Select>
        <Button type="button" variant="ghost" onClick={() => { setInput(''); setSearch(''); setTool(''); setOrder('DESC') }}>{t({ ko: '필터 초기화', en: 'Reset filters' })}</Button>
      </form>
      {query.isPending ? <p className="py-12 text-center text-sm text-muted-foreground">{t({ ko: '불러오는 중…', en: 'Loading…' })}</p> : safety.visibleItems.length ? <ImageList
        items={safety.visibleItems} resetKey={`${search}:${tool}:${order}`} layout="grid" activationMode="none"
        selectable forceSelectionMode selectedIds={[...selected.keys()]} onSelectedIdsChange={select}
        scrollMode="container" viewportHeight="min(48vh, 480px)" minColumnWidth={130} gridItemHeight={145} columnGap={8} rowGap={8}
        showDefaultQuickActions={false} shouldBlurItemPreview={safety.shouldBlurItemPreview} renderItemPersistentOverlay={safety.renderItemPersistentOverlay}
      /> : !query.isError ? <p className="py-12 text-center text-sm text-muted-foreground">{t({ ko: '조건에 맞는 미디어가 없어.', en: 'No media matches these filters.' })}</p> : null}
      {query.isError ? <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
        {getErrorMessage(query.error, t({ ko: '미디어를 불러오지 못했어.', en: 'Could not load media.' }))}
        <Button variant="ghost" onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>{t({ ko: '다시 시도', en: 'Retry' })}</Button>
      </div> : null}
      {query.hasNextPage ? <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{t({ ko: '더 보기', en: 'Load more' })}</Button> : null}
      <p className="text-xs text-muted-foreground">{t({ ko: '원본을 참조해 첨부해. 이미지 이해에는 이미지 보기 도구와 비전 모델이 필요하고, 영상·오디오 내용 분석은 지원하지 않아.', en: 'Attachments reference the originals. Image understanding requires the image tool and a vision model; video/audio analysis is not supported.' })}</p>
    </ModalBody>
    <ModalFooter>
      <span className="mr-auto text-sm text-muted-foreground">{t({ ko: '{count}개 선택', en: '{count} selected' }, { count: selected.size })}</span>
      <Button variant="ghost" disabled={!selected.size} onClick={() => setSelected(new Map())}>{t({ ko: '선택 해제', en: 'Clear selection' })}</Button>
      <Button variant="secondary" onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button>
      <Button disabled={selected.size > maxCount} onClick={() => onPick([...selected.values()])}>{t({ ko: '첨부 적용', en: 'Apply attachments' })}</Button>
    </ModalFooter>
  </Modal>
}

/** Resolve current metadata/visibility for thumbnails; removed originals stay recognizable by name. */
export function ChatMediaAttachments({ items = [], onRemove, disabled = false }: {
  items?: ChatMediaAttachment[]; onRemove?: (hash: string) => void; disabled?: boolean
}) {
  const { t } = useI18n()
  const viewer = useImageViewModal()
  const queries = useQueries({ queries: items.map((item) => ({ queryKey: getImageDetailQueryKey(item.compositeHash), queryFn: ({ signal }: { signal: AbortSignal }) => getImage(item.compositeHash, { signal }), retry: false })) })
  const images = queries.flatMap((query) => query.data ? [query.data] : [])
  const safety = useImageFeedSafety({ items: images, enabled: items.length > 0 })
  const visible = new Map(safety.visibleItems.map((image) => [image.composite_hash, image]))
  if (!items.length) return null
  return <div className={cn('flex flex-wrap gap-2', onRemove ? 'mb-2' : 'mt-2 justify-end')}>
    {items.map((item) => {
      const image: ImageRecord | undefined = visible.get(item.compositeHash)
      return <div key={item.compositeHash} className="relative flex w-24 flex-col overflow-hidden rounded-sm bg-surface-high">
        <Button variant="ghost" className="h-20 w-full overflow-hidden p-0" disabled={!image || !viewer} title={item.name} onClick={() => viewer?.openImageView({ compositeHash: item.compositeHash, sourceItems: image ? [image] : [] })}>
          {image ? <img src={buildApiUrl(`/api/images/${encodeURIComponent(item.compositeHash)}/thumbnail`)} alt={item.name} loading="lazy" className={cn('size-full object-cover', safety.shouldBlurItemPreview(image) && 'blur-md')} /> : <ImageOff className="size-5 text-muted-foreground" />}
        </Button>
        <span className="truncate px-1 py-1 text-2xs" title={item.name}>{item.name}</span>
        {onRemove ? <IconButton variant="secondary" size="icon-xs" className="absolute right-0.5 top-0.5" disabled={disabled} label={t({ ko: '첨부 빼기', en: 'Remove attachment' })} onClick={() => onRemove(item.compositeHash)}><X /></IconButton> : null}
      </div>
    })}
  </div>
}
