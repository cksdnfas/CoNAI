import { getWallpaperCanvasPreset } from './wallpaper-canvas-presets'
import { createWallpaperWidgetInstance, getWallpaperWidgetDefinition } from './wallpaper-widget-registry'
import type { WallpaperCanvasPreset, WallpaperLayoutPreset, WallpaperWidgetInstance, WallpaperWidgetType } from './wallpaper-types'

function normalizeWallpaperPresetQueryValue(value: string) {
  return value.trim().toLowerCase()
}

function buildWallpaperPresetSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function getWallpaperPresetQueryId(presetQuery: string) {
  const separatorIndex = presetQuery.lastIndexOf('--')
  if (separatorIndex < 0) {
    return null
  }

  return normalizeWallpaperPresetQueryValue(presetQuery.slice(separatorIndex + 2)) || null
}

/** Build one stable human-readable query token from a wallpaper preset name. */
export function buildWallpaperPresetQueryValue(preset: Pick<WallpaperLayoutPreset, 'id' | 'name'>) {
  const slug = buildWallpaperPresetSlug(preset.name)
  const normalizedId = normalizeWallpaperPresetQueryValue(preset.id)

  return slug ? `${slug}--${normalizedId}` : normalizedId
}

/** Resolve one saved wallpaper preset from a runtime preset query token. */
export function findWallpaperPresetByQuery(layoutPresets: WallpaperLayoutPreset[], presetQuery: string | null | undefined) {
  const normalizedQuery = normalizeWallpaperPresetQueryValue(presetQuery ?? '')
  if (!normalizedQuery) {
    return null
  }

  const presetIdFromQuery = getWallpaperPresetQueryId(normalizedQuery)
  if (presetIdFromQuery) {
    const matchedPresetById = layoutPresets.find((preset) => normalizeWallpaperPresetQueryValue(preset.id) === presetIdFromQuery)
    if (matchedPresetById) {
      return matchedPresetById
    }
  }

  return layoutPresets.find((preset) => (
    normalizeWallpaperPresetQueryValue(preset.id) === normalizedQuery ||
    normalizeWallpaperPresetQueryValue(buildWallpaperPresetSlug(preset.name)) === normalizedQuery ||
    normalizeWallpaperPresetQueryValue(buildWallpaperPresetQueryValue(preset)) === normalizedQuery
  )) ?? null
}

/** Build one runtime hash-route path for a saved wallpaper preset. */
export function buildWallpaperRuntimePath(preset?: Pick<WallpaperLayoutPreset, 'id' | 'name'> | null) {
  if (!preset) {
    return '/wallpaper/runtime'
  }

  return `/wallpaper/runtime?preset=${encodeURIComponent(buildWallpaperPresetQueryValue(preset))}`
}

/** Build one absolute browser URL for a wallpaper runtime hash route. */
export function buildWallpaperRuntimeAbsoluteUrl(runtimePath: string) {
  if (typeof window === 'undefined') {
    return runtimePath
  }

  return `${window.location.origin}${window.location.pathname}#${runtimePath}`
}

const WALLPAPER_LAYOUT_DRAFT_STORAGE_KEY = 'conai.wallpaper.layoutDraft.v1'
const WALLPAPER_LAYOUT_PRESETS_STORAGE_KEY = 'conai.wallpaper.layoutPresets.v1'
const WALLPAPER_LAYOUT_ACTIVE_PRESET_ID_STORAGE_KEY = 'conai.wallpaper.activePresetId.v1'

/** Clamp one widget instance into the current canvas grid bounds. */
export function clampWallpaperWidgetInstance(widget: WallpaperWidgetInstance, canvasPreset: WallpaperCanvasPreset): WallpaperWidgetInstance {
  const widgetDefinition = getWallpaperWidgetDefinition(widget.type)
  const nextWidth = Math.max(widgetDefinition.minSize.w, Math.min(widget.w, canvasPreset.gridColumns))
  const nextHeight = Math.max(widgetDefinition.minSize.h, Math.min(widget.h, canvasPreset.gridRows))
  const nextX = Math.max(0, Math.min(widget.x, canvasPreset.gridColumns - nextWidth))
  const nextY = Math.max(0, Math.min(widget.y, canvasPreset.gridRows - nextHeight))

  return {
    ...widget,
    x: nextX,
    y: nextY,
    w: nextWidth,
    h: nextHeight,
  }
}

/** Normalize all widget frames after a canvas preset change or manual edit. */
export function normalizeWallpaperLayoutPreset(layoutPreset: WallpaperLayoutPreset, canvasPreset = getWallpaperCanvasPreset(layoutPreset.canvasPresetId)): WallpaperLayoutPreset {
  return {
    ...layoutPreset,
    canvasPresetId: canvasPreset.id,
    widgets: layoutPreset.widgets.map((widget) => clampWallpaperWidgetInstance(widget, canvasPreset)),
    updatedAt: new Date().toISOString(),
  }
}

/** Create the first local wallpaper layout draft for one selected canvas preset. */
export function buildWallpaperLayoutDraft(canvasPresetId: string): WallpaperLayoutPreset {
  const now = new Date().toISOString()
  return {
    id: 'wallpaper-layout-draft',
    name: '새 월페이퍼',
    canvasPresetId,
    widgets: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** Create a small starter layout so the editor and runtime are not completely empty. */
export function buildWallpaperStarterLayout(canvasPresetId: string): WallpaperLayoutPreset {
  const canvasPreset = getWallpaperCanvasPreset(canvasPresetId)
  const baseLayout = buildWallpaperLayoutDraft(canvasPreset.id)

  return normalizeWallpaperLayoutPreset(
    {
      ...baseLayout,
      widgets: [
        createWallpaperWidgetInstance('clock', canvasPreset, 0),
        createWallpaperWidgetInstance('queue-status', canvasPreset, 1),
        createWallpaperWidgetInstance('text-note', canvasPreset, 2),
      ],
    },
    canvasPreset,
  )
}

/** Create one editable draft from a saved preset. */
export function cloneWallpaperPresetToDraft(layoutPreset: WallpaperLayoutPreset): WallpaperLayoutPreset {
  return normalizeWallpaperLayoutPreset({
    ...layoutPreset,
    id: 'wallpaper-layout-draft',
  })
}

/** Load the locally saved wallpaper draft when available. */
export function loadWallpaperLayoutDraft() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(WALLPAPER_LAYOUT_DRAFT_STORAGE_KEY)
    if (!rawValue) {
      return null
    }
    const parsedValue = JSON.parse(rawValue) as WallpaperLayoutPreset
    return normalizeWallpaperLayoutPreset(parsedValue)
  } catch {
    return null
  }
}

/** Persist the current wallpaper draft locally for runtime preview. */
export function saveWallpaperLayoutDraft(layoutPreset: WallpaperLayoutPreset) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(WALLPAPER_LAYOUT_DRAFT_STORAGE_KEY, JSON.stringify(layoutPreset))
}

/** Read all named wallpaper presets from local storage. */
export function loadWallpaperLayoutPresets() {
  if (typeof window === 'undefined') {
    return [] as WallpaperLayoutPreset[]
  }

  try {
    const rawValue = window.localStorage.getItem(WALLPAPER_LAYOUT_PRESETS_STORAGE_KEY)
    if (!rawValue) {
      return [] as WallpaperLayoutPreset[]
    }

    const parsedValue = JSON.parse(rawValue) as WallpaperLayoutPreset[]
    return parsedValue.map((preset) => normalizeWallpaperLayoutPreset(preset))
  } catch {
    return [] as WallpaperLayoutPreset[]
  }
}

/** Persist the full named preset list locally. */
export function saveWallpaperLayoutPresets(layoutPresets: WallpaperLayoutPreset[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(WALLPAPER_LAYOUT_PRESETS_STORAGE_KEY, JSON.stringify(layoutPresets))
}

/** Read the last active preset id when available. */
export function loadWallpaperActivePresetId() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage.getItem(WALLPAPER_LAYOUT_ACTIVE_PRESET_ID_STORAGE_KEY)
}

/** Persist the last active preset id for the editor. */
export function saveWallpaperActivePresetId(presetId: string | null) {
  if (typeof window === 'undefined') {
    return
  }

  if (!presetId) {
    window.localStorage.removeItem(WALLPAPER_LAYOUT_ACTIVE_PRESET_ID_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(WALLPAPER_LAYOUT_ACTIVE_PRESET_ID_STORAGE_KEY, presetId)
}

/** Save or update one named wallpaper preset from the current draft. */
export function upsertWallpaperLayoutPreset(layoutPresets: WallpaperLayoutPreset[], draftLayout: WallpaperLayoutPreset, options?: { presetId?: string | null; name?: string }) {
  const now = new Date().toISOString()
  const trimmedName = (options?.name ?? draftLayout.name).trim()
  const presetName = trimmedName || '월페이퍼 프리셋'
  const presetId = options?.presetId ?? `wallpaper-preset-${Date.now()}`
  const existingPreset = layoutPresets.find((preset) => preset.id === presetId)

  const nextPreset = normalizeWallpaperLayoutPreset({
    ...draftLayout,
    id: presetId,
    name: presetName,
    createdAt: existingPreset?.createdAt ?? now,
    updatedAt: now,
  })

  const nextPresets = existingPreset
    ? layoutPresets.map((preset) => (preset.id === presetId ? nextPreset : preset))
    : [...layoutPresets, nextPreset]

  return {
    presetId,
    presets: nextPresets,
  }
}

/** Delete one named wallpaper preset. */
export function deleteWallpaperLayoutPreset(layoutPresets: WallpaperLayoutPreset[], presetId: string) {
  return layoutPresets.filter((preset) => preset.id !== presetId)
}

/** Sort wallpaper widgets from frontmost to backmost using the persisted z-index order. */
export function getWallpaperWidgetsFrontToBack(widgets: WallpaperWidgetInstance[]) {
  return [...widgets].sort((left, right) => right.zIndex - left.zIndex)
}

/** Rebuild widget order from one front-to-back id list while keeping z-indexes contiguous. */
export function reorderWallpaperWidgets(layoutPreset: WallpaperLayoutPreset, orderedWidgetIds: string[]) {
  const currentFrontToBack = getWallpaperWidgetsFrontToBack(layoutPreset.widgets)
  const widgetMap = new Map(layoutPreset.widgets.map((widget) => [widget.id, widget]))
  const seen = new Set<string>()

  const nextFrontToBack = [
    ...orderedWidgetIds.map((widgetId) => {
      seen.add(widgetId)
      return widgetMap.get(widgetId) ?? null
    }).filter((widget): widget is WallpaperWidgetInstance => widget !== null),
    ...currentFrontToBack.filter((widget) => !seen.has(widget.id)),
  ]

  const widgetCount = nextFrontToBack.length
  return normalizeWallpaperLayoutPreset({
    ...layoutPreset,
    widgets: nextFrontToBack.map((widget, index) => ({
      ...widget,
      zIndex: widgetCount - index,
    })),
  })
}

/** Move one widget to the requested front-to-back order position. */
export function moveWallpaperWidgetToOrder(layoutPreset: WallpaperLayoutPreset, widgetId: string, nextOrder: number) {
  const currentFrontToBack = getWallpaperWidgetsFrontToBack(layoutPreset.widgets)
  const currentIndex = currentFrontToBack.findIndex((widget) => widget.id === widgetId)
  if (currentIndex < 0) {
    return layoutPreset
  }

  const clampedIndex = Math.max(0, Math.min(currentFrontToBack.length - 1, Math.round(nextOrder) - 1))
  if (clampedIndex === currentIndex) {
    return layoutPreset
  }

  const reordered = [...currentFrontToBack]
  const [movedWidget] = reordered.splice(currentIndex, 1)
  if (!movedWidget) {
    return layoutPreset
  }
  reordered.splice(clampedIndex, 0, movedWidget)

  return reorderWallpaperWidgets(layoutPreset, reordered.map((widget) => widget.id))
}

/** Add one default widget instance to the current layout draft. */
export function appendWallpaperWidget(layoutPreset: WallpaperLayoutPreset, widgetType: WallpaperWidgetType) {
  const canvasPreset = getWallpaperCanvasPreset(layoutPreset.canvasPresetId)
  return normalizeWallpaperLayoutPreset(
    {
      ...layoutPreset,
      widgets: [...layoutPreset.widgets, createWallpaperWidgetInstance(widgetType, canvasPreset, layoutPreset.widgets.length)],
    },
    canvasPreset,
  )
}
