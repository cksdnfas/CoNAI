import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router-dom'
import { ChevronDown, Files, FolderKanban, RefreshCw, TriangleAlert } from 'lucide-react'
import { copyChatPageData, type ChatPageData, type PluginInstance, type PluginSnapshot, type PluginWorkspaceProposal, type PluginMediaProposal, type StoredFileEntry } from '@conai/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody } from '@/components/ui/modal'
import { LoadingState } from '@/components/ui/loading-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageToolbar } from '@/components/common/page-toolbar'
import { FileBrowser } from '@/features/files/file-browser'
import { WorkspaceProjectPicker } from '@/features/files/workspace-projects'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { closePlugin, listPlugins, openPlugin, pluginRequest, proposePluginWrite, PLUGINS_QUERY_KEY } from '@/lib/api-plugins'
import { ApiRequestError } from '@/lib/api-request'
import { FILES_QUERY_KEY } from '@/lib/api-files'
import { getWorkspace } from '@/lib/api-workspaces'
import { useI18n } from '@/i18n'
import { useUnsavedSettingsGuard } from '@/features/settings/use-unsaved-settings-guard'
import { createRandomUuid } from '@/lib/random-uuid'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { APP_REQUESTS_KEY, AppRequestJob, useAppRequestsById } from './plugin-app-requests'
import { PluginReviewBar, PluginReviewModal, type PluginMediaJob, type PluginProposal } from './plugin-review'
const proposalRoute = (proposal: PluginProposal) => 'source' in proposal ? proposal.source === 'media' ? 'media-proposals' : 'workspace-proposals' : 'proposals'
function appResultSummary(result: unknown) {
  return JSON.stringify(result, (_key, value: unknown) => {
    if (value && typeof value === 'object' && 'type' in value && ['image', 'audio'].includes(String(value.type)) && 'data' in value) return { type: value.type, preview: 'available in app result' }
    return value
  }).slice(0, 8000)
}

/** App tokens a plugin's conai-plugin.css reads, so its page follows the app's theme and fonts. */
const THEME_VARS = ['background', 'foreground', 'muted-foreground', 'primary', 'primary-foreground', 'line', 'field', 'fill', 'surface-high', 'destructive', 'success', 'warning', 'font-sans', 'font-mono'] as const
function hostTheme() {
  const root = document.documentElement
  const style = getComputedStyle(root)
  const vars: Record<string, string> = {}
  for (const name of THEME_VARS) {
    const value = style.getPropertyValue(`--${name}`).trim()
    if (value) vars[name] = value
  }
  return { scheme: root.classList.contains('light') ? 'light' as const : 'dark' as const, vars }
}

export function PluginPage() {
  const { pluginId = '', pageId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const files = params.get('files') ?? ''
  const projectId = params.get('project') ?? ''
  // Write is granted per project in this tab (never from a link). Keyed by project, so picking another project and
  // then cancelling the leave-confirm changes nothing for the open one.
  const [writeGrants, setWriteGrants] = useState<Record<string, boolean>>({})
  const write = writeGrants[projectId] === true
  const [projectPicker, setProjectPicker] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const [reload, setReload] = useState(0)
  const confirm = useConfirm()
  const plugins = useQuery({ queryKey: PLUGINS_QUERY_KEY, queryFn: listPlugins })
  const project = useQuery({ queryKey: ['workspaces', projectId, 'plugin-context'], queryFn: () => getWorkspace(projectId), enabled: !!projectId })
  const definition = plugins.data?.find((plugin) => plugin.enabled && plugin.manifest.id === pluginId)?.manifest
  const page = definition?.pages.find((item) => item.id === pageId)
  const [picker, setPicker] = useState(false)
  const [folder, setFolder] = useState<string | null>(null)
  const { t } = useI18n()
  const pick = (items: StoredFileEntry[]) => {
    setParams((previous) => { const next = new URLSearchParams(previous); if (items.length) next.set('files', items.map((item) => item.id).join(',')); else next.delete('files'); return next })
    setPicker(false)
  }
  const discardDraft = async () => !hasDraft || await confirm({ title: t({ ko: '지금 초안과 검토를 닫고 다시 열까?', en: 'Discard current drafts and reopen?' }) })
  if (plugins.isPending) return <LoadingState />
  if (!page || !definition) return <ErrorState description={t({ ko: '플러그인이 없거나 꺼져 있어.', en: 'The plugin is unavailable or disabled.' })} />
  const canProject = definition.capabilities.includes('workspace.read')
  const canFiles = definition.capabilities.some(capability => capability.startsWith('files.'))
  const fileCount = files ? files.split(',').filter(Boolean).length : 0
  const contextButtons = <>
    {canProject ? (projectId
      ? <Button variant="subtle" size="sm" onClick={() => setProjectPicker(true)}><FolderKanban />{project.data?.name ?? '…'}<span className="text-muted-foreground">· {t(write ? { ko: '저장 제안', en: 'Save proposals' } : { ko: '읽기 전용', en: 'Read only' })}</span><ChevronDown /></Button>
      : <IconButton variant="ghost" label={t({ ko: '프로젝트 연결', en: 'Connect project' })} onClick={() => setProjectPicker(true)}><FolderKanban /></IconButton>) : null}
    {canFiles ? (fileCount
      ? <Button variant="subtle" size="sm" onClick={() => setPicker(true)}><Files />{t({ ko: '파일 {count}개', en: '{count} files' }, { count: fileCount })}<ChevronDown /></Button>
      : <IconButton variant="ghost" label={t({ ko: '파일 고르기', en: 'Choose files' })} onClick={() => setPicker(true)}><Files /></IconButton>) : null}
  </>
  return <div className="px-4 pb-6">
    <PageToolbar
      title={<span className="flex min-w-0 items-baseline gap-2"><span className="truncate">{page.title}</span>{definition.name !== page.title ? <span className="truncate text-sm font-normal text-muted-foreground">{definition.name}</span> : null}</span>}
      start={<div className="flex min-w-0 flex-wrap items-center gap-1">{contextButtons}</div>}
      actions={<IconButton variant="ghost" label={t({ ko: '다시 열기', en: 'Reopen' })} onClick={() => { void (async () => { if (await discardDraft()) setReload(value => value + 1) })() }}><RefreshCw /></IconButton>}
    />
    {files || projectId || page.accepts.length === 0 ? <PluginConnection key={`${pluginId}/${pageId}/${files}/${projectId}/${write}/${reload}`} pluginId={pluginId} pageId={pageId} fileIds={files} projectId={projectId} write={write} onDirty={setHasDraft} /> : <p className="py-4 text-sm text-muted-foreground">{t({ ko: '이 도구로 열 파일을 골라줘.', en: 'Choose files to open in this tool.' })}</p>}
    <WorkspaceProjectPicker
      open={projectPicker}
      onClose={() => setProjectPicker(false)}
      projectId={projectId || null}
      write={write}
      writeLabel={definition.capabilities.includes('workspace.write') ? t({ ko: '저장 제안 허용', en: 'Allow save proposals' }) : null}
      onConnect={async (selected, allowWrite) => {
        // Another project is a navigation, and the leave guard asks about drafts then; only a write toggle on the
        // same project reopens without one, so ask here.
        if (selected === (projectId || null) && !await discardDraft()) return
        if (selected) setWriteGrants((grants) => ({ ...grants, [selected]: allowWrite }))
        setParams(previous => { const next = new URLSearchParams(previous); if (selected) next.set('project', selected); else next.delete('project'); return next })
        setProjectPicker(false)
      }}
    />
    <Modal open={picker} onClose={() => setPicker(false)} title={t({ ko: '플러그인에 연결할 파일', en: 'Files for this plugin' })} size="wide"><ModalBody>
      <FileBrowser parentId={folder} onNavigate={setFolder} onPick={pick} accept={page.accepts.length ? page.accepts : undefined} pickLabel={(count) => t({ ko: '{count}개 연결', en: 'Connect {count}' }, { count })} />
    </ModalBody></Modal>
  </div>
}

function PluginConnection({ pluginId, pageId, fileIds, projectId, write, onDirty }: { pluginId: string; pageId: string; fileIds: string; projectId: string; write: boolean; onDirty: (value: boolean) => void }) {
  const [instance, setInstance] = useState<PluginInstance | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false, active: PluginInstance | null = null
    void openPlugin(pluginId, pageId, fileIds ? fileIds.split(',') : [], projectId ? { id: projectId, write } : undefined).then((value) => {
      active = value
      if (disposed) void closePlugin(value.id)
      else setInstance(value)
    }).catch((reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
    const onHide = (event: PageTransitionEvent) => { if (!event.persisted && active) void closePlugin(active.id) }
    window.addEventListener('pagehide', onHide)
    return () => { disposed = true; window.removeEventListener('pagehide', onHide); if (active) void closePlugin(active.id) }
  }, [pluginId, pageId, fileIds, projectId, write])
  return error ? <ErrorState description={error} /> : instance ? <PluginFrame instance={instance} onDirty={onDirty} /> : <LoadingState />
}

function PluginFrame({ instance, onDirty }: { instance: PluginInstance; onDirty: (value: boolean) => void }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const frame = useRef<HTMLIFrameElement>(null)
  const channel = useRef<MessagePort | null>(null)
  const initialized = useRef(false)
  const alive = useRef(true)
  const inFlight = useRef(0)
  const rate = useRef({ start: Date.now(), count: 0 })
  // Snapshots follow typing; the latest one is taken at most every 150 ms and never counts as a request.
  const latestSnapshot = useRef<PluginSnapshot | null>(null)
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commands = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>())
  const [snapshot, setSnapshot] = useState<PluginSnapshot>({ revision: '0', data: { files: instance.files } })
  const [proposals, setProposals] = useState<PluginProposal[]>([])
  const [appRequestIds, setAppRequestIds] = useState<string[]>([])
  const [appResult, setAppResult] = useState('')
  const [review, setReview] = useState(false)
  const appRequestsQuery = useAppRequestsById(appRequestIds)
  const appRequests = appRequestsQuery.data?.requests ?? []
  const appCall = async (method: 'call' | 'action', args: unknown) => {
    const result = await pluginRequest<import('@conai/shared').PluginAppRequest | { status: 'completed'; result: unknown }>(`/instances/${instance.id}/app/${method}`, 'POST', args)
    if ('id' in result) {
      setAppRequestIds(ids => [...new Set([...ids, result.id])].slice(-16))
      await queryClient.invalidateQueries({ queryKey: APP_REQUESTS_KEY })
    } else setAppResult(appResultSummary(result.result))
    return result
  }
  const [jobs, setJobs] = useState<PluginMediaJob[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [closed, setClosed] = useState(false)
  const [blockedFrame, setBlockedFrame] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const checking = useRef(false)
  useEffect(() => { onDirty(!!snapshot.dirty || proposals.length > 0 || busy); return () => onDirty(false) }, [snapshot.dirty, proposals.length, busy, onDirty])
  const stop = useCallback(() => {
    channel.current?.close(); channel.current = null
    for (const pending of commands.current.values()) { clearTimeout(pending.timer); pending.reject(new Error('플러그인 연결이 닫혔어.')) }
    commands.current.clear()
  }, [])
  const checkConnection = useCallback(async () => {
    if (checking.current || closed) return
    checking.current = true
    try {
      await pluginRequest(`/instances/${instance.id}/renew`, 'POST')
      if (alive.current) setConnectionError('')
    } catch (reason) {
      if (!alive.current) return
      if (reason instanceof ApiRequestError && [401, 403, 404, 409, 410].includes(reason.status)) {
        stop(); setClosed(true)
        setConnectionError(t({ ko: '연결이 끝났어. 남은 초안을 복사한 뒤 플러그인을 다시 열어줘.', en: 'The connection ended. Copy your draft before reopening the plugin.' }))
      } else {
        setConnectionError(t({ ko: '연결을 확인하지 못했어. 초안은 그대로야. 네트워크가 돌아오면 다시 확인해줘.', en: 'Could not check the connection. Your draft is kept. Retry when the network returns.' }))
      }
    } finally { checking.current = false }
  }, [closed, instance.id, stop, t])
  useUnsavedSettingsGuard(!!snapshot.dirty || proposals.length > 0 || busy, t({ ko: '플러그인에 저장 안 한 초안이나 검토 중인 변경이 있어. 떠날까?', en: 'This plugin has unsaved drafts or pending changes. Leave?' }), true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; stop(); if (snapshotTimer.current) clearTimeout(snapshotTimer.current) }
  }, [stop])
  // A theme switched while the plugin is open reaches it too (conai-plugin.css reads the same tokens).
  useEffect(() => {
    const observer = new MutationObserver(() => channel.current?.postMessage({ type: 'theme', theme: hostTheme() }))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    return () => observer.disconnect()
  }, [])
  // A short server lease collects crashed tabs. Network failures must never destroy the draft iframe.
  useEffect(() => {
    if (closed) return
    const check = () => { void checkConnection() }
    const visible = () => { if (document.visibilityState === 'visible') check() }
    const timer = setInterval(check, 60_000)
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', check)
    window.addEventListener('pageshow', check)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', check); window.removeEventListener('pageshow', check) }
  }, [checkConnection, closed])

  const perform = (actionId: string, args: Record<string, ChatPageData>) => new Promise<void>((resolve, reject) => {
    const port = channel.current
    if (!port || closed) { reject(new Error('플러그인 화면이 준비되지 않았어.')); return }
    const id = createRandomUuid()
    const timer = setTimeout(() => { commands.current.delete(id); reject(new Error('플러그인 작업 응답이 늦어지고 있어. 화면을 확인해줘.')) }, 15_000)
    commands.current.set(id, { resolve, reject, timer })
    port.postMessage({ type: 'action', id, actionId, args })
  })
  useChatPageRegistration(closed ? null : {
    title: instance.page.title,
    kind: 'extension', resourceId: instance.plugin.version, fields: [], actions: instance.page.actions,
    localRevision: `${snapshot.revision}:${proposals.map(item => item.id.slice(0, 6)).join(',')}:${jobs.map(item => item.status).join(',')}`,
    data: { ...snapshot.data, extensionHost: {
      pendingReviews: proposals.map(item => ({ proposalId: item.id, name: item.name, state: 'awaiting_user_apply' })),
      appRequests: appRequests.map(item => ({ requestId: item.id, label: item.label, tool: item.tool, status: item.status, jobId: item.jobId })),
      appResult,
      jobs: jobs.map(item => ({ jobId: item.jobId, proposalId: item.proposalId, status: item.status })),
      note: 'These reviews belong to the extension host, not get_proposal_status. Only human host Apply authorizes changes.',
    } }, dirty: snapshot.dirty,
    apply: () => { throw new Error('등록된 플러그인 작업을 사용해줘.') },
    applyAction: async (actionId, args, assertCurrent) => {
      assertCurrent()
      if (instance.page.serverActions?.includes(actionId)) await appCall('action', { action: actionId, arguments: args, requestId: createRandomUuid() })
      else await perform(actionId, args)
      assertCurrent()
    },
  })

  const takeSnapshot = (state: PluginSnapshot | null) => {
    try {
      if (JSON.stringify(state).length > 200_000) throw new Error('화면 정보가 너무 커.')
      if (!state || typeof state.revision !== 'string' || state.revision.length > 100 || !state.data || Array.isArray(state.data)) throw new Error('화면 정보가 올바르지 않아.')
      const data = copyChatPageData(state.data) as Record<string, ChatPageData>
      setSnapshot({ revision: state.revision, dirty: state.dirty === true, data })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const connect = () => {
    // A second document load invalidates the channel instead of handing privileges to a navigated document.
    if (initialized.current) { stop(); setClosed(true); setBlockedFrame(true); setError(t({ ko: '플러그인 페이지가 이동했어. 다시 열어줘.', en: 'The plugin navigated. Open it again.' })); return }
    initialized.current = true
    const connection = new MessageChannel()
    channel.current = connection.port1
    connection.port1.onmessage = (event: MessageEvent) => {
      if (!alive.current) return
      const message = event.data as { type?: string; id?: string; method?: string; args?: unknown; error?: string; snapshot?: PluginSnapshot }
      if (!message || typeof message !== 'object') return
      if (message.type === 'snapshot') {
        latestSnapshot.current = message.snapshot ?? null
        snapshotTimer.current ??= setTimeout(() => { snapshotTimer.current = null; if (alive.current) takeSnapshot(latestSnapshot.current) }, 150)
        return
      }
      if (Date.now() - rate.current.start > 1000) rate.current = { start: Date.now(), count: 0 }
      if (++rate.current.count > 40) { stop(); setClosed(true); setBlockedFrame(true); setError('플러그인 요청이 너무 많아.'); return }
      if (message.type === 'action-result' && typeof message.id === 'string') {
        const pending = commands.current.get(message.id)
        if (!pending) return
        clearTimeout(pending.timer); commands.current.delete(message.id)
        if (message.error) pending.reject(new Error(String(message.error).slice(0, 500)))
        else pending.resolve()
        return
      }
      if (message.type !== 'request' || typeof message.id !== 'string' || message.id.length > 100 || inFlight.current >= 4) return
      const requestId = message.id
      const respond = (result: unknown, failed = false) => { if (alive.current) connection.port1.postMessage({ type: 'response', id: requestId, ...(failed ? { error: String(result).slice(0, 500) } : { result }) }) }
      inFlight.current++
      void (async () => {
        if (JSON.stringify(message.args ?? null).length > 4_500_000) throw new Error('요청이 너무 커.')
        const args = message.args as Record<string, unknown> | undefined
        if (message.method === 'app.tools') return pluginRequest(`/instances/${instance.id}/app/tools`, 'POST', args ?? {})
        if (message.method === 'app.call' || message.method === 'app.action') return appCall(message.method === 'app.call' ? 'call' : 'action', args)
        if (message.method === 'app.getRequest') return pluginRequest(`/instances/${instance.id}/app/requests/${encodeURIComponent(String(args?.requestId ?? ''))}`)
        if (message.method === 'server.request') return pluginRequest(`/instances/${instance.id}/server`, 'POST', { body: args?.body ?? null })
        if (['llm.profiles', 'llm.start', 'llm.get', 'llm.cancel'].includes(message.method ?? '')) return pluginRequest(`/instances/${instance.id}/llm/${message.method!.split('.')[1]}`, 'POST', args ?? {})
        if (['workspace.list', 'workspace.read', 'workspace.stat'].includes(message.method ?? '')) return pluginRequest(`/instances/${instance.id}/workspace/${message.method!.split('.')[1]}`, 'POST', args)
        if (message.method === 'workspace.proposeChanges' || message.method === 'media.proposeProcess') {
          const suffix = message.method === 'workspace.proposeChanges' ? 'workspace/changes' : 'media-proposals'
          const proposal = await pluginRequest<PluginWorkspaceProposal | PluginMediaProposal>(`/instances/${instance.id}/${suffix}`, 'POST', args)
          if (alive.current) setProposals(items => [...items, proposal].slice(-4))
          return { proposalId: proposal.id, status: 'pending' }
        }
        if (message.method === 'workspace.proposeWrite') {
          const proposal = await pluginRequest<PluginWorkspaceProposal>(`/instances/${instance.id}/workspace/proposals`, 'POST', args)
          if (alive.current) setProposals(items => [...items, proposal].slice(-4))
          return { proposalId: proposal.id, status: 'pending' }
        }
        if (message.method === 'workspace.media') {
          const media = await pluginRequest<{ token: string; expiresAt: number }>(`/instances/${instance.id}/workspace/media`, 'POST', args)
          return { url: new URL(`/api/plugin-media/workspace/${media.token}`, window.location.href).href, expiresAt: media.expiresAt }
        }
        if (message.method === 'files.readText') return pluginRequest(`/instances/${instance.id}/files/${encodeURIComponent(String(args?.fileId ?? ''))}`)
        if (message.method === 'files.proposeWrite') {
          const proposal = await proposePluginWrite(instance.id, message.args)
          if (alive.current) setProposals((items) => [...items, proposal].slice(-4))
          return { proposalId: proposal.id, status: 'pending' }
        }
        if (message.method === 'files.media') {
          const media = await pluginRequest<{ token: string; expiresAt: number }>(`/instances/${instance.id}/media/${encodeURIComponent(String(args?.fileId ?? ''))}`, 'POST')
          return { url: new URL(`/api/plugin-media/${media.token}`, window.location.href).href, expiresAt: media.expiresAt }
        }
        throw new Error('등록되지 않은 SDK 호출이야.')
      })().then((result) => respond(result), (reason: unknown) => respond(reason instanceof Error ? reason.message : reason, true)).finally(() => { inFlight.current-- })
    }
    frame.current?.contentWindow?.postMessage({ type: 'conai-plugin-connect', version: 1, files: instance.files, workspace: instance.workspace, actions: instance.page.actions, language: document.documentElement.lang || 'ko', theme: hostTheme() }, '*', [connection.port2])
  }
  const apply = async (proposal: PluginProposal) => {
    setBusy(true); setError('')
    try {
      const route = proposalRoute(proposal)
      const approval = await pluginRequest<{ applied: boolean; approval?: string; result?: unknown }>(`/${route}/${proposal.id}/approve`, 'POST')
      const result = approval.applied ? approval.result : await pluginRequest(`/${route}/${proposal.id}/apply`, 'POST', { approval: approval.approval })
      setProposals((items) => items.filter((item) => item.id !== proposal.id))
      await queryClient.invalidateQueries({ queryKey: 'source' in proposal ? ['workspaces', proposal.projectId] : FILES_QUERY_KEY })
      if ('source' in proposal && proposal.source === 'media') {
        const job = result as { jobId: string }
        setJobs(items => [...items.filter(item => item.jobId !== job.jobId), { jobId: job.jobId, proposalId: proposal.id, status: 'running' }].slice(-4))
      } else channel.current?.postMessage({ type: 'saved', proposalId: proposal.id, result })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const discard = (proposal: PluginProposal) => {
    void pluginRequest(`/${proposalRoute(proposal)}/${proposal.id}`, 'DELETE').catch(() => undefined)
    setProposals((items) => items.filter((item) => item.id !== proposal.id))
  }
  const closeReview = useCallback(() => setReview(false), [])
  return <>
    {error ? <Alert variant="destructive" className="mb-2"><TriangleAlert /><AlertDescription>{error}</AlertDescription></Alert> : null}
    {connectionError ? <Alert variant="warning" className="mb-2"><TriangleAlert /><AlertDescription className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1">{connectionError}</span>{closed ? null : <Button size="sm" variant="secondary" onClick={() => void checkConnection()}>{t({ ko: '다시 확인', en: 'Retry' })}</Button>}</AlertDescription></Alert> : null}
    {blockedFrame ? null : <iframe ref={frame} title={instance.page.title} sandbox="allow-scripts" referrerPolicy="no-referrer" src={`/api/plugin-assets/${instance.plugin.id}/${instance.plugin.version}/${instance.page.entry}`} onLoad={connect} className="h-[max(420px,calc(100dvh-var(--theme-shell-header-height)-7rem))] w-full rounded-sm border-0" />}
    {/* App operations started here report their job result back to the plugin page. */}
    {appRequests.filter(request => request.jobId).map(request => <AppRequestJob key={request.id} jobId={request.jobId!} showProgress={false} onFinished={result => { channel.current?.postMessage({ type: 'saved', proposalId: request.id, result }); setAppResult(appResultSummary(result)) }} />)}
    <PluginReviewBar
      proposals={proposals}
      requests={appRequests}
      jobs={jobs}
      onReview={() => setReview(true)}
      onJobFinished={(job, status, result, failure) => {
        setJobs(items => items.map(item => item.jobId === job.jobId ? { ...item, status } : item))
        void queryClient.invalidateQueries({ queryKey: ['workspaces', instance.workspace?.id] })
        if (status === 'completed') channel.current?.postMessage({ type: 'saved', proposalId: job.proposalId, result })
        if (status === 'failed' && failure) setError(failure)
      }}
    />
    <PluginReviewModal
      open={review}
      onClose={closeReview}
      proposals={proposals}
      requests={appRequests}
      busy={busy}
      closed={closed}
      onApply={apply}
      onDiscard={discard}
      location={(proposal) => 'source' in proposal ? [instance.workspace?.name, proposal.target].filter(Boolean).join(' / ') : proposal.name}
    />
  </>
}
