import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router-dom'
import { copyChatPageData, type ChatPageData, type PluginInstance, type PluginSnapshot, type PluginWriteProposal, type StoredFileEntry } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { Modal, ModalBody } from '@/components/ui/modal'
import { CodeBlock } from '@/components/ui/code-block'
import { LoadingState } from '@/components/ui/loading-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageToolbar } from '@/components/common/page-toolbar'
import { FileBrowser } from '@/features/files/file-browser'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { closePlugin, listPlugins, openPlugin, pluginRequest, proposePluginWrite, PLUGINS_QUERY_KEY } from '@/lib/api-plugins'
import { ApiRequestError } from '@/lib/api-request'
import { FILES_QUERY_KEY } from '@/lib/api-files'
import { useI18n } from '@/i18n'
import { useUnsavedSettingsGuard } from '@/features/settings/use-unsaved-settings-guard'
import { createRandomUuid } from '@/lib/random-uuid'

export function PluginPage() {
  const { pluginId = '', pageId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const files = params.get('files') ?? ''
  const plugins = useQuery({ queryKey: PLUGINS_QUERY_KEY, queryFn: listPlugins })
  const definition = plugins.data?.find((plugin) => plugin.enabled && plugin.manifest.id === pluginId)?.manifest
  const page = definition?.pages.find((item) => item.id === pageId)
  const [picker, setPicker] = useState(false)
  const [folder, setFolder] = useState<string | null>(null)
  const { t } = useI18n()
  const pick = (items: StoredFileEntry[]) => { setParams({ files: items.map((item) => item.id).join(',') }); setPicker(false) }
  if (plugins.isPending) return <LoadingState />
  if (!page || !definition) return <ErrorState description={t({ ko: '확장이 없거나 비활성화됐어.', en: 'The extension is unavailable or disabled.' })} />
  return <div className="px-4 pb-6">
    <PageToolbar title={`${definition.name} · ${page.title}`} actions={<Button variant="secondary" onClick={() => setPicker(true)}>{t({ ko: '파일 선택', en: 'Choose files' })}</Button>} />
    {files || page.accepts.length === 0 ? <PluginConnection key={`${pluginId}/${pageId}/${files}`} pluginId={pluginId} pageId={pageId} fileIds={files} /> : <p className="py-4 text-sm text-muted-foreground">{t({ ko: '이 도구로 열 파일을 선택해줘.', en: 'Choose files to open in this tool.' })}</p>}
    <Modal open={picker} onClose={() => setPicker(false)} title={t({ ko: '확장에 연결할 파일', en: 'Files for this extension' })} size="wide"><ModalBody>
      <FileBrowser parentId={folder} onNavigate={setFolder} onPick={pick} accept={page.accepts.length ? page.accepts : undefined} pickLabel={(count) => t({ ko: '{count}개 연결', en: 'Connect {count}' }, { count })} />
    </ModalBody></Modal>
  </div>
}

function PluginConnection({ pluginId, pageId, fileIds }: { pluginId: string; pageId: string; fileIds: string }) {
  const [instance, setInstance] = useState<PluginInstance | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false, active: PluginInstance | null = null
    void openPlugin(pluginId, pageId, fileIds ? fileIds.split(',') : []).then((value) => {
      active = value
      if (disposed) void closePlugin(value.id)
      else setInstance(value)
    }).catch((reason: unknown) => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)) })
    const onHide = (event: PageTransitionEvent) => { if (!event.persisted && active) void closePlugin(active.id) }
    window.addEventListener('pagehide', onHide)
    return () => { disposed = true; window.removeEventListener('pagehide', onHide); if (active) void closePlugin(active.id) }
  }, [pluginId, pageId, fileIds])
  return error ? <ErrorState description={error} /> : instance ? <PluginFrame instance={instance} /> : <LoadingState />
}

function PluginFrame({ instance }: { instance: PluginInstance }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const frame = useRef<HTMLIFrameElement>(null)
  const channel = useRef<MessagePort | null>(null)
  const initialized = useRef(false)
  const alive = useRef(true)
  const inFlight = useRef(0)
  const rate = useRef({ start: Date.now(), count: 0 })
  const commands = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>())
  const [snapshot, setSnapshot] = useState<PluginSnapshot>({ revision: '0', data: { files: instance.files } })
  const [proposals, setProposals] = useState<PluginWriteProposal[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [closed, setClosed] = useState(false)
  const [blockedFrame, setBlockedFrame] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const checking = useRef(false)
  const stop = useCallback(() => {
    channel.current?.close(); channel.current = null
    for (const pending of commands.current.values()) { clearTimeout(pending.timer); pending.reject(new Error('확장 연결이 닫혔어.')) }
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
        setConnectionError(t({ ko: '연결이 종료됐어. 남아 있는 초안을 복사한 뒤 확장을 다시 열어줘.', en: 'The connection ended. Copy your draft before reopening the extension.' }))
      } else {
        setConnectionError(t({ ko: '연결을 확인하지 못했어. 초안은 유지돼. 네트워크가 돌아오면 다시 확인해줘.', en: 'Could not check the connection. Your draft is kept. Retry when the network returns.' }))
      }
    } finally { checking.current = false }
  }, [closed, instance.id, stop, t])
  useUnsavedSettingsGuard(!!snapshot.dirty || proposals.length > 0 || busy, t({ ko: '확장에 저장하지 않은 초안이나 검토 중인 변경이 있어. 떠날까?', en: 'This extension has unsaved drafts or pending changes. Leave?' }), true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; stop() }
  }, [stop])
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
    if (!port || closed) { reject(new Error('확장 화면이 준비되지 않았어.')); return }
    const id = createRandomUuid()
    const timer = setTimeout(() => { commands.current.delete(id); reject(new Error('확장 작업 응답이 늦어지고 있어. 화면을 확인해줘.')) }, 15_000)
    commands.current.set(id, { resolve, reject, timer })
    port.postMessage({ type: 'action', id, actionId, args })
  })
  useChatPageRegistration(closed ? null : {
    title: instance.page.title,
    kind: 'extension', resourceId: instance.plugin.version, fields: [], actions: instance.page.actions,
    localRevision: snapshot.revision, data: snapshot.data, dirty: snapshot.dirty,
    apply: () => { throw new Error('등록된 확장 작업을 사용해줘.') },
    applyAction: async (actionId, args, assertCurrent) => { assertCurrent(); await perform(actionId, args); assertCurrent() },
  })

  const connect = () => {
    // A second document load invalidates the channel instead of handing privileges to a navigated document.
    if (initialized.current) { stop(); setClosed(true); setBlockedFrame(true); setError(t({ ko: '확장 페이지가 이동했어. 다시 열어줘.', en: 'The extension navigated. Open it again.' })); return }
    initialized.current = true
    const connection = new MessageChannel()
    channel.current = connection.port1
    connection.port1.onmessage = (event: MessageEvent) => {
      if (!alive.current) return
      const message = event.data as { type?: string; id?: string; method?: string; args?: unknown; error?: string; snapshot?: PluginSnapshot }
      if (!message || typeof message !== 'object') return
      if (Date.now() - rate.current.start > 1000) rate.current = { start: Date.now(), count: 0 }
      if (++rate.current.count > 40) { stop(); setClosed(true); setBlockedFrame(true); setError('확장 요청이 너무 많아.'); return }
      if (message.type === 'action-result' && typeof message.id === 'string') {
        const pending = commands.current.get(message.id)
        if (!pending) return
        clearTimeout(pending.timer); commands.current.delete(message.id)
        if (message.error) pending.reject(new Error(String(message.error).slice(0, 500)))
        else pending.resolve()
        return
      }
      if (message.type === 'snapshot') {
        try {
          if (JSON.stringify(message.snapshot).length > 200_000) throw new Error('화면 정보가 너무 커.')
          const state = message.snapshot
          if (!state || typeof state.revision !== 'string' || state.revision.length > 100 || !state.data || Array.isArray(state.data)) throw new Error('화면 정보가 올바르지 않아.')
          const data = copyChatPageData(state.data) as Record<string, ChatPageData>
          setSnapshot({ revision: state.revision, dirty: state.dirty === true, data })
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
        return
      }
      if (message.type !== 'request' || typeof message.id !== 'string' || message.id.length > 100 || inFlight.current >= 4) return
      const requestId = message.id
      const respond = (result: unknown, failed = false) => { if (alive.current) connection.port1.postMessage({ type: 'response', id: requestId, ...(failed ? { error: String(result).slice(0, 500) } : { result }) }) }
      inFlight.current++
      void (async () => {
        if (JSON.stringify(message.args ?? null).length > 4_500_000) throw new Error('요청이 너무 커.')
        const args = message.args as Record<string, unknown> | undefined
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
    frame.current?.contentWindow?.postMessage({ type: 'conai-plugin-connect', version: 1, files: instance.files, actions: instance.page.actions, language: document.documentElement.lang || 'ko' }, '*', [connection.port2])
  }
  const apply = async (proposal: PluginWriteProposal) => {
    setBusy(true); setError('')
    try {
      const approval = await pluginRequest<{ applied: boolean; approval?: string; result?: unknown }>(`/proposals/${proposal.id}/approve`, 'POST')
      const result = approval.applied ? approval.result : await pluginRequest(`/proposals/${proposal.id}/apply`, 'POST', { approval: approval.approval })
      setProposals((items) => items.filter((item) => item.id !== proposal.id))
      await queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY })
      channel.current?.postMessage({ type: 'saved', proposalId: proposal.id, result })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <>
    {error ? <p role="alert" className="py-2 text-sm text-destructive">{error}</p> : null}
    {connectionError ? <div role="alert" className="py-2 text-sm"><p>{connectionError}</p>{closed ? null : <Button variant="secondary" onClick={() => void checkConnection()}>{t({ ko: '연결 다시 확인', en: 'Retry connection' })}</Button>}</div> : null}
    {blockedFrame ? null : <iframe ref={frame} title={instance.page.title} sandbox="allow-scripts" referrerPolicy="no-referrer" src={`/api/plugin-assets/${instance.plugin.id}/${instance.plugin.version}/${instance.page.entry}`} onLoad={connect} className="h-[65vh] w-full border-0" />}
    {proposals.map((proposal) => <section key={proposal.id} className="border-t border-line py-4">
      <h2 className="text-sm font-semibold">{t({ ko: '저장 검토', en: 'Review save' })} · {proposal.name}</h2>
      <div className="my-3 grid gap-3 md:grid-cols-2">
        <div><p className="mb-1 text-xs text-muted-foreground">{t({ ko: '현재 내용', en: 'Current text' })}</p><CodeBlock maxHeight="md" wrap>{proposal.before}</CodeBlock></div>
        <div><p className="mb-1 text-xs text-muted-foreground">{t({ ko: '저장할 내용', en: 'Proposed text' })}</p><CodeBlock maxHeight="md" wrap>{proposal.text}</CodeBlock></div>
      </div>
      <div className="flex gap-2"><Button disabled={busy || closed} onClick={() => void apply(proposal)}>{t({ ko: '적용', en: 'Apply' })}</Button><Button variant="secondary" disabled={busy} onClick={() => {
        void pluginRequest(`/proposals/${proposal.id}`, 'DELETE').catch(() => undefined)
        setProposals((items) => items.filter((item) => item.id !== proposal.id))
      }}>{t({ ko: '취소', en: 'Cancel' })}</Button></div>
    </section>)}
  </>
}
