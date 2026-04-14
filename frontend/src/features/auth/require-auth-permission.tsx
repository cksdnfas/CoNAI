import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { hasAuthPermission } from './auth-permissions'
import { useAuthStatusQuery } from './use-auth-status-query'

interface RequireAuthPermissionProps {
  permissionKey: string
  children: ReactNode
}

/** Redirect authenticated users away from routes they are not allowed to view. */
export function RequireAuthPermission({ permissionKey, children }: RequireAuthPermissionProps) {
  const authStatusQuery = useAuthStatusQuery()

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
  }

  if (hasAuthPermission(authStatusQuery.data?.permissionKeys, permissionKey)) {
    return <>{children}</>
  }

  return <Navigate to="/" replace />
}
