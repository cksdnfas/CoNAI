import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { getWallpaperRuntimeSettings } from '@/lib/api-settings-appearance'
import { getWallpaperCanvasPreset } from './wallpaper-canvas-presets'
import { buildWallpaperStarterLayout, cloneWallpaperPresetToDraft, findWallpaperPresetByQuery, loadWallpaperLayoutDraft } from './wallpaper-layout-utils'
import { WallpaperCanvasView } from './wallpaper-shared'
import { toWallpaperLayoutPresetViewModels } from './wallpaper-types'

export function WallpaperRuntimePage() {
  const { t } = useI18n()
  const [searchParams] = useSearchParams()
  const presetQuery = searchParams.get('preset')
  const isDraftPreview = searchParams.get('draft') === '1'
  const authStatusQuery = useAuthStatusQuery()
  const isAnonymousSession = authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated !== true

  const wallpaperSettingsQuery = useQuery({
    queryKey: ['wallpaper-runtime-settings'],
    queryFn: getWallpaperRuntimeSettings,
    staleTime: 60_000,
    enabled: !isDraftPreview,
  })

  const layoutPreset = useMemo(() => {
    if (isDraftPreview) {
      return loadWallpaperLayoutDraft() ?? buildWallpaperStarterLayout('landscape-1080p')
    }

    const runtimeSettings = wallpaperSettingsQuery.data
    const serverPresets = runtimeSettings
      ? toWallpaperLayoutPresetViewModels(runtimeSettings.wallpaperLayoutPresets)
      : []
    const serverPreset = runtimeSettings
      ? (serverPresets.find((preset) => preset.id === runtimeSettings.wallpaperActivePresetId) ?? serverPresets[0] ?? null)
      : null

    if (presetQuery) {
      const matchedPreset = runtimeSettings
        ? findWallpaperPresetByQuery(serverPresets, presetQuery)
        : null
      return matchedPreset ? cloneWallpaperPresetToDraft(matchedPreset) : null
    }

    if (!isAnonymousSession) {
      const localDraft = loadWallpaperLayoutDraft()
      if (localDraft) {
        return localDraft
      }
    }

    return serverPreset ? cloneWallpaperPresetToDraft(serverPreset) : buildWallpaperStarterLayout('landscape-1080p')
  }, [isAnonymousSession, isDraftPreview, presetQuery, wallpaperSettingsQuery.data])

  if (!layoutPreset) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
        {wallpaperSettingsQuery.isLoading
          ? t({ ko: '월페이퍼를 불러오는 중…', en: 'Loading wallpaper…' })
          : t({ ko: '월페이퍼를 찾을 수 없어. URL을 다시 확인해.', en: 'Wallpaper not found. Check the URL.' })}
      </div>
    )
  }

  const canvasPreset = getWallpaperCanvasPreset(layoutPreset.canvasPresetId)

  return (
    <div className="flex min-h-screen items-center justify-center overflow-hidden bg-background">
      <WallpaperCanvasView
        canvasPreset={canvasPreset}
        layoutPreset={layoutPreset}
        mode="runtime"
      />
    </div>
  )
}
