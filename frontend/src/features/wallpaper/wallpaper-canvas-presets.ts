import type { WallpaperCanvasPreset } from './wallpaper-types'

export const WALLPAPER_CANVAS_PRESETS: WallpaperCanvasPreset[] = [
  {
    id: 'landscape-1080p',
    name: '1920 × 1080',
    width: 1920,
    height: 1080,
    aspectRatioLabel: '16:9',
    gridColumns: 24,
    gridRows: 14,
  },
  {
    id: 'landscape-1440p',
    name: '2560 × 1440',
    width: 2560,
    height: 1440,
    aspectRatioLabel: '16:9',
    gridColumns: 24,
    gridRows: 14,
  },
  {
    id: 'ultrawide-1440p',
    name: '3440 × 1440',
    width: 3440,
    height: 1440,
    aspectRatioLabel: '21:9',
    gridColumns: 30,
    gridRows: 14,
  },
  {
    id: 'portrait-1080p',
    name: '1080 × 1920',
    width: 1080,
    height: 1920,
    aspectRatioLabel: '9:16',
    gridColumns: 18,
    gridRows: 30,
  },
]

/** Return the full list of wallpaper canvas presets. */
export function listWallpaperCanvasPresets() {
  return WALLPAPER_CANVAS_PRESETS
}

/** Find one wallpaper canvas preset by id, with a safe fallback. */
export function getWallpaperCanvasPreset(canvasPresetId: string) {
  return WALLPAPER_CANVAS_PRESETS.find((preset) => preset.id === canvasPresetId) ?? WALLPAPER_CANVAS_PRESETS[0]
}
