import { useMemo, type CSSProperties } from 'react'
import { buildAppearanceVariables, DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'

/**
 * Theme variables for one wallpaper's own light/dark choice, scoped to the stage instead of the document, so the
 * editor around it keeps the app theme. Without a choice the stage inherits the app theme.
 */
export function useWallpaperTheme(themeMode: 'dark' | 'light' | undefined) {
  const appearanceQuery = useGlobalAppearanceSettingsQuery()
  return useMemo(() => {
    if (!themeMode) return { className: undefined, style: undefined as CSSProperties | undefined }
    const appearance = appearanceQuery.data ?? DEFAULT_APPEARANCE_SETTINGS
    return {
      className: themeMode,
      style: buildAppearanceVariables({ ...appearance, themeMode }) as CSSProperties,
    }
  }, [appearanceQuery.data, themeMode])
}
