import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { buildAppearanceVariables, DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'
import type { WallpaperThemeMode } from './wallpaper-types'

const DAY_START_HOUR = 7
const NIGHT_START_HOUR = 19

function isDaytime(date = new Date()) {
  const hour = date.getHours()
  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR
}

/** 'auto' as light or dark for the current local hour, rechecked every minute. */
function useResolvedThemeMode(themeMode: WallpaperThemeMode | undefined) {
  const [daytime, setDaytime] = useState(isDaytime)
  useEffect(() => {
    if (themeMode !== 'auto') return undefined
    const timer = window.setInterval(() => setDaytime(isDaytime()), 60_000)
    return () => window.clearInterval(timer)
  }, [themeMode])
  if (themeMode === 'auto') return daytime ? 'light' : 'dark'
  return themeMode
}

/**
 * Theme variables for one wallpaper's own light/dark choice, scoped to the stage instead of the document, so the
 * editor around it keeps the app theme. Without a choice the stage inherits the app theme.
 */
export function useWallpaperTheme(themeMode: WallpaperThemeMode | undefined) {
  const appearanceQuery = useGlobalAppearanceSettingsQuery()
  const resolved = useResolvedThemeMode(themeMode)
  return useMemo(() => {
    if (!resolved) return { className: undefined, style: undefined as CSSProperties | undefined }
    const appearance = appearanceQuery.data ?? DEFAULT_APPEARANCE_SETTINGS
    return {
      className: resolved,
      style: buildAppearanceVariables({ ...appearance, themeMode: resolved }) as CSSProperties,
    }
  }, [appearanceQuery.data, resolved])
}
