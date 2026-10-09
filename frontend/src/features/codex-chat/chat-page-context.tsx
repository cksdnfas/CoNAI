import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Monitor } from 'lucide-react'
import { CHAT_PAGE_ACTION_LIMITS, chatPageActionLeavesScreen, chatPageActionTier, chatPagePatch, chatPagePermission, chatPageTarget, validateChatPageArguments, type ChatPageCommandEvent, normalizeChatPageSnapshot, requireChatPageTarget, requireChatPageActionState, type ChatPageAction, type ChatPageData, type ChatPageField, type ChatPageSnapshot, type ChatPageValue, type ChatProposal, type ChatWorkflowSnapshot } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { acknowledgeChatPageProposal, answerChatPageCommand, checkChatPageProposal } from '@/lib/api-codex-chat'
import { createRuntimeEventStream } from '@/lib/runtime-event-stream'
import { createRandomUuid } from '@/lib/random-uuid'
import { PAGE_ACCESS_CATALOG } from '@/features/auth/page-access-catalog'
import { SETTINGS_TAB_ITEMS } from '@/features/settings/settings-tabs'
import { IMAGE_GENERATION_TAB_ORDER } from '@/features/image-generation/image-generation-tabs'
import { PROMPT_PAGE_VIEWS } from '@/features/prompts/prompt-page-view'
import { pageAction, pageChoice, pageObject } from './page-action-helpers'

type PageProposal = Extract<ChatProposal, { kind: 'page_fields' }>
export type PageActionProposal = Extract<ChatProposal, { kind: 'page_action' }>
export type WorkflowPageProposal = Extract<ChatProposal, { kind: 'workflow_graph' }>
export type WorkflowUndo = { isCurrent: () => boolean; restore: () => void }
type Editor = { instanceId: string; path: string; title: string; kind: ChatPageSnapshot['kind']; resourceId: string | null; fields: ChatPageField[]; workflow?: ChatWorkflowSnapshot; revision?: string; actions?: ChatPageAction[]; data?: Record<string, ChatPageData>; priority?: number; dirty?: boolean; apply: (patch: Record<string, ChatPageValue>) => void; applyWorkflow?: (proposal: WorkflowPageProposal) => WorkflowUndo; applyAction?: (id: string, args: Record<string, ChatPageData>, assertCurrent: () => void, nativeRevision?: string) => Promise<WorkflowUndo | void> | WorkflowUndo | void }
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
  /** What the chat ran on the connected screen (newest last); drafts can be undone while the screen still holds them. */
  activity: ChatPageActivity[]
  undoActivity: (id: string) => void
  /** The chat is running an operation on this screen right now (and for a moment after). */
  driving: boolean
  /** The field still holds the value the chat filled on this screen; a manual edit clears it. */
  isFilled: (fieldId: string) => boolean
}
const PageContext = createContext<PageApi | null>(null)

export type ChatPageActivity = { id: string; threadId: number; label: string; tier: 'view' | 'draft'; at: number; state: 'done' | 'undone'; undo?: () => void }
const ACTIVITY_LIMIT = 30

/** Wait until the screen stops changing (a route or editor may still be loading), up to a few seconds. */
async function settledSnapshot(read: () => ChatPageSnapshot | undefined) {
  const deadline = Date.now() + 5000
  let last = ''
  let stable = 0
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const key = JSON.stringify(read() ?? null)
    if (key !== 'null' && key === last) { stable += 1; if (stable >= 3) break }
    else { stable = 0; last = key }
  }
  return read()
}

/** The app-wide navigation entry registers below every page editor and is merged into whichever editor is active. */
const NAVIGATION_PRIORITY = -100
/** Pages whose views live in one query parameter; navigation offers each view as its own destination. */
const PAGE_VIEWS: Record<string, { param: string; values: readonly string[] }> = {
  '/settings': { param: 'section', values: SETTINGS_TAB_ITEMS.map((item) => item.value) },
  '/generation': { param: 'tab', values: IMAGE_GENERATION_TAB_ORDER },
  '/prompts': { param: 'tab', values: PROMPT_PAGE_VIEWS },
  '/sprite': { param: 'tab', values: ['extract', 'normalize', 'animation'] },
}
/** Views nested inside one of those views (settings › chat and › LLM keep their own ?view=). */
const NESTED_VIEWS: Record<string, string[]> = {
  '/settings': [
    ...['resources', 'mine'].map((view) => `/settings?section=chat&view=${view}`),
    ...['connections', 'judge'].map((view) => `/settings?section=llm&view=${view}`),
  ],
}

function withNavigation(editor: Editor | null, navigation: Editor | undefined): Editor | null {
  const navigate = navigation?.actions?.find((action) => action.id === 'page.navigate')
  if (!editor || !navigation || !navigate || editor === navigation) return editor
  const actions = editor.actions ?? []
  if (actions.some((action) => action.id === 'page.navigate') || actions.length >= CHAT_PAGE_ACTION_LIMITS.actions) return editor
  const own = editor.applyAction
  return {
    ...editor,
    actions: [...actions, navigate],
    applyAction: (id, args, assertCurrent, nativeRevision) => {
      if (id === 'page.navigate') return navigation.applyAction?.(id, args, assertCurrent)
      if (!own) throw new Error('페이지 작업 편집기가 닫혔어.')
      return own(id, args, assertCurrent, nativeRevision)
    },
  }
}

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
  const available = !!auth?.authenticated && permission !== null && (permission === '' || auth.permissionKeys.includes(permission))
  const enabled = available && connection?.accountKey === accountKey
  const primaryEditor = editors.filter((item) => item.path === location.pathname).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0] ?? null
  const workflowBrowser = editors.find((item) => item.path === location.pathname && item.kind === 'workflow_runner' && item.resourceId === 'workflow-browser')
  const navigation = editors.find((item) => item.path === location.pathname && item.kind === 'page' && item.priority === NAVIGATION_PRIORITY)
  const activeEditor = useMemo(() => {
    if (primaryEditor?.kind !== 'workflow_runner' || primaryEditor.resourceId === 'workflow-browser' || !workflowBrowser) return withNavigation(primaryEditor, navigation)
    return withNavigation({ ...primaryEditor, actions: [...(primaryEditor.actions ?? []), ...(workflowBrowser.actions ?? [])], data: { ...workflowBrowser.data, ...primaryEditor.data }, applyAction: workflowBrowser.applyAction }, navigation)
  }, [primaryEditor, workflowBrowser, navigation])
  const fallbackTitle = t({
    ko: ({ '/': '이미지 라이브러리', '/access': '접근 가능한 페이지', '/chat': '채팅', '/generation': '이미지 생성', '/prompts': '프롬프트', '/groups': '그룹', '/wildcards': '와일드카드', '/files': '파일 보관함', '/upload': '업로드', '/settings': '설정', '/wallpaper': '배경화면', '/wallpaper/runtime': '배경화면 실행' } as Record<string, string>)[location.pathname] ?? (location.pathname.startsWith('/groups/') ? '그룹 상세' : '이미지 상세'),
    en: ({ '/': 'Image library', '/access': 'Available pages', '/chat': 'Chat', '/generation': 'Image generation', '/prompts': 'Prompts', '/groups': 'Groups', '/wildcards': 'Wildcards', '/files': 'File store', '/upload': 'Upload', '/settings': 'Settings', '/wallpaper': 'Wallpaper', '/wallpaper/runtime': 'Wallpaper runtime' } as Record<string, string>)[location.pathname] ?? (location.pathname.startsWith('/groups/') ? 'Group detail' : 'Image detail'),
  })
  const title = activeEditor?.title ?? fallbackTitle
  const [activity, setActivity] = useState<ChatPageActivity[]>([])
  const [driving, setDriving] = useState(false)
  const drivingTimer = useRef<number | null>(null)
  /** `${instanceId}:${fieldId}` → JSON of the value the chat filled. */
  const [filled, setFilled] = useState(new Map<string, string>())
  const handledCommands = useRef(new Set<string>())
  const snapshot = useMemo<ChatPageSnapshot | null>(() => enabled && connection ? {
    instanceId: activeEditor?.instanceId ?? instanceId, connectionId: connection.id, path: location.pathname, title,
    kind: activeEditor?.kind ?? 'page', resourceId: activeEditor?.resourceId ?? null, fields: activeEditor?.fields ?? [],
    ...(activeEditor?.workflow ? { workflow: activeEditor.workflow } : {}),
    ...(activeEditor?.revision ? { revision: activeEditor.revision } : {}),
    ...(activeEditor?.actions ? { actions: activeEditor.actions } : {}),
    ...(activeEditor?.dirty ? { dirty: true as const } : {}),
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
  const connectionId = enabled ? connection?.id ?? null : null
  const connectionRef = useRef(connectionId)
  useLayoutEffect(() => { connectionRef.current = connectionId })
  const record = useCallback((entry: Omit<ChatPageActivity, 'at' | 'state'>) => {
    setActivity((old) => [...old, { ...entry, at: Date.now(), state: 'done' as const }].slice(-ACTIVITY_LIMIT))
  }, [])
  const undoActivity = useCallback((id: string) => {
    const entry = activity.find((item) => item.id === id)
    if (!entry?.undo || entry.state !== 'done') throw new Error('되돌릴 수 없는 작업이야.')
    entry.undo()
    setActivity((old) => old.map((item) => item.id === id ? { ...item, state: 'undone' } : item))
  }, [activity])
  /** Runs one view/draft operation the chat asked for, only from the registry of the screen it was checked against. */
  const runCommand = useCallback(async (event: ChatPageCommandEvent) => {
    if (event.connectionId !== connectionRef.current || event.expiresAt < Date.now() || handledCommands.current.has(event.commandId)) return
    handledCommands.current.add(event.commandId)
    if (event.type !== 'capture') {
      if (drivingTimer.current !== null) window.clearTimeout(drivingTimer.current)
      setDriving(true)
    }
    if (handledCommands.current.size > 200) handledCommands.current = new Set([...handledCommands.current].slice(-100))
    try {
      const live = current.current
      if (!live.snapshot || !live.editor) throw new Error('연결된 페이지가 없어.')
      if (event.type !== 'capture' && live.snapshot.instanceId !== event.instanceId) throw new Error('그사이 화면이 바뀌었어. get_current_page로 지금 화면을 읽고 다시 해.')
      const assertCurrent = () => { if (connectionRef.current !== event.connectionId) throw new Error('페이지 연결이 해제됐어.') }
      if (event.type === 'action') {
        const action = live.snapshot.actions?.find((item) => item.id === event.actionId)
        if (!action || chatPageActionTier(action.id) !== event.tier) throw new Error('이 화면에서 바로 실행할 수 없는 작업이야.')
        if (chatPageActionLeavesScreen(action.id) && live.snapshot.dirty) throw new Error('저장하지 않은 변경이 있어. 사용자가 저장하거나 버린 뒤에 다시 해.')
        const args = validateChatPageArguments(action.schema, event.arguments) as Record<string, ChatPageData>
        if (!live.editor.applyAction) throw new Error('페이지 작업 편집기가 닫혔어.')
        const undo = await live.editor.applyAction(action.id, args, assertCurrent)
        record({ id: event.commandId, threadId: event.threadId, label: action.label, tier: event.tier, ...(undo && event.tier === 'draft' ? { undo: () => { if (!undo.isCurrent()) throw new Error('그 뒤에 입력이 바뀌어서 되돌리지 않았어.'); undo.restore() } } : {}) })
      } else if (event.type === 'workflow') {
        if (!live.snapshot.workflow || !live.editor.applyWorkflow) throw new Error('노드 워크플로 편집기가 닫혔어.')
        if (live.snapshot.workflow.revision !== event.revision) throw new Error('그사이 워크플로가 바뀌었어. get_workflow_editor로 다시 읽고 해.')
        // The editor re-runs the transaction against its own state before writing; only the fields it reads are passed.
        const undo = live.editor.applyWorkflow({ revision: event.revision, operations: event.operations, modules: event.modules } as WorkflowPageProposal)
        record({ id: event.commandId, threadId: event.threadId, label: event.label, tier: 'draft', undo: () => undo.restore() })
      } else if (event.type === 'fields') {
        const proposal = { kind: 'page_fields' as const, page: chatPageTarget(live.snapshot), changes: event.changes, expiresAt: event.expiresAt }
        const filledOn = live.snapshot.instanceId
        live.editor.apply(chatPagePatch(live.snapshot, proposal))
        setFilled((old) => { const next = new Map(old); event.changes.forEach((change) => next.set(`${filledOn}:${change.fieldId}`, JSON.stringify(change.value))); return next })
        const editor = live.editor
        record({ id: event.commandId, threadId: event.threadId, label: event.changes.map((change) => change.label).join(', '), tier: 'draft', undo: () => {
          const now = current.current
          if (!now.snapshot || now.editor !== editor) throw new Error('화면이 바뀌어서 되돌리지 않았어.')
          now.editor.apply(chatPagePatch(now.snapshot, { ...proposal, page: chatPageTarget(now.snapshot) }, true))
          setFilled((old) => { const next = new Map(old); event.changes.forEach((change) => next.delete(`${filledOn}:${change.fieldId}`)); return next })
        } })
      }
      const page = await settledSnapshot(() => current.current.snapshot ? normalizeChatPageSnapshot(current.current.snapshot) : undefined)
      if (!page || page.connectionId !== event.connectionId) throw new Error('페이지 연결이 해제됐어.')
      await answerChatPageCommand(event.commandId, { ok: true, page })
    } catch (error) {
      await answerChatPageCommand(event.commandId, { ok: false, error: error instanceof Error ? error.message : '페이지 작업이 실패했어.' }).catch(() => undefined)
    } finally {
      if (event.type !== 'capture') drivingTimer.current = window.setTimeout(() => { drivingTimer.current = null; setDriving(false) }, 1500)
    }
  }, [record])
  const isFilled = useCallback((fieldId: string) => {
    if (!snapshot) return false
    const value = filled.get(`${snapshot.instanceId}:${fieldId}`)
    const field = snapshot.fields.find((item) => item.id === fieldId)
    return value !== undefined && !!field && JSON.stringify(field.value) === value
  }, [filled, snapshot])
  useEffect(() => {
    if (!connectionId) return
    return createRuntimeEventStream({
      onEnvelope: (envelope) => { if (envelope.name === 'chat.page.command') void runCommand(envelope.payload as ChatPageCommandEvent) },
      onStatusChange: () => {}, onResync: () => {}, onSessionExpired: () => {},
    })
  }, [connectionId, runCommand])
  const api = useMemo<PageApi>(() => ({ snapshot, available, enabled, toggle, disconnect, capture, register, states, apply, workflowProblem, applyWorkflow, actionProblem, applyAction, actionUndos: actionUndos.current, activity, undoActivity, driving, isFilled }), [snapshot, available, enabled, toggle, disconnect, capture, register, states, apply, workflowProblem, applyWorkflow, actionProblem, applyAction, activity, undoActivity, driving, isFilled])
  return <PageContext.Provider value={api}><PageNavigationRegistration title={fallbackTitle} />{driving ? <ChatPageDrivingBar /> : null}{children}</PageContext.Provider>
}

function PageNavigationRegistration({ title }: { title: string }) {
  const auth = useAuthStatusQuery().data
  const navigate = useNavigate()
  const { t } = useI18n()
  const destinations = PAGE_ACCESS_CATALOG.filter((item) => auth?.permissionKeys.includes(item.permissionKey)).flatMap((item) => {
    const views = PAGE_VIEWS[item.path]
    return [item.path, ...(views ? views.values.map((value) => `${item.path}?${views.param}=${value}`) : []), ...(NESTED_VIEWS[item.path] ?? [])]
  })
  const actions = destinations.length ? [pageAction('page.navigate', t({ ko: '내부 페이지 이동', en: 'Navigate within CoNAI' }), t({ ko: '접근 가능한 CoNAI 페이지나 그 탭으로 이동해. 설정은 ?section=, 다른 페이지는 ?tab= 이 탭이야.', en: 'Open an accessible CoNAI page or one of its tabs. Settings sections use ?section=, other pages ?tab=.' }), pageObject({ to: pageChoice(destinations) }, ['to']))] : []
  useChatPageRegistration({ kind: 'page', title, resourceId: null, priority: NAVIGATION_PRIORITY, fields: [], actions, apply: () => {}, applyAction: (_id, args, assertCurrent) => { assertCurrent(); void navigate(String(args.to)) } })
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
  const description = input ? JSON.stringify({ title: input.title, kind: input.kind, resourceId: input.resourceId, fields: input.fields, workflow: input.workflow, actions: input.actions, data: input.data, priority: input.priority, dirty: input.dirty }) : null
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

export function ChatPageConnectButton({ disabled }: { disabled: boolean }) {
  const page = useChatPage()
  const { t } = useI18n()
  if (!page?.available) return null
  const label = t(page.driving ? { ko: '어시스턴트가 조작 중', en: 'Assistant is operating the page' } : page.enabled ? { ko: '현재 페이지 연결 해제', en: 'Disconnect current page' } : { ko: '현재 페이지 연결', en: 'Connect current page' })
  const hint = t({ ko: '현재 페이지의 등록된 입력과 워크플로 편집 정보를 전달해. 채팅이 만든 변경안을 검토하고 직접 적용해.', en: 'Share registered page inputs and workflow editor state. Review and apply the changes proposed by chat.' })
  return <Tip content={hint}><IconButton variant="ghost" size="icon-sm" active={page.enabled} disabled={disabled} onClick={page.toggle} label={label} tooltip={false}><Monitor className={page.driving ? 'animate-pulse motion-reduce:animate-none' : undefined} /></IconButton></Tip>
}

export function ChatPageConnectionNotice() {
  const page = useChatPage()
  const { t } = useI18n()
  if (!page?.snapshot) return null
  const inputCount = page.snapshot.fields.filter((field) => field.editable !== false).length
  const workflow = page.snapshot.workflow
  const actionCount = page.snapshot.actions?.length ?? 0
  // The page's name only; what the chat can read and change sits in the tooltip.
  const details = [
    workflow ? t({ ko: '노드 {nodes} · 연결 {edges}', en: '{nodes} nodes · {edges} edges' }, { nodes: workflow.nodes.length, edges: workflow.edges.length }) : inputCount ? t({ ko: '입력 {count}', en: '{count} inputs' }, { count: inputCount }) : '',
    actionCount ? t({ ko: '작업 {count}', en: '{count} operations' }, { count: actionCount }) : !inputCount && !workflow ? t({ ko: '읽기만', en: 'Read only' }) : '',
  ].filter(Boolean).join(' · ')
  return <Tip content={details} side="top" align="start"><p className="mb-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"><Monitor aria-label={t({ ko: '연결된 페이지', en: 'Connected page' })} className="size-3.5 shrink-0" /><span className="truncate">{page.snapshot.title}</span></p></Tip>
}

/** A thin sweeping line along the top of the app while the chat operates the connected screen. */
function ChatPageDrivingBar() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[var(--z-index-toast)] h-0.5 overflow-hidden">
      <div className="h-full w-2/5 animate-progress-indeterminate bg-primary motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />
    </div>
  )
}

/** A dot next to a field label while the field still holds what the chat filled. Pages place it beside their own labels. */
export function ChatFilledMark({ fieldId, className }: { fieldId: string; className?: string }) {
  const page = useChatPage()
  const { t } = useI18n()
  if (!page?.isFilled(fieldId)) return null
  return <Tip content={t({ ko: '어시스턴트가 채움', en: 'Filled by the assistant' })}><span role="img" aria-label={t({ ko: '어시스턴트가 채움', en: 'Filled by the assistant' })} className={`inline-block size-1.5 shrink-0 rounded-full bg-primary ${className ?? ''}`} /></Tip>
}

/** A field label with the filled dot after it. */
export function ChatFilledLabel({ fieldId, children }: { fieldId: string; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5">{children}<ChatFilledMark fieldId={fieldId} /></span>
}
