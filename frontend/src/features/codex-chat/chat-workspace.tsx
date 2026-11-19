import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { AlarmClock, Boxes, BrainCircuit, ChevronDown, MessagesSquare, Scale, SlidersHorizontal, UserCog, UserRound, type LucideIcon } from 'lucide-react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { TextTabs } from '@/components/common/text-tabs'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { RequireAuthPermission } from '@/features/auth/require-auth-permission'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { CHAT_WORKSPACE_PATHS } from './chat-admin-location'

type WorkspaceTab = keyof typeof CHAT_WORKSPACE_PATHS
type AdminWorkspaceTab = Exclude<WorkspaceTab, 'chat' | 'mine'>

const ADMIN_TABS: AdminWorkspaceTab[] = ['profiles', 'resources', 'llm', 'routines', 'judge']

const TAB_ICONS: Record<WorkspaceTab, LucideIcon> = {
  chat: MessagesSquare,
  profiles: UserRound,
  resources: Boxes,
  llm: BrainCircuit,
  routines: AlarmClock,
  judge: Scale,
  mine: UserCog,
}

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
  const activeAdminTab = (ADMIN_TABS as readonly WorkspaceTab[]).includes(active) ? (active as AdminWorkspaceTab) : null

  const labels: Record<WorkspaceTab, string> = {
    chat: t({ ko: '대화', en: 'Chats' }),
    profiles: t({ ko: '프로필', en: 'Profiles' }),
    resources: t({ ko: '자원', en: 'Resources' }),
    llm: t({ ko: 'AI 연결', en: 'AI connections' }),
    routines: t({ ko: '루틴', en: 'Routines' }),
    judge: t({ ko: '판단 기록', en: 'Judge log' }),
    mine: t({ ko: '내 설정', en: 'My settings' }),
  }
  const primaryTabs: WorkspaceTab[] = ['chat', 'mine']

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
      className={cn('z-sticky flex items-center justify-between gap-3 border-b border-line bg-background px-(--theme-shell-inline-padding) pt-2', conversations ? 'shrink-0' : '-mx-(--theme-shell-inline-padding) sticky top-(--theme-shell-header-height)')}
    >
      <TextTabs<WorkspaceTab>
        value={activeAdminTab ? ('' as WorkspaceTab) : active}
        onChange={(tab) => navigate(CHAT_WORKSPACE_PATHS[tab])}
        items={primaryTabs.map((tab) => ({ value: tab, label: labels[tab], icon: TAB_ICONS[tab] }))}
        ariaLabel={t({ ko: '채팅 화면', en: 'Chat screens' })}
        hairline={false}
      />
      {admin ? (
        <div className="mb-1.5 shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant={activeAdminTab ? 'secondary' : 'ghost'}
                size="sm"
                data-pressed={activeAdminTab ? 'true' : undefined}
              >
                <SlidersHorizontal className="size-4" aria-hidden />
                <span>{activeAdminTab ? `${t({ ko: '관리', en: 'Manage' })} · ${labels[activeAdminTab]}` : t({ ko: '관리', en: 'Manage' })}</span>
                <ChevronDown className="size-3.5 opacity-70" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              {ADMIN_TABS.map((tab) => {
                const Icon = TAB_ICONS[tab]
                return (
                  <DropdownMenuItem key={tab} onSelect={() => navigate(CHAT_WORKSPACE_PATHS[tab])}>
                    <Icon className="size-4" aria-hidden />
                    <span>{labels[tab]}</span>
                    {active === tab ? <span className="ml-auto text-2xs font-medium text-primary-text">{t({ ko: '현재', en: 'Current' })}</span> : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
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
