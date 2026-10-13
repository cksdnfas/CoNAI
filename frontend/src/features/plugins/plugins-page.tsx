import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { EmptyState } from '@/components/ui/empty-state'
import { PageToolbar } from '@/components/common/page-toolbar'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/i18n'
import { listPlugins, pluginRequest, PLUGINS_QUERY_KEY } from '@/lib/api-plugins'

export function PluginsPage() {
  const { t } = useI18n()
  const plugins = useQuery({ queryKey: PLUGINS_QUERY_KEY, queryFn: listPlugins })
  const auth = useAuthStatusQuery()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const fileInput = useRef<HTMLInputElement>(null)
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await operation(); await plugins.refetch() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = '' }
  }
  return <div className="px-4 pb-6">
    <PageToolbar title={t({ ko: '확장', en: 'Extensions' })} actions={auth.data?.isAdmin ? <Button disabled={busy} onClick={() => fileInput.current?.click()}>{t({ ko: '패키지 설치', en: 'Install package' })}</Button> : null} />
    {auth.data?.isAdmin ? <Input ref={fileInput} type="file" accept=".zip" className="hidden" aria-label={t({ ko: '확장 ZIP', en: 'Extension ZIP' })} onChange={(event) => {
      const file = event.target.files?.[0]
      if (!file) return
      const body = new FormData(); body.append('package', file)
      void run(() => pluginRequest('/install', 'POST', body))
    }} /> : null}
    {error ? <p role="alert" className="py-3 text-sm text-destructive">{error}</p> : null}
    {plugins.isPending ? <LoadingState /> : plugins.error ? <ErrorState error={plugins.error} /> : null}
    {plugins.data?.length === 0 ? <EmptyState title={t({ ko: '설치된 확장이 없어', en: 'No extensions installed' })} description={t({ ko: '관리자가 필요한 확장 패키지를 설치하면 여기서 열 수 있어.', en: 'An administrator can install the extensions you need.' })} /> : null}
    {plugins.data?.map(({ manifest, enabled }) => <section key={manifest.id} className="border-b border-line py-4 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-sm font-semibold">{manifest.name} <span className="font-normal text-muted-foreground">{manifest.version}</span></h2><p className="mt-1 text-sm text-muted-foreground">{manifest.description}</p></div>
        {auth.data?.isAdmin ? <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => void run(async () => {
            if (!enabled && !await confirm({ title: t({ ko: '확장 활성화', en: 'Enable extension' }), description: `${manifest.name}\n${manifest.capabilities.map((capability) => t(capability === 'files.read' ? { ko: '선택한 텍스트 파일 읽기', en: 'Read selected text files' } : capability === 'files.write' ? { ko: '선택한 파일의 저장 제안', en: 'Propose changes to selected files' } : { ko: '선택한 미디어 보기', en: 'View selected media' })).join('\n')}`, confirmLabel: t({ ko: '활성화', en: 'Enable' }) })) return
            await pluginRequest(`/${manifest.id}/enabled`, 'PUT', { enabled: !enabled })
          })}>{t(enabled ? { ko: '비활성화', en: 'Disable' } : { ko: '활성화', en: 'Enable' })}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void run(async () => {
            if (await confirm({ title: t({ ko: '확장 제거', en: 'Remove extension' }), description: t({ ko: '확장 코드를 제거해. 파일함의 결과 파일은 유지돼.', en: 'Remove the extension code. Your files are kept.' }), confirmLabel: t({ ko: '제거', en: 'Remove' }), tone: 'destructive' })) await pluginRequest(`/${manifest.id}`, 'DELETE')
          })}>{t({ ko: '제거', en: 'Remove' })}</Button>
        </div> : null}
      </div>
      {enabled ? <div className="mt-3 flex flex-wrap gap-2">{manifest.pages.map((page) => <Button key={page.id} variant="secondary" onClick={() => navigate(`/ext/${manifest.id}/${page.id}${params.get('files') ? `?files=${encodeURIComponent(params.get('files')!)}` : ''}`)}>{page.title}</Button>)}</div> : <p className="mt-2 text-xs text-muted-foreground">{t({ ko: '비활성화됨', en: 'Disabled' })}</p>}
    </section>)}
  </div>
}
