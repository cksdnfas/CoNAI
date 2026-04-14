import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { getWallpaperRuntimeSettings } from '@/lib/api-settings'
import { getWallpaperCanvasPreset } from './wallpaper-canvas-presets'
import { buildWallpaperStarterLayout, cloneWallpaperPresetToDraft, findWallpaperPresetByQuery, loadWallpaperLayoutDraft } from './wallpaper-layout-utils'
import { WallpaperCanvasView } from './wallpaper-shared'

export function WallpaperRuntimePage() {
  const [searchParams] = useSearchParams()
  const presetQuery = searchParams.get('preset')
  const authStatusQuery = useAuthStatusQuery()
  const isAnonymousSession = authStatusQuery.data?.hasCredentials === true && authStatusQuery.data?.authenticated !== true

  const wallpaperSettingsQuery = useQuery({
    queryKey: ['wallpaper-runtime-settings'],
    queryFn: getWallpaperRuntimeSettings,
    staleTime: 60_000,
  })

  const layoutPreset = useMemo(() => {
    const runtimeSettings = wallpaperSettingsQuery.data
    const serverPreset = runtimeSettings
      ? (runtimeSettings.wallpaperLayoutPresets.find((preset) => preset.id === runtimeSettings.wallpaperActivePresetId) ?? runtimeSettings.wallpaperLayoutPresets[0] ?? null)
      : null

    if (presetQuery) {
      const matchedPreset = runtimeSettings ? findWallpaperPresetByQuery(runtimeSettings.wallpaperLayoutPresets, presetQuery) : null
      return matchedPreset
        ? cloneWallpaperPresetToDraft(matchedPreset)
        : (serverPreset ? cloneWallpaperPresetToDraft(serverPreset) : buildWallpaperStarterLayout('landscape-1080p'))
    }

    if (!isAnonymousSession) {
      const localDraft = loadWallpaperLayoutDraft()
      if (localDraft) {
        return localDraft
      }
    }

    return serverPreset ? cloneWallpaperPresetToDraft(serverPreset) : buildWallpaperStarterLayout('landscape-1080p')
  }, [isAnonymousSession, presetQuery, wallpaperSettingsQuery.data])

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
