import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Code, Download, ExternalLink, FileText, Puzzle, ServerCog, Trash2, Upload, Webhook, Wrench } from 'lucide-react'
import type { InstalledPlugin, PluginInstallResult, PluginServerStatus } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { ResourceRow, ResourceRowStat, ResourceRowStatus } from '@/components/ui/resource-row'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { SwitchLine } from '@/components/ui/switch-line'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { useI18n } from '@/i18n'
import { listPlugins, pluginRequest, PLUGINS_QUERY_KEY } from '@/lib/api-plugins'
import { getErrorMessage } from '@/lib/error-message'
import { PluginRuntimeSummary } from './plugin-capabilities'
import { PluginAuthoring } from './plugin-authoring'
import { createPluginDraft, downloadPluginPackage, PLUGIN_DRAFTS_QUERY_KEY } from '@/lib/api-plugin-authoring'
import { createRandomUuid } from '@/lib/random-uuid'

/** Settings › 플러그인 관리 and the 플러그인 page: install a package, switch plugins on and off, see what each may do, remove one. */
export function PluginManagement() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [, setParams] = useSearchParams()
  const cache = useQueryClient()
  const confirm = useConfirm()
  const auth = useAuthStatusQuery()
  const isAdmin = auth.data?.isAdmin === true
  const { showSnackbar } = useSnackbar()
  // A server module comes up a moment after it is turned on: `plugin.server.changed` follows it; polling is the stream fallback.
  const { status: streamStatus } = useRuntimeEventStream()
  const plugins = useQuery({ queryKey: PLUGINS_QUERY_KEY, queryFn: listPlugins, refetchInterval: (query) => resolveStreamFallbackInterval(streamStatus, query.state.data?.some((plugin) => plugin.server?.state === 'starting') ? 1000 : false) })
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<string | null>(null)
  const opened = plugins.data?.find((plugin) => plugin.manifest.id === detail) ?? null
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await operation(); await plugins.refetch() }
    catch (reason) { setError(getErrorMessage(reason, t({ ko: '플러그인 작업에 실패했어.', en: 'Plugin operation failed.' }))) }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = '' }
  }
  const setEnabled = (plugin: InstalledPlugin, enabled: boolean) => run(async () => {
    const { manifest } = plugin
    await pluginRequest(`/${manifest.id}/enabled`, 'PUT', { enabled })
  })
  const install = (file: File) => run(async () => {
    const body = new FormData(); body.append('package', file)
    const result = await pluginRequest<PluginInstallResult>('/install', 'POST', body)
    const { name, version } = result.plugin.manifest
    showSnackbar({
      tone: result.reenable ? 'error' : 'info',
      message: result.reenable
        ? t({ ko: '{name} {version}로 복구했어. 다시 켜줘.', en: 'Recovered {name} to {version}. Enable it again.' }, { name, version })
        : result.updated ? t({ ko: '{name} {version}로 업데이트했어.', en: 'Updated {name} to {version}.' }, { name, version }) : t({ ko: '{name}을 설치했어.', en: 'Installed {name}.' }, { name }),
    })
  })
  const remove = (plugin: InstalledPlugin) => run(async () => {
    const description = plugin.manifest.server
      ? t({ ko: '플러그인 코드와 플러그인 데이터를 지워. 파일함의 결과 파일은 남아.', en: 'Removes the plugin code and its data. Your files are kept.' })
      : t({ ko: '플러그인 코드를 지워. 파일함의 결과 파일은 남아.', en: 'Removes the plugin code. Your files are kept.' })
    if (!await confirm({ title: t({ ko: '{name} 제거', en: 'Remove {name}' }, { name: plugin.manifest.name }), description, confirmLabel: t({ ko: '제거', en: 'Remove' }), tone: 'destructive' })) return
    await pluginRequest(`/${plugin.manifest.id}`, 'DELETE')
    setDetail(null)
  })

  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <RowGroup
        heading={t({ ko: '설치한 플러그인', en: 'Installed plugins' })}
        count={plugins.data?.length}
        actions={isAdmin ? (
          <>
            <input ref={fileInput} type="file" accept=".zip" className="hidden" aria-label={t({ ko: '플러그인 패키지', en: 'Plugin package' })} onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void install(file)
            }} />
            <IconButton size="icon-sm" variant="ghost" disabled={busy} label={t({ ko: '패키지 설치 (.zip)', en: 'Install package (.zip)' })} onClick={() => fileInput.current?.click()}><Upload /></IconButton>
          </>
        ) : undefined}
      >
        {plugins.error ? <ErrorState error={plugins.error} onRetry={() => void plugins.refetch()} /> : null}
        {plugins.data?.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t({ ko: '아직 설치한 플러그인이 없어.', en: 'No plugins installed yet.' })}</p> : null}
        {plugins.data?.map((plugin) => {
          const { manifest, enabled } = plugin
          return (
            <ResourceRow
              key={manifest.id}
              className={enabled ? undefined : '[&_[data-slot=resource-row-leading]]:opacity-50'}
              leading={<Puzzle />}
              name={manifest.name}
              extra={(
                <>
                  <Chip size="sm" tone="muted" className="font-mono">{manifest.version}</Chip>
                  {plugin.server?.state === 'error' ? <ResourceRowStatus tone="destructive" tip={plugin.server.error}>{t({ ko: '서버 오류', en: 'Server error' })}</ResourceRowStatus> : null}
                </>
              )}
              aside={(
                <>
                  <ResourceRowStat icon={FileText} tip={manifest.pages.map((page) => page.title).join(', ')}>{manifest.pages.length}</ResourceRowStat>
                  {plugin.server ? <ResourceRowStat icon={ServerCog} tip={serverStateLabel(plugin.server, t)}>{plugin.server.tools.length}</ResourceRowStat> : null}
                </>
              )}
              trailing={isAdmin ? <Switch checked={enabled} disabled={busy} aria-label={t({ ko: '{name} 켜기', en: 'Enable {name}' }, { name: manifest.name })} onCheckedChange={(value) => void setEnabled(plugin, value)} /> : undefined}
              onOpen={() => setDetail(manifest.id)}
              openLabel={t({ ko: '자세히', en: 'Details' })}
            />
          )
        })}
      </RowGroup>

      {isAdmin ? <PluginAuthoring /> : null}

      <Modal open={opened !== null} onClose={() => setDetail(null)} title={opened ? <span className="flex items-center gap-2">{opened.manifest.name}<Chip size="sm" tone="muted" className="font-mono">{opened.manifest.version}</Chip></span> : ''} widthClassName="max-w-lg">
        {opened ? (
          <>
            <ModalBody className="space-y-5">
              {opened.manifest.description ? <p className="text-sm">{opened.manifest.description}</p> : null}
              <PluginRuntimeSummary server={Boolean(opened.manifest.server)} />
              {opened.server ? (
                <RowGroup heading={t({ ko: '서버', en: 'Server' })} actions={<span className={opened.server.state === 'error' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{serverStateLabel(opened.server, t)}</span>}>
                  {opened.server.error ? <p className="py-1.5 font-mono text-xs break-all text-destructive">{opened.server.error}</p> : null}
                  {opened.server.tools.map((tool) => (
                    <ListRow key={tool.name} size="sm" leading={<Wrench className="size-4 text-muted-foreground" aria-hidden />}>
                      <span className="truncate font-mono text-xs" title={tool.description}>{tool.name}</span>
                    </ListRow>
                  ))}
                  {opened.server.hooks.map((hook) => (
                    <ListRow key={hook} size="sm" leading={<Webhook className="size-4 text-muted-foreground" aria-hidden />}>
                      <span className="truncate font-mono text-xs">{hook}</span>
                    </ListRow>
                  ))}
                </RowGroup>
              ) : null}
              <RowGroup heading={t({ ko: '페이지', en: 'Pages' })}>
                {opened.manifest.pages.map((page) => (
                  <ListRow
                    key={page.id}
                    size="sm"
                    leading={<FileText className="size-4 text-muted-foreground" aria-hidden />}
                    trailing={(
                      <>
                        {page.accepts.length ? <span className="text-xs">{page.accepts.join(' ')}</span> : null}
                        <IconButton size="icon-sm" variant="ghost" disabled={!opened.enabled} label={t({ ko: '열기', en: 'Open' })} onClick={() => navigate(`/ext/${opened.manifest.id}/${page.id}`)}><ExternalLink /></IconButton>
                      </>
                    )}
                  >
                    <span className="truncate font-semibold">{page.title}</span>
                  </ListRow>
                ))}
              </RowGroup>
            </ModalBody>
            {isAdmin ? (
              <ModalFooter>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(async () => {
                  const draft = await createPluginDraft({ requestId: createRandomUuid(), pluginId: opened.manifest.id, fromInstalled: true })
                  await cache.invalidateQueries({ queryKey: PLUGIN_DRAFTS_QUERY_KEY })
                  setDetail(null)
                  // The editor follows ?draft= on whichever page holds this list.
                  setParams((previous) => { const next = new URLSearchParams(previous); next.set('draft', draft.id); return next })
                })}><Code />{t({ ko: '소스 수정', en: 'Edit source' })}</Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => downloadPluginPackage(`${opened.manifest.id}-${opened.manifest.version}.zip`, { pluginId: opened.manifest.id }))}><Download />{t({ ko: 'ZIP 내보내기', en: 'Export ZIP' })}</Button>
                <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove(opened)}><Trash2 />{t({ ko: '제거', en: 'Remove' })}</Button>
                <span className="flex-1" />
                <SwitchLine label={t({ ko: '켜짐', en: 'Enabled' })} checked={opened.enabled} disabled={busy} onCheckedChange={(value) => void setEnabled(opened, value)} />
              </ModalFooter>
            ) : null}
          </>
        ) : null}
      </Modal>
    </div>
  )
}

function serverStateLabel(server: PluginServerStatus, t: ReturnType<typeof useI18n>['t']) {
  if (server.state === 'ready') return t({ ko: '실행 중', en: 'Running' })
  if (server.state === 'starting') return t({ ko: '시작하는 중', en: 'Starting' })
  if (server.state === 'error') return t({ ko: '오류', en: 'Error' })
  return t({ ko: '꺼짐', en: 'Off' })
}
