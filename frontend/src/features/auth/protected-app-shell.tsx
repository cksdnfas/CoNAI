import { Navigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { Heading } from '@/components/ui/heading'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { hasAuthPermission, resolveAccountDraftOwner } from './auth-permissions'
import { resolveRoutePermissionKey } from './auth-route-permissions'
import { useAuthStatusQuery } from './use-auth-status-query'
import { ImagePermissionsContext, resolveImagePermissions } from './use-image-permissions'
import { FeaturePermissionsContext, resolveFeaturePermissions } from './use-feature-permissions'

/** Block app-shell routes until the local login requirement is satisfied. */
export function ProtectedAppShell() {
  const location = useLocation()
  const authStatusQuery = useAuthStatusQuery()

  if (authStatusQuery.isLoading) {
    return <div className="min-h-screen bg-background" />
  }

  if (authStatusQuery.data?.hasCredentials === false && !authStatusQuery.data.authenticated) {
    return <SetupRequiredScreen />
  }

  if (authStatusQuery.data?.hasCredentials && !authStatusQuery.data.authenticated) {
    const nextPath = `${location.pathname}${location.search}` || '/'
    const requiredPermissionKey = resolveRoutePermissionKey(location.pathname)
    if (!requiredPermissionKey || !hasAuthPermission(authStatusQuery.data.permissionKeys, requiredPermissionKey)) {
      return <Navigate to={`/login?next=${encodeURIComponent(nextPath)}`} replace />
    }
  }

  return <FeaturePermissionsContext.Provider value={resolveFeaturePermissions(authStatusQuery.data?.permissionKeys, authStatusQuery.data?.authenticated, authStatusQuery.data?.isAdmin)}><ImagePermissionsContext.Provider value={resolveImagePermissions(authStatusQuery.data?.permissionKeys, authStatusQuery.data?.authenticated)}><AppShell key={resolveAccountDraftOwner(authStatusQuery.data)} /></ImagePermissionsContext.Provider></FeaturePermissionsContext.Provider>
}

/** Shown to other machines before the first admin exists; bootstrap access stays on the server PC. */
function SetupRequiredScreen() {
  const { t } = useI18n()
  const localUrl = `http://localhost:${window.location.port || '80'}`

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Text variant="overline" className="font-semibold">CoNAI</Text>
      <Panel tone="none" padding="lg" className="theme-floating-panel space-y-3 rounded-md">
        <Heading level={1}>{t({ ko: '초기 설정 필요', en: 'Setup required' })}</Heading>
        <Text>
          {t({
            ko: `아직 관리자 계정이 없어. 서버 PC에서 ${localUrl} 로 열어서 설정 > 보안에서 관리자 계정을 만들어.`,
            en: `No admin account yet. Open ${localUrl} on the server PC and create one in Settings > Security.`,
          })}
        </Text>
      </Panel>
    </div>
  )
}
