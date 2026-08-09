import {
  WALLPAPER_WIDGET_TYPES,
  type WallpaperWidgetType,
  type WallpaperLayoutPreset as WallpaperLayoutPresetWire,
  type WallpaperWidgetInstance as WallpaperWidgetInstanceWire,
} from '@conai/shared'

export type { WallpaperWidgetType }

export interface WallpaperCanvasPreset {
  id: string
  name: string
  width: number
  height: number
  aspectRatioLabel: string
  gridColumns: number
  gridRows: number
}

export interface WallpaperWidgetSize {
  w: number
  h: number
}

export interface WallpaperWidgetFrame extends WallpaperWidgetSize {
  x: number
  y: number
}

export interface WallpaperBaseWidgetSettings {
  title: string
  showTitle: boolean
  showBackground: boolean
  showBorder?: boolean
  opacity?: number
  imagePreviewOpenScalePercent?: number
  imagePreviewOpenDurationMs?: number
  imagePreviewOpenEasing?: WallpaperAnimationEasing
  imagePreviewCloseScalePercent?: number
  imagePreviewCloseDurationMs?: number
  imagePreviewCloseEasing?: WallpaperAnimationEasing
  imageClickAction?: 'preview' | 'none'
  pauseOnHover?: boolean
}

export type WallpaperImageTransitionStyle = 'none' | 'fade' | 'zoom' | 'slide' | 'blur' | 'flip' | 'shuffle'
export type WallpaperImageTransitionSpeed = 'fast' | 'normal' | 'slow'
export type WallpaperAnimationEasingPreset = 'linear' | 'easeInOutSine' | 'easeOutCubic' | 'easeInOutCubic' | 'easeOutExpo' | 'easeOutBack' | 'easeOutBounce'
export type WallpaperAnimationEasing = WallpaperAnimationEasingPreset | `cubic-bezier(${string})` | `linear(${string})`
export type WallpaperImageHoverMotion = number
export type WallpaperFloatingCollageSwapMode = 'time' | 'bounce'
export type WallpaperClockVisualStyle = 'clean' | 'glass' | 'editorial' | 'minimal' | 'glow' | 'split'

export interface WallpaperClockWidgetSettings extends WallpaperBaseWidgetSettings {
  timeFormat: '12h' | '24h'
  showSeconds: boolean
  showDate?: boolean
  visualStyle: WallpaperClockVisualStyle
}

export interface WallpaperQueueStatusWidgetSettings extends WallpaperBaseWidgetSettings {
  refreshIntervalSec: number
  visualMode: 'tiles' | 'bars' | 'rings'
}

export interface WallpaperRecentResultsWidgetSettings extends WallpaperBaseWidgetSettings {
  refreshIntervalSec: number
  visibleCount: number
  displayMode: 'grid' | 'stack'
  shiftIntervalSec: number
  imageTransitionStyle: WallpaperImageTransitionStyle
  imageTransitionSpeed: WallpaperImageTransitionSpeed
  imageTransitionDurationMs?: number
  imageTransitionEasing: WallpaperAnimationEasing
  imageHoverMotion: WallpaperImageHoverMotion
  hoverEasing: WallpaperAnimationEasing
}

export interface WallpaperActivityPulseWidgetSettings extends WallpaperBaseWidgetSettings {
  refreshIntervalSec: number
  motionStrength: number
  emphasis: 'mixed' | 'queue' | 'results'
}

export interface WallpaperGroupSourceWidgetSettings extends WallpaperBaseWidgetSettings {
  groupId: number | null
  includeChildren: boolean
}

export interface WallpaperGroupImageViewWidgetSettings extends WallpaperGroupSourceWidgetSettings {
  visibleCount: number
  layoutMode?: 'grid' | 'filmstrip'
  slideshowIntervalSec: number
  motionMode: 'static' | 'ambient' | 'pointer'
  motionStrength: number
  motionEasing: WallpaperAnimationEasing
  imageTransitionStyle: WallpaperImageTransitionStyle
  imageTransitionSpeed: WallpaperImageTransitionSpeed
  imageTransitionDurationMs?: number
  imageTransitionEasing: WallpaperAnimationEasing
  imageHoverMotion: WallpaperImageHoverMotion
  hoverEasing: WallpaperAnimationEasing
}

export interface WallpaperImageShowcaseWidgetSettings extends WallpaperGroupSourceWidgetSettings {
  fitMode: 'cover' | 'contain' | 'scale-down'
  slideshowIntervalSec: number
  playbackMode: 'static' | 'carousel' | 'ken-burns'
  imageTransitionStyle: WallpaperImageTransitionStyle
  imageTransitionSpeed: WallpaperImageTransitionSpeed
  imageTransitionDurationMs?: number
  imageTransitionEasing: WallpaperAnimationEasing
  imageHoverMotion: WallpaperImageHoverMotion
  hoverEasing: WallpaperAnimationEasing
}

export interface WallpaperFloatingCollageWidgetSettings extends WallpaperGroupSourceWidgetSettings {
  visibleCount: number
  motionStrength: number
  motionEasing: WallpaperAnimationEasing
  motionSpeed: number
  imageScalePercent: number
  fitMode: 'cover' | 'contain'
  aspectMode: 'slot' | 'image'
  imageSwapMode: WallpaperFloatingCollageSwapMode
  imageTransitionStyle?: WallpaperImageTransitionStyle
  imageTransitionDurationMs?: number
  imageTransitionEasing: WallpaperAnimationEasing
  swapIntervalSec: number
  swapBounceCount: number
  imageHoverMotion: WallpaperImageHoverMotion
  hoverEasing: WallpaperAnimationEasing
}

export interface WallpaperTextNoteWidgetSettings extends WallpaperBaseWidgetSettings {
  text: string
}

export interface WallpaperWidgetSettingsMap {
  clock: WallpaperClockWidgetSettings
  'queue-status': WallpaperQueueStatusWidgetSettings
  'recent-results': WallpaperRecentResultsWidgetSettings
  'activity-pulse': WallpaperActivityPulseWidgetSettings
  'group-image-view': WallpaperGroupImageViewWidgetSettings
  'image-showcase': WallpaperImageShowcaseWidgetSettings
  'floating-collage': WallpaperFloatingCollageWidgetSettings
  'text-note': WallpaperTextNoteWidgetSettings
}

interface WallpaperWidgetDefinitionBase<T extends WallpaperWidgetType> {
  type: T
  title: string
  description: string
  searchKeywords?: readonly string[]
  defaultSize: WallpaperWidgetSize
  minSize: WallpaperWidgetSize
  maxSize: WallpaperWidgetSize
  defaultSettings: WallpaperWidgetSettingsMap[T]
}

export type WallpaperWidgetDefinition = {
  [T in WallpaperWidgetType]: WallpaperWidgetDefinitionBase<T>
}[WallpaperWidgetType]

interface WallpaperWidgetInstanceBase<T extends WallpaperWidgetType> extends WallpaperWidgetFrame {
  id: string
  type: T
  zIndex: number
  locked: boolean
  hidden: boolean
  settings: WallpaperWidgetSettingsMap[T]
}

export type WallpaperWidgetInstance = {
  [T in WallpaperWidgetType]: WallpaperWidgetInstanceBase<T>
}[WallpaperWidgetType]

export type WallpaperGroupSourceWidgetInstance =
  | Extract<WallpaperWidgetInstance, { type: 'group-image-view' }>
  | Extract<WallpaperWidgetInstance, { type: 'image-showcase' }>
  | Extract<WallpaperWidgetInstance, { type: 'floating-collage' }>

export function isWallpaperGroupSourceWidget(widget: WallpaperWidgetInstance): widget is WallpaperGroupSourceWidgetInstance {
  return widget.type === 'group-image-view' || widget.type === 'image-showcase' || widget.type === 'floating-collage'
}

export function isWallpaperPreviewableImageWidget(widget: WallpaperWidgetInstance): widget is Extract<WallpaperWidgetInstance, { type: 'recent-results' | 'group-image-view' | 'image-showcase' | 'floating-collage' }> {
  return widget.type === 'recent-results' || widget.type === 'group-image-view' || widget.type === 'image-showcase' || widget.type === 'floating-collage'
}

export interface WallpaperLayoutPreset {
  id: string
  name: string
  canvasPresetId: string
  widgets: WallpaperWidgetInstance[]
  createdAt: string
  updatedAt: string
  /** Wire widgets unknown to this frontend build; hidden in the editor but preserved on save. */
  unsupportedWidgets?: WallpaperWidgetInstanceWire[]
}

const WALLPAPER_WIDGET_TYPE_SET = new Set<string>(WALLPAPER_WIDGET_TYPES)

function toWallpaperWidgetViewModel(widget: WallpaperWidgetInstanceWire): WallpaperWidgetInstance | null {
  if (!WALLPAPER_WIDGET_TYPE_SET.has(widget.type)) {
    return null
  }

  return {
    ...widget,
    settings: { ...widget.settings },
  } as unknown as WallpaperWidgetInstance
}

/** Narrow the intentionally loose API wire records at the wallpaper UI boundary. */
export function toWallpaperLayoutPresetViewModels(presets: readonly WallpaperLayoutPresetWire[]): WallpaperLayoutPreset[] {
  return presets.map((preset) => {
    const widgets: WallpaperWidgetInstance[] = []
    const unsupportedWidgets: WallpaperWidgetInstanceWire[] = []
    for (const widget of preset.widgets) {
      const viewModel = toWallpaperWidgetViewModel(widget)
      if (viewModel) {
        widgets.push(viewModel)
      } else {
        unsupportedWidgets.push({ ...widget, settings: { ...widget.settings } })
      }
    }
    return {
      ...preset,
      widgets,
      ...(unsupportedWidgets.length > 0 ? { unsupportedWidgets } : {}),
    }
  })
}

/** Serialize the detailed editor view model without constraining backend-owned record fields. */
export function toWallpaperLayoutPresetWireModels(presets: readonly WallpaperLayoutPreset[]): WallpaperLayoutPresetWire[] {
  return presets.map(({ unsupportedWidgets = [], ...preset }) => ({
    ...preset,
    widgets: [
      ...preset.widgets.map((widget) => ({
        ...widget,
        settings: { ...widget.settings } as Record<string, unknown>,
      })),
      ...unsupportedWidgets.map((widget) => ({ ...widget, settings: { ...widget.settings } })),
    ],
  }))
}
