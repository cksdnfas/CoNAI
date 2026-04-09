export type WallpaperWidgetType = 'clock' | 'queue-status' | 'group-image-view' | 'image-showcase' | 'text-note'

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

export interface WallpaperClockWidgetSettings extends WallpaperBaseWidgetSettings {
  timeFormat: '12h' | '24h'
  showSeconds: boolean
}

export interface WallpaperQueueStatusWidgetSettings extends WallpaperBaseWidgetSettings {
  refreshIntervalSec: number
}

export interface WallpaperGroupSourceWidgetSettings extends WallpaperBaseWidgetSettings {
  groupId: number | null
  includeChildren: boolean
}

export interface WallpaperGroupImageViewWidgetSettings extends WallpaperGroupSourceWidgetSettings {
  visibleCount: number
}

export interface WallpaperImageShowcaseWidgetSettings extends WallpaperGroupSourceWidgetSettings {
  fitMode: 'cover' | 'contain'
  slideshowIntervalSec: number
}

export interface WallpaperTextNoteWidgetSettings extends WallpaperBaseWidgetSettings {
  text: string
}

export interface WallpaperWidgetSettingsMap {
  clock: WallpaperClockWidgetSettings
  'queue-status': WallpaperQueueStatusWidgetSettings
  'group-image-view': WallpaperGroupImageViewWidgetSettings
  'image-showcase': WallpaperImageShowcaseWidgetSettings
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
  | WallpaperWidgetDefinitionBase<'group-image-view'>
  | WallpaperWidgetDefinitionBase<'image-showcase'>
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
  | WallpaperWidgetInstanceBase<'group-image-view'>
  | WallpaperWidgetInstanceBase<'image-showcase'>
  | WallpaperWidgetInstanceBase<'text-note'>

export type WallpaperGroupSourceWidgetInstance =
  | Extract<WallpaperWidgetInstance, { type: 'group-image-view' }>
  | Extract<WallpaperWidgetInstance, { type: 'image-showcase' }>

export type WallpaperTextNoteWidgetInstance = Extract<WallpaperWidgetInstance, { type: 'text-note' }>

export function isWallpaperGroupSourceWidget(widget: WallpaperWidgetInstance): widget is WallpaperGroupSourceWidgetInstance {
  return widget.type === 'group-image-view' || widget.type === 'image-showcase'
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
