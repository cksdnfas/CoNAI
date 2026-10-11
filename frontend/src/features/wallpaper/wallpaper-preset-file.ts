import type { WallpaperLayoutPresetWire } from './wallpaper-types'
import type { WallpaperLayoutPreset } from './wallpaper-types'
import { cloneWallpaperPresetToDraft, toWallpaperLayoutPresetViewModel, toWallpaperLayoutPresetWireModel } from './wallpaper-layout-utils'

const WALLPAPER_PRESET_FILE_FORMAT = 'conai-wallpaper'
const WALLPAPER_PRESET_FILE_VERSION = 1

interface WallpaperPresetFile {
  format: typeof WALLPAPER_PRESET_FILE_FORMAT
  version: number
  exportedAt: string
  preset: WallpaperLayoutPresetWire
}

function finiteOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** One wallpaper as a shareable JSON file. Library media stay references (image hash, group id). */
export function buildWallpaperPresetFile(preset: WallpaperLayoutPreset): { fileName: string; blob: Blob } {
  const payload: WallpaperPresetFile = {
    format: WALLPAPER_PRESET_FILE_FORMAT,
    version: WALLPAPER_PRESET_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    preset: toWallpaperLayoutPresetWireModel(preset),
  }
  const slug = preset.name.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'wallpaper'
  return {
    fileName: `${slug}.conai-wallpaper.json`,
    blob: new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  }
}

/** Read a wallpaper file into an unsaved draft; null when the file is not one. */
export function parseWallpaperPresetFile(text: string): WallpaperLayoutPreset | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Partial<WallpaperPresetFile>
  const preset = record.format === WALLPAPER_PRESET_FILE_FORMAT ? record.preset : null
  if (
    !preset
    || typeof preset !== 'object'
    || typeof preset.name !== 'string'
    || typeof preset.canvasPresetId !== 'string'
    || !Array.isArray(preset.widgets)
  ) {
    return null
  }
  const now = new Date().toISOString()
  const view = toWallpaperLayoutPresetViewModel({
    ...preset,
    id: 'wallpaper-layout-draft',
    name: preset.name.trim().slice(0, 80) || 'Wallpaper',
    widgets: preset.widgets
      .filter((widget) => widget && typeof widget === 'object' && typeof widget.type === 'string' && typeof widget.id === 'string')
      .map((widget, index) => ({
        ...widget,
        x: finiteOr(widget.x, 0),
        y: finiteOr(widget.y, 0),
        w: finiteOr(widget.w, 320),
        h: finiteOr(widget.h, 200),
        zIndex: finiteOr(widget.zIndex, index + 1),
        locked: widget.locked === true,
        hidden: widget.hidden === true,
        settings: widget.settings && typeof widget.settings === 'object' ? widget.settings : {},
      })),
    createdAt: now,
    updatedAt: now,
  })
  return cloneWallpaperPresetToDraft(view)
}
