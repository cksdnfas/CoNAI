import { useQuery } from '@tanstack/react-query'
import { ArrowRight, LogIn, ShieldAlert, ShieldCheck, Sparkles, X, type LucideIcon } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Text } from '@/components/ui/text'
import { PageHeader } from '@/components/common/page-header'
import { useI18n } from '@/i18n'
import { getPublicGenerationWorkflows } from '@/lib/api-public-workflows'
import { cn } from '@/lib/utils'
import { resolveRoutePermissionKey } from './auth-route-permissions'
import { PAGE_ACCESS_CATALOG, listAccessiblePageAccessItems } from './page-access-catalog'
import { useAuthStatusQuery } from './use-auth-status-query'

interface AccessEntryCardProps {
  label: string
  description: string
  href: string
  icon: LucideIcon
  badge?: string | null
}

/** Render one compact access card with a direct jump target. */
function AccessEntryCard({ label, description, href, icon: Icon, badge }: AccessEntryCardProps) {
  return (
    <Link
      to={href}
      className={cn(
        'group flex items-center gap-3 rounded-sm bg-surface-container px-4 py-3 transition-colors',
        'hover:bg-surface-high focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
      )}
    >
      <div className="rounded-sm bg-primary/10 p-2 text-primary transition-colors group-hover:bg-primary/14">
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <Text as="div" variant="title" className="truncate">{label}</Text>
          {badge ? <Badge variant="outline">{badge}</Badge> : null}
        </div>
        <Text as="div" variant="caption" className="truncate">{description}</Text>
      </div>

      <div className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground">
        <ArrowRight className="h-4 w-4" />
      </div>
    </Link>
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
    <Alert variant="destructive" className="pr-12">
      <ShieldAlert />
      <AlertTitle className="line-clamp-none">
        {t('accessOverviewPage.blockedTitle', { pageLabel })}
      </AlertTitle>
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

/** Render one compact landing page for the pages the current account can use. */
export function AccessOverviewPage() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const authStatusQuery = useAuthStatusQuery()
  const authStatus = authStatusQuery.data
  const blockedRoute = readBlockedRoute(location.state)
  const publicWorkflowsQuery = useQuery({
    queryKey: ['public-generation-workflows', 'access-overview'],
    queryFn: getPublicGenerationWorkflows,
    enabled: authStatus?.hasCredentials === true && authStatus?.authenticated === true,
    staleTime: 30_000,
  })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  const accessibleItems = listAccessiblePageAccessItems(authStatus?.permissionKeys ?? [])
  // Primary pages first, then the pages reached from them; users don't need the distinction spelled out.
  const pageItems = [
    ...accessibleItems.filter((item) => item.category === 'primary'),
    ...accessibleItems.filter((item) => item.category !== 'primary'),
  ]
  const publicWorkflows = publicWorkflowsQuery.data ?? []
  const accountTypeLabel = authStatus?.accountType === 'admin'
    ? t({ ko: '관리자', en: 'Admin' })
    : authStatus?.accountType === 'guest'
      ? t({ ko: '게스트', en: 'Guest' })
      : t({ ko: '계정', en: 'Account' })

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('appShell.availablePages')}
        actions={(
          <>
            {authStatus?.username ? <Badge variant="secondary">{authStatus.username}</Badge> : null}
            <Badge variant="outline">{accountTypeLabel}</Badge>
          </>
        )}
      />

      {blockedRoute ? (
        <BlockedRouteNotice
          path={blockedRoute.path}
          permissionKey={blockedRoute.permissionKey}
          isAnonymous={authStatus?.hasCredentials === true && authStatus.authenticated !== true}
          onDismiss={() => navigate(`${location.pathname}${location.search}`, { replace: true, state: null })}
        />
      ) : null}

      {accessibleItems.length === 0 && publicWorkflows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={t({ ko: '지금 열 수 있는 페이지가 없어.', en: 'There are no pages available right now.' })} />
      ) : (
        <div className="space-y-5">
          {pageItems.length > 0 ? (
            <section className="space-y-2.5">
              {publicWorkflows.length > 0 ? (
                <Heading level={3}>{t({ ko: '페이지', en: 'Pages' })}</Heading>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {pageItems.map(({ path, labelKey, descriptionKey, icon }) => (
                  <AccessEntryCard
                    key={path}
                    href={path}
                    label={t(labelKey)}
                    description={t(descriptionKey)}
                    icon={icon}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {publicWorkflowsQuery.isLoading ? (
            <LoadingState variant="inline" label={t({ ko: '공용 워크플로우 불러오는 중…', en: 'Loading public workflows…' })} />
          ) : null}

          {publicWorkflows.length > 0 ? (
            <section className="space-y-2.5">
              <Heading level={3}>{t({ ko: '공용 워크플로우', en: 'Public workflows' })}</Heading>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {publicWorkflows.map((workflow) => (
                  <AccessEntryCard
                    key={workflow.id}
                    href={`/public/workflows/${workflow.public_slug}`}
                    label={workflow.name}
                    description={workflow.description?.trim() || t('accessOverviewPage.publicGenerationPage')}
                    icon={Sparkles}
                    badge={t({ ko: '공용', en: 'Public' })}
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
