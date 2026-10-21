import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { StoredFileEntry } from '@conai/shared'
import { Folder, HardDrive } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { SearchField } from '@/components/common/search-field'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { ListRow } from '@/components/ui/list-row'
import { Spinner } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, listStoredFiles, listStoredFolders, searchStoredFiles, storedFileThumbnailUrl } from '@/lib/api-files'
import { formatFileSize } from '@/lib/format-size'
import { TwoPane, TwoPaneToolbar } from '@/components/common/sidebar-layout'
import { SidebarItem } from '@/components/ui/sidebar'
import { ExtensionTile, LoadMoreSentinel, PickOrderMark, attachKey, type AttachItem } from './post-attach-shared'
import { HighlightText } from '@/components/common/highlight-text'
import { useDebouncedValue } from '@/lib/use-debounced-value'

function FileThumb({ entry }: { entry: StoredFileEntry }) {
  const [failed, setFailed] = useState(false)
  if (entry.kind === 'folder') return <span className="flex size-9 shrink-0 items-center justify-center text-warning"><Folder className="size-5" /></span>
  if (entry.mimeType?.startsWith('image/') && !failed) return <img src={storedFileThumbnailUrl(entry.id)} alt="" loading="lazy" onError={() => setFailed(true)} className="size-9 shrink-0 rounded-sm object-cover" />
  return <ExtensionTile name={entry.name} className="h-10 w-8" />
}

/** The writer's file store: folders on the left, files with type tiles on the right. */
export function AttachFilesTab({ selected, setSelected }: { selected: AttachItem[]; setSelected: Dispatch<SetStateAction<AttachItem[]>> }) {
  const { t, formatDate } = useI18n()
  const foldersQuery = useQuery({ queryKey: [...FILES_QUERY_KEY, 'folders', 'attach'], queryFn: () => listStoredFolders() })
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data])
  const [parentId, setParentId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const search = useDebouncedValue(input.trim())
  const listing = useInfiniteQuery({
    queryKey: [...FILES_QUERY_KEY, 'attach', parentId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => listStoredFiles(parentId, pageParam),
    getNextPageParam: (last) => last.offset + last.entries.length < last.total && last.entries.length > 0 ? last.offset + last.entries.length : undefined,
    enabled: !search,
  })
  const found = useQuery({ queryKey: [...FILES_QUERY_KEY, 'attach-search', search], queryFn: () => searchStoredFiles(search), enabled: Boolean(search) })
  const entries = search
    ? (found.data?.hits ?? []).map((hit) => ({ entry: hit.entry, path: hit.path }))
    : (listing.data?.pages.flatMap((page) => page.entries) ?? []).map((entry) => ({ entry, path: null as string | null }))
  const active = search ? found : listing
  const orderByKey = new Map(selected.map((item, index) => [item.key, index + 1]))
  const toggle = (entry: StoredFileEntry) => setSelected((current) => current.some((item) => item.key === attachKey.file(entry.id))
    ? current.filter((item) => item.key !== attachKey.file(entry.id))
    : [...current, { kind: 'file', key: attachKey.file(entry.id), id: entry.id, name: entry.name, mimeType: entry.mimeType }])

  const side = (
    <div className="space-y-1">
      <SidebarItem icon={HardDrive} label={t({ ko: '내 파일', en: 'My files' })} active={parentId === null} onClick={() => { setParentId(null); setInput('') }} />
      {folders.length ? <div className="border-t border-line pt-1">
        <HierarchyNav<StoredFileEntry>
          items={folders} expandable selectedId={parentId}
          onSelect={(folder) => { setParentId(folder.id); setInput('') }}
          getId={(folder) => folder.id} getParentId={(folder) => folder.parentId}
          sortItems={(left, right) => left.name.localeCompare(right.name)}
          renderIcon={() => <Folder className="size-4 text-warning" />}
          getLabel={(folder) => <span className="block truncate">{folder.name}</span>}
        />
      </div> : null}
    </div>
  )

  return (
    <TwoPane sidebar={side} sidebarLabel={t({ ko: '폴더', en: 'Folders' })}>
      <TwoPaneToolbar>
        <SearchField className="min-w-40 flex-1" value={input} onChange={setInput} placeholder={t({ ko: '파일 이름·내용', en: 'File name or text' })} />
      </TwoPaneToolbar>
      <div className="min-h-0 flex-1 overflow-y-auto px-(--page-gutter) pb-2">
        {active.isPending ? <div className="flex justify-center py-8"><Spinner label={t({ ko: '불러오는 중', en: 'Loading' })} /></div>
          : active.isError && !entries.length ? <ErrorState size="compact" className="mt-2" title={t({ ko: '파일을 불러오지 못했어.', en: 'Could not load files.' })} error={active.error} onRetry={() => void active.refetch()} />
          : !entries.length ? <EmptyState title={search ? t({ ko: '찾은 파일이 없어', en: 'No matching files' }) : t({ ko: '빈 폴더야', en: 'Empty folder' })} />
          : entries.map(({ entry, path }) => {
            const folder = entry.kind === 'folder'
            const position = orderByKey.get(attachKey.file(entry.id))
            return (
              <ListRow key={entry.id} asChild interactive selected={Boolean(position)}
                leading={<FileThumb entry={entry} />}
                trailing={folder ? null : <span className="flex items-center gap-3">
                  <span className="hidden w-20 text-right text-xs tabular-nums text-muted-foreground sm:block">{formatFileSize(entry.size)}</span>
                  <span className="hidden w-24 text-right text-xs tabular-nums text-muted-foreground sm:block">{formatDate(new Date(entry.updatedAt))}</span>
                  <PickOrderMark position={position} />
                </span>}>
                <button type="button" aria-pressed={folder ? undefined : Boolean(position)} onClick={() => { if (folder) { setParentId(entry.id); setInput('') } else toggle(entry) }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm"><HighlightText text={entry.name} terms={search} /></span>
                  {path ? <span className="block truncate text-2xs text-muted-foreground">{path}</span> : null}
                </span>
                </button>
              </ListRow>
            )
          })}
        {!search ? <LoadMoreSentinel enabled={Boolean(listing.hasNextPage) && !listing.isFetchingNextPage} onVisible={() => void listing.fetchNextPage()} /> : null}
        {listing.isFetchingNextPage ? <div className="flex justify-center py-3"><Spinner /></div> : null}
      </div>
    </TwoPane>
  )
}
