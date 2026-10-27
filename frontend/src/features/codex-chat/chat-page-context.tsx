import { usePageSettings } from '@/components/common/page-settings-context'
import { type PageSettingsScopeId } from '@conai/shared'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Monitor } from 'lucide-react'
import { CHAT_PAGE_ACTION_LIMITS, CHAT_PAGE_ACTION_PERMISSIONS, chatPageActionAllowed, normalizeChatPageValue, chatPageActionLeavesScreen, chatPageActionTier, chatPagePatch, chatPagePermission, chatPageTarget, validateChatPageArguments, type ChatPageCommandEvent, normalizeChatPageSnapshot, requireChatPageTarget, requireChatPageActionState, type ChatPageAction, type ChatPageData, type ChatPageField, type ChatPageSnapshot, type ChatPageValue, type ChatProposal, type ChatWorkflowSnapshot } from '@conai/shared'
import { Tip } from '@/components/ui/tooltip'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useI18n } from '@/i18n'
import { acknowledgeChatPageProposal, answerChatPageCommand, checkChatPageProposal } from '@/lib/api-codex-chat'
import { createRuntimeEventStream } from '@/lib/runtime-event-stream'
import { createRandomUuid } from '@/lib/random-uuid'
import { PAGE_ACCESS_CATALOG } from '@/features/auth/page-access-catalog'
import { SETTINGS_TAB_ITEMS } from '@/features/settings/settings-tabs'
import { IMAGE_GENERATION_TAB_ORDER } from '@/features/image-generation/image-generation-tabs'
import { PROMPT_PAGE_VIEWS } from '@/features/prompts/prompt-page-view'
import { pageAction, pageChoice, pageObject } from './page-action-helpers'
import { ToggleChip } from '@/components/ui/chip'

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
  /** The screen's own form for plugin blocks on it, whether or not a chat is connected; null without inputs. */
  form: () => { title: string; fields: ChatPageField[] } | null
  /** Fill some of the screen's inputs by field id; every value is checked against its field before anything changes. */
  fillForm: (values: Record<string, unknown>) => void
  /** Pages register their operations (and unsaved state) for a connected chat or while the command palette watches. */
  actionsWanted: boolean
  /** The command palette's entries on this screen: native `view` operations without required input. Empty unless watched. */
  commandActions: ChatPageAction[]
  /** Watch `commandActions` until the returned cleanup runs. */
  watchCommandActions: () => () => void
  /** Run one of `commandActions` through the same checks a chat command gets; never a commit. */
  runCommandAction: (id: string) => Promise<void>
}
const PageContext = createContext<PageApi | null>(null)

export type ChatPageActivity = { id: string; threadId: number; label: string; tier: 'view' | 'draft' | 'direct'; at: number; state: 'done' | 'undone'; undo?: () => void }
const ACTIVITY_LIMIT = 30

/**
 * Wait until the screen stops changing, up to a few seconds: an operation may open a route or an editor that still
 * loads, so it gets `checks` equal reads `interval` ms apart. Filling inputs only needs the re-render (two quick
 * checks), and a capture changes nothing, so it reads at once (a background tab's slowed timers would otherwise
 * outlast the server's short capture wait).
 */
async function settledSnapshot(read: () => ChatPageSnapshot | undefined, kind: ChatPageCommandEvent['type']) {
  if (kind === 'capture') return read()
  const [interval, checks] = kind === 'action' ? [100, 3] : [50, 2]
  const deadline = Date.now() + 5000
  let last = ''
  let stable = 0
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval))
    const key = JSON.stringify(read() ?? null)
    if (key !== 'null' && key === last) { stable += 1; if (stable >= checks) break }
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
  '/characters': { param: 'view', values: ['appearance', 'profiles'] },
}
/** Views nested inside one of those views (settings › chat and › LLM keep their own ?view=). */
const NESTED_VIEWS: Record<string, string[]> = {
  '/settings': [
    '/settings?section=mine',
    ...['connections', 'prompts', 'log', 'dashboard'].map((group) => `/settings?section=llm&group=${group}`),
    ...['topics', 'knowledge'].map((group) => `/settings?section=posts&group=${group}`),
    ...['nai', 'comfyui', 'pacing', 'schedules'].map((group) => `/settings?section=generation&group=${group}`),
  ],
  '/chat': ['/chat/resources', ...['presets', 'blocks', 'lorebooks', 'routines'].map((tab) => `/chat/resources?tab=${tab}`), '/settings?section=mine'],
}

function withNavigation(editor: Editor | null, navigation: Editor | undefined): Editor | null {
  const additions = (navigation?.actions ?? []).filter((action) => !(editor?.actions ?? []).some((own) => own.id === action.id))
  if (!editor || !navigation || !additions.length || editor === navigation) return editor
  const actions = editor.actions ?? []
  if (actions.length + additions.length > CHAT_PAGE_ACTION_LIMITS.actions) return editor
  const own = editor.applyAction
  return {
    ...editor,
    actions: [...actions, ...additions],
    applyAction: (id, args, assertCurrent, nativeRevision) => {
      if (additions.some((action) => action.id === id)) return navigation.applyAction?.(id, args, assertCurrent)
      if (!own) throw new Error('페이지 작업 편집기가 닫혔어.')
      return own(id, args, assertCurrent, nativeRevision)
    },
  }
}

/** The one way a registered operation runs, for chat commands and the command palette alike. */
async function runRegisteredAction(editor: Editor, actionId: string, tier: 'view' | 'draft' | 'direct', input: unknown, assertCurrent: () => void) {
  const action = editor.actions?.find((item) => item.id === actionId)
  if (!action || chatPageActionTier(action.id, action) === 'commit' || chatPageActionTier(action.id, action) !== tier) throw new Error('이 화면에서 바로 실행할 수 없는 작업이야.')
  if (chatPageActionLeavesScreen(action.id, action) && editor.dirty) throw new Error('저장하지 않은 변경이 있어. 사용자가 저장하거나 버린 뒤에 다시 해.')
  const args = validateChatPageArguments(action.schema, input) as Record<string, ChatPageData>
  if (!editor.applyAction) throw new Error('페이지 작업 편집기가 닫혔어.')
  return { action, undo: await editor.applyAction(action.id, args, assertCurrent) }
}

const NO_ACTIONS: ChatPageAction[] = []
/** Palette entries: native operations that only move or open something and need no input. Extension tiers are checked on the server, so they stay with the chat. */
function isCommandAction(action: ChatPageAction, path: string, permissionKeys: string[] | undefined) {
  if (!Object.hasOwn(CHAT_PAGE_ACTION_PERMISSIONS, action.id) || !chatPageActionAllowed(path, action.id) || chatPageActionTier(action.id) !== 'view' || action.schema.required?.length) return false
  const permission = CHAT_PAGE_ACTION_PERMISSIONS[action.id]
  return !permission || hasAuthPermission(permissionKeys, permission)
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
  const permission = chatPagePermission(`${location.pathname}${location.search}`)
  const available = !!auth?.authenticated && permission !== null && (permission === '' || auth.permissionKeys.includes(permission))
  const enabled = available && connection?.accountKey === accountKey
  const primaryEditor = editors.filter((item) => item.path === location.pathname).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0] ?? null
  const workflowBrowser = editors.find((item) => item.path === location.pathname && item.kind === 'workflow_runner' && item.resourceId === 'workflow-browser')
  const navigation = editors.find((item) => item.path === location.pathname && item.kind === 'page' && item.priority === NAVIGATION_PRIORITY)
  const activeEditor = useMemo(() => {
    if (primaryEditor?.kind !== 'workflow_runner' || primaryEditor.resourceId === 'workflow-browser' || !workflowBrowser) return withNavigation(primaryEditor, navigation)
    // The run screen's own operations (workflow.run) stay with it; the browser's (workflow.select) go to the browser.
    const browserActions = new Set((workflowBrowser.actions ?? []).map((action) => action.id))
    const runner = primaryEditor.applyAction
    return withNavigation({ ...primaryEditor, actions: [...(primaryEditor.actions ?? []), ...(workflowBrowser.actions ?? [])], data: { ...workflowBrowser.data, ...primaryEditor.data }, applyAction: (id, args, assertCurrent, nativeRevision) => {
      if (browserActions.has(id) || !runner) return workflowBrowser.applyAction?.(id, args, assertCurrent, nativeRevision)
      return runner(id, args, assertCurrent, nativeRevision)
    } }, navigation)
  }, [primaryEditor, workflowBrowser, navigation])
  const [commandWatchers, setCommandWatchers] = useState(0)
  const watchCommandActions = useCallback(() => {
    setCommandWatchers((count) => count + 1)
    return () => setCommandWatchers((count) => count - 1)
  }, [])
  const commandActions = useMemo(() => commandWatchers ? (activeEditor?.actions ?? []).filter((action) => isCommandAction(action, location.pathname, auth?.permissionKeys)) : NO_ACTIONS, [commandWatchers, activeEditor, location.pathname, auth?.permissionKeys])
  const fallbackTitle = t({
    ko: ({ '/': '이미지 라이브러리', '/access': '접근 가능한 페이지', '/chat': '채팅', '/generation': '이미지 생성', '/prompts': '프롬프트', '/groups': '그룹', '/characters': '캐릭터 라이브러리', '/wildcards': '와일드카드', '/files': '파일 보관함', '/upload': '업로드', '/settings': '설정', '/wallpaper': '배경화면', '/wallpaper/runtime': '배경화면 실행' } as Record<string, string>)[location.pathname] ?? (location.pathname.startsWith('/groups/') ? '그룹 상세' : '이미지 상세'),
    en: ({ '/': 'Image library', '/access': 'Available pages', '/chat': 'Chat', '/generation': 'Image generation', '/prompts': 'Prompts', '/groups': 'Groups', '/characters': 'Character library', '/wildcards': 'Wildcards', '/files': 'File store', '/upload': 'Upload', '/settings': 'Settings', '/wallpaper': 'Wallpaper', '/wallpaper/runtime': 'Wallpaper runtime' } as Record<string, string>)[location.pathname] ?? (location.pathname.startsWith('/groups/') ? 'Group detail' : 'Image detail'),
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
  const current = useRef({ snapshot, editor: activeEditor, commandActions })
  useLayoutEffect(() => { current.current = { snapshot, editor: activeEditor, commandActions } })
  useEffect(() => { statesRef.current = new Map(); workflowUndos.current.clear(); actionUndos.current.clear(); setStates(statesRef.current) }, [accountKey])
  const toggle = useCallback(() => setConnection((old) => old?.accountKey === accountKey ? null : { id: createRandomUuid(), accountKey }), [accountKey])
  const disconnect = useCallback(() => setConnection(null), [])
  const register = useCallback((next: Editor) => {
    setEditors((old) => [...old.filter((item) => item.instanceId !== next.instanceId), next])
    return () => setEditors((old) => old.filter((item) => item.instanceId !== next.instanceId))
  }, [])
  const capture = useCallback(() => current.current.snapshot ? normalizeChatPageSnapshot(current.current.snapshot) : undefined, [])
  const form = useCallback(() => {
    const editor = current.current.editor
    return editor?.fields.length ? { title: editor.title, fields: editor.fields } : null
  }, [])
  const fillForm = useCallback((values: Record<string, unknown>) => {
    const editor = current.current.editor
    if (!editor?.fields.length) throw new Error('이 화면에는 채울 입력이 없어.')
    const patch = Object.fromEntries(Object.entries(values).map(([id, value]) => {
      const field = editor.fields.find((item) => item.id === id)
      if (!field) throw new Error(`이 화면에 없는 입력이야: ${id}`)
      if (field.editable === false) throw new Error(`${field.label}: 읽기 전용 항목은 변경할 수 없어.`)
      return [id, normalizeChatPageValue(field, value)]
    }))
    if (Object.keys(patch).length) editor.apply(patch)
  }, [])
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
  /** Runs one immediate operation the chat asked for, only from the registry of the screen it was checked against. */
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
      const target = chatPageTarget(live.snapshot)
      const assertTargetCurrent = () => {
        if (connectionRef.current !== event.connectionId || !current.current.snapshot || !current.current.editor) throw new Error('페이지 연결이 해제됐어.')
        requireChatPageTarget(current.current.snapshot, target)
      }
      const assertCurrent = () => {
        assertTargetCurrent()
        // Native drafts check again after loading inputs and before replacing their captured state.
        // Extensions validate their own revisions and can report a new snapshot before returning.
        if (event.type === 'action' && event.tier === 'draft' && live.snapshot!.kind !== 'extension' && current.current.snapshot!.revision !== live.snapshot!.revision) throw new Error('그사이 입력이나 선택이 바뀌었어. 지금 화면을 읽고 다시 요청해줘.')
      }
      if (event.type === 'action') {
        if (event.tier === 'direct' && (!event.revision || live.snapshot.revision !== event.revision)) throw new Error('그사이 화면이나 선택이 바뀌었어. get_current_page로 다시 읽고 요청해줘.')
        const { action, undo } = await runRegisteredAction(live.editor, event.actionId, event.tier, event.arguments, assertCurrent)
        record({ id: event.commandId, threadId: event.threadId, label: action.label, tier: event.tier, ...(undo && event.tier === 'draft' ? { undo: () => { assertTargetCurrent(); if (!undo.isCurrent()) throw new Error('그 뒤에 입력이 바뀌어서 되돌리지 않았어.'); undo.restore() } } : {}) })
      } else if (event.type === 'workflow') {
        if (!live.snapshot.workflow || !live.editor.applyWorkflow) throw new Error('노드 워크플로 편집기가 닫혔어.')
        if (live.snapshot.workflow.revision !== event.revision) throw new Error('그사이 워크플로가 바뀌었어. get_workflow_editor로 다시 읽고 해.')
        // The editor re-runs the transaction against its own state before writing; only the fields it reads are passed.
        const undo = live.editor.applyWorkflow({ revision: event.revision, operations: event.operations, modules: event.modules } as WorkflowPageProposal)
        record({ id: event.commandId, threadId: event.threadId, label: event.label, tier: 'draft', undo: () => { assertTargetCurrent(); if (!undo.isCurrent()) throw new Error('그 뒤에 워크플로가 바뀌어서 되돌리지 않았어.'); undo.restore() } })
      } else if (event.type === 'fields') {
        const proposal = { kind: 'page_fields' as const, page: chatPageTarget(live.snapshot), changes: event.changes, expiresAt: event.expiresAt }
        const filledOn = live.snapshot.instanceId
        live.editor.apply(chatPagePatch(live.snapshot, proposal))
        setFilled((old) => { const next = new Map(old); event.changes.forEach((change) => next.set(`${filledOn}:${change.fieldId}`, JSON.stringify(change.value))); return next })
        record({ id: event.commandId, threadId: event.threadId, label: event.changes.map((change) => change.label).join(', '), tier: 'draft', undo: () => {
          assertTargetCurrent()
          const now = current.current
          now.editor!.apply(chatPagePatch(now.snapshot!, proposal, true))
          setFilled((old) => { const next = new Map(old); event.changes.forEach((change) => next.delete(`${filledOn}:${change.fieldId}`)); return next })
        } })
      }
      const page = await settledSnapshot(() => current.current.snapshot ? normalizeChatPageSnapshot(current.current.snapshot) : undefined, event.type)
      if (!page || page.connectionId !== event.connectionId) throw new Error('페이지 연결이 해제됐어.')
      await answerChatPageCommand(event.commandId, { ok: true, page })
    } catch (error) {
      await answerChatPageCommand(event.commandId, { ok: false, error: error instanceof Error ? error.message : '페이지 작업이 실패했어.' }).catch(() => undefined)
    } finally {
      if (event.type !== 'capture') drivingTimer.current = window.setTimeout(() => { drivingTimer.current = null; setDriving(false) }, 1500)
    }
  }, [record])
  const runCommandAction = useCallback(async (id: string) => {
    const { editor, commandActions: listed } = current.current
    if (!editor || !listed.some((action) => action.id === id)) throw new Error('이 화면에서 바로 실행할 수 없는 작업이야.')
    await runRegisteredAction(editor, id, 'view', {}, () => {
      if (current.current.editor?.instanceId !== editor.instanceId) throw new Error('그사이 화면이 바뀌었어.')
    })
  }, [])
  const actionsWanted = enabled || commandWatchers > 0
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
  const api = useMemo<PageApi>(() => ({ snapshot, available, enabled, toggle, disconnect, capture, register, states, apply, workflowProblem, applyWorkflow, actionProblem, applyAction, actionUndos: actionUndos.current, activity, undoActivity, driving, isFilled, form, fillForm, actionsWanted, commandActions, watchCommandActions, runCommandAction }), [snapshot, available, enabled, toggle, disconnect, capture, register, states, apply, workflowProblem, applyWorkflow, actionProblem, applyAction, activity, undoActivity, driving, isFilled, form, fillForm, actionsWanted, commandActions, watchCommandActions, runCommandAction])
  return <PageContext.Provider value={api}><PageNavigationRegistration title={fallbackTitle} />{driving ? <ChatPageDrivingBar /> : null}{children}</PageContext.Provider>
}

function PageNavigationRegistration({ title }: { title: string }) {
  const settings = usePageSettings()
  const auth = useAuthStatusQuery().data
  const navigate = useNavigate()
  const { t } = useI18n()
  const destinations = PAGE_ACCESS_CATALOG.filter((item) => auth?.permissionKeys.includes(item.permissionKey)).flatMap((item) => {
    const views = PAGE_VIEWS[item.path]
    return [item.path, ...(views ? views.values.map((value) => `${item.path}?${views.param}=${value}`) : []), ...(NESTED_VIEWS[item.path] ?? [])].filter((destination) => auth?.isAdmin || (!destination.startsWith('/chat/resources') && destination !== '/characters?view=profiles'))
  })
  const actions = destinations.length ? [pageAction('page.navigate', t({ ko: '내부 페이지 이동', en: 'Navigate within CoNAI' }), t({ ko: '접근 가능한 CoNAI 페이지나 그 탭으로 이동해. 설정은 ?section=, 다른 페이지는 ?tab= 이 탭이야.', en: 'Open an accessible CoNAI page or one of its tabs. Settings sections use ?section=, other pages ?tab=.' }), pageObject({ to: pageChoice(destinations) }, ['to']))] : []
  if (settings.scopes.length && !settings.scope) actions.push(pageAction('page.settings_open', t({ ko: '현재 페이지 설정 열기', en: 'Open current page settings' }), t({ ko: '이 페이지에 적용되는 앱 공용 설정 창(저장 형식, 생성 속도 제한, 화면 테마 등)을 열어. 화면의 입력 칸(프롬프트 등)은 여기서 바꾸지 말고 page_fill로 채워.', en: 'Open the app-wide settings that apply to this page (save format, generation throttle, appearance, etc.). Never use it to change the screen\'s own inputs such as prompts; fill those with page_fill.' }), pageObject({ scope: pageChoice(settings.scopes) }, ['scope'])))
  useChatPageRegistration({ kind: 'page', title, resourceId: null, priority: NAVIGATION_PRIORITY, fields: [], actions, apply: () => {}, applyAction: (id, args, assertCurrent) => { assertCurrent(); if (id === 'page.settings_open') settings.open(args.scope as PageSettingsScopeId); else void navigate(String(args.to)) } })
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
  // Disconnected plugin forms still need fields/setters, but not the chat's workflow, actions or page data.
  const connected = page?.enabled === true
  // The command palette also needs the operations and unsaved state, only while it is open.
  const listsActions = page?.actionsWanted === true
  const description = input && register ? JSON.stringify({ title: input.title, kind: input.kind, resourceId: input.resourceId, fields: input.fields, priority: input.priority, ...(connected ? { workflow: input.workflow, data: input.data } : {}), ...(listsActions ? { actions: input.actions, dirty: input.dirty } : {}) }) : null
  const revisionKey = `${description}:${connected ? input?.localRevision ?? '' : ''}`
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

/** The composer's page link chip: says whether the chat sees the current page, and turns that on or off. */
export function ChatPageConnectButton({ disabled }: { disabled: boolean }) {
  const page = useChatPage()
  const { t } = useI18n()
  if (!page?.available) return null
  const label = t(page.driving ? { ko: '페이지 조작 중', en: 'Operating the page' } : page.enabled ? { ko: '페이지 연결 켜짐', en: 'Page linked' } : { ko: '페이지 연결', en: 'Link page' })
  return <ToggleChip pressed={page.enabled} disabled={disabled} onClick={page.toggle}><Monitor className={page.driving ? 'animate-pulse motion-reduce:animate-none' : undefined} />{label}</ToggleChip>
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
