import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { useLocation } from 'react-router-dom'
import { Monitor } from 'lucide-react'
import { chatPagePatch, chatPagePermission, normalizeChatPageSnapshot, type ChatPageField, type ChatPageSnapshot, type ChatPageValue, type ChatProposal } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { acknowledgeChatPageProposal, checkChatPageProposal } from '@/lib/api-codex-chat'

type PageProposal = Extract<ChatProposal, { kind: 'page_fields' }>
type Editor = { instanceId: string; path: string; title: string; kind: 'nai' | 'comfyui'; resourceId: string | null; fields: ChatPageField[]; apply: (patch: Record<string, ChatPageValue>) => void }
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
}
const PageContext = createContext<PageApi | null>(null)

/** A local registry of form setters; no DOM inspection or code execution. */
export function ChatPageProvider({ children }: PropsWithChildren) {
  const location = useLocation()
  const auth = useAuthStatusQuery().data
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const accountKey = `${auth?.hasCredentials}:${auth?.authenticated}:${auth?.accountId ?? 'bootstrap'}`
  const [connection, setConnection] = useState<{ id: string; accountKey: string } | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [states, setStates] = useState(new Map<number, 'applied' | 'undone'>())
  const statesRef = useRef(states)
  const busy = useRef(new Set<number>())
  const instanceId = useMemo(() => ({ key: `${location.key}:${location.pathname}:${accountKey}`, id: crypto.randomUUID() }), [location.key, location.pathname, accountKey]).id
  const permission = chatPagePermission(location.pathname)
  const available = !!auth?.authenticated && !!permission && auth.permissionKeys.includes(permission) && auth.permissionKeys.includes('chat.tools.read')
  const enabled = available && connection?.accountKey === accountKey
  const activeEditor = editor?.path === location.pathname ? editor : null
  const title = activeEditor?.title ?? t({
    ko: ({ '/': '이미지 라이브러리', '/access': '접근 가능한 페이지', '/chat': '채팅', '/generation': '이미지 생성', '/prompts': '프롬프트', '/groups': '그룹', '/wildcards': '와일드카드', '/files': '파일 보관함', '/upload': '업로드', '/settings': '설정', '/wallpaper': '배경화면', '/wallpaper/runtime': '배경화면 실행' } as Record<string, string>)[location.pathname] ?? (location.pathname.startsWith('/groups/') ? '그룹 상세' : '이미지 상세'),
    en: ({ '/': 'Image library', '/access': 'Available pages', '/chat': 'Chat', '/generation': 'Image generation', '/prompts': 'Prompts', '/groups': 'Groups', '/wildcards': 'Wildcards', '/files': 'File store', '/upload': 'Upload', '/settings': 'Settings', '/wallpaper': 'Wallpaper', '/wallpaper/runtime': 'Wallpaper runtime' } as Record<string, string>)[location.pathname] ?? (location.pathname.startsWith('/groups/') ? 'Group detail' : 'Image detail'),
  })
  const snapshot = useMemo<ChatPageSnapshot | null>(() => enabled && connection ? {
    instanceId: activeEditor?.instanceId ?? instanceId, connectionId: connection.id, path: location.pathname, title,
    kind: activeEditor?.kind ?? 'page', resourceId: activeEditor?.resourceId ?? null, fields: activeEditor?.fields ?? [],
  } : null, [enabled, connection, activeEditor, instanceId, location.pathname, title])
  const current = useRef({ snapshot, editor: activeEditor })
  useLayoutEffect(() => { current.current = { snapshot, editor: activeEditor } })
  useEffect(() => { statesRef.current = new Map(); setStates(statesRef.current) }, [accountKey])
  const toggle = useCallback(() => setConnection((old) => old?.accountKey === accountKey ? null : { id: crypto.randomUUID(), accountKey }), [accountKey])
  const disconnect = useCallback(() => setConnection(null), [])
  const register = useCallback((next: Editor) => {
    setEditor(next)
    return () => setEditor((old) => old?.instanceId === next.instanceId ? null : old)
  }, [])
  const capture = useCallback(() => current.current.snapshot ? normalizeChatPageSnapshot(current.current.snapshot) : undefined, [])
  const apply = useCallback(async (proposal: PageProposal, undo = false) => {
    if (busy.current.has(proposal.id)) throw new Error('이 제안을 처리하고 있어.')
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
  const api = useMemo<PageApi>(() => ({ snapshot, available, enabled, toggle, disconnect, capture, register, states, apply }), [snapshot, available, enabled, toggle, disconnect, capture, register, states, apply])
  return <PageContext.Provider value={api}>{children}</PageContext.Provider>
}

export function useChatPage() { return useContext(PageContext) }

/** Primitive descriptors stay stable across unrelated chat renders; setters always read their latest closure. */
export function useChatPageRegistration(input: Omit<Editor, 'instanceId' | 'path'> | null) {
  const page = useChatPage()
  const register = page?.register
  const location = useLocation()
  const applyRef = useRef(input?.apply)
  useLayoutEffect(() => { applyRef.current = input?.apply })
  const description = input ? JSON.stringify({ title: input.title, kind: input.kind, resourceId: input.resourceId, fields: input.fields }) : null
  const kind = input?.kind
  const resourceId = input?.resourceId
  const instanceId = useMemo(() => ({ key: `${location.key}:${location.pathname}:${kind}:${resourceId}`, id: crypto.randomUUID() }), [location.key, location.pathname, kind, resourceId]).id
  useLayoutEffect(() => {
    if (!register || !description) return
    const data = JSON.parse(description) as Omit<Editor, 'instanceId' | 'path' | 'apply'>
    return register({ ...data, instanceId, path: location.pathname, apply: (patch) => applyRef.current?.(patch) })
  }, [register, description, instanceId, location.pathname])
}

export function ChatPageConnectButton({ disabled, allowed }: { disabled: boolean; allowed: boolean }) {
  const page = useChatPage()
  const { t } = useI18n()
  if (!page?.available) return null
  const label = t(page.enabled ? { ko: '현재 페이지 연결 해제', en: 'Disconnect current page' } : { ko: '현재 페이지 연결', en: 'Connect current page' })
  const hint = t(allowed ? { ko: '현재 페이지와 등록된 입력값을 이 채팅에 전달해. 연결 중에는 현재 페이지 조회와 입력 제안만 사용하고, 변경은 네가 적용해.', en: 'Share this page and its registered inputs. While connected, only current-page reads and input proposals are available; you apply the changes.' } : { ko: '프로필 도구에서 현재 페이지 읽기를 허용해줘.', en: 'Allow Read current page in the profile tools.' })
  return <Tip content={hint}><IconButton variant="ghost" size="icon-sm" active={page.enabled && allowed} disabled={disabled || !allowed} onClick={page.toggle} label={label} tooltip={false}><Monitor /></IconButton></Tip>
}

export function ChatPageConnectionNotice({ allowed }: { allowed: boolean }) {
  const page = useChatPage()
  const { t } = useI18n()
  if (!page?.snapshot || !allowed) return null
  return <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Monitor className="size-3.5 shrink-0" /><span>{t({ ko: '연결된 페이지: {name}', en: 'Connected page: {name}' }, { name: page.snapshot.title })}{page.snapshot.fields.length ? t({ ko: ' · 입력 {count}개', en: ' · {count} inputs' }, { count: page.snapshot.fields.length }) : ''}</span></p>
}
