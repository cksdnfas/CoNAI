import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'

/**
 * Server paths and environment-variable hints are only useful (and only safe to show) to whoever runs the server:
 * admins, or the local owner before any account exists.
 */
export function useCanSeeServerDetails(): boolean {
  const { data: authStatus } = useAuthStatusQuery()
  if (!authStatus) return false
  return authStatus.hasCredentials !== true || authStatus.isAdmin === true
}
