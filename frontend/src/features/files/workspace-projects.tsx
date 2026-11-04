import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Check, ChevronDown, FolderKanban, Plus } from 'lucide-react'
import type { WorkspaceSummary } from '@conai/shared'
import { SearchField } from '@/components/common/search-field'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { EditorFooter } from '@/components/ui/editor-footer'
import { SidebarGroupLabel, SidebarItem } from '@/components/ui/sidebar'
import { SwitchLine } from '@/components/ui/switch-line'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { listWorkspaces } from '@/lib/api-workspaces'
import { cn } from '@/lib/utils'

const PAGE = 50

/** Projects newest first, 50 at a time (`loadMore` for the next 50). The list is shared by every project screen. */
export function useWorkspaceProjects(enabled = true) {
  const auth = useAuthStatusQuery()
  const account = auth.data?.accountId ?? 'bootstrap'
  const query = useInfiniteQuery({
    queryKey: ['workspaces', 'list', account, 'pages'],
    queryFn: ({ pageParam }) => listWorkspaces(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, offset) => (last.length > PAGE ? offset + PAGE : undefined),
    enabled,
  })
  const projects: WorkspaceSummary[] = query.data?.pages.flatMap((page) => page.slice(0, PAGE)) ?? []
  return { projects, query, hasMore: query.hasNextPage, loadMore: () => void query.fetchNextPage() }
}

/** Files sidebar group: every project, + to create one, and "더 보기" past the first 50. */
export function WorkspaceSidebarGroup({ activeId, onOpen, onCreate }: { activeId: string | null; onOpen: (id: string) => void; onCreate?: () => void }) {
  const { t } = useI18n()
  const { projects, hasMore, loadMore, query } = useWorkspaceProjects()
  return (
    <>
      <SidebarGroupLabel actions={onCreate ? <Button size="compact" variant="ghost" aria-label={t({ ko: '새 작업 공간', en: 'New workspace' })} onClick={onCreate}><Plus />{t({ ko: '추가', en: 'Add' })}</Button> : undefined}>
        {t({ ko: '작업 공간', en: 'Workspaces' })}
      </SidebarGroupLabel>
      {projects.map((project) => <SidebarItem key={project.id} icon={FolderKanban} label={project.name} active={project.id === activeId} onClick={() => onOpen(project.id)} />)}
      {hasMore ? <SidebarItem icon={ChevronDown} label={t({ ko: '더 보기', en: 'More' })} disabled={query.isFetchingNextPage} onClick={(event) => { event.preventDefault(); loadMore() }} /> : null}
    </>
  )
}

/**
 * Choose the project a chat or a plugin works in (or none), and whether it may save. Search filters the loaded
 * projects; "더 보기" loads the next 50. `writeLabel` null hides the write switch.
 */
export function WorkspaceProjectPicker({ open, onClose, projectId, write, writeLabel, onConnect, busy = false, title, noneLabel, exclude }: {
  open: boolean
  onClose: () => void
  projectId: string | null
  write: boolean
  writeLabel: string | null
  onConnect: (projectId: string | null, write: boolean) => void | Promise<void>
  busy?: boolean
  title?: string
  /** The first row, which connects no project (default: 연결 안 함); null leaves it out, for adding one more. */
  noneLabel?: string | null
  /** Projects already connected, left out of the list. */
  exclude?: ReadonlySet<string>
}) {
  const { t } = useI18n()
  const { projects, hasMore, loadMore, query } = useWorkspaceProjects(open)
  const [selected, setSelected] = useState(projectId)
  const [allowWrite, setAllowWrite] = useState(write)
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (!open) return
    setSelected(projectId)
    setAllowWrite(write)
    setSearch('')
  }, [open, projectId, write])
  const term = search.trim().toLowerCase()
  const shown = projects.filter((project) => !exclude?.has(project.id) && (!term || project.name.toLowerCase().includes(term)))
  const row = (id: string | null, label: string, icon: boolean) => (
    <ListRow
      key={id ?? 'none'}
      asChild
      interactive
      size="sm"
      selected={selected === id}
      leading={<Check className={cn('size-4 text-primary-text', selected === id ? 'opacity-100' : 'opacity-0')} aria-hidden />}
    >
      <button type="button" role="radio" aria-checked={selected === id} onClick={() => setSelected(id)}>
        {icon ? <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <span className={cn('truncate', id === null && 'text-muted-foreground')}>{label}</span>
      </button>
    </ListRow>
  )
  return (
    <Modal open={open} onClose={() => { if (!busy) onClose() }} title={title ?? t({ ko: '작업 공간 연결', en: 'Connect a workspace' })} size="md">
      <ModalBody spacing="sm">
        <SearchField value={search} onChange={setSearch} placeholder={t({ ko: '작업 공간 찾기', en: 'Find a workspace' })} />
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        <div role="radiogroup" aria-label={t({ ko: '작업 공간', en: 'Workspace' })} className="max-h-72 overflow-y-auto">
          {term || noneLabel === null ? null : row(null, noneLabel ?? t({ ko: '연결 안 함', en: 'Not connected' }), false)}
          {shown.map((project) => row(project.id, project.name, true))}
          {query.isPending ? <LoadingState /> : null}
          {hasMore ? <Button variant="ghost" size="sm" className="w-full" disabled={query.isFetchingNextPage} onClick={loadMore}>{t({ ko: '더 보기', en: 'More' })}</Button> : null}
        </div>
        {writeLabel !== null && selected !== null ? <SwitchLine label={writeLabel} checked={allowWrite} onCheckedChange={setAllowWrite} /> : null}
      </ModalBody>
      <EditorFooter onSave={() => void onConnect(selected, selected !== null && writeLabel !== null && allowWrite)} canSave={noneLabel !== null || selected !== null} saving={busy} saveLabel={t({ ko: '연결', en: 'Connect' })} />
    </Modal>
  )
}
