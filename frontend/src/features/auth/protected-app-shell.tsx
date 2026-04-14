import { Navigate, useLocation } from 'react-router-dom'
import { AppShell } from '@/components/layout/app-shell'
import { hasAuthPermission } from './auth-permissions'
import { resolveRoutePermissionKey } from './auth-route-permissions'
import { useAuthStatusQuery } from './use-auth-status-query'

/** Block app-shell routes until the local login requirement is satisfied. */
export function ProtectedAppShell() {
  const location = useLocation()
  const authStatusQuery = useAuthStatusQuery()

  if (authStatusQuery.isLoading) {
    return <div className="min-h-screen bg-surface-low animate-pulse" />
  }

  if (authStatusQuery.data?.hasCredentials && !authStatusQuery.data.authenticated) {
    const nextPath = `${location.pathname}${location.search}` || '/'
    const requiredPermissionKey = resolveRoutePermissionKey(location.pathname)
    if (!requiredPermissionKey || !hasAuthPermission(authStatusQuery.data.permissionKeys, requiredPermissionKey)) {
      return <Navigate to={`/login?next=${encodeURIComponent(nextPath)}`} replace />
    }
  }

  return <AppShell />
}
