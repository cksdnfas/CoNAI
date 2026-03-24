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
    applyAppearanceTheme(settingsQuery.data?.appearance ?? DEFAULT_APPEARANCE_SETTINGS)
  }, [settingsQuery.data?.appearance])

  return <>{children}</>
}
