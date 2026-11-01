import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { TextTabs } from '@/components/common/text-tabs'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { RequireAuthPermission } from '@/features/auth/require-auth-permission'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { CHAT_WORKSPACE_PATHS } from './chat-admin-location'

type WorkspaceTab = keyof typeof CHAT_WORKSPACE_PATHS

/** What the administrator screens need: the same permission their routes ask for. */
const ADMIN_PERMISSION = 'page.settings.view'

/**
 * The chat's one row of screens: the conversations, what they draw on (profiles, resources, AI connections, routines, the judge log;
 * administrators) and the account's own personas and flags. Each is a route under /chat, so the assistant side panel
 * stays available on all but the conversations, which are the page itself.
 */
export function ChatWorkspaceLayout() {
  return <RequireAuthPermission permissionKey="page.chat.view"><ChatWorkspace /></RequireAuthPermission>
}

function ChatWorkspace() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const permissionKeys = useAuthStatusQuery().data?.permissionKeys
  const admin = hasAuthPermission(permissionKeys, ADMIN_PERMISSION)
  const active = (Object.keys(CHAT_WORKSPACE_PATHS) as WorkspaceTab[]).find((tab) => CHAT_WORKSPACE_PATHS[tab] === pathname) ?? 'chat'
  const conversations = active === 'chat'

  const labels: Record<WorkspaceTab, string> = {
    chat: t({ ko: '대화', en: 'Chats' }),
    profiles: t({ ko: '프로필', en: 'Profiles' }),
    resources: t({ ko: '자원', en: 'Resources' }),
    llm: t({ ko: 'AI 연결', en: 'AI connections' }),
    routines: t({ ko: '루틴', en: 'Routines' }),
    judge: t({ ko: '판단 기록', en: 'Judge log' }),
    mine: t({ ko: '내 설정', en: 'My settings' }),
  }
  const tabs: WorkspaceTab[] = admin ? ['chat', 'profiles', 'resources', 'llm', 'routines', 'judge', 'mine'] : ['chat', 'mine']

  // Pages under the row stick below it: the strip's measured height becomes --page-top-offset (see PageWithSidebar).
  const stripRef = useRef<HTMLDivElement>(null)
  const [stripHeight, setStripHeight] = useState(0)
  useLayoutEffect(() => {
    const node = stripRef.current
    if (!node) return
    const measure = () => setStripHeight(node.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const strip = (
    <div
      ref={stripRef}
      className={cn('z-sticky border-b border-line bg-background px-(--theme-shell-inline-padding) pt-2', conversations ? 'shrink-0' : '-mx-(--theme-shell-inline-padding) sticky top-(--theme-shell-header-height)')}
    >
      <TextTabs<WorkspaceTab>
        value={active}
        onChange={(tab) => navigate(CHAT_WORKSPACE_PATHS[tab])}
        items={tabs.map((tab) => ({ value: tab, label: labels[tab] }))}
        ariaLabel={t({ ko: '채팅 화면', en: 'Chat screens' })}
        hairline={false}
      />
    </div>
  )

  // The conversations fill the shell's height edge to edge (their list column and composer manage their own scroll);
  // every other screen is an ordinary page under the row.
  return (
    <div
      className={cn(conversations && 'page-bleed flex h-(--shell-content-height) min-h-0 flex-col')}
      style={{ '--page-top-offset': `${stripHeight}px` } as CSSProperties}
    >
      {strip}
      {conversations ? <div className="flex min-h-0 flex-1 flex-col"><Outlet /></div> : <Outlet />}
    </div>
  )
}

/** The administrator screens of the workspace. */
export function ChatAdminGuard() {
  return <RequireAuthPermission permissionKey={ADMIN_PERMISSION}><Outlet /></RequireAuthPermission>
}
