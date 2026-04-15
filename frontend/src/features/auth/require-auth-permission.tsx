import type { ReactNode } from 'react'
import { hasAuthPermission } from './auth-permissions'
import { useAuthPermissionRedirect } from './use-auth-permission-redirect'
import { useAuthStatusQuery } from './use-auth-status-query'

interface RequireAuthPermissionProps {
  permissionKey: string
  children: ReactNode
}

/** Redirect authenticated users away from routes they are not allowed to view. */
export function RequireAuthPermission({ permissionKey, children }: RequireAuthPermissionProps) {
  const authStatusQuery = useAuthStatusQuery()
  const canViewPage = hasAuthPermission(authStatusQuery.data?.permissionKeys, permissionKey)

  useAuthPermissionRedirect({
    enabled: !authStatusQuery.isLoading && !canViewPage,
    permissionKey,
  })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  if (canViewPage) {
    return <>{children}</>
  }

  return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
}
