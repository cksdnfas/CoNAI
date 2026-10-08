import { useQuery } from '@tanstack/react-query'
import { ArrowRight, LogIn, ShieldAlert, ShieldCheck, Sparkles, X, type LucideIcon } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { getPublicGenerationWorkflows } from '@/lib/api-public-workflows'
import { cn } from '@/lib/utils'
import { resolveRoutePermissionKey } from './auth-route-permissions'
import { PAGE_ACCESS_CATALOG, listAccessiblePageAccessItems } from './page-access-catalog'
import { useAuthStatusQuery } from './use-auth-status-query'

interface AccessEntryCardProps {
  label: string
  description?: string | null
  href: string
  icon: LucideIcon
}

/** One cell of the flat access grid: icon, label, arrow; hairline below, hover wash. */
function AccessEntryCard({ label, description, href, icon: Icon }: AccessEntryCardProps) {
  return (
    <Link
      to={href}
      className={cn(
        'group flex min-h-14 items-center gap-3 border-b border-line px-2 py-2.5 transition-colors',
        'hover:bg-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40',
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />

      <div className="min-w-0 flex-1 space-y-0.5">
        <Text as="div" variant="title" className="truncate">{label}</Text>
        {description ? <Text as="div" variant="caption" className="truncate">{description}</Text> : null}
      </div>

      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
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
    return <div className="min-h-[40vh] rounded-sm bg-fill animate-pulse" />
  }

  const accessibleItems = listAccessiblePageAccessItems(authStatus?.permissionKeys ?? [])
  // Primary pages first, then the pages reached from them; users don't need the distinction spelled out.
  const pageItems = [
    ...accessibleItems.filter((item) => item.category === 'primary'),
    ...accessibleItems.filter((item) => item.category !== 'primary'),
  ]
  const publicWorkflows = publicWorkflowsQuery.data ?? []

  return (
    <div className="space-y-8 pt-2">
      <h1 className="sr-only">{t('appShell.availablePages')}</h1>

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
        <div className="space-y-10">
          {pageItems.length > 0 ? (
            <section className="space-y-2">
              {publicWorkflows.length > 0 ? (
                <Heading level={3} className="text-sm">{t({ ko: '페이지', en: 'Pages' })}</Heading>
              ) : null}
              <div className="grid md:grid-cols-2 md:gap-x-8 xl:grid-cols-3">
                {pageItems.map(({ path, labelKey, icon }) => (
                  <AccessEntryCard
                    key={path}
                    href={path}
                    label={t(labelKey)}
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
            <section className="space-y-2">
              <Heading level={3} className="text-sm">{t({ ko: '공용 워크플로우', en: 'Public workflows' })}</Heading>
              <div className="grid md:grid-cols-2 md:gap-x-8 xl:grid-cols-3">
                {publicWorkflows.map((workflow) => (
                  <AccessEntryCard
                    key={workflow.id}
                    href={`/public/workflows/${workflow.public_slug}`}
                    label={workflow.name}
                    description={workflow.description?.trim()}
                    icon={Sparkles}
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
