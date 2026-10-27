import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Code, Download, ExternalLink, FileText, GitBranch, Puzzle, RefreshCw, ServerCog, Trash2, Upload, Webhook, Wrench } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import type { InstalledPlugin, PluginInstallResult, PluginServerStatus, PluginSourceProvider } from '@conai/shared'
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
import { Text } from '@/components/ui/text'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { pageAction, pageChoice, pageFreeText, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { resolveStreamFallbackInterval } from '@/features/runtime-events/runtime-event-fallback'
import { useRuntimeEventStream } from '@/features/runtime-events/use-runtime-event-stream'
import { useI18n } from '@/i18n'
import { checkPluginSources, listPlugins, pluginRequest, PLUGINS_QUERY_KEY, unlinkPluginSource } from '@/lib/api-plugins'
import { getErrorMessage } from '@/lib/error-message'
import { PluginRuntimeSummary } from './plugin-capabilities'
import { PluginAuthoring, type PluginManagementPage } from './plugin-authoring'
import { PluginSourceInstall, usePluginSourceInstall } from './plugin-source-install'
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
  const showInstallResult = (result: PluginInstallResult) => {
    const { name, version } = result.plugin.manifest
    showSnackbar({
      tone: result.reenable ? 'error' : 'info',
      message: result.reenable
        ? t({ ko: '{name} {version}로 복구했어. 다시 켜줘.', en: 'Recovered {name} to {version}. Enable it again.' }, { name, version })
        : result.updated ? t({ ko: '{name} {version}로 업데이트했어.', en: 'Updated {name} to {version}.' }, { name, version }) : t({ ko: '{name}을 설치했어.', en: 'Installed {name}.' }, { name }),
    })
  }
  const install = (file: File) => run(async () => {
    const body = new FormData(); body.append('package', file)
    const result = await pluginRequest<PluginInstallResult>('/install', 'POST', body)
    showInstallResult(result)
  })
  const remove = (plugin: InstalledPlugin) => run(async () => {
    const description = plugin.manifest.server
      ? t({ ko: '플러그인 코드와 플러그인 데이터를 지워. 파일함의 결과 파일은 남아.', en: 'Removes the plugin code and its data. Your files are kept.' })
      : t({ ko: '플러그인 코드를 지워. 파일함의 결과 파일은 남아.', en: 'Removes the plugin code. Your files are kept.' })
    if (!await confirm({ title: t({ ko: '{name} 제거', en: 'Remove {name}' }, { name: plugin.manifest.name }), description, confirmLabel: t({ ko: '제거', en: 'Remove' }), tone: 'destructive' })) return
    await pluginRequest(`/${plugin.manifest.id}`, 'DELETE')
    setDetail(null)
  })
  const sourceInstall = usePluginSourceInstall(async result => {
    showInstallResult(result)
    await plugins.refetch()
  })
  const linked = (plugins.data ?? []).filter(plugin => plugin.source)
  const checking = useRef(false)
  const checkSources = async () => {
    if (busy || sourceInstall.busy || checking.current) throw new Error(t({ ko: '진행 중인 작업이 끝나면 다시 요청해줘.', en: 'Wait for the current operation to finish.' }))
    checking.current = true; setBusy(true); setError('')
    try {
      const results = await checkPluginSources()
      await plugins.refetch()
      const updates = results.filter(result => result.source.updateAvailable && !result.source.checkError).length
      const failed = results.filter(result => result.source.checkError).length
      showSnackbar({
        tone: failed ? 'error' : 'info',
        message: failed
          ? t({ ko: '업데이트 {updates}개를 찾았어. {failed}개는 확인하지 못했어.', en: 'Found {updates} updates. {failed} checks failed.' }, { updates, failed })
          : t({ ko: '업데이트 {count}개를 찾았어.', en: 'Found {count} updates.' }, { count: updates }),
      })
    } catch (reason) {
      setError(getErrorMessage(reason, t({ ko: '업데이트 확인에 실패했어.', en: 'Could not check for updates.' })))
      throw reason
    } finally { checking.current = false; setBusy(false) }
  }
  const reviewLinked = async (plugin: InstalledPlugin) => {
    if (!plugin.source) throw new Error(t({ ko: 'Git에 연결된 플러그인이 아니야.', en: 'This plugin is not linked to Git.' }))
    setDetail(null)
    await sourceInstall.openAndReview(plugin.source, plugin.manifest.id)
  }
  const unlink = (plugin: InstalledPlugin) => run(async () => {
    if (!await confirm({
      title: t({ ko: 'Git 연결 해제', en: 'Unlink Git source' }),
      description: t({ ko: '{name}의 Git 연결만 지워. 설치한 플러그인과 데이터는 그대로 남아.', en: 'Only removes the Git link for {name}. The installed plugin and its data are kept.' }, { name: plugin.manifest.name }),
      confirmLabel: t({ ko: '연결 해제', en: 'Unlink' }),
    })) return
    await unlinkPluginSource(plugin.manifest.id)
  })
  // Page data and arguments never carry URLs (shared page-data rule), so the repository travels as host/owner/repo.
  const sourcePage: PluginManagementPage = {
    localRevision: JSON.stringify([busy, detail, sourceInstall.input, sourceInstall.review?.reviewId, sourceInstall.busy]),
    data: {
      linkedPlugins: linked.slice(0, 80).map(({ manifest, source }) => ({
        pluginId: manifest.id, name: pageFreeText(manifest.name), version: manifest.version,
        repository: source!.url.replace(/^https:\/\//, ''), ref: source!.ref, path: source!.path, commit: source!.commit, latestCommit: source!.latestCommit,
        updateAvailable: source!.updateAvailable, modified: source!.modified, checkError: source!.checkError,
      })),
      linkedPluginCount: linked.length,
      review: sourceInstall.input && sourceInstall.review ? {
        pluginId: sourceInstall.review.pluginId, version: sourceInstall.review.version, commit: sourceInstall.review.source.commit, server: sourceInstall.review.server,
        files: sourceInstall.review.files.filter(file => file.change !== 'unchanged').slice(0, 80).map(file => ({ ...file })),
        skippedCount: sourceInstall.review.skipped.length,
      } : null,
      error: sourceInstall.input ? sourceInstall.error : error,
    },
    actions: [
      pageAction('plugin_source.check', t({ ko: '업데이트 확인', en: 'Check for updates' }), 'Check all linked public Git repositories for updates. Installs nothing.'),
      pageAction('plugin_source.review', t({ ko: 'Git 패키지 검토', en: 'Review Git package' }), 'Open and review a linked plugin by pluginId, or a public HTTPS repository given as host/owner/repo without the scheme (e.g. github.com/owner/repo) with optional provider, ref and folder (the plugin folder in the repository). Installs nothing. Omit provider for github.com, gitlab.com or codeberg.org.', pageObject({
        pluginId: pageText(48), repository: pageText(2000), provider: pageChoice(['github', 'gitlab', 'gitea']), ref: pageText(200), folder: pageText(200),
      })),
      ...(sourceInstall.input && sourceInstall.review ? [pageAction('plugin_source.install', t({ ko: '검토한 패키지 적용', en: 'Apply reviewed package' }), 'Install exactly the displayed Git package review. A new package stays disabled; an enabled update restarts its code.', undefined, 'save')] : []),
    ],
    applyAction: async (id, args) => {
      if (busy || sourceInstall.busy) throw new Error(t({ ko: '진행 중인 작업이 끝나면 다시 요청해줘.', en: 'Wait for the current operation to finish.' }))
      if (id === 'plugin_source.check') await checkSources()
      else if (id === 'plugin_source.review') {
        if (args.pluginId) {
          const plugin = linked.find(item => item.manifest.id === args.pluginId)
          if (!plugin) throw new Error(t({ ko: 'Git에 연결된 플러그인을 찾지 못했어.', en: 'Could not find a linked plugin.' }))
          await reviewLinked(plugin)
        } else {
          if (typeof args.repository !== 'string' || !args.repository.trim()) throw new Error(t({ ko: '플러그인 ID나 저장소 주소를 입력해줘.', en: 'Provide a plugin ID or repository URL.' }))
          setDetail(null)
          await sourceInstall.openAndReview({
            url: `https://${args.repository.trim()}`, provider: args.provider as PluginSourceProvider | undefined,
            ...(typeof args.ref === 'string' ? { ref: args.ref } : {}), ...(typeof args.folder === 'string' ? { path: args.folder } : {}),
          })
        }
      } else if (id === 'plugin_source.install') await sourceInstall.install()
    },
  }

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
            <IconButton size="icon-sm" variant="ghost" disabled={busy || sourceInstall.busy} label={t({ ko: 'Git에서 설치', en: 'Install from Git' })} onClick={() => sourceInstall.open()}><GitBranch /></IconButton>
            {linked.length ? <IconButton size="icon-sm" variant="ghost" disabled={busy || sourceInstall.busy} label={t({ ko: '업데이트 확인', en: 'Check for updates' })} onClick={() => void checkSources().catch(() => undefined)}><RefreshCw /></IconButton> : null}
          </>
        ) : undefined}
      >
        {plugins.error ? <ErrorState error={plugins.error} onRetry={() => void plugins.refetch()} /> : null}
        {plugins.data?.length === 0 ? <EmptyState size="compact" icon={Puzzle} title={t({ ko: '아직 설치한 플러그인이 없어', en: 'No plugins installed yet' })} description={t({ ko: '.zip 패키지나 Git 주소로 설치할 수 있어.', en: 'Install one from a .zip package or a Git address.' })} /> : null}
        {plugins.data?.map((plugin) => {
          const { manifest, enabled } = plugin
          return (
            <ResourceRow
              key={manifest.id}
              leading={<Puzzle className={enabled ? undefined : 'opacity-50'} />}
              name={manifest.name}
              extra={(
                <>
                  <Chip size="sm" tone="muted" mono>{manifest.version}</Chip>
                  {isAdmin && plugin.source?.updateAvailable ? <Chip size="sm">{t({ ko: '업데이트', en: 'Update' })}</Chip> : null}
                  {plugin.server?.state === 'error' ? <ResourceRowStatus tone="destructive" tip={plugin.server.error}>{t({ ko: '서버 오류', en: 'Server error' })}</ResourceRowStatus> : null}
                </>
              )}
              aside={(
                <>
                  <ResourceRowStat icon={FileText} tip={manifest.pages.map((page) => page.title).join(', ')}>{manifest.pages.length}</ResourceRowStat>
                  {plugin.server ? <ResourceRowStat icon={ServerCog} tip={serverStateLabel(plugin.server, t)}>{plugin.server.tools.length}</ResourceRowStat> : null}
                  {isAdmin && plugin.source ? <ResourceRowStat icon={GitBranch} tip={`${plugin.source.url}@${plugin.source.ref}`}>Git</ResourceRowStat> : null}
                </>
              )}
              trailing={isAdmin ? <Switch checked={enabled} disabled={busy} aria-label={t({ ko: '{name} 켜기', en: 'Enable {name}' }, { name: manifest.name })} onCheckedChange={(value) => void setEnabled(plugin, value)} /> : undefined}
              onOpen={() => setDetail(manifest.id)}
              openLabel={t({ ko: '자세히', en: 'Details' })}
            />
          )
        })}
      </RowGroup>

      {isAdmin ? <PluginAuthoring page={sourcePage} /> : null}
      {isAdmin ? <PluginSourceInstall state={sourceInstall} /> : null}

      <Modal open={opened !== null} onClose={() => setDetail(null)} title={opened ? <span className="flex items-center gap-2">{opened.manifest.name}<Chip size="sm" tone="muted" mono>{opened.manifest.version}</Chip></span> : ''} size="md">
        {opened ? (
          <>
            <ModalBody spacing="lg">
              {opened.manifest.description ? <p className="text-sm">{opened.manifest.description}</p> : null}
              <PluginRuntimeSummary server={Boolean(opened.manifest.server)} />
              {isAdmin && opened.source ? <RowGroup heading={t({ ko: 'Git 연결', en: 'Git source' })}>
                <ListRow size="sm"><span className="shrink-0 text-xs text-muted-foreground">{t({ ko: '저장소 주소', en: 'Repository URL' })}</span><span className="min-w-0 break-all text-sm">{opened.source.url}</span></ListRow>
                <ListRow size="sm"><span className="shrink-0 text-xs text-muted-foreground">{t({ ko: '브랜치·태그', en: 'Branch / tag' })}</span><span className="min-w-0 break-all font-mono text-xs">{opened.source.ref}</span></ListRow>
                <ListRow size="sm"><span className="shrink-0 text-xs text-muted-foreground">{t({ ko: '플러그인 폴더', en: 'Plugin folder' })}</span><span className="min-w-0 break-all font-mono text-xs">{opened.source.path || '/'}</span></ListRow>
                <ListRow size="sm"><span className="shrink-0 text-xs text-muted-foreground">{t({ ko: '설치한 커밋', en: 'Installed commit' })}</span><span className="font-mono text-xs" title={opened.source.commit}>{opened.source.commit.slice(0, 7)}</span></ListRow>
                <ListRow size="sm">
                  <span className="shrink-0 text-xs text-muted-foreground">{t({ ko: '마지막 확인', en: 'Last check' })}</span>
                  <div className="min-w-0">
                    {opened.source.checkError ? <Text variant="caption" tone="destructive" className="break-all">{opened.source.checkError}</Text> : <Text variant="caption" mono title={opened.source.latestCommit ?? undefined}>{opened.source.latestCommit?.slice(0, 7) ?? t({ ko: '아직 확인하지 않았어.', en: 'Not checked yet.' })}</Text>}
                    {opened.source.checkedAt ? <Text variant="caption"><time dateTime={opened.source.checkedAt}>{new Date(opened.source.checkedAt).toLocaleString()}</time></Text> : null}
                  </div>
                </ListRow>
                {opened.source.modified ? <p className="py-2 text-sm text-warning">{t({ ko: '지금 설치본은 ZIP이나 편집기로 설치한 버전이야. Git에서 다시 설치하면 덮어써.', en: 'The installed version came from a ZIP or the editor. Reinstalling from Git overwrites it.' })}</p> : null}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" variant="secondary" disabled={busy || sourceInstall.busy} onClick={() => void reviewLinked(opened).catch(() => undefined)}>{t({ ko: '업데이트 검토', en: 'Review update' })}</Button>
                  <Button size="sm" variant="ghost" disabled={busy || sourceInstall.busy} onClick={() => void unlink(opened)}>{t({ ko: '연결 해제', en: 'Unlink' })}</Button>
                </div>
              </RowGroup> : null}
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
