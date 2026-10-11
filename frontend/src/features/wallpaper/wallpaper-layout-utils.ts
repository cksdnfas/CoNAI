import { WALLPAPER_LAYOUT_VERSION } from '@conai/shared'
import { getWallpaperCanvasPreset, getWallpaperLayoutCanvas, WALLPAPER_CUSTOM_CANVAS_ID } from './wallpaper-canvas-presets'
import {
  createWallpaperWidgetInstance,
  getWallpaperCanvasScale,
  getWallpaperWidgetDefinition,
  getWallpaperWidgetMinSize,
  WALLPAPER_DEFAULT_WIDGET_STYLE,
} from './wallpaper-widget-registry'
import {
  WALLPAPER_WIDGET_TYPE_SET,
  type WallpaperBackground,
  type WallpaperCanvasPreset,
  type WallpaperLayoutPreset,
  type WallpaperLayoutPresetWire,
  type WallpaperPresetOptions,
  type WallpaperWidgetFrame,
  type WallpaperWidgetInstance,
  type WallpaperWidgetInstanceWire,
  type WallpaperWidgetStyle,
  type WallpaperWidgetType,
} from './wallpaper-types'

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

/** Build the stable runtime path for one saved wallpaper preset; a runtime key rides along as `k`. */
export function buildWallpaperRuntimePath(preset: Pick<WallpaperLayoutPreset, 'id' | 'name'>, runtimeKey?: string | null) {
  const query = new URLSearchParams({ preset: buildWallpaperPresetQueryValue(preset) })
  if (runtimeKey) {
    query.set('k', runtimeKey)
  }
  return `/#/wallpaper/runtime?${query.toString()}`
}

/** Build the local-only runtime path used to preview the current editor draft. */
export function buildWallpaperDraftRuntimePath() {
  return '/#/wallpaper/runtime?draft=1'
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

const WALLPAPER_LAYOUT_DRAFT_STORAGE_KEY = 'conai.wallpaper.layoutDraft.v2'
const WALLPAPER_LAYOUT_PRESETS_STORAGE_KEY = 'conai.wallpaper.layoutPresets.v2'
const WALLPAPER_LAYOUT_ACTIVE_PRESET_ID_STORAGE_KEY = 'conai.wallpaper.activePresetId.v1'
/** Version-1 grid drafts; read once and converted. */
const LEGACY_DRAFT_STORAGE_KEY = 'conai.wallpaper.layoutDraft.v1'

export const WALLPAPER_DEFAULT_BACKGROUND: WallpaperBackground = { kind: 'theme' }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** `#RRGGBB`, or `#RRGGBBAA` when a color carries its own opacity. */
export const WALLPAPER_HEX_COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function asColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && WALLPAPER_HEX_COLOR.test(value) ? value : fallback
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}

/** Coerce a stored background into a complete, typed one. */
export function normalizeWallpaperBackground(raw: unknown): WallpaperBackground {
  const record = asRecord(raw)
  const overlay = {
    dim: clampNumber(record.dim, 0, 0, 80),
    blur: clampNumber(record.blur, 0, 0, 24),
    vignette: clampNumber(record.vignette, 0, 0, 100),
    kenBurns: record.kenBurns === true,
  }
  const fit = pick(record.fit, ['cover', 'contain', 'blur-fill'] as const, 'cover')
  switch (record.kind) {
    case 'color':
      return { kind: 'color', color: asColor(record.color, '#131313'), ...overlay }
    case 'gradient':
      return { kind: 'gradient', from: asColor(record.from, '#2d2340'), to: asColor(record.to, '#141119'), angle: clampNumber(record.angle, 160, 0, 360), ...overlay }
    case 'image':
      return { kind: 'image', compositeHash: typeof record.compositeHash === 'string' ? record.compositeHash : null, fit, ...overlay }
    case 'video':
      return { kind: 'video', compositeHash: typeof record.compositeHash === 'string' ? record.compositeHash : null, fit, ...overlay }
    case 'group-slideshow':
      return {
        kind: 'group-slideshow',
        groupId: Number.isInteger(record.groupId) ? record.groupId as number : null,
        includeChildren: record.includeChildren !== false,
        intervalSec: clampNumber(record.intervalSec, 300, 10, 86400),
        order: pick(record.order, ['random', 'latest'] as const, 'random'),
        transition: pick(record.transition, ['fade', 'zoom', 'slide'] as const, 'fade'),
        fit,
        ...overlay,
      }
    default:
      return { kind: 'theme', ...overlay }
  }
}

/** Coerce a stored style; `legacy` maps the version-1 toggles (showBackground/showBorder/opacity). */
export function normalizeWallpaperWidgetStyle(raw: unknown, base: Partial<WallpaperWidgetStyle> = {}, legacy?: Record<string, unknown>): WallpaperWidgetStyle {
  const record = asRecord(raw)
  const fallback = { ...WALLPAPER_DEFAULT_WIDGET_STYLE, ...base }
  const legacyVariant = legacy
    ? legacy.showBackground === true ? 'card' : legacy.showBorder === true ? 'outline' : 'none'
    : undefined
  const legacyOpacity = legacy && typeof legacy.opacity === 'number' ? legacy.opacity * 100 : undefined
  return {
    variant: pick(record.variant ?? legacyVariant, ['none', 'card', 'glass', 'outline'] as const, fallback.variant),
    backgroundColor: typeof record.backgroundColor === 'string' && WALLPAPER_HEX_COLOR.test(record.backgroundColor) ? record.backgroundColor : fallback.backgroundColor,
    backgroundOpacity: clampNumber(record.backgroundOpacity, fallback.backgroundOpacity, 0, 100),
    radius: clampNumber(record.radius, fallback.radius, 0, 200),
    padding: clampNumber(record.padding, fallback.padding, 0, 200),
    shadow: pick(record.shadow, ['none', 'sm', 'md', 'lg'] as const, fallback.shadow),
    blur: clampNumber(record.blur, fallback.blur, 0, 60),
    fontFamily: pick(record.fontFamily, ['inherit', 'sans', 'serif', 'mono', 'display'] as const, fallback.fontFamily),
    fontWeight: pick(record.fontWeight, ['light', 'regular', 'bold'] as const, fallback.fontWeight),
    textColor: typeof record.textColor === 'string' && WALLPAPER_HEX_COLOR.test(record.textColor) ? record.textColor : fallback.textColor,
    accentColor: typeof record.accentColor === 'string' && WALLPAPER_HEX_COLOR.test(record.accentColor) ? record.accentColor : fallback.accentColor,
    textAlign: pick(record.textAlign, ['left', 'center', 'right'] as const, fallback.textAlign),
    opacity: clampNumber(record.opacity ?? legacyOpacity, fallback.opacity, 5, 100),
    showTitle: typeof record.showTitle === 'boolean' ? record.showTitle : legacy?.showTitle === true ? true : fallback.showTitle,
    entrance: pick(record.entrance, ['none', 'fade', 'rise', 'zoom'] as const, fallback.entrance),
    depth: clampNumber(record.depth, fallback.depth, 0, 100),
    showFrom: asClockTime(record.showFrom) ?? fallback.showFrom,
    showUntil: asClockTime(record.showUntil) ?? fallback.showUntil,
  }
}

function asClockTime(value: unknown): string | null {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null
}

export const WALLPAPER_DEFAULT_PRESET_OPTIONS: WallpaperPresetOptions = {
  accentColor: null,
  autoAccent: false,
  textColor: null,
  fontFamily: 'inherit',
  particles: 'none',
  particleAmount: 40,
  parallax: 0,
  widgetReveal: 'always',
  idleOpacity: 25,
  fpsLimit: 0,
}

/** Coerce stored preset options; missing ones take the defaults. */
export function resolveWallpaperPresetOptions(raw: unknown): WallpaperPresetOptions {
  const record = asRecord(raw)
  const fallback = WALLPAPER_DEFAULT_PRESET_OPTIONS
  const color = (value: unknown) => (typeof value === 'string' && WALLPAPER_HEX_COLOR.test(value) ? value : null)
  return {
    accentColor: color(record.accentColor),
    autoAccent: record.autoAccent === true,
    textColor: color(record.textColor),
    fontFamily: pick(record.fontFamily, ['inherit', 'sans', 'serif', 'mono', 'display'] as const, fallback.fontFamily),
    particles: pick(record.particles, ['none', 'snow', 'sakura', 'rain', 'dust', 'fireflies'] as const, fallback.particles),
    particleAmount: clampNumber(record.particleAmount, fallback.particleAmount, 0, 100),
    parallax: clampNumber(record.parallax, fallback.parallax, 0, 100),
    widgetReveal: pick(record.widgetReveal, ['always', 'pointer'] as const, fallback.widgetReveal),
    idleOpacity: clampNumber(record.idleOpacity, fallback.idleOpacity, 0, 100),
    fpsLimit: [0, 15, 24, 30, 60].includes(Number(record.fpsLimit)) ? Number(record.fpsLimit) : fallback.fpsLimit,
  }
}

/** Grid cells of a version-1 layout to canvas pixels. */
function convertLegacyFrame(widget: WallpaperWidgetInstanceWire, canvas: WallpaperCanvasPreset): WallpaperWidgetFrame {
  const cellWidth = canvas.width / canvas.gridColumns
  const cellHeight = canvas.height / canvas.gridRows
  return {
    x: Math.round(widget.x * cellWidth),
    y: Math.round(widget.y * cellHeight),
    w: Math.round(widget.w * cellWidth),
    h: Math.round(widget.h * cellHeight),
  }
}

function toWidgetViewModel(widget: WallpaperWidgetInstanceWire, canvas: WallpaperCanvasPreset, isLegacy: boolean): WallpaperWidgetInstance {
  const type = widget.type as WallpaperWidgetType
  const definition = getWallpaperWidgetDefinition(type)
  const settings = { ...(definition.defaultSettings as object), ...asRecord(widget.settings) } as Record<string, unknown>
  const frame = isLegacy ? convertLegacyFrame(widget, canvas) : { x: widget.x, y: widget.y, w: widget.w, h: widget.h }
  if (isLegacy && type === 'text-note' && typeof settings.fontSize !== 'number') {
    settings.fontSize = Math.max(16, Math.round((frame.h / getWallpaperCanvasScale(canvas)) * 0.22))
  }
  return clampWallpaperWidgetInstance({
    id: widget.id,
    type,
    ...frame,
    zIndex: widget.zIndex,
    locked: widget.locked,
    hidden: widget.hidden,
    rotation: clampNumber(widget.rotation, 0, -360, 360),
    style: normalizeWallpaperWidgetStyle(widget.style, definition.defaultStyle, isLegacy ? asRecord(widget.settings) : undefined),
    settings,
  } as unknown as WallpaperWidgetInstance, canvas)
}

/** Narrow the loose API wire records at the wallpaper UI boundary, converting version-1 grid layouts. */
export function toWallpaperLayoutPresetViewModels(presets: readonly WallpaperLayoutPresetWire[]): WallpaperLayoutPreset[] {
  return presets.map((preset) => toWallpaperLayoutPresetViewModel(preset))
}

export function toWallpaperLayoutPresetViewModel(preset: WallpaperLayoutPresetWire): WallpaperLayoutPreset {
  const canvas = getWallpaperLayoutCanvas(preset)
  const isLegacy = preset.version !== WALLPAPER_LAYOUT_VERSION
  const widgets: WallpaperWidgetInstance[] = []
  const unsupportedWidgets: WallpaperWidgetInstanceWire[] = []
  for (const widget of preset.widgets ?? []) {
    if (WALLPAPER_WIDGET_TYPE_SET.has(widget.type)) {
      widgets.push(toWidgetViewModel(widget, canvas, isLegacy))
    } else {
      unsupportedWidgets.push({ ...widget, settings: { ...widget.settings } })
    }
  }
  return {
    id: preset.id,
    name: preset.name,
    canvasPresetId: canvas.id,
    ...(canvas.id === WALLPAPER_CUSTOM_CANVAS_ID ? { canvasWidth: canvas.width, canvasHeight: canvas.height } : {}),
    themeMode: preset.themeMode === 'light' || preset.themeMode === 'dark' || preset.themeMode === 'auto' ? preset.themeMode : undefined,
    background: normalizeWallpaperBackground(preset.background),
    ...(preset.options ? { options: resolveWallpaperPresetOptions(preset.options) } : {}),
    widgets,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
    ...(unsupportedWidgets.length > 0 ? { unsupportedWidgets } : {}),
  }
}

/** Serialize the editor view model (layout version 2) without constraining backend-owned record fields. */
export function toWallpaperLayoutPresetWireModels(presets: readonly WallpaperLayoutPreset[]): WallpaperLayoutPresetWire[] {
  return presets.map((preset) => toWallpaperLayoutPresetWireModel(preset))
}

export function toWallpaperLayoutPresetWireModel({ unsupportedWidgets = [], ...preset }: WallpaperLayoutPreset): WallpaperLayoutPresetWire {
  return {
    id: preset.id,
    name: preset.name,
    canvasPresetId: preset.canvasPresetId,
    version: WALLPAPER_LAYOUT_VERSION,
    ...(preset.canvasPresetId === WALLPAPER_CUSTOM_CANVAS_ID ? { canvasWidth: preset.canvasWidth, canvasHeight: preset.canvasHeight } : {}),
    ...(preset.themeMode ? { themeMode: preset.themeMode } : {}),
    background: { ...preset.background },
    ...(preset.options ? { options: { ...preset.options } as Record<string, unknown> } : {}),
    widgets: [
      ...preset.widgets.map((widget) => ({
        ...widget,
        x: Math.round(widget.x),
        y: Math.round(widget.y),
        w: Math.round(widget.w),
        h: Math.round(widget.h),
        style: { ...(widget.style as object) } as Record<string, unknown>,
        settings: { ...(widget.settings as object) } as Record<string, unknown>,
      })),
      ...unsupportedWidgets.map((widget) => ({ ...widget, settings: { ...widget.settings } })),
    ],
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
  }
}

/** Keep one widget's frame on the canvas and at least its minimum size. */
export function clampWallpaperWidgetInstance<T extends WallpaperWidgetInstance>(widget: T, canvas: Pick<WallpaperCanvasPreset, 'width' | 'height'>): T {
  const minSize = getWallpaperWidgetMinSize(widget.type, canvas)
  const w = Math.round(Math.max(Math.min(minSize.w, canvas.width), Math.min(widget.w, canvas.width)))
  const h = Math.round(Math.max(Math.min(minSize.h, canvas.height), Math.min(widget.h, canvas.height)))
  return {
    ...widget,
    x: Math.round(Math.max(0, Math.min(widget.x, canvas.width - w))),
    y: Math.round(Math.max(0, Math.min(widget.y, canvas.height - h))),
    w,
    h,
  }
}

/** Clamp every widget after a canvas change or manual edit. */
export function normalizeWallpaperLayoutPreset(layoutPreset: WallpaperLayoutPreset): WallpaperLayoutPreset {
  const canvas = getWallpaperLayoutCanvas(layoutPreset)
  return {
    ...layoutPreset,
    widgets: layoutPreset.widgets.map((widget) => clampWallpaperWidgetInstance(widget, canvas)),
  }
}

/** Move the layout to another canvas, scaling widget frames with it. */
export function resizeWallpaperLayoutCanvas(layoutPreset: WallpaperLayoutPreset, canvasPresetId: string, custom?: { width: number; height: number }): WallpaperLayoutPreset {
  const from = getWallpaperLayoutCanvas(layoutPreset)
  const to = getWallpaperCanvasPreset(canvasPresetId, custom)
  const scaleX = to.width / from.width
  const scaleY = to.height / from.height
  return normalizeWallpaperLayoutPreset({
    ...layoutPreset,
    canvasPresetId: to.id,
    canvasWidth: to.id === WALLPAPER_CUSTOM_CANVAS_ID ? to.width : undefined,
    canvasHeight: to.id === WALLPAPER_CUSTOM_CANVAS_ID ? to.height : undefined,
    widgets: layoutPreset.widgets.map((widget) => ({
      ...widget,
      x: widget.x * scaleX,
      y: widget.y * scaleY,
      w: widget.w * scaleX,
      h: widget.h * scaleY,
    })),
  })
}

/** Create the first local wallpaper layout draft for one selected canvas preset. */
export function buildWallpaperLayoutDraft(canvasPresetId: string): WallpaperLayoutPreset {
  const now = new Date().toISOString()
  return {
    id: 'wallpaper-layout-draft',
    name: '새 월페이퍼',
    canvasPresetId,
    background: { ...WALLPAPER_DEFAULT_BACKGROUND },
    widgets: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** A small starter layout so the editor and runtime are not completely empty. */
export function buildWallpaperStarterLayout(canvasPresetId: string): WallpaperLayoutPreset {
  const canvas = getWallpaperCanvasPreset(canvasPresetId)
  const layout = buildWallpaperLayoutDraft(canvas.id)
  const clock = createWallpaperWidgetInstance('clock', canvas, 1, { x: canvas.width * 0.24, y: canvas.height * 0.2 })
  const progress = createWallpaperWidgetInstance('generation-progress', canvas, 2, { x: canvas.width * 0.2, y: canvas.height * 0.78 })
  const recent = createWallpaperWidgetInstance('recent-results', canvas, 3, { x: canvas.width * 0.7, y: canvas.height * 0.5 })
  return normalizeWallpaperLayoutPreset({ ...layout, widgets: [clock, progress, recent] })
}

/** Create one editable draft from a saved preset. */
export function cloneWallpaperPresetToDraft(layoutPreset: WallpaperLayoutPreset): WallpaperLayoutPreset {
  return normalizeWallpaperLayoutPreset({
    ...layoutPreset,
    id: 'wallpaper-layout-draft',
  })
}

function readStorage(key: string) {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (typeof window === 'undefined') return
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Private windows and full quotas: the draft just is not kept.
  }
}

/** Load the locally saved wallpaper draft (converting a version-1 draft once). */
export function loadWallpaperLayoutDraft(): WallpaperLayoutPreset | null {
  try {
    const raw = readStorage(WALLPAPER_LAYOUT_DRAFT_STORAGE_KEY) ?? readStorage(LEGACY_DRAFT_STORAGE_KEY)
    return raw ? toWallpaperLayoutPresetViewModel(JSON.parse(raw) as WallpaperLayoutPresetWire) : null
  } catch {
    return null
  }
}

/** Persist the current wallpaper draft locally for runtime preview. */
export function saveWallpaperLayoutDraft(layoutPreset: WallpaperLayoutPreset) {
  writeStorage(WALLPAPER_LAYOUT_DRAFT_STORAGE_KEY, JSON.stringify(toWallpaperLayoutPresetWireModel(layoutPreset)))
}

/** Read all named wallpaper presets cached in this browser. */
export function loadWallpaperLayoutPresets(): WallpaperLayoutPreset[] {
  try {
    const raw = readStorage(WALLPAPER_LAYOUT_PRESETS_STORAGE_KEY)
    return raw ? toWallpaperLayoutPresetViewModels(JSON.parse(raw) as WallpaperLayoutPresetWire[]) : []
  } catch {
    return []
  }
}

export function saveWallpaperLayoutPresets(layoutPresets: WallpaperLayoutPreset[]) {
  writeStorage(WALLPAPER_LAYOUT_PRESETS_STORAGE_KEY, JSON.stringify(toWallpaperLayoutPresetWireModels(layoutPresets)))
}

export function loadWallpaperActivePresetId() {
  return readStorage(WALLPAPER_LAYOUT_ACTIVE_PRESET_ID_STORAGE_KEY)
}

export function saveWallpaperActivePresetId(presetId: string | null) {
  writeStorage(WALLPAPER_LAYOUT_ACTIVE_PRESET_ID_STORAGE_KEY, presetId)
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

  return { presetId, presets: nextPresets }
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
  return {
    ...layoutPreset,
    widgets: nextFrontToBack.map((widget, index) => ({ ...widget, zIndex: widgetCount - index })),
  }
}

/** Move one widget to the requested front-to-back order position (1 = front). */
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

/** Bring the given widgets to the front (or back), keeping their order among themselves. */
export function stackWallpaperWidgets(layoutPreset: WallpaperLayoutPreset, widgetIds: string[], where: 'front' | 'back') {
  const ids = new Set(widgetIds)
  const frontToBack = getWallpaperWidgetsFrontToBack(layoutPreset.widgets)
  const moved = frontToBack.filter((widget) => ids.has(widget.id))
  const rest = frontToBack.filter((widget) => !ids.has(widget.id))
  const ordered = where === 'front' ? [...moved, ...rest] : [...rest, ...moved]
  return reorderWallpaperWidgets(layoutPreset, ordered.map((widget) => widget.id))
}

/** Move the given widgets one layer forward (or backward); a widget already at the end, or behind a selected one, stays. */
export function stepWallpaperWidgets(layoutPreset: WallpaperLayoutPreset, widgetIds: string[], direction: 'forward' | 'backward') {
  const ids = new Set(widgetIds)
  const order = getWallpaperWidgetsFrontToBack(layoutPreset.widgets).map((widget) => widget.id)
  if (direction === 'forward') {
    for (let index = 1; index < order.length; index += 1) {
      if (ids.has(order[index]) && !ids.has(order[index - 1])) [order[index - 1], order[index]] = [order[index], order[index - 1]]
    }
  } else {
    for (let index = order.length - 2; index >= 0; index -= 1) {
      if (ids.has(order[index]) && !ids.has(order[index + 1])) [order[index + 1], order[index]] = [order[index], order[index + 1]]
    }
  }
  return reorderWallpaperWidgets(layoutPreset, order)
}

/** How far a duplicate or a paste lands from its source: the same visual step on every canvas size. */
export function getWallpaperCopyOffset(layoutPreset: WallpaperLayoutPreset) {
  const step = Math.round(getWallpaperLayoutCanvas(layoutPreset).width * 0.0125)
  return { x: step, y: step }
}

/** Center of the first spot (reading order) where a `w`×`h` box overlaps no visible widget, or null. */
function findFreeSpot(layoutPreset: WallpaperLayoutPreset, canvas: Pick<WallpaperCanvasPreset, 'width' | 'height'>, w: number, h: number) {
  const unit = getWallpaperCanvasScale(canvas)
  const margin = Math.round(24 * unit)
  const step = Math.round(24 * unit)
  const others = layoutPreset.widgets.filter((widget) => !widget.hidden)
  for (let y = margin; y + h <= canvas.height - margin; y += step) {
    for (let x = margin; x + w <= canvas.width - margin; x += step) {
      const clear = others.every((widget) => (
        x + w + margin <= widget.x || widget.x + widget.w + margin <= x || y + h + margin <= widget.y || widget.y + widget.h + margin <= y
      ))
      if (clear) return { x: x + w / 2, y: y + h / 2 }
    }
  }
  return null
}

/** Add one default widget instance at `center` (canvas px), else the first free spot, else near the middle. */
export function appendWallpaperWidget(layoutPreset: WallpaperLayoutPreset, widgetType: WallpaperWidgetType, center?: { x: number; y: number }) {
  const canvas = getWallpaperLayoutCanvas(layoutPreset)
  const topZ = layoutPreset.widgets.reduce((max, widget) => Math.max(max, widget.zIndex), 0)
  const cascade = (layoutPreset.widgets.length % 6) * Math.round(canvas.width * 0.012)
  const probe = createWallpaperWidgetInstance(widgetType, canvas, topZ + 1)
  const spot = center
    ?? findFreeSpot(layoutPreset, canvas, probe.w, probe.h)
    ?? { x: canvas.width / 2 + cascade, y: canvas.height / 2 + cascade }
  const widget = createWallpaperWidgetInstance(widgetType, canvas, topZ + 1, spot)
  return {
    layout: normalizeWallpaperLayoutPreset({ ...layoutPreset, widgets: [...layoutPreset.widgets, widget] }),
    widgetId: widget.id,
  }
}

/** Copies of the given widgets, nudged so they do not hide the originals; returns the new ids. */
export function duplicateWallpaperWidgets(layoutPreset: WallpaperLayoutPreset, widgetIds: string[], offset?: { x: number; y: number }) {
  const canvas = getWallpaperLayoutCanvas(layoutPreset)
  const step = offset ?? getWallpaperCopyOffset(layoutPreset)
  let topZ = layoutPreset.widgets.reduce((max, widget) => Math.max(max, widget.zIndex), 0)
  const sources = layoutPreset.widgets.filter((widget) => widgetIds.includes(widget.id)).sort((a, b) => a.zIndex - b.zIndex)
  const copies = sources.map((widget, index) => {
    topZ += 1
    return clampWallpaperWidgetInstance({
      ...structuredClone(widget),
      id: `${widget.type}-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      x: widget.x + step.x,
      y: widget.y + step.y,
      zIndex: topZ,
      locked: false,
    }, canvas)
  })
  return { layout: { ...layoutPreset, widgets: [...layoutPreset.widgets, ...copies] }, widgetIds: copies.map((widget) => widget.id) }
}

/** Paste widgets copied from any layout: new ids, on top, kept on this canvas. */
export function pasteWallpaperWidgets(layoutPreset: WallpaperLayoutPreset, widgets: WallpaperWidgetInstance[]) {
  const canvas = getWallpaperLayoutCanvas(layoutPreset)
  let topZ = layoutPreset.widgets.reduce((max, widget) => Math.max(max, widget.zIndex), 0)
  const copies = widgets.map((widget, index) => {
    topZ += 1
    return clampWallpaperWidgetInstance({
      ...structuredClone(widget),
      id: `${widget.type}-${Date.now().toString(36)}-p${index}-${Math.random().toString(36).slice(2, 6)}`,
      zIndex: topZ,
      locked: false,
      hidden: false,
    }, canvas)
  })
  return { layout: { ...layoutPreset, widgets: [...layoutPreset.widgets, ...copies] }, widgetIds: copies.map((widget) => widget.id) }
}

export type WallpaperAlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** Align one widget to the canvas, or several to their shared bounds. Locked widgets stay put. */
export function alignWallpaperWidgets(layoutPreset: WallpaperLayoutPreset, widgetIds: string[], mode: WallpaperAlignMode) {
  const canvas = getWallpaperLayoutCanvas(layoutPreset)
  const targets = layoutPreset.widgets.filter((widget) => widgetIds.includes(widget.id) && !widget.locked)
  if (targets.length === 0) return layoutPreset
  const bounds = targets.length === 1
    ? { left: 0, top: 0, right: canvas.width, bottom: canvas.height }
    : {
        left: Math.min(...targets.map((widget) => widget.x)),
        top: Math.min(...targets.map((widget) => widget.y)),
        right: Math.max(...targets.map((widget) => widget.x + widget.w)),
        bottom: Math.max(...targets.map((widget) => widget.y + widget.h)),
      }
  const ids = new Set(targets.map((widget) => widget.id))
  return {
    ...layoutPreset,
    widgets: layoutPreset.widgets.map((widget) => {
      if (!ids.has(widget.id)) return widget
      switch (mode) {
        case 'left': return { ...widget, x: bounds.left }
        case 'right': return { ...widget, x: bounds.right - widget.w }
        case 'hcenter': return { ...widget, x: Math.round((bounds.left + bounds.right - widget.w) / 2) }
        case 'top': return { ...widget, y: bounds.top }
        case 'bottom': return { ...widget, y: bounds.bottom - widget.h }
        case 'vcenter': return { ...widget, y: Math.round((bounds.top + bounds.bottom - widget.h) / 2) }
      }
    }),
  }
}

/** Even gaps between three or more widgets along one axis. */
export function distributeWallpaperWidgets(layoutPreset: WallpaperLayoutPreset, widgetIds: string[], axis: 'x' | 'y') {
  const targets = layoutPreset.widgets.filter((widget) => widgetIds.includes(widget.id) && !widget.locked)
  if (targets.length < 3) return layoutPreset
  const size = axis === 'x' ? 'w' : 'h'
  const sorted = [...targets].sort((a, b) => a[axis] - b[axis])
  const start = sorted[0][axis]
  const end = Math.max(...sorted.map((widget) => widget[axis] + widget[size]))
  const gap = (end - start - sorted.reduce((sum, widget) => sum + widget[size], 0)) / (sorted.length - 1)
  const next = new Map<string, number>()
  let cursor = start
  for (const widget of sorted) {
    next.set(widget.id, Math.round(cursor))
    cursor += widget[size] + gap
  }
  return {
    ...layoutPreset,
    widgets: layoutPreset.widgets.map((widget) => (next.has(widget.id) ? { ...widget, [axis]: next.get(widget.id) } : widget)),
  }
}

/** Shift unlocked widgets by a pixel delta, kept on the canvas. */
export function nudgeWallpaperWidgets(layoutPreset: WallpaperLayoutPreset, widgetIds: string[], delta: { x: number; y: number }) {
  const canvas = getWallpaperLayoutCanvas(layoutPreset)
  const ids = new Set(widgetIds)
  return {
    ...layoutPreset,
    widgets: layoutPreset.widgets.map((widget) => (
      ids.has(widget.id) && !widget.locked
        ? clampWallpaperWidgetInstance({ ...widget, x: widget.x + delta.x, y: widget.y + delta.y }, canvas)
        : widget
    )),
  }
}

/** Replace frames of several widgets at once (drag of a selection). */
export function setWallpaperWidgetFrames(layoutPreset: WallpaperLayoutPreset, frames: Map<string, WallpaperWidgetFrame>) {
  const canvas = getWallpaperLayoutCanvas(layoutPreset)
  return {
    ...layoutPreset,
    widgets: layoutPreset.widgets.map((widget) => {
      const frame = frames.get(widget.id)
      return frame ? clampWallpaperWidgetInstance({ ...widget, ...frame }, canvas) : widget
    }),
  }
}

export function removeWallpaperWidgets(layoutPreset: WallpaperLayoutPreset, widgetIds: string[]) {
  const ids = new Set(widgetIds)
  return { ...layoutPreset, widgets: layoutPreset.widgets.filter((widget) => !ids.has(widget.id)) }
}
