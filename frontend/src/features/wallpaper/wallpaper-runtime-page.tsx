import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { getAppSettings } from '@/lib/api-settings'
import { getWallpaperCanvasPreset } from './wallpaper-canvas-presets'
import { buildWallpaperStarterLayout, cloneWallpaperPresetToDraft, findWallpaperPresetByQuery, loadWallpaperLayoutDraft } from './wallpaper-layout-utils'
import { WallpaperCanvasView } from './wallpaper-shared'

export function WallpaperRuntimePage() {
  const [searchParams] = useSearchParams()
  const presetQuery = searchParams.get('preset')

  const wallpaperSettingsQuery = useQuery({
    queryKey: ['app-settings', 'wallpaper-layout'],
    queryFn: getAppSettings,
    staleTime: 60_000,
  })

  const layoutPreset = useMemo(() => {
    const appearance = wallpaperSettingsQuery.data?.appearance
    const serverPreset = appearance
      ? (appearance.wallpaperLayoutPresets.find((preset) => preset.id === appearance.wallpaperActivePresetId) ?? appearance.wallpaperLayoutPresets[0] ?? null)
      : null

    if (presetQuery) {
      const matchedPreset = appearance ? findWallpaperPresetByQuery(appearance.wallpaperLayoutPresets, presetQuery) : null
      return matchedPreset
        ? cloneWallpaperPresetToDraft(matchedPreset)
        : (serverPreset ? cloneWallpaperPresetToDraft(serverPreset) : buildWallpaperStarterLayout('landscape-1080p'))
    }

    const localDraft = loadWallpaperLayoutDraft()
    if (localDraft) {
      return localDraft
    }

    return serverPreset ? cloneWallpaperPresetToDraft(serverPreset) : buildWallpaperStarterLayout('landscape-1080p')
  }, [presetQuery, wallpaperSettingsQuery.data])

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
