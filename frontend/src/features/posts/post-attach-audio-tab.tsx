import { useState, type Dispatch, type SetStateAction } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { SearchField } from '@/components/common/search-field'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Spinner } from '@/components/ui/loading-state'
import { audioPlayer, useAudioPlayer } from '@/features/audio/audio-player'
import { useI18n } from '@/i18n'
import { listAudioCandidates, searchAudioGroups, type AudioGroup } from '@/lib/api-audio'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { TwoPane, TwoPaneToolbar } from '@/components/common/sidebar-layout'
import { LoadMoreSentinel, attachKey, type AttachItem } from './post-attach-shared'

const PAGE = 50

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return ''
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Audio takes: search the sounds (audio groups) of every project, open one, pick its takes. Both lists load page by page. */
export function AttachAudioTab({ selected, setSelected }: { selected: AttachItem[]; setSelected: Dispatch<SetStateAction<AttachItem[]>> }) {
  const { t } = useI18n()
  const player = useAudioPlayer()
  const [group, setGroup] = useState<AudioGroup | null>(null)
  const [input, setInput] = useState('')
  const search = useDebouncedValue(input.trim(), 250)
  const groups = useInfiniteQuery({
    queryKey: ['post-picker', 'audio-groups', search],
    queryFn: ({ pageParam, signal }) => searchAudioGroups({ search, cursor: pageParam, limit: PAGE }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: group === null,
  })
  const takes = useInfiniteQuery({
    queryKey: ['post-picker', 'audio-takes', group?.id],
    queryFn: ({ pageParam }) => listAudioCandidates(group?.id ?? '', { limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.items.length > 0 && last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    enabled: group !== null,
  })
  const query = group ? takes : groups
  const groupItems = groups.data?.pages.flatMap((page) => page.items) ?? []
  const takeItems = takes.data?.pages.flatMap((page) => page.items) ?? []
  const groupName = (item: AudioGroup) => (item.is_inbox ? t({ ko: '받은 소리', en: 'Inbox' }) : item.label ?? item.name)
  const orderByKey = new Map(selected.map((item, index) => [item.key, index + 1]))
  const toggle = (id: string, name: string) => setSelected((current) => current.some((item) => item.key === attachKey.audio(id))
    ? current.filter((item) => item.key !== attachKey.audio(id))
    : [...current, { kind: 'audio', key: attachKey.audio(id), id, name }])

  return (
    <TwoPane>
      <TwoPaneToolbar>
        {group ? (
          <>
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '효과음 목록', en: 'All sounds' })} onClick={() => setGroup(null)}><ArrowLeft /></IconButton>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{group.project_name ? <span className="font-normal text-muted-foreground">{group.project_name} / </span> : null}{groupName(group)}</span>
          </>
        ) : (
          <SearchField className="min-w-40 flex-1" value={input} onChange={setInput} placeholder={t({ ko: '효과음 이름·설명', en: 'Sound name or description' })} />
        )}
      </TwoPaneToolbar>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line px-(--page-gutter)">
        {query.isPending ? <div className="flex justify-center py-8"><Spinner label={t({ ko: '불러오는 중', en: 'Loading' })} /></div> : null}
        {query.isError && !query.data ? <ErrorState size="compact" className="mt-2" title={t({ ko: '오디오를 불러오지 못했어.', en: 'Could not load audio.' })} error={query.error} onRetry={() => void query.refetch()} /> : null}
        {group ? takeItems.map((take) => {
          const position = orderByKey.get(attachKey.audio(take.id))
          const playing = player.key === take.id && player.playing
          return (
            <ListRow key={take.id} selected={Boolean(position)}
              leading={<IconButton size="icon-sm" variant="ghost" label={playing ? t({ ko: '일시정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={() => audioPlayer.toggle(take.id)}>{playing ? <Pause /> : <Play />}</IconButton>}
              trailing={<span className="flex items-center gap-3"><span className="text-xs tabular-nums text-muted-foreground">{formatDuration(take.file?.duration)}</span><Checkbox className="mx-1" checked={Boolean(position)} onCheckedChange={() => toggle(take.id, take.name)} aria-label={take.name} /></span>}>
              <Button variant="ghost" size="sm" className="w-full min-w-0 justify-start truncate" onClick={() => toggle(take.id, take.name)}>{take.name}</Button>
            </ListRow>
          )
        }) : groupItems.map((item) => (
          <ListRow key={item.id} asChild interactive trailing={<span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">{item.candidate_count}<ChevronRight className="size-4" /></span>}>
            <button type="button" onClick={() => setGroup(item)}>
              <span className="min-w-0 flex-1 truncate">{item.project_name ? <span className="text-muted-foreground">{item.project_name} / </span> : null}{groupName(item)}</span>
            </button>
          </ListRow>
        ))}
        {query.isSuccess && (group ? takeItems : groupItems).length === 0 ? <EmptyState title={group ? t({ ko: '테이크가 없어', en: 'No takes' }) : t({ ko: '찾은 효과음이 없어', en: 'No matching sounds' })} /> : null}
        <LoadMoreSentinel enabled={Boolean(query.hasNextPage) && !query.isFetchingNextPage} onVisible={() => void query.fetchNextPage()} />
        {query.isFetchingNextPage ? <div className="flex justify-center py-3"><Spinner /></div> : null}
      </div>
    </TwoPane>
  )
}
