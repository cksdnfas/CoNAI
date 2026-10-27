import { useQuery } from '@tanstack/react-query'
import { ArrowRight, LogIn, ShieldAlert, ShieldCheck, Wand, X, type LucideIcon } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { PageToolbar } from '@/components/common/page-toolbar'
import { useAppNavigation, type AppNavLink } from '@/components/layout/app-navigation'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { getPublicGenerationWorkflows } from '@/lib/api-public-workflows'
import { cn } from '@/lib/utils'
import { resolveRoutePermissionKey } from './auth-route-permissions'
import { PAGE_ACCESS_CATALOG } from './page-access-catalog'
import { useAuthStatusQuery } from './use-auth-status-query'

interface AccessEntryCardProps {
  label: string
  description?: string | null
  href: string
  icon: LucideIcon
}

/**
 * One cell of the flat access grid: icon, label with its one line (cut short, whole in the tooltip), arrow; hairline
 * below, hover wash.
 */
function AccessEntryCard({ label, description, href, icon: Icon }: AccessEntryCardProps) {
  return (
    <Tip content={description || null} side="bottom" align="start">
      <Link
        to={href}
        className={cn(
          'group flex min-h-12 items-center gap-3 border-b border-line px-2 py-2.5 transition-colors',
          'hover:bg-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40',
        )}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />

        <span className="min-w-0 flex-1">
          <Text as="div" variant="title" className="truncate">{label}</Text>
          {description ? <Text as="div" variant="caption" className="truncate">{description}</Text> : null}
        </span>

        <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </Tip>
  )
}

interface BlockedRouteState {
  blockedPath?: unknown
  blockedPermissionKey?: unknown
}

/** Read the blocked-route details that `useAuthPermissionRedirect` stores in navigation state. */
function readBlockedRoute(state: unknown): { path: string; permissionKey: string | null } | null {
  if (!state || typeof state !== 'object') {
    return null
  }

  const { blockedPath, blockedPermissionKey } = state as BlockedRouteState
  if (typeof blockedPath !== 'string' || !blockedPath.startsWith('/')) {
    return null
  }

  return {
    path: blockedPath,
    permissionKey: typeof blockedPermissionKey === 'string' ? blockedPermissionKey : null,
  }
}

/** Explain which page was blocked and how to get access to it. */
function BlockedRouteNotice({ path, permissionKey, isAnonymous, onDismiss }: { path: string; permissionKey: string | null; isAnonymous: boolean; onDismiss: () => void }) {
  const { t } = useI18n()
  const resolvedPermissionKey = permissionKey ?? resolveRoutePermissionKey(path.split('?')[0] ?? path)
  const matchedPage = PAGE_ACCESS_CATALOG.find((item) => item.permissionKey === resolvedPermissionKey)
  const pageLabel = matchedPage ? t(matchedPage.labelKey) : path

  return (
    <Alert variant="destructive">
      <ShieldAlert />
      <div className="col-start-2 min-w-0 space-y-0.5 pr-8">
        <Text variant="title" tone="inherit">
          {t('accessOverviewPage.blockedTitle', { pageLabel })}
        </Text>
        <AlertDescription>
          <p>{isAnonymous ? t('accessOverviewPage.blockedHintAnonymous') : t('accessOverviewPage.blockedHintSignedIn')}</p>
          {isAnonymous ? (
            <Button asChild size="sm" className="mt-1">
              <Link to={`/login?next=${encodeURIComponent(path)}`}>
                <LogIn className="h-4 w-4" />
                {t('loginPage.signIn')}
              </Link>
            </Button>
          ) : null}
        </AlertDescription>
      </div>
      <IconButton
        variant="ghost"
        size="icon-sm"
        onClick={onDismiss}
        className="absolute right-2 top-2"
        label={t({ ko: '닫기', en: 'Close' })}
      >
        <X className="h-4 w-4" />
      </IconButton>
    </Alert>
  )
}

/**
 * Every page the current account can use, in the header's groups (라이브러리·만들기·확장), then the public workflows.
 * The logo and the phone's 전체 tab open it; a blocked route lands here with its reason.
 */
export function AccessOverviewPage() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const authStatusQuery = useAuthStatusQuery()
  const authStatus = authStatusQuery.data
  const { groups, ungrouped } = useAppNavigation()
  const blockedRoute = readBlockedRoute(location.state)
  const publicWorkflowsQuery = useQuery({
    queryKey: ['public-generation-workflows', 'access-overview'],
    queryFn: getPublicGenerationWorkflows,
    enabled: authStatus?.hasCredentials === true && authStatus?.authenticated === true,
    staleTime: 30_000,
  })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-fill animate-pulse" />
  }

  // Pages outside the menus (Settings) close the list; this page itself is left out.
  const others = ungrouped.filter((link) => link.to !== '/access')
  const sections: Array<{ id: string; label: string; links: AppNavLink[] }> = [
    ...groups,
    ...(others.length ? [{ id: 'manage', label: t({ ko: '관리', en: 'Manage' }), links: others }] : []),
  ]
  const publicWorkflows = publicWorkflowsQuery.data ?? []

  return (
    <div className="space-y-6">
      <PageToolbar title={t('appShell.availablePages')} />

      {blockedRoute ? (
        <BlockedRouteNotice
          path={blockedRoute.path}
          permissionKey={blockedRoute.permissionKey}
          isAnonymous={authStatus?.hasCredentials === true && authStatus.authenticated !== true}
          onDismiss={() => navigate(`${location.pathname}${location.search}`, { replace: true, state: null })}
        />
      ) : null}

      {sections.length === 0 && publicWorkflows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t({ ko: '지금 열 수 있는 페이지가 없어', en: 'There are no pages available right now' })} />
      ) : (
        <div className="space-y-10">
          {sections.map((section) => (
            <section key={section.id} className="space-y-2">
              <Heading level={3}>{section.label}</Heading>
              <div className="grid md:grid-cols-2 md:gap-x-8 xl:grid-cols-3">
                {section.links.map((link) => (
                  <AccessEntryCard key={link.key} href={link.to} label={link.label} icon={link.icon} />
                ))}
              </div>
            </section>
          ))}

          {publicWorkflowsQuery.isLoading ? (
            <LoadingState variant="inline" label={t({ ko: '공용 워크플로우 불러오는 중…', en: 'Loading public workflows…' })} />
          ) : null}

          {publicWorkflows.length > 0 ? (
            <section className="space-y-2">
              <Heading level={3}>{t({ ko: '공용 워크플로우', en: 'Public workflows' })}</Heading>
              <div className="grid md:grid-cols-2 md:gap-x-8 xl:grid-cols-3">
                {publicWorkflows.map((workflow) => (
                  <AccessEntryCard
                    key={workflow.id}
                    href={`/public/workflows/${workflow.public_slug}`}
                    label={workflow.name}
                    description={workflow.description?.trim()}
                    icon={Wand}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}
