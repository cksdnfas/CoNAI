import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronDown, Files, FolderKanban, RefreshCw, TriangleAlert } from 'lucide-react'
import { copyChatPageData, type ChatPageData, type GenerationLayoutSurface, type PluginInstance, type PluginSnapshot, type PluginWorkspaceProposal, type PluginMediaProposal, type StoredFileEntry } from '@conai/shared'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ui/code-block'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody } from '@/components/ui/modal'
import { LoadingState } from '@/components/ui/loading-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageToolbar } from '@/components/common/page-toolbar'
import { FileBrowser } from '@/features/files/file-browser'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { WorkspaceProjectPicker } from '@/features/files/workspace-projects'
import { useChatPage, useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
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
import { PLUGIN_NATIVE_API_ROOTS, PLUGIN_REQUEST_TIMEOUT_MS, PLUGIN_SDK_FEATURES, chatPagePermission, pluginNativeApiPath } from '@conai/shared'
import { buildApiUrl } from '@/lib/api-url'
import { cn } from '@/lib/utils'
import { fetchPluginNative, pluginNativeResponse } from './plugin-native-api'
import { createRuntimeEventStream } from '@/lib/runtime-event-stream'
import { useCodexChat } from '@/features/codex-chat/codex-chat-context'
import { getCodexChatThread } from '@/lib/api-codex-chat'
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
  const auth = useAuthStatusQuery()
  const { pluginId = '', pageId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const files = params.get('files') ?? ''
  const projectId = params.get('project') ?? ''
  const write = hasAuthPermission(auth.data?.permissionKeys, 'files.edit')
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
  const canFiles = hasAuthPermission(auth.data?.permissionKeys, 'files.view')
  const canProject = canFiles
  const fileCount = files ? files.split(',').filter(Boolean).length : 0
  const contextButtons = <>
    {canProject ? (projectId
      ? <Button variant="subtle" size="sm" onClick={() => setProjectPicker(true)}><FolderKanban />{project.data?.name ?? '…'}<span className="text-muted-foreground">· {t(write ? { ko: '편집 가능', en: 'Editable' } : { ko: '읽기 전용', en: 'Read only' })}</span><ChevronDown /></Button>
      : <IconButton variant="ghost" label={t({ ko: '프로젝트 연결', en: 'Connect project' })} onClick={() => setProjectPicker(true)}><FolderKanban /></IconButton>) : null}
    {canFiles ? (fileCount
      ? <Button variant="subtle" size="sm" onClick={() => setPicker(true)}><Files />{t({ ko: '파일 {count}개', en: '{count} files' }, { count: fileCount })}<ChevronDown /></Button>
      : <IconButton variant="ghost" label={t({ ko: '파일 고르기', en: 'Choose files' })} onClick={() => setPicker(true)}><Files /></IconButton>) : null}
  </>
  return <div className="pb-6">
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
      writeLabel={null}
      onConnect={(selected) => {
        setParams(previous => { const next = new URLSearchParams(previous); if (selected) next.set('project', selected); else next.delete('project'); return next })
        setProjectPicker(false)
      }}
    />
    <Modal open={picker} onClose={() => setPicker(false)} title={t({ ko: '플러그인에 연결할 파일', en: 'Files for this plugin' })} size="wide"><ModalBody>
      <FileBrowser parentId={folder} onNavigate={setFolder} onPick={pick} accept={page.accepts.length ? page.accepts : undefined} pickLabel={(count) => t({ ko: '{count}개 연결', en: 'Connect {count}' }, { count })} />
    </ModalBody></Modal>
  </div>
}

/** Shown inside a generation layout instead of on its own page: fixed height, no chat registration, reads the screen's form. */
export type PluginEmbed = { surface: GenerationLayoutSurface; height: number }

export function PluginConnection({ pluginId, pageId, fileIds, projectId, write, onDirty, embed }: { pluginId: string; pageId: string; fileIds: string; projectId: string; write: boolean; onDirty: (value: boolean) => void; embed?: PluginEmbed }) {
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
  return error ? <ErrorState description={error} /> : instance ? <PluginFrame instance={instance} onDirty={onDirty} embed={embed} /> : <LoadingState />
}

function PluginFrame({ instance, onDirty, embed }: { instance: PluginInstance; onDirty: (value: boolean) => void; embed?: PluginEmbed }) {
  const chat = useCodexChat()
  const hostPage = useChatPage()
  const { t } = useI18n()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const frame = useRef<HTMLIFrameElement>(null)
  const channel = useRef<MessagePort | null>(null)
  const initialized = useRef(false)
  const alive = useRef(true)
  const requests = useRef(new Map<string, { controller: AbortController; finish: () => void }>())
  const eventSubscription = useRef<(() => void) | null>(null)
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
  const appCall = async (method: 'call' | 'action', args: unknown, requireReview = commands.current.size > 0, signal?: AbortSignal) => {
    const result = await pluginRequest<import('@conai/shared').PluginAppRequest | { status: 'completed'; result: unknown }>(`/instances/${instance.id}/app/${method}${requireReview ? '?review=1' : ''}`, 'POST', args, signal)
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
    eventSubscription.current?.(); eventSubscription.current = null
    for (const request of requests.current.values()) { request.controller.abort(); request.finish() }
    channel.current?.postMessage({ type: 'closed' })
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
    const timer = setTimeout(() => { commands.current.delete(id); reject(new Error('플러그인 작업 제한 시간을 넘었어. 실행 상태를 확인해줘.')) }, PLUGIN_REQUEST_TIMEOUT_MS)
    commands.current.set(id, { resolve, reject, timer })
    port.postMessage({ type: 'action', id, actionId, args })
  })
  // An embedded block is part of the screen it sits on; that screen's own editor stays the chat's page.
  useChatPageRegistration(closed || embed ? null : {
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
      if (instance.page.serverActions?.includes(actionId)) await appCall('action', { action: actionId, arguments: args, requestId: createRandomUuid() }, true)
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
      const message = event.data as { type?: string; id?: string; method?: string; args?: unknown; error?: string; snapshot?: PluginSnapshot; timeoutMs?: number }
      if (!message || typeof message !== 'object') return
      if (message.type === 'cancel' && typeof message.id === 'string') { requests.current.get(message.id)?.controller.abort(); return }
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
      if (message.type !== 'request' || typeof message.id !== 'string' || message.id.length > 100) return
      const requestId = message.id
      const respond = (result: unknown, failed = false, transfer: Transferable[] = []) => {
        if (alive.current) connection.port1.postMessage({ type: 'response', id: requestId, ...(failed ? {
          error: (result instanceof Error ? result.message : String(result)).slice(0, 1500),
          errorInfo: { name: result instanceof Error ? result.name : 'Error', status: result instanceof ApiRequestError ? result.status : undefined, code: result instanceof ApiRequestError ? result.code : undefined },
        } : { result }) }, transfer)
      }
      if (requests.current.size >= (['app.cancel', 'llm.cancel'].includes(message.method ?? '') ? 5 : 4) || requests.current.has(requestId)) { respond(new ApiRequestError('실행 중인 요청이 너무 많아.', 429, 'BUSY'), true); return }
      const controller = new AbortController()
      const timeoutMs = Math.min(PLUGIN_REQUEST_TIMEOUT_MS, Math.max(1000, Number.isFinite(message.timeoutMs) ? message.timeoutMs! : PLUGIN_REQUEST_TIMEOUT_MS))
      const timeout = setTimeout(() => controller.abort(new DOMException('요청 제한 시간을 넘었어.', 'TimeoutError')), timeoutMs)
      const finish = () => {
        clearTimeout(timeout)
        controller.signal.removeEventListener('abort', finish)
        if (requests.current.get(requestId)?.controller === controller) requests.current.delete(requestId)
      }
      requests.current.set(requestId, { controller, finish })
      controller.signal.addEventListener('abort', finish, { once: true })
      let streaming = false
      const request = <T,>(suffix: string, method = 'GET', body?: unknown) => pluginRequest<T>(suffix, method, body, controller.signal)
      void (async () => {
        if (message.method === 'app.fetch') return fetchPluginNative(instance.id, message.args, controller.signal, async (path, method, details) => {
          if (commands.current.size === 0) return true
          if (details.length > 32_000) throw new ApiRequestError('검토할 입력이 너무 커. 변경을 나누거나 앱 도구의 저장 제안을 사용해줘.', 413)
          return confirm({ title: t({ ko: '플러그인의 변경 적용', en: 'Apply plugin change' }), description: <div className="space-y-2"><p>{instance.page.title} · {method} {path}</p>{details ? <CodeBlock maxHeight="sm">{details}</CodeBlock> : null}</div>, confirmLabel: t({ ko: '적용', en: 'Apply' }) })
        })
        if (JSON.stringify(message.args ?? null).length > 4_500_000) throw new Error('요청이 너무 커.')
        const args = message.args as Record<string, unknown> | undefined
        if (message.method === 'app.download') {
          const path = pluginNativeApiPath(String(args?.path ?? ''), [window.location.origin, new URL(buildApiUrl('/'), window.location.href).origin])
          await request(`/instances/${instance.id}`)
          const link = document.createElement('a')
          link.href = buildApiUrl(path); link.download = Array.from(String(args?.filename ?? '')).map(char => char.charCodeAt(0) < 32 || '/\\'.includes(char) ? '_' : char).join('').slice(0, 200)
          document.body.append(link); link.click(); link.remove()
          return { started: true }
        }
        if (message.method === 'app.tools') return request(`/instances/${instance.id}/app/tools`, 'POST', args ?? {})
        if (message.method === 'app.call' || message.method === 'app.action') return appCall(message.method === 'app.call' ? 'call' : 'action', args, commands.current.size > 0, controller.signal)
        if (message.method === 'app.getRequest') return request(`/instances/${instance.id}/app/requests/${encodeURIComponent(String(args?.requestId ?? ''))}`)
        if (message.method === 'app.cancel') return request(`/instances/${instance.id}/app/requests/${encodeURIComponent(String(args?.requestId ?? ''))}/cancel`, 'POST')
        if (message.method === 'server.request') return request(`/instances/${instance.id}/server`, 'POST', { body: args?.body ?? null })
        if (message.method === 'page.form.get' || message.method === 'page.form.fill') {
          if (!embed || !hostPage) throw new ApiRequestError('화면 입력은 생성 화면 블록에서만 쓸 수 있어.', 400)
          if (message.method === 'page.form.get') return hostPage.form()
          const values = args?.values
          if (!values || typeof values !== 'object' || Array.isArray(values)) throw new ApiRequestError('채울 값은 { 필드 ID: 값 } 객체여야 해.', 400)
          hostPage.fillForm(values as Record<string, unknown>)
          return { filled: Object.keys(values) }
        }
        if (['storage.get', 'storage.set', 'storage.delete'].includes(message.method ?? '')) return request(`/instances/${instance.id}/storage/${message.method!.split('.')[1]}`, 'POST', args)
        if (message.method === 'media.open') {
          const media = await request<{ token: string; expiresAt: number; name: string; mimeType: string }>(`/instances/${instance.id}/artifact-media`, 'POST', args)
          return { url: new URL(`/api/plugin-media/artifact/${media.token}`, window.location.href).href, expiresAt: media.expiresAt, name: media.name, mimeType: media.mimeType }
        }
        if (message.method === 'preview.open' || message.method === 'preview.update') {
          const { url, ...content } = (args ?? {}) as { url?: unknown }
          const token = message.method === 'preview.update' ? /^\/api\/plugin-media\/preview\/([a-f0-9]{48})\/$/.exec(new URL(String(url ?? ''), window.location.href).pathname)?.[1] : undefined
          if (message.method === 'preview.update' && !token) throw new ApiRequestError('이 화면에서 연 미리보기 주소를 넘겨줘.', 400)
          const preview = await request<{ token: string; expiresAt: number }>(`/instances/${instance.id}/previews${token ? `/${token}` : ''}`, token ? 'PUT' : 'POST', content)
          return { url: new URL(`/api/plugin-media/preview/${preview.token}/`, window.location.href).href, expiresAt: preview.expiresAt }
        }
        if (message.method === 'navigation.openChat') {
          const threadId = Number(args?.threadId)
          if (!chat?.canUse || !Number.isSafeInteger(threadId) || threadId < 1) throw new ApiRequestError('열 수 있는 대화를 선택해줘.', 400)
          await request(`/instances/${instance.id}`)
          await getCodexChatThread(threadId, 1)
          controller.signal.throwIfAborted()
          chat.selectThread(threadId); navigate('/chat'); return { navigated: true }
        }
        if (message.method === 'navigation.open') {
          const path = String(args?.path ?? '')
          if (!path.startsWith('/') || path.startsWith('//') || /[\\#]/.test(path) || chatPagePermission(path.split('?')[0]) === null) throw new ApiRequestError('등록된 앱 페이지 경로를 사용해줘.', 400)
          navigate(path); return { navigated: true }
        }
        if (message.method === 'events.subscribe') {
          eventSubscription.current?.()
          eventSubscription.current = args?.enabled === false ? null : createRuntimeEventStream({
            onEnvelope: envelope => { if (!envelope.name.startsWith('chat.')) connection.port1.postMessage({ type: 'event', event: envelope }) },
            onStatusChange: status => connection.port1.postMessage({ type: 'event', event: { name: 'connection', status } }),
            onResync: () => connection.port1.postMessage({ type: 'event', event: { name: 'resync' } }),
            onSessionExpired: stop,
          })
          return { subscribed: args?.enabled !== false }
        }
        if (['llm.profiles', 'llm.asset', 'llm.start', 'llm.get', 'llm.cancel', 'llm.decide', 'llm.judgeTurn'].includes(message.method ?? '')) return request(`/instances/${instance.id}/llm/${message.method!.split('.')[1]}`, 'POST', args ?? {})
        if (['workspace.list', 'workspace.read', 'workspace.stat'].includes(message.method ?? '')) return request(`/instances/${instance.id}/workspace/${message.method!.split('.')[1]}`, 'POST', args)
        if (message.method === 'workspace.proposeChanges' || message.method === 'media.proposeProcess') {
          const suffix = message.method === 'workspace.proposeChanges' ? 'workspace/changes' : 'media-proposals'
          const proposal = await request<PluginWorkspaceProposal | PluginMediaProposal>(`/instances/${instance.id}/${suffix}`, 'POST', args)
          if (alive.current) setProposals(items => [...items, proposal].slice(-4))
          return { proposalId: proposal.id, status: 'pending' }
        }
        if (message.method === 'workspace.proposeWrite') {
          const proposal = await request<PluginWorkspaceProposal>(`/instances/${instance.id}/workspace/proposals`, 'POST', args)
          if (alive.current) setProposals(items => [...items, proposal].slice(-4))
          return { proposalId: proposal.id, status: 'pending' }
        }
        if (message.method === 'workspace.media') {
          const media = await request<{ token: string; expiresAt: number }>(`/instances/${instance.id}/workspace/media`, 'POST', args)
          return { url: new URL(`/api/plugin-media/workspace/${media.token}`, window.location.href).href, expiresAt: media.expiresAt }
        }
        if (message.method === 'files.readText') return request(`/instances/${instance.id}/files/${encodeURIComponent(String(args?.fileId ?? ''))}`)
        if (message.method === 'files.proposeWrite') {
          const proposal = await proposePluginWrite(instance.id, message.args, controller.signal)
          if (alive.current) setProposals((items) => [...items, proposal].slice(-4))
          return { proposalId: proposal.id, status: 'pending' }
        }
        if (message.method === 'files.media') {
          const media = await request<{ token: string; expiresAt: number }>(`/instances/${instance.id}/media/${encodeURIComponent(String(args?.fileId ?? ''))}`, 'POST')
          return { url: new URL(`/api/plugin-media/${media.token}`, window.location.href).href, expiresAt: media.expiresAt }
        }
        throw new Error('등록되지 않은 SDK 호출이야.')
      })().then((result) => {
        if (result instanceof Response) {
          const response = pluginNativeResponse(result, finish)
          respond(response, false, response.body ? [response.body] : [])
          streaming = response.body !== null
        } else respond(result)
      }).catch((reason: unknown) => { controller.abort(); respond(reason, true) }).finally(() => { if (!streaming) finish() })
    }
    frame.current?.contentWindow?.postMessage({ type: 'conai-plugin-connect', version: 1, features: PLUGIN_SDK_FEATURES, nativeApiRoots: PLUGIN_NATIVE_API_ROOTS, files: instance.files, workspace: instance.workspace, actions: instance.page.actions, language: document.documentElement.lang || 'ko', theme: hostTheme(), context: embed ? { kind: 'generation-block', surface: embed.surface } : null }, '*', [connection.port2])
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
    {blockedFrame ? null : <iframe ref={frame} title={instance.page.title} sandbox="allow-scripts" allow="autoplay" referrerPolicy="no-referrer" src={`/api/plugin-assets/${instance.plugin.id}/${instance.plugin.version}/${instance.page.entry}`} onLoad={connect} style={embed ? { height: embed.height } : undefined} className={cn('w-full rounded-sm border-0', !embed && 'h-[max(420px,calc(100dvh-var(--theme-shell-header-height)-7rem))]')} />}
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
