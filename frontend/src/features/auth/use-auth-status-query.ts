import { useQuery } from '@tanstack/react-query'
import type { AuthStatusRecord } from '@/lib/api-auth'
import { getAuthStatus } from '@/lib/api'

export const AUTH_STATUS_QUERY_KEY = ['auth-status'] as const

/** Read one server-embedded auth snapshot for the initial app render. */
function readBootstrapAuthStatus(): AuthStatusRecord | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const bootstrapAuthStatus = (window as Window & { __CONAI_AUTH_STATUS__?: AuthStatusRecord }).__CONAI_AUTH_STATUS__
  return bootstrapAuthStatus ?? undefined
}

/** Load shared auth status for route guards and account-management UI. */
export function useAuthStatusQuery() {
  const bootstrapAuthStatus = readBootstrapAuthStatus()

  return useQuery({
    queryKey: AUTH_STATUS_QUERY_KEY,
    queryFn: getAuthStatus,
    staleTime: 30_000,
    initialData: bootstrapAuthStatus,
    initialDataUpdatedAt: bootstrapAuthStatus ? Date.now() : undefined,
  })
}
