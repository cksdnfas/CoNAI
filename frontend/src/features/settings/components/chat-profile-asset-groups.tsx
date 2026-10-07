import { useState } from 'react'
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { ChevronDown, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ListRow } from '@/components/ui/list-row'
import { Spinner } from '@/components/ui/loading-state'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { ImageList } from '@/features/images/components/image-list/image-list'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import { getGroupEmoticons, getGroupImages, getGroupsHierarchyAll, groupEmoticonsQueryKey } from '@/lib/api-groups'
import { getPromptPresets } from '@/lib/api-prompt-presets'
import { getImage, getImageDetailQueryKey } from '@/lib/api-images'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

const DEFAULT_EXPRESSIONS = ['중립', '기쁨', '슬픔', '분노', '두려움', '놀람', '애정', '부끄러움']

/** Read the character's existing library groups; candidates keep the shared masonry and viewer. */
export function ChatProfileAssetGroups({ characterName, onCreate, busy }: { characterName: string; onCreate: () => void; busy: boolean }) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const [expressionsOpen, setExpressionsOpen] = useState(false)
  const [candidatesOpen, setCandidatesOpen] = useState(false)
  const groups = useQuery({ queryKey: ['groups-hierarchy-all', 'chat-assets'], queryFn: getGroupsHierarchyAll, enabled: canViewImages, staleTime: 30000 })
  const presets = useQuery({ queryKey: ['prompt-presets', 'chat-assets'], queryFn: () => getPromptPresets({ withItems: true }), enabled: canViewImages })
  // Match the server's characterMediaGroupPath normalization.
  // eslint-disable-next-line no-control-regex
  const name = characterName.replace(/[/\\]/g, '-').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || '이름 없음'
  const root = groups.data?.find((group) => group.name === '채팅 캐릭터' && !group.parent_id)
  const character = root ? groups.data?.find((group) => group.name === name && group.parent_id === root.id) : undefined
  const expressionGroup = character ? groups.data?.find((group) => group.name === '표정' && group.parent_id === character.id) : undefined
  const candidateGroup = character ? groups.data?.find((group) => group.name === '후보' && group.parent_id === character.id) : undefined
  const emoticons = useQuery({ queryKey: groupEmoticonsQueryKey(expressionGroup?.id ?? 0), queryFn: () => getGroupEmoticons(expressionGroup!.id), enabled: canViewImages && !!expressionGroup })
  const names = presets.data?.find((preset) => preset.name === '기본 캐릭터 표정')?.items?.map((item) => item.description).filter(Boolean) ?? DEFAULT_EXPRESSIONS
  const entries = emoticons.data?.entries ?? []
  const expressionImages = useQueries({ queries: entries.map((entry) => ({ queryKey: getImageDetailQueryKey(entry.compositeHash), queryFn: ({ signal }: { signal: AbortSignal }) => getImage(entry.compositeHash, { signal }), enabled: canViewImages && expressionsOpen, retry: false })) })
  const expressionSafety = useImageFeedSafety({ items: expressionImages.flatMap((query) => query.data ? [query.data] : []) })
  const visibleExpressions = new Map(expressionSafety.visibleItems.map((image) => [image.composite_hash, image]))
  const allNames = [...new Set([...names, ...entries.flatMap((entry) => entry.keywords)])]
  const filled = allNames.filter((name) => entries.some((entry) => entry.keywords.includes(name))).length
  const candidates = useInfiniteQuery({
    queryKey: ['chat-asset-candidates', candidateGroup?.id],
    enabled: canViewImages && !!candidateGroup && candidatesOpen,
    initialPageParam: { page: 1, cursorOrderIndex: null as number | null, cursorAddedDate: null as string | null, cursorHash: null as string | null },
    queryFn: ({ pageParam }) => getGroupImages(candidateGroup!.id, { ...pageParam, limit: 48 }),
    getNextPageParam: (last) => (last.pagination.hasMore ?? last.pagination.page < last.pagination.totalPages) ? { page: last.pagination.page + 1, cursorOrderIndex: last.pagination.nextCursorOrderIndex ?? null, cursorAddedDate: last.pagination.nextCursorAddedDate ?? null, cursorHash: last.pagination.nextCursorHash ?? null } : undefined,
  })
  const safety = useImageFeedSafety({ items: candidates.data?.pages.flatMap((page) => page.images.filter((image) => image.mime_type?.startsWith('image/'))) ?? [], hasMore: candidates.hasNextPage, isLoadingMore: candidates.isFetchingNextPage, onLoadMore: () => candidates.fetchNextPage() })
  const count = candidateGroup?.visible_image_count ?? candidateGroup?.image_count ?? 0
  return <div className="sm:col-span-2">
    <section className="border-t border-line py-3">
      <div className="flex items-center gap-3">
        <ListRow asChild interactive size="sm" className="flex-1"><button type="button" aria-expanded={expressionsOpen} onClick={() => setExpressionsOpen(!expressionsOpen)} className="flex min-h-8 flex-1 items-center gap-2 text-left text-sm font-semibold"><ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !expressionsOpen && '-rotate-90')} />{t({ ko: '표정', en: 'Expressions' })}<span className="text-xs font-normal tabular-nums text-muted-foreground">{filled}/{allNames.length}</span></button></ListRow>
        <Button size="sm" disabled={busy} onClick={onCreate}><Sparkles />{t({ ko: '만들기', en: 'Create' })}</Button>
      </div>
      {expressionsOpen ? <div className="mt-3 overflow-x-auto"><div className="grid w-max grid-cols-8 gap-3">
        {allNames.map((name) => {
          const entry = entries.find((entry) => entry.keywords.includes(name))
          const image = entry ? visibleExpressions.get(entry.compositeHash) : undefined
          return <div key={name} className="w-[76px]"><div className={cn('relative h-[100px] overflow-hidden rounded-[6px]', !image && 'border border-dashed border-line')}><ChatProfileImage src={image && entry ? buildApiUrl(`/api/images/${entry.compositeHash}/file`) : null} className={image && expressionSafety.shouldBlurItemPreview(image) ? 'blur-lg' : undefined} />{image ? expressionSafety.renderItemPersistentOverlay(image) : null}</div><div className="mt-1 truncate text-center text-xs text-muted-foreground">{name}</div></div>
        })}
      </div></div> : null}
      {emoticons.isError ? <p role="alert" className="text-sm text-destructive">{getErrorMessage(emoticons.error, t({ ko: '불러오지 못했어.', en: 'Could not load.' }))}</p> : null}
    </section>
    <section className="border-t border-line py-3">
      <ListRow asChild interactive size="sm"><button type="button" aria-expanded={candidatesOpen} onClick={() => setCandidatesOpen(!candidatesOpen)} className="flex min-h-8 w-full items-center gap-2 text-sm font-semibold"><ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !candidatesOpen && '-rotate-90')} />{t({ ko: '후보', en: 'Candidates' })}<span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span></button></ListRow>
      {candidatesOpen && candidateGroup ? <div className="mt-3">
        {candidates.isPending ? <Spinner /> : <ImageList items={safety.visibleItems} layout="masonry" activationMode="modal" scrollMode="container" viewportHeight="min(48vh, 480px)" minColumnWidth={130} columnGap={8} rowGap={8} resetKey={String(candidateGroup.id)} showDefaultQuickActions={false} shouldBlurItemPreview={safety.shouldBlurItemPreview} renderItemPersistentOverlay={safety.renderItemPersistentOverlay} hasMore={candidates.hasNextPage} isLoadingMore={candidates.isFetchingNextPage} onLoadMore={() => void candidates.fetchNextPage()} />}
        {candidates.hasNextPage ? <Button size="sm" variant="ghost" disabled={candidates.isFetchingNextPage} onClick={() => void candidates.fetchNextPage()}>{t({ ko: '더 보기', en: 'Load more' })}</Button> : null}
        {candidates.isError ? <div role="alert" className="flex items-center gap-2 text-sm text-destructive">{getErrorMessage(candidates.error, t({ ko: '불러오지 못했어.', en: 'Could not load.' }))}<Button size="xs" variant="ghost" onClick={() => void candidates.refetch()}>{t({ ko: '다시 시도', en: 'Retry' })}</Button></div> : null}
      </div> : null}
      {groups.isError ? <div role="alert" className="text-sm text-destructive">{getErrorMessage(groups.error, t({ ko: '불러오지 못했어.', en: 'Could not load.' }))}</div> : null}
    </section>
  </div>
}
