import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'
import { useMinWidth } from './use-min-width'

/** Resolve the shared desktop page-layout breakpoint from appearance settings. */
export function useDesktopPageLayout() {
  const appearanceQuery = useGlobalAppearanceSettingsQuery()

  const desktopPageColumnsMinWidth = appearanceQuery.data?.desktopPageColumnsMinWidth ?? DEFAULT_APPEARANCE_SETTINGS.desktopPageColumnsMinWidth

  return useMinWidth(desktopPageColumnsMinWidth)
}
