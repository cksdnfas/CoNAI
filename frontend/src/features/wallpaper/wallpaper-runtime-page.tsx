import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { getAppSettings } from '@/lib/api-settings'
import { getWallpaperCanvasPreset } from './wallpaper-canvas-presets'
import { buildWallpaperStarterLayout, cloneWallpaperPresetToDraft, loadWallpaperLayoutDraft } from './wallpaper-layout-utils'
import { WallpaperCanvasView } from './wallpaper-shared'

export function WallpaperRuntimePage() {
  const wallpaperSettingsQuery = useQuery({
    queryKey: ['app-settings', 'wallpaper-layout'],
    queryFn: getAppSettings,
    staleTime: 60_000,
  })

  const layoutPreset = useMemo(() => {
    const localDraft = loadWallpaperLayoutDraft()
    if (localDraft) {
      return localDraft
    }

    const appearance = wallpaperSettingsQuery.data?.appearance
    const serverPreset = appearance
      ? (appearance.wallpaperLayoutPresets.find((preset) => preset.id === appearance.wallpaperActivePresetId) ?? appearance.wallpaperLayoutPresets[0] ?? null)
      : null

    return serverPreset ? cloneWallpaperPresetToDraft(serverPreset) : buildWallpaperStarterLayout('landscape-1080p')
  }, [wallpaperSettingsQuery.data])

  const canvasPreset = getWallpaperCanvasPreset(layoutPreset.canvasPresetId)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Wallpaper"
        title="Wallpaper Runtime"
        actions={(
          <Button asChild variant="outline">
            <Link to="/wallpaper">Back to Editor</Link>
          </Button>
        )}
      />

      <WallpaperCanvasView
        canvasPreset={canvasPreset}
        layoutPreset={layoutPreset}
        mode="runtime"
      />
    </div>
  )
}
