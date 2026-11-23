import { useQuery } from '@tanstack/react-query'
import { getServerTimeZone, SERVER_TIME_ZONE_QUERY_KEY } from '@/lib/api-settings-general'

/** The zone the server's clock runs in (settings › 시스템 › 시간대) and its time; saving that row invalidates it. */
export function useServerTimeZoneQuery(enabled = true) {
  return useQuery({ queryKey: SERVER_TIME_ZONE_QUERY_KEY, queryFn: getServerTimeZone, enabled, staleTime: 60_000 })
}
