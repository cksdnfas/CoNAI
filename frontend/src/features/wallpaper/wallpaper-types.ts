export type WallpaperWidgetType = 'clock' | 'queue-status' | 'recent-results' | 'activity-pulse' | 'group-image-view' | 'image-showcase' | 'floating-collage' | 'text-note'

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
  opacity?: number
}

export type WallpaperImageTransitionStyle = 'none' | 'fade' | 'zoom' | 'slide' | 'blur' | 'flip' | 'shuffle'

export type WallpaperImageTransitionSpeed = 'fast' | 'normal' | 'slow'

export interface WallpaperClockWidgetSettings extends WallpaperBaseWidgetSettings {
  timeFormat: '12h' | '24h'
  showSeconds: boolean
  visualStyle: 'minimal' | 'glow' | 'split'
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
}

export interface WallpaperActivityPulseWidgetSettings extends WallpaperBaseWidgetSettings {
  refreshIntervalSec: number
  motionStrength: 'soft' | 'medium' | 'strong'
  emphasis: 'mixed' | 'queue' | 'results'
}

export interface WallpaperGroupSourceWidgetSettings extends WallpaperBaseWidgetSettings {
  groupId: number | null
  includeChildren: boolean
}

export interface WallpaperGroupImageViewWidgetSettings extends WallpaperGroupSourceWidgetSettings {
  visibleCount: number
  motionMode: 'static' | 'ambient' | 'pointer'
  motionStrength: 'soft' | 'medium' | 'strong'
  imageTransitionStyle: WallpaperImageTransitionStyle
  imageTransitionSpeed: WallpaperImageTransitionSpeed
}

export interface WallpaperImageShowcaseWidgetSettings extends WallpaperGroupSourceWidgetSettings {
  fitMode: 'cover' | 'contain'
  slideshowIntervalSec: number
  playbackMode: 'static' | 'carousel' | 'ken-burns'
  imageTransitionStyle: WallpaperImageTransitionStyle
  imageTransitionSpeed: WallpaperImageTransitionSpeed
}

export interface WallpaperFloatingCollageWidgetSettings extends WallpaperGroupSourceWidgetSettings {
  visibleCount: number
  motionStrength: 'soft' | 'medium' | 'strong'
  fitMode: 'cover' | 'contain'
  aspectMode: 'slot' | 'image'
  layoutSpread: 'compact' | 'balanced' | 'wide'
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
  defaultSize: WallpaperWidgetSize
  minSize: WallpaperWidgetSize
  maxSize: WallpaperWidgetSize
  defaultSettings: WallpaperWidgetSettingsMap[T]
}

export type WallpaperWidgetDefinition =
  | WallpaperWidgetDefinitionBase<'clock'>
  | WallpaperWidgetDefinitionBase<'queue-status'>
  | WallpaperWidgetDefinitionBase<'recent-results'>
  | WallpaperWidgetDefinitionBase<'activity-pulse'>
  | WallpaperWidgetDefinitionBase<'group-image-view'>
  | WallpaperWidgetDefinitionBase<'image-showcase'>
  | WallpaperWidgetDefinitionBase<'floating-collage'>
  | WallpaperWidgetDefinitionBase<'text-note'>

interface WallpaperWidgetInstanceBase<T extends WallpaperWidgetType> extends WallpaperWidgetFrame {
  id: string
  type: T
  zIndex: number
  locked: boolean
  hidden: boolean
  settings: WallpaperWidgetSettingsMap[T]
}

export type WallpaperWidgetInstance =
  | WallpaperWidgetInstanceBase<'clock'>
  | WallpaperWidgetInstanceBase<'queue-status'>
  | WallpaperWidgetInstanceBase<'recent-results'>
  | WallpaperWidgetInstanceBase<'activity-pulse'>
  | WallpaperWidgetInstanceBase<'group-image-view'>
  | WallpaperWidgetInstanceBase<'image-showcase'>
  | WallpaperWidgetInstanceBase<'floating-collage'>
  | WallpaperWidgetInstanceBase<'text-note'>

export type WallpaperGroupSourceWidgetInstance =
  | Extract<WallpaperWidgetInstance, { type: 'group-image-view' }>
  | Extract<WallpaperWidgetInstance, { type: 'image-showcase' }>
  | Extract<WallpaperWidgetInstance, { type: 'floating-collage' }>

export type WallpaperTextNoteWidgetInstance = Extract<WallpaperWidgetInstance, { type: 'text-note' }>

export function isWallpaperGroupSourceWidget(widget: WallpaperWidgetInstance): widget is WallpaperGroupSourceWidgetInstance {
  return widget.type === 'group-image-view' || widget.type === 'image-showcase' || widget.type === 'floating-collage'
}

export function isWallpaperTextNoteWidget(widget: WallpaperWidgetInstance): widget is WallpaperTextNoteWidgetInstance {
  return widget.type === 'text-note'
}

export interface WallpaperLayoutPreset {
  id: string
  name: string
  canvasPresetId: string
  widgets: WallpaperWidgetInstance[]
  createdAt: string
  updatedAt: string
}
