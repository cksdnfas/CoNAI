import { useQuery } from '@tanstack/react-query'
import { getAppSettings } from '@/lib/api'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useMinWidth } from './use-min-width'

/** Resolve the shared desktop page-layout breakpoint from appearance settings. */
export function useDesktopPageLayout() {
  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const desktopPageColumnsMinWidth = settingsQuery.data?.appearance.desktopPageColumnsMinWidth ?? DEFAULT_APPEARANCE_SETTINGS.desktopPageColumnsMinWidth

  return useMinWidth(desktopPageColumnsMinWidth)
}
