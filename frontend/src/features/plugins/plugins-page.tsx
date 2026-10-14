import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Files, FolderKanban, History, Puzzle, Settings2, ShieldCheck } from 'lucide-react'
import { ListPager } from '@/components/common/list-pager'
import { PageToolbar } from '@/components/common/page-toolbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { RowGroup } from '@/components/ui/row-group'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { listPlugins, PLUGINS_QUERY_KEY } from '@/lib/api-plugins'
import { getWorkspace } from '@/lib/api-workspaces'
import { cn } from '@/lib/utils'
import type { PluginAppRequest } from '@conai/shared'
import { PluginAppRequestList, usePendingAppRequests, usePluginAppRequests } from './plugin-app-requests'
import { PluginReviewModal } from './plugin-review'

const HISTORY_PAGE = 20

/** Every app operation plugins asked for, newest first, 20 a page. */
function AppRequestHistory({ open, onClose, pluginName, onReview }: { open: boolean; onClose: () => void; pluginName: (id: string) => string; onReview: (request: PluginAppRequest) => void }) {
  const { t } = useI18n()
  const [offset, setOffset] = useState(0)
  const requests = usePluginAppRequests(offset)
  return (
    <Modal open={open} onClose={onClose} title={t({ ko: '작업 기록', en: 'Operation history' })} size="normal">
      <ModalBody className="space-y-3">
        {requests.isPending ? <LoadingState /> : requests.error ? <ErrorState error={requests.error} onRetry={() => void requests.refetch()} /> : null}
        {requests.data?.requests.length === 0 ? <EmptyState icon={History} title={t({ ko: '아직 작업이 없어', en: 'No operations yet' })} /> : null}
        <div><PluginAppRequestList requests={requests.data?.requests ?? []} pluginName={pluginName} onReview={onReview} /></div>
        <ListPager hasPrevious={offset > 0} hasNext={requests.data?.nextOffset != null} onPrevious={() => setOffset(Math.max(0, offset - HISTORY_PAGE))} onNext={() => setOffset(requests.data!.nextOffset!)} />
      </ModalBody>
    </Modal>
  )
}

/** The plugin launcher: operations waiting for approval, then every page of the enabled plugins. */
export function PluginsPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const auth = useAuthStatusQuery()
  const plugins = useQuery({ queryKey: PLUGINS_QUERY_KEY, queryFn: listPlugins })
  const requests = usePendingAppRequests()
  const [history, setHistory] = useState(false)
  // The request opened for review (from the list or the history), so the modal always shows that one.
  const [review, setReview] = useState<PluginAppRequest | null>(null)
  const closeReview = useCallback(() => setReview(null), [])
  const files = params.get('files') ?? ''
  const projectId = params.get('project') ?? ''
  const project = useQuery({ queryKey: ['workspaces', projectId, 'plugin-context'], queryFn: () => getWorkspace(projectId), enabled: !!projectId })
  const contextParams = new URLSearchParams()
  if (files) contextParams.set('files', files)
  if (projectId) contextParams.set('project', projectId)
  const clearContext = (key: 'files' | 'project') => setParams((previous) => { const next = new URLSearchParams(previous); next.delete(key); return next })
  const enabled = (plugins.data ?? []).filter((plugin) => plugin.enabled)
  const pluginName = (id: string) => plugins.data?.find((plugin) => plugin.manifest.id === id)?.manifest.name ?? id
  const pending = (requests.data?.requests ?? []).filter((request) => request.status === 'pending')
  const fileCount = files ? files.split(',').filter(Boolean).length : 0
  const pages = enabled.flatMap(({ manifest }) => manifest.pages.map((page) => {
    // A page opened with a project needs project access; one opened with files needs file access.
    const blocked = (projectId || fileCount) && !auth.data?.permissionKeys.includes('files.view')
      ? t({ ko: '파일 조회 권한이 필요해', en: 'File access required' }) : null
    return { manifest, page, blocked }
  }))

  return (
    <div className="pb-6">
      <PageToolbar
        title={t({ ko: '플러그인', en: 'Plugins' })}
        start={fileCount || projectId ? (
          <div className="flex flex-wrap items-center gap-1">
            {fileCount ? <Chip tone="muted" onRemove={() => clearContext('files')} removeLabel={t({ ko: '파일 연결 빼기', en: 'Remove files' })}><Files />{t({ ko: '파일 {count}개', en: '{count} files' }, { count: fileCount })}</Chip> : null}
            {projectId ? <Chip tone="muted" onRemove={() => clearContext('project')} removeLabel={t({ ko: '프로젝트 연결 빼기', en: 'Remove project' })}><FolderKanban />{project.data?.name ?? '…'}</Chip> : null}
          </div>
        ) : null}
        actions={(
          <>
            <IconButton variant="ghost" label={t({ ko: '작업 기록', en: 'Operation history' })} onClick={() => setHistory(true)}><History /></IconButton>
            {auth.data?.isAdmin ? <IconButton variant="ghost" label={t({ ko: '플러그인 관리', en: 'Manage plugins' })} onClick={() => navigate('/settings?section=plugins')}><Settings2 /></IconButton> : null}
          </>
        )}
      />
      <div className="space-y-8">
        {pending.length ? (
          <RowGroup heading={t({ ko: '승인 대기', en: 'Awaiting approval' })} count={pending.length} headingClassName="text-warning">
            {pending.map((request) => (
              <ListRow
                key={request.id}
                size="lg"
                leading={<ShieldCheck className="size-4 text-warning" aria-hidden />}
                trailing={<Button size="sm" variant="secondary" onClick={() => setReview(request)}>{t({ ko: '검토', en: 'Review' })}</Button>}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-2"><span className="truncate font-semibold">{request.label}</span>{request.scope === 'generate' ? <Badge variant="warning">{t({ ko: '비용 발생', en: 'Costs' })}</Badge> : null}</span>
                  <span className="truncate text-xs text-muted-foreground">{[pluginName(request.pluginId), request.project?.name, request.tool].filter(Boolean).join(' · ')}</span>
                </span>
              </ListRow>
            ))}
          </RowGroup>
        ) : null}

        {plugins.isPending ? <LoadingState /> : plugins.error ? <ErrorState error={plugins.error} onRetry={() => void plugins.refetch()} /> : pages.length === 0 ? (
          <EmptyState icon={Puzzle} title={t({ ko: '쓸 수 있는 플러그인이 없어', en: 'No plugins available' })} />
        ) : (
          <RowGroup heading={t({ ko: '도구', en: 'Tools' })} count={pages.length}>
            {pages.map(({ manifest, page, blocked }) => (
              <ListRow
                key={`${manifest.id}/${page.id}`}
                asChild
                interactive
                size="lg"
                className={cn(blocked && 'opacity-50')}
                leading={<Puzzle className="size-4 text-muted-foreground" aria-hidden />}
                trailing={<ChevronRight className="size-4" aria-hidden />}
              >
                <button type="button" disabled={!!blocked} onClick={() => navigate(`/ext/${manifest.id}/${page.id}${contextParams.size ? `?${contextParams.toString()}` : ''}`)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-2"><span className="truncate font-semibold">{page.title}</span>{blocked ? <Chip size="sm" tone="muted">{blocked}</Chip> : null}</span>
                    <span className="truncate text-xs text-muted-foreground">{manifest.name}</span>
                  </span>
                </button>
              </ListRow>
            ))}
          </RowGroup>
        )}
      </div>
      <AppRequestHistory open={history} onClose={() => setHistory(false)} pluginName={pluginName} onReview={(request) => { setHistory(false); setReview(request) }} />
      <PluginReviewModal
        open={review !== null}
        onClose={closeReview}
        proposals={[]}
        requests={review && !pending.some((request) => request.id === review.id) ? [review, ...pending] : pending}
        initialKey={review ? `r:${review.id}` : null}
        busy={false}
        closed={false}
        onApply={() => undefined}
        onDiscard={() => undefined}
      />
    </div>
  )
}
