import type { PropsWithChildren } from 'react'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRuntimeAppearanceSettings } from '@/lib/api'
import { DEFAULT_APPEARANCE_SETTINGS, applyAppearanceTheme } from '@/lib/appearance'

export function ThemeProvider({ children }: PropsWithChildren) {
  const appearanceQuery = useQuery({
    queryKey: ['runtime-appearance-settings'],
    queryFn: getRuntimeAppearanceSettings,
  })

  useEffect(() => {
    const appearance = appearanceQuery.data ?? DEFAULT_APPEARANCE_SETTINGS
    applyAppearanceTheme(appearance)

    if (typeof window === 'undefined' || appearance.themeMode !== 'system') {
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
    const handleChange = () => applyAppearanceTheme(appearance)

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [appearanceQuery.data])

  return <>{children}</>
}
