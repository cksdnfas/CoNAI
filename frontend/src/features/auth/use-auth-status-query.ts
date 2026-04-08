import { useQuery } from '@tanstack/react-query'
import { getAuthStatus } from '@/lib/api'

export const AUTH_STATUS_QUERY_KEY = ['auth-status'] as const

/** Load shared auth status for route guards and account-management UI. */
export function useAuthStatusQuery() {
  return useQuery({
    queryKey: AUTH_STATUS_QUERY_KEY,
    queryFn: getAuthStatus,
    staleTime: 30_000,
  })
}
