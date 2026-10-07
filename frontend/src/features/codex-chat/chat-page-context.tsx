import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Monitor } from 'lucide-react'
import { chatPagePatch, chatPagePermission, normalizeChatPageSnapshot, requireChatPageTarget, requireChatPageActionState, type ChatPageAction, type ChatPageData, type ChatPageField, type ChatPageSnapshot, type ChatPageValue, type ChatProposal, type ChatWorkflowSnapshot } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { acknowledgeChatPageProposal, checkChatPageProposal } from '@/lib/api-codex-chat'
import { createRandomUuid } from '@/lib/random-uuid'
import { PAGE_ACCESS_CATALOG } from '@/features/auth/page-access-catalog'
import { pageAction, pageChoice, pageObject } from './page-action-helpers'

type PageProposal = Extract<ChatProposal, { kind: 'page_fields' }>
export type PageActionProposal = Extract<ChatProposal, { kind: 'page_action' }>
export type WorkflowPageProposal = Extract<ChatProposal, { kind: 'workflow_graph' }>
export type WorkflowUndo = { isCurrent: () => boolean; restore: () => void }
type Editor = { instanceId: string; path: string; title: string; kind: ChatPageSnapshot['kind']; resourceId: string | null; fields: ChatPageField[]; workflow?: ChatWorkflowSnapshot; revision?: string; actions?: ChatPageAction[]; data?: Record<string, ChatPageData>; priority?: number; apply: (patch: Record<string, ChatPageValue>) => void; applyWorkflow?: (proposal: WorkflowPageProposal) => WorkflowUndo; applyAction?: (id: string, args: Record<string, ChatPageData>, assertCurrent: () => void, nativeRevision?: string) => Promise<WorkflowUndo | void> | WorkflowUndo | void }
type PageApi = {
  snapshot: ChatPageSnapshot | null
  available: boolean
  enabled: boolean
  toggle: () => void
  disconnect: () => void
  capture: () => ChatPageSnapshot | undefined
  register: (editor: Editor) => () => void
  states: ReadonlyMap<number, 'applied' | 'undone'>
  apply: (proposal: PageProposal, undo?: boolean) => Promise<void>
  workflowProblem: (proposal: WorkflowPageProposal, undo?: boolean) => string
  applyWorkflow: (proposal: WorkflowPageProposal, undo?: boolean) => Promise<void>
  actionProblem: (proposal: PageActionProposal, undo?: boolean) => string
  applyAction: (proposal: PageActionProposal, undo?: boolean) => Promise<void>
  actionUndos: ReadonlyMap<number, WorkflowUndo>
}
const PageContext = createContext<PageApi | null>(null)

function validateWorkflow(snapshot: ChatPageSnapshot | null, proposal: WorkflowPageProposal, undo: boolean, record?: WorkflowUndo) {
  if (!snapshot?.workflow) throw new Error('워크플로 편집기를 채팅에 연결해줘.')
  requireChatPageTarget(snapshot, proposal.page)
  if (undo) {
    if (!record?.isCurrent()) throw new Error('적용 뒤 워크플로를 편집했어. 현재 작업을 보호하려고 되돌리기를 중단했어.')
  } else if (snapshot.workflow.revision !== proposal.revision || proposal.expiresAt < Date.now()) throw new Error('워크플로가 바뀌었거나 제안의 유효 시간이 지났어. 다시 제안받아줘.')
}

/** A local registry of form setters; no DOM inspection or code execution. */
export function ChatPageProvider({ children }: PropsWithChildren) {
  const location = useLocation()
  const auth = useAuthStatusQuery().data
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const accountKey = `${auth?.hasCredentials}:${auth?.authenticated}:${auth?.accountId ?? 'bootstrap'}`
  const [connection, setConnection] = useState<{ id: string; accountKey: string } | null>(null)
  const [editors, setEditors] = useState<Editor[]>([])
  const [states, setStates] = useState(new Map<number, 'applied' | 'undone'>())
  const statesRef = useRef(states)
  const busy = useRef(new Set<number>())
  const workflowUndos = useRef(new Map<number, WorkflowUndo>())
  const actionUndos = useRef(new Map<number, WorkflowUndo>())
  const instanceId = useMemo(() => ({ key: `${location.key}:${location.pathname}:${accountKey}`, id: createRandomUuid() }), [location.key, location.pathname, accountKey]).id
  const permission = chatPagePermission(location.pathname)
  const available = !!auth?.authenticated && !!permission && auth.permissionKeys.includes(permission) && auth.permissionKeys.includes('chat.tools.read')
  const enabled = available && connection?.accountKey === accountKey
  const primaryEditor = editors.filter((item) => item.path === location.pathname).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0] ?? null
  const workflowBrowser = editors.find((item) => item.path === location.pathname && item.kind === 'workflow_runner' && item.resourceId === 'workflow-browser')
  const activeEditor = useMemo(() => {
    if (primaryEditor?.kind !== 'workflow_runner' || primaryEditor.resourceId === 'workflow-browser' || !workflowBrowser) return primaryEditor
    return { ...primaryEditor, actions: [...(primaryEditor.actions ?? []), ...(workflowBrowser.actions ?? [])], data: { ...workflowBrowser.data, ...primaryEditor.data }, applyAction: workflowBrowser.applyAction }
  }, [primaryEditor, workflowBrowser])
  const fallbackTitle = t({
    ko: ({ '/': '이미지 라이브러리', '/access': '접근 가능한 페이지', '/chat': '채팅', '/generation': '이미지 생성', '/prompts': '프롬프트', '/groups': '그룹', '/wildcards': '와일드카드', '/files': '파일 보관함', '/upload': '업로드', '/settings': '설정', '/wallpaper': '배경화면', '/wallpaper/runtime': '배경화면 실행' } as Record<string, string>)[location.pathname] ?? (location.pathname.startsWith('/groups/') ? '그룹 상세' : '이미지 상세'),
    en: ({ '/': 'Image library', '/access': 'Available pages', '/chat': 'Chat', '/generation': 'Image generation', '/prompts': 'Prompts', '/groups': 'Groups', '/wildcards': 'Wildcards', '/files': 'File store', '/upload': 'Upload', '/settings': 'Settings', '/wallpaper': 'Wallpaper', '/wallpaper/runtime': 'Wallpaper runtime' } as Record<string, string>)[location.pathname] ?? (location.pathname.startsWith('/groups/') ? 'Group detail' : 'Image detail'),
  })
  const title = activeEditor?.title ?? fallbackTitle
  const snapshot = useMemo<ChatPageSnapshot | null>(() => enabled && connection ? {
    instanceId: activeEditor?.instanceId ?? instanceId, connectionId: connection.id, path: location.pathname, title,
    kind: activeEditor?.kind ?? 'page', resourceId: activeEditor?.resourceId ?? null, fields: activeEditor?.fields ?? [],
    ...(activeEditor?.workflow ? { workflow: activeEditor.workflow } : {}),
    ...(activeEditor?.revision ? { revision: activeEditor.revision } : {}),
    ...(activeEditor?.actions ? { actions: activeEditor.actions } : {}),
    data: { view: new URLSearchParams(location.search).get('tab') ?? new URLSearchParams(location.search).get('section') ?? '', ...(activeEditor?.data ?? {}) },
  } : null, [enabled, connection, activeEditor, instanceId, location.pathname, location.search, title])
  const current = useRef({ snapshot, editor: activeEditor })
  useLayoutEffect(() => { current.current = { snapshot, editor: activeEditor } })
  useEffect(() => { statesRef.current = new Map(); workflowUndos.current.clear(); actionUndos.current.clear(); setStates(statesRef.current) }, [accountKey])
  const toggle = useCallback(() => setConnection((old) => old?.accountKey === accountKey ? null : { id: createRandomUuid(), accountKey }), [accountKey])
  const disconnect = useCallback(() => setConnection(null), [])
  const register = useCallback((next: Editor) => {
    setEditors((old) => [...old.filter((item) => item.instanceId !== next.instanceId), next])
    return () => setEditors((old) => old.filter((item) => item.instanceId !== next.instanceId))
  }, [])
  const capture = useCallback(() => current.current.snapshot ? normalizeChatPageSnapshot(current.current.snapshot) : undefined, [])
  const apply = useCallback(async (proposal: PageProposal, undo = false) => {
    if (busy.current.size) throw new Error('다른 제안을 처리하고 있어.')
    const state = statesRef.current.get(proposal.id)
    if (undo ? state !== 'applied' : !!state || proposal.saved) throw new Error('이미 처리한 제안이야.')
    const before = current.current
    if (!before.snapshot || !before.editor) throw new Error('편집할 페이지를 채팅에 연결해줘.')
    chatPagePatch(before.snapshot, proposal, undo)
    busy.current.add(proposal.id)
    try {
      const authorized = await checkChatPageProposal(proposal, undo)
      const live = current.current
      if (!live.snapshot || !live.editor) throw new Error('페이지 연결이 해제됐어.')
      const patch = chatPagePatch(live.snapshot, authorized, undo)
      live.editor.apply(patch)
      statesRef.current = new Map(statesRef.current).set(proposal.id, undo ? 'undone' : 'applied')
      setStates(statesRef.current)
      if (!undo) {
        try { await acknowledgeChatPageProposal(authorized) }
        catch { showSnackbar({ message: t({ ko: '입력은 적용했어. 채팅의 적용 상태는 기록하지 못했어.', en: 'The inputs were applied, but their chat receipt could not be saved.' }), tone: 'error' }) }
      }
    } finally { busy.current.delete(proposal.id) }
  }, [showSnackbar, t])
  const workflowProblem = useCallback((proposal: WorkflowPageProposal, undo = false) => {
    try { validateWorkflow(snapshot, proposal, undo, workflowUndos.current.get(proposal.id)); return '' }
    catch (error) { return error instanceof Error ? error.message : '워크플로를 확인하지 못했어.' }
  }, [snapshot])
  const applyWorkflow = useCallback(async (proposal: WorkflowPageProposal, undo = false) => {
    if (busy.current.size) throw new Error('다른 제안을 처리하고 있어.')
    const state = statesRef.current.get(proposal.id)
    if (undo ? state !== 'applied' : !!state || proposal.saved || proposal.dismissed) throw new Error('이미 처리한 제안이야.')
    validateWorkflow(current.current.snapshot, proposal, undo, workflowUndos.current.get(proposal.id))
    busy.current.add(proposal.id)
    try {
      const authorized = await checkChatPageProposal(proposal, undo)
      const live = current.current
      validateWorkflow(live.snapshot, authorized, undo, workflowUndos.current.get(proposal.id))
      if (undo) { workflowUndos.current.get(proposal.id)!.restore(); workflowUndos.current.delete(proposal.id) }
      else {
        if (!live.editor?.applyWorkflow) throw new Error('워크플로 편집기가 닫혔어.')
        workflowUndos.current.set(proposal.id, live.editor.applyWorkflow(authorized))
      }
      statesRef.current = new Map(statesRef.current).set(proposal.id, undo ? 'undone' : 'applied')
      setStates(statesRef.current)
      if (!undo) {
        try { await acknowledgeChatPageProposal(authorized) }
        catch { showSnackbar({ message: t({ ko: '워크플로 초안은 적용했어. 채팅의 적용 상태는 기록하지 못했어.', en: 'The workflow draft was applied, but its chat receipt could not be saved.' }), tone: 'error' }) }
      }
    } finally { busy.current.delete(proposal.id) }
  }, [showSnackbar, t])
  const actionProblem = useCallback((proposal: PageActionProposal, undo = false) => {
    try {
      if (!snapshot) throw new Error('대상 페이지를 채팅에 연결해줘.')
      requireChatPageTarget(snapshot, proposal.page)
      if (undo) { if (!actionUndos.current.get(proposal.id)?.isCurrent()) throw new Error('적용 뒤 입력이 바뀌었어. 현재 작업을 보호하려고 되돌리기를 중단했어.') }
      else requireChatPageActionState(snapshot, proposal)
      return ''
    } catch (error) { return error instanceof Error ? error.message : '페이지 작업을 확인하지 못했어.' }
  }, [snapshot])
  const applyAction = useCallback(async (proposal: PageActionProposal, undo = false) => {
    if (busy.current.size) throw new Error('다른 제안을 처리하고 있어.')
    const state = statesRef.current.get(proposal.id)
    if (undo ? state !== 'applied' : !!state || proposal.saved) throw new Error('이미 처리한 제안이야.')
    const assertCurrent = () => {
      const live = current.current
      if (!live.snapshot || !live.editor?.applyAction) throw new Error('페이지 연결이나 편집기가 닫혔어.')
      requireChatPageTarget(live.snapshot, proposal.page)
      if (undo) { if (!actionUndos.current.get(proposal.id)?.isCurrent()) throw new Error('적용 뒤 입력이 바뀌었어.') }
      else requireChatPageActionState(live.snapshot, proposal)
    }
    assertCurrent()
    busy.current.add(proposal.id)
    try {
      const authorized = await checkChatPageProposal(proposal, undo)
      assertCurrent()
      if (undo) { actionUndos.current.get(proposal.id)!.restore(); actionUndos.current.delete(proposal.id) }
      else {
        const record = await current.current.editor!.applyAction!(authorized.action.id, authorized.arguments, assertCurrent, authorized.nativeRevision)
        if (record && authorized.action.effect === 'draft') actionUndos.current.set(proposal.id, record)
      }
      statesRef.current = new Map(statesRef.current).set(proposal.id, undo ? 'undone' : 'applied')
      setStates(statesRef.current)
      if (!undo) {
        try { await acknowledgeChatPageProposal(authorized) }
        catch { showSnackbar({ message: t({ ko: '작업은 적용했어. 채팅의 적용 상태는 기록하지 못했어.', en: 'The operation was applied, but its chat receipt could not be saved.' }), tone: 'error' }) }
      }
    } finally { busy.current.delete(proposal.id) }
  }, [showSnackbar, t])
  const api = useMemo<PageApi>(() => ({ snapshot, available, enabled, toggle, disconnect, capture, register, states, apply, workflowProblem, applyWorkflow, actionProblem, applyAction, actionUndos: actionUndos.current }), [snapshot, available, enabled, toggle, disconnect, capture, register, states, apply, workflowProblem, applyWorkflow, actionProblem, applyAction])
  return <PageContext.Provider value={api}><PageNavigationRegistration title={fallbackTitle} />{children}</PageContext.Provider>
}

function PageNavigationRegistration({ title }: { title: string }) {
  const auth = useAuthStatusQuery().data
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const destinations = PAGE_ACCESS_CATALOG.filter((item) => auth?.permissionKeys.includes(item.permissionKey)).map((item) => item.path)
  const actions = destinations.length && !['/settings', '/generation'].includes(location.pathname) ? [pageAction('page.navigate', t({ ko: '내부 페이지 이동', en: 'Navigate within CoNAI' }), t({ ko: '접근 가능한 CoNAI 페이지로 이동해.', en: 'Open an accessible CoNAI page.' }), pageObject({ path: pageChoice(destinations) }, ['path']))] : []
  useChatPageRegistration({ kind: 'page', title, resourceId: null, priority: -100, fields: [], actions, apply: () => {}, applyAction: (_id, args, assertCurrent) => { assertCurrent(); void navigate(String(args.path)) } })
  return null
}

export function useChatPage() { return useContext(PageContext) }

/** Primitive descriptors stay stable across unrelated chat renders; setters always read their latest closure. */
export function useChatPageRegistration(input: (Omit<Editor, 'instanceId' | 'path' | 'revision'> & { localRevision?: string }) | null, options?: { preserveOnSearchChange?: boolean }) {
  const page = useChatPage()
  const register = page?.register
  const location = useLocation()
  const applyRef = useRef(input?.apply)
  const workflowApplyRef = useRef(input?.applyWorkflow)
  const actionApplyRef = useRef(input?.applyAction)
  useLayoutEffect(() => { applyRef.current = input?.apply; workflowApplyRef.current = input?.applyWorkflow; actionApplyRef.current = input?.applyAction })
  const description = input ? JSON.stringify({ title: input.title, kind: input.kind, resourceId: input.resourceId, fields: input.fields, workflow: input.workflow, actions: input.actions, data: input.data, priority: input.priority }) : null
  const revisionKey = `${description}:${input?.localRevision ?? ''}`
  const revision = useMemo(() => ({ key: revisionKey, id: createRandomUuid() }), [revisionKey]).id
  const kind = input?.kind
  const resourceId = input?.resourceId
  // View controls that write URL search params retain undo within the same mounted view.
  const navigationKey = options?.preserveOnSearchChange ? location.pathname : location.key
  const instanceId = useMemo(() => ({ key: `${navigationKey}:${location.pathname}:${kind}:${resourceId}`, id: createRandomUuid() }), [navigationKey, location.pathname, kind, resourceId]).id
  useLayoutEffect(() => {
    if (!register || !description) return
    const data = JSON.parse(description) as Omit<Editor, 'instanceId' | 'path' | 'apply' | 'applyWorkflow' | 'applyAction'>
    return register({ ...data, revision, instanceId, path: location.pathname, apply: (patch) => applyRef.current?.(patch), applyAction: async (id, args, assertCurrent, nativeRevision) => {
      if (!actionApplyRef.current) throw new Error('페이지 작업 편집기가 닫혔어.')
      return actionApplyRef.current(id, args, assertCurrent, nativeRevision)
    }, applyWorkflow: (proposal) => {
      if (!workflowApplyRef.current) throw new Error('워크플로 편집기가 닫혔어.')
      return workflowApplyRef.current(proposal)
    } })
  }, [register, description, revision, instanceId, location.pathname])
}

export function ChatPageConnectButton({ disabled, allowed }: { disabled: boolean; allowed: boolean }) {
  const page = useChatPage()
  const { t } = useI18n()
  if (!page?.available) return null
  const label = t(page.enabled ? { ko: '현재 페이지 연결 해제', en: 'Disconnect current page' } : { ko: '현재 페이지 연결', en: 'Connect current page' })
  const hint = t(allowed ? { ko: '현재 페이지의 등록된 입력과 워크플로 편집 정보를 전달해. 채팅이 만든 변경안을 검토하고 직접 적용해.', en: 'Share registered page inputs and workflow editor state. Review and apply the changes proposed by chat.' } : { ko: '프로필 도구에서 현재 페이지 읽기를 허용해줘.', en: 'Allow Read current page in the profile tools.' })
  return <Tip content={hint}><IconButton variant="ghost" size="icon-sm" active={page.enabled && allowed} disabled={disabled || !allowed} onClick={page.toggle} label={label} tooltip={false}><Monitor /></IconButton></Tip>
}

export function ChatPageConnectionNotice({ allowed }: { allowed: boolean }) {
  const page = useChatPage()
  const { t } = useI18n()
  if (!page?.snapshot || !allowed) return null
  const inputCount = page.snapshot.fields.filter((field) => field.editable !== false).length
  const workflow = page.snapshot.workflow
  const actionCount = page.snapshot.actions?.length ?? 0
  return <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Monitor className="size-3.5 shrink-0" /><span>{t({ ko: '연결된 페이지: {name}', en: 'Connected page: {name}' }, { name: page.snapshot.title })}{workflow ? t({ ko: ' · 노드 {nodes}개 · 연결 {edges}개', en: ' · {nodes} nodes · {edges} edges' }, { nodes: workflow.nodes.length, edges: workflow.edges.length }) : inputCount ? t({ ko: ' · 입력 {count}개', en: ' · {count} inputs' }, { count: inputCount }) : ''}{actionCount ? t({ ko: ' · 작업 {count}개', en: ' · {count} operations' }, { count: actionCount }) : !inputCount && !workflow ? t({ ko: ' · 페이지 정보 읽기만 지원', en: ' · Page information only' }) : ''}</span></p>
}
