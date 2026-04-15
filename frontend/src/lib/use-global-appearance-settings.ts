import { useQuery } from '@tanstack/react-query'
import { getPublicAppearanceSettings } from '@/lib/api-settings'
import type { AppearanceSettings } from '@/types/settings'

export const GLOBAL_APPEARANCE_QUERY_KEY = ['global-appearance-settings'] as const

/** Read the server-embedded shared appearance snapshot for the first paint. */
function readBootstrapAppearance(): AppearanceSettings | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const bootstrapAppearance = (window as Window & { __CONAI_APPEARANCE__?: AppearanceSettings }).__CONAI_APPEARANCE__
  return bootstrapAppearance ?? undefined
}

/** Load the shared global appearance that should apply to every viewer surface. */
export function useGlobalAppearanceSettingsQuery() {
  const bootstrapAppearance = readBootstrapAppearance()

  return useQuery({
    queryKey: GLOBAL_APPEARANCE_QUERY_KEY,
    queryFn: getPublicAppearanceSettings,
    staleTime: 30_000,
    initialData: bootstrapAppearance,
    initialDataUpdatedAt: bootstrapAppearance ? Date.now() : undefined,
  })
}
