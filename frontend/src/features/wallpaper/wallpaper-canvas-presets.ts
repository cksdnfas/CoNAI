import type { WallpaperCanvasPreset, WallpaperLayoutPreset } from './wallpaper-types'

export const WALLPAPER_CUSTOM_CANVAS_ID = 'custom'
export const WALLPAPER_CANVAS_MIN = 320
export const WALLPAPER_CANVAS_MAX = 7680

export const WALLPAPER_CANVAS_PRESETS: WallpaperCanvasPreset[] = [
  { id: 'landscape-1080p', name: '1920 × 1080', width: 1920, height: 1080, aspectRatioLabel: '16:9', gridColumns: 24, gridRows: 14 },
  { id: 'landscape-1440p', name: '2560 × 1440', width: 2560, height: 1440, aspectRatioLabel: '16:9', gridColumns: 24, gridRows: 14 },
  { id: 'landscape-2160p', name: '3840 × 2160', width: 3840, height: 2160, aspectRatioLabel: '16:9', gridColumns: 24, gridRows: 14 },
  { id: 'landscape-1600p', name: '2560 × 1600', width: 2560, height: 1600, aspectRatioLabel: '16:10', gridColumns: 24, gridRows: 15 },
  { id: 'ultrawide-1080p', name: '2560 × 1080', width: 2560, height: 1080, aspectRatioLabel: '21:9', gridColumns: 30, gridRows: 14 },
  { id: 'ultrawide-1440p', name: '3440 × 1440', width: 3440, height: 1440, aspectRatioLabel: '21:9', gridColumns: 30, gridRows: 14 },
  { id: 'superwide-1440p', name: '5120 × 1440', width: 5120, height: 1440, aspectRatioLabel: '32:9', gridColumns: 40, gridRows: 14 },
  { id: 'portrait-1080p', name: '1080 × 1920', width: 1080, height: 1920, aspectRatioLabel: '9:16', gridColumns: 18, gridRows: 30 },
]

/** Return the full list of wallpaper canvas presets. */
export function listWallpaperCanvasPresets() {
  return WALLPAPER_CANVAS_PRESETS
}

export function clampWallpaperCanvasSide(value: unknown, fallback: number) {
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed) ? Math.min(WALLPAPER_CANVAS_MAX, Math.max(WALLPAPER_CANVAS_MIN, parsed)) : fallback
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right)
}

/** Find one wallpaper canvas preset by id, with a safe fallback; 'custom' needs the layout's own size. */
export function getWallpaperCanvasPreset(canvasPresetId: string, custom?: { width?: number; height?: number }): WallpaperCanvasPreset {
  if (canvasPresetId === WALLPAPER_CUSTOM_CANVAS_ID) {
    const width = clampWallpaperCanvasSide(custom?.width, 1920)
    const height = clampWallpaperCanvasSide(custom?.height, 1080)
    const divisor = greatestCommonDivisor(width, height)
    return {
      id: WALLPAPER_CUSTOM_CANVAS_ID,
      name: `${width} × ${height}`,
      width,
      height,
      aspectRatioLabel: `${width / divisor}:${height / divisor}`,
      gridColumns: 24,
      gridRows: Math.max(1, Math.round((24 * height) / width)),
    }
  }
  return WALLPAPER_CANVAS_PRESETS.find((preset) => preset.id === canvasPresetId) ?? WALLPAPER_CANVAS_PRESETS[0]
}

/** The canvas a layout draws on. */
export function getWallpaperLayoutCanvas(layout: Pick<WallpaperLayoutPreset, 'canvasPresetId' | 'canvasWidth' | 'canvasHeight'>) {
  return getWallpaperCanvasPreset(layout.canvasPresetId, { width: layout.canvasWidth, height: layout.canvasHeight })
}
