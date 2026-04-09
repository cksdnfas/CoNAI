import type { WallpaperCanvasPreset, WallpaperWidgetDefinition, WallpaperWidgetInstance, WallpaperWidgetType } from './wallpaper-types'

export const WALLPAPER_WIDGET_DEFINITIONS: WallpaperWidgetDefinition[] = [
  {
    type: 'clock',
    title: 'Clock',
    description: 'Show the current time with a large wallpaper-friendly display.',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 6 },
    defaultSettings: {
      title: 'Clock',
      showTitle: true,
      showBackground: true,
      timeFormat: '24h',
      showSeconds: true,
      visualStyle: 'glow',
    },
  },
  {
    type: 'queue-status',
    title: 'Queue Status',
    description: 'Show generation queue totals, active jobs, and failures.',
    defaultSize: { w: 8, h: 5 },
    minSize: { w: 6, h: 4 },
    maxSize: { w: 12, h: 8 },
    defaultSettings: {
      title: 'Queue Status',
      showTitle: true,
      showBackground: true,
      refreshIntervalSec: 5,
      visualMode: 'tiles',
    },
  },
  {
    type: 'recent-results',
    title: 'Recent Results',
    description: 'Show the latest workflow image results in one compact live strip.',
    defaultSize: { w: 10, h: 7 },
    minSize: { w: 6, h: 5 },
    maxSize: { w: 16, h: 10 },
    defaultSettings: {
      title: 'Recent Results',
      showTitle: true,
      showBackground: true,
      refreshIntervalSec: 10,
      visibleCount: 4,
      displayMode: 'stack',
      shiftIntervalSec: 8,
    },
  },
  {
    type: 'group-image-view',
    title: 'Group Image View',
    description: 'Display a compact gallery from one target image group.',
    defaultSize: { w: 10, h: 7 },
    minSize: { w: 8, h: 5 },
    maxSize: { w: 16, h: 12 },
    defaultSettings: {
      title: 'Group Image View',
      showTitle: true,
      showBackground: true,
      visibleCount: 6,
      motionMode: 'ambient',
      motionStrength: 'medium',
      groupId: null,
      includeChildren: true,
    },
  },
  {
    type: 'image-showcase',
    title: 'Image Showcase',
    description: 'Highlight one featured image or a slideshow region.',
    defaultSize: { w: 12, h: 8 },
    minSize: { w: 8, h: 5 },
    maxSize: { w: 18, h: 12 },
    defaultSettings: {
      title: 'Image Showcase',
      showTitle: true,
      showBackground: true,
      fitMode: 'cover',
      slideshowIntervalSec: 20,
      playbackMode: 'carousel',
      groupId: null,
      includeChildren: true,
    },
  },
  {
    type: 'floating-collage',
    title: 'Floating Collage',
    description: 'Display a layered floating collage from one target image group.',
    defaultSize: { w: 12, h: 8 },
    minSize: { w: 8, h: 6 },
    maxSize: { w: 18, h: 12 },
    defaultSettings: {
      title: 'Floating Collage',
      showTitle: true,
      showBackground: true,
      visibleCount: 5,
      motionStrength: 'medium',
      groupId: null,
      includeChildren: true,
    },
  },
  {
    type: 'text-note',
    title: 'Text Note',
    description: 'Pin one short note, label, or focus reminder on the layout.',
    defaultSize: { w: 7, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    defaultSettings: {
      title: 'Text Note',
      showTitle: true,
      showBackground: true,
      text: 'Wallpaper note',
    },
  },
]

/** Return the registered wallpaper widget types. */
export function listWallpaperWidgetDefinitions() {
  return WALLPAPER_WIDGET_DEFINITIONS
}

/** Find one wallpaper widget definition by type. */
export function getWallpaperWidgetDefinition<T extends WallpaperWidgetType>(widgetType: T): Extract<WallpaperWidgetDefinition, { type: T }> {
  return (WALLPAPER_WIDGET_DEFINITIONS.find((widget) => widget.type === widgetType) ?? WALLPAPER_WIDGET_DEFINITIONS[0]) as Extract<WallpaperWidgetDefinition, { type: T }>
}

/** Create one placed widget instance using the widget defaults and a simple grid slot. */
export function createWallpaperWidgetInstance<T extends WallpaperWidgetType>(widgetType: T, canvasPreset: WallpaperCanvasPreset, sequence: number): Extract<WallpaperWidgetInstance, { type: T }> {
  const definition = getWallpaperWidgetDefinition(widgetType)
  const slotWidth = Math.max(1, definition.defaultSize.w)
  const itemsPerRow = Math.max(1, Math.floor(canvasPreset.gridColumns / slotWidth))
  const x = (sequence % itemsPerRow) * slotWidth
  const y = Math.floor(sequence / itemsPerRow) * definition.defaultSize.h

  return {
    id: `${widgetType}-${Date.now()}-${sequence}`,
    type: definition.type,
    x,
    y,
    w: definition.defaultSize.w,
    h: definition.defaultSize.h,
    zIndex: sequence + 1,
    locked: false,
    hidden: false,
    settings: { ...definition.defaultSettings },
  } as Extract<WallpaperWidgetInstance, { type: T }>
}
