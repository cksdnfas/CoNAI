import type { PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAppSettings } from '@/lib/api'
import { DEFAULT_APPEARANCE_SETTINGS, applyAppearanceTheme } from '@/lib/appearance'

export function ThemeProvider({ children }: PropsWithChildren) {
  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  useEffect(() => {
    const appearance = settingsQuery.data?.appearance ?? DEFAULT_APPEARANCE_SETTINGS
    applyAppearanceTheme(appearance)

    if (typeof window === 'undefined' || appearance.themeMode !== 'system') {
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = () => applyAppearanceTheme(appearance)

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [settingsQuery.data?.appearance])

  return <>{children}</>
}
