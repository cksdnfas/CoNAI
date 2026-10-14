import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { PluginAppRequest } from '@conai/shared'
import { pluginRequest } from '@/lib/api-plugins'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ui/code-block'
import { DisclosureButton } from '@/components/ui/disclosure-button'
import { ListRow } from '@/components/ui/list-row'
import { useRuntimeJob } from '@/lib/use-runtime-job'
import { getErrorMessage } from '@/lib/error-message'
import { useI18n } from '@/i18n'

export const APP_REQUESTS_KEY = ['plugin-app-requests']
type AppRequestPage = { requests: PluginAppRequest[]; nextOffset: number | null }
/** The history, 20 a page, newest first. */
export function usePluginAppRequests(offset = 0) {
  return useQuery({ queryKey: [...APP_REQUESTS_KEY, offset], queryFn: () => pluginRequest<AppRequestPage>(`/app-requests?offset=${offset}`) })
}
/** Every request still waiting for approval, however old. */
export function usePendingAppRequests() {
  return useQuery({ queryKey: [...APP_REQUESTS_KEY, 'pending'], queryFn: () => pluginRequest<AppRequestPage>('/app-requests?status=pending') })
}
/** These requests (the ones a plugin window started), wherever they are in the history. */
export function useAppRequestsById(ids: string[]) {
  return useQuery({ queryKey: [...APP_REQUESTS_KEY, 'ids', ids], queryFn: () => pluginRequest<AppRequestPage>(`/app-requests?ids=${ids.join(',')}`), enabled: ids.length > 0 })
}

/** App operation states in the app's words. */
export function useAppRequestStatus() {
  const { t } = useI18n()
  return (status: PluginAppRequest['status']) => t(({
    pending: { ko: '대기', en: 'Pending' },
    starting: { ko: '시작 중', en: 'Starting' },
    running: { ko: '실행 중', en: 'Running' },
    completed: { ko: '완료', en: 'Completed' },
    failed: { ko: '실패', en: 'Failed' },
    cancelled: { ko: '취소됨', en: 'Cancelled' },
  } as const)[status] ?? { ko: status, en: status })
}

/** Apply or cancel an app operation (the one place that calls the server for it). */
export function useAppRequestActions() {
  const { t } = useI18n()
  const query = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const run = async (id: string, action: 'apply' | 'cancel') => {
    setBusy(id); setError('')
    try {
      await pluginRequest(`/app-requests/${id}/${action}`, 'POST')
      await query.invalidateQueries({ queryKey: APP_REQUESTS_KEY })
      return true
    } catch (reason) {
      setError(getErrorMessage(reason, t({ ko: '앱 작업을 처리하지 못했어.', en: 'Could not process the app operation.' })))
      return false
    } finally { setBusy(null) }
  }
  return { run, busy, error }
}

/** Follows an app operation's runtime job while mounted; reports its result once it completes. */
export function AppRequestJob({ jobId, onFinished, showProgress = true }: { jobId: string; onFinished?: (result: unknown) => void; showProgress?: boolean }) {
  const query = useQueryClient()
  const finish = () => { void query.invalidateQueries({ queryKey: APP_REQUESTS_KEY }) }
  const { job } = useRuntimeJob(jobId, { onCompleted: job => { finish(); onFinished?.(job.result) }, onFailed: finish, onCancelled: finish })
  if (!showProgress || !job) return null
  return <p className="text-xs text-muted-foreground">{job.progress.currentLabel ?? `${job.progress.processed} / ${job.progress.total}`}</p>
}

function AppResult({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false)
  const { t } = useI18n()
  const result = useQuery({ queryKey: ['plugin-app-result', requestId], queryFn: () => pluginRequest<PluginAppRequest>(`/app-requests/${requestId}`), enabled: open })
  return <div>
    <DisclosureButton open={open} onClick={() => setOpen(value => !value)}>{t({ ko: '실행 결과', en: 'Result' })}</DisclosureButton>
    {open ? <CodeBlock maxHeight="md" wrap>{result.error ? String(result.error) : JSON.stringify(result.data?.result ?? null, null, 2)}</CodeBlock> : null}
  </div>
}

/** What a pending operation will run: the cost warning (generation only) and its exact inputs. */
export function AppRequestDetail({ request }: { request: PluginAppRequest }) {
  const { t } = useI18n()
  return <div className="space-y-3">
    {request.status === 'pending' && request.scope === 'generate' ? <Alert variant="warning"><TriangleAlert /><AlertDescription>{t({ ko: '적용하면 이 요청대로 생성해. 유료 서비스 비용이 생길 수 있어.', en: 'Apply runs this generation request and may incur service costs.' })}</AlertDescription></Alert> : null}
    <CodeBlock maxHeight="md" wrap>{JSON.stringify(request.arguments, null, 2)}</CodeBlock>
    {request.error ? <p role="alert" className="text-sm text-destructive">{request.error}</p> : null}
    {request.status === 'completed' ? <AppResult requestId={request.id} /> : null}
  </div>
}

/** Every app operation (history): label, plugin · tool · project, state; pending ones open the review, live ones can be cancelled. */
export function PluginAppRequestList({ requests, onReview, pluginName }: { requests: PluginAppRequest[]; onReview?: (request: PluginAppRequest) => void; pluginName?: (id: string) => string }) {
  const { t } = useI18n()
  const status = useAppRequestStatus()
  const { run, busy, error } = useAppRequestActions()
  return <>
    {error ? <p role="alert" className="py-2 text-sm text-destructive">{error}</p> : null}
    {requests.map(request => <ListRow
      key={request.id}
      size="lg"
      trailing={<>
        <Badge variant={request.status === 'failed' ? 'destructive' : request.status === 'pending' ? 'warning' : 'secondary'}>{status(request.status)}</Badge>
        {request.status === 'pending' && onReview ? <Button size="sm" variant="secondary" onClick={() => onReview(request)}>{t({ ko: '검토', en: 'Review' })}</Button> : null}
        {['starting', 'running'].includes(request.status) ? <Button size="sm" variant="ghost" disabled={busy === request.id} onClick={() => void run(request.id, 'cancel')}>{t({ ko: '취소', en: 'Cancel' })}</Button> : null}
      </>}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-semibold">{request.label}</span>
        <span className="truncate text-xs text-muted-foreground">{[pluginName?.(request.pluginId) ?? request.pluginId, request.tool, request.project?.name].filter(Boolean).join(' · ')}</span>
        {request.error ? <span className="truncate text-xs text-destructive">{request.error}</span> : null}
        {request.jobId && ['starting', 'running'].includes(request.status) ? <AppRequestJob jobId={request.jobId} /> : null}
      </span>
    </ListRow>)}
  </>
}
