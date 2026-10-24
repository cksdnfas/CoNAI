import { validateChatPageArguments, type ChatPageAction, type ChatPageData, type ChatPageField, type ChatPageSchema, type WallpaperSchedule, type WallpaperScheduleEntry } from '@conai/shared'
import type { TranslationInput } from '@/i18n'
import { pageAction, pageArray, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { normalizeWallpaperAnimationEasing } from './wallpaper-widget-utils'
import { normalizeWallpaperBackground, normalizeWallpaperWidgetStyle, resolveWallpaperPresetOptions, WALLPAPER_DEFAULT_PRESET_OPTIONS, WALLPAPER_HEX_COLOR } from './wallpaper-layout-utils'
import { getWallpaperWidgetDefinition, listWallpaperWidgetDefinitions, WALLPAPER_DEFAULT_WIDGET_STYLE } from './wallpaper-widget-registry'
import { listWallpaperCanvasPresets, WALLPAPER_CANVAS_MAX, WALLPAPER_CANVAS_MIN, WALLPAPER_CUSTOM_CANVAS_ID } from './wallpaper-canvas-presets'
import { WALLPAPER_TEMPLATES } from './wallpaper-templates'
import { isWallpaperPreviewableImageWidget, type WallpaperBackground, type WallpaperLayoutPreset, type WallpaperPresetOptions, type WallpaperThemeMode, type WallpaperWidgetInstance, type WallpaperWidgetStyle, type WallpaperWidgetType } from './wallpaper-types'

/**
 * What a connected chat may write in the wallpaper editor: bounded schemas for widget style, widget settings,
 * background and preset options, and the checks that turn the chat's arguments into editor values. Colors are
 * #RRGGBB, an empty string clears a color or a time window, and every value is normalized like a stored preset.
 */

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const FONTS = ['inherit', 'sans', 'serif', 'mono', 'display']

const color = (description: string): ChatPageSchema => ({ ...pageText(7), description: `${description} #RRGGBB; "" clears it.` })
const clock = (description: string): ChatPageSchema => ({ ...pageText(5), description: `${description} HH:MM (24h); "" clears it.` })

export const WALLPAPER_STYLE_SCHEMA = pageObject({
  variant: pageChoice(['none', 'card', 'glass', 'outline']),
  backgroundColor: color('Fill of card/glass.'),
  backgroundOpacity: pageNumber(0, 100),
  radius: pageNumber(0, 200),
  padding: pageNumber(0, 200),
  shadow: pageChoice(['none', 'sm', 'md', 'lg']),
  blur: pageNumber(0, 60),
  fontFamily: pageChoice(FONTS),
  fontWeight: pageChoice(['light', 'regular', 'bold']),
  textColor: color('Text color.'),
  accentColor: color('Bars, progress and highlights inside the widget.'),
  textAlign: pageChoice(['left', 'center', 'right']),
  opacity: pageNumber(5, 100),
  scale: { ...pageNumber(50, 200), description: 'Percent the title and body are drawn at inside the frame (smaller fits more).' },
  showTitle: { type: 'boolean' },
  entrance: pageChoice(['none', 'fade', 'rise', 'zoom']),
  depth: { ...pageNumber(0, 100), description: 'How far the widget follows the pointer when the wallpaper uses parallax.' },
  showFrom: clock('The live wallpaper shows the widget only from this time.'),
  showUntil: clock('…until this time (before showFrom wraps midnight).'),
})

/** Choices of string settings; a key two widgets share with different choices is narrowed per widget below. */
const SETTING_CHOICES: Record<string, string[]> = {
  timeFormat: ['12h', '24h'],
  visualStyle: ['clean', 'serif', 'glow', 'split', 'analog', 'mono', 'glass', 'editorial', 'minimal'],
  weekStart: ['sun', 'mon'],
  visualMode: ['tiles', 'bars', 'rings'],
  service: ['all', 'novelai', 'comfyui', 'codex'],
  displayMode: ['grid', 'stack', 'masonry'],
  imageTransitionStyle: ['none', 'fade', 'zoom', 'slide', 'blur', 'flip', 'shuffle'],
  imageTransitionSpeed: ['fast', 'normal', 'slow'],
  emphasis: ['mixed', 'queue', 'results'],
  layoutMode: ['grid', 'filmstrip', 'masonry'],
  motionMode: ['static', 'ambient', 'pointer'],
  fitMode: ['cover', 'contain', 'scale-down'],
  playbackMode: ['static', 'carousel', 'ken-burns'],
  aspectMode: ['slot', 'image'],
  imageSwapMode: ['time', 'bounce'],
  display: ['bars', 'numbers', 'rings'],
  metric: ['tokens', 'requests'],
  typeface: ['serif', 'sans'],
  shape: ['bars', 'mirror', 'wave', 'circle'],
  layout: ['row', 'stack'],
  source: ['host', 'comfyui'],
  imageClickAction: ['preview', 'none', 'open'],
}
const TYPE_CHOICES: Partial<Record<WallpaperWidgetType, Record<string, string[]>>> = {
  'generation-stats': { display: ['bars', 'numbers'] },
  'system-monitor': { display: ['bars', 'rings'] },
  'floating-collage': { fitMode: ['cover', 'contain'] },
}
const NUMBER_CHOICES: Record<string, number[]> = { messageLines: [0, 1, 3] }
const NUMBER_RANGES: Record<string, [number, number]> = {
  volume: [0, 100], barCount: [8, 64], sensitivity: [50, 300], smoothing: [0, 90], fontSize: [10, 240], maxJobs: [1, 8],
  tagCount: [1, 20], messageCount: [1, 12], count: [1, 10], visibleCount: [1, 48], days: [1, 90], motionStrength: [0, 100],
  imageHoverMotion: [0, 100], refreshIntervalSec: [5, 3600], shiftIntervalSec: [1, 3600], slideshowIntervalSec: [1, 86400],
  swapIntervalSec: [1, 3600], swapBounceCount: [1, 20], poolRefreshMinutes: [0, 1440], rerollMinutes: [0, 1440],
  imageScalePercent: [10, 300], imageTransitionDurationMs: [0, 10000],
}
/** Settings whose stored value may be null: a chat clears a number with 0 and a string with "". */
const NULLABLE_NUMBERS = new Set(['groupId', 'profileId', 'scheduleId'])
const NULLABLE_STRINGS = new Set(['audioGroupId', 'color'])
const EASINGS = new Set(['hoverEasing', 'motionEasing', 'imageTransitionEasing', 'imagePreviewOpenEasing', 'imagePreviewCloseEasing'])
const SETTING_NOTES: Record<string, string> = {
  groupId: 'Image group id (0 clears).',
  profileId: 'Chat profile id; 0 = the latest chat.',
  scheduleId: 'Workflow schedule id from data.quickRunSchedules (0 clears).',
  audioGroupId: 'Audio group id ("" clears).',
  color: 'Visualizer color #RRGGBB; "" = accent.',
  text: 'The text the note shows.',
  template: 'Prompt template; __wildcard__ names roll from wildcards.',
  title: 'Title shown when style.showTitle is on.',
}

function settingType(key: string, value: unknown): 'string' | 'number' | 'boolean' {
  if (NULLABLE_NUMBERS.has(key)) return 'number'
  if (NULLABLE_STRINGS.has(key)) return 'string'
  return typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string'
}

/** Optional settings every image widget reads (click and preview behaviour). */
const IMAGE_OPTIONAL_KEYS = ['imageClickAction', 'pauseOnHover', 'imagePreviewOpenScalePercent', 'imagePreviewOpenDurationMs', 'imagePreviewOpenEasing', 'imagePreviewCloseScalePercent', 'imagePreviewCloseDurationMs', 'imagePreviewCloseEasing', 'imageTransitionDurationMs']

/** Every widget's settings keys (the union; data.widgetTypes says which keys each widget reads). */
function collectSettingKeys() {
  const keys = new Map<string, 'string' | 'number' | 'boolean'>()
  for (const definition of listWallpaperWidgetDefinitions()) {
    for (const [key, value] of Object.entries(definition.defaultSettings)) keys.set(key, settingType(key, value))
  }
  for (const key of IMAGE_OPTIONAL_KEYS) {
    if (!keys.has(key)) keys.set(key, key === 'pauseOnHover' ? 'boolean' : key.endsWith('Easing') || key === 'imageClickAction' ? 'string' : 'number')
  }
  return keys
}
const SETTING_KEYS = collectSettingKeys()

export const WALLPAPER_SETTINGS_SCHEMA = pageObject(Object.fromEntries([...SETTING_KEYS].map(([key, type]) => {
  const note = SETTING_NOTES[key] ? { description: SETTING_NOTES[key] } : {}
  if (type === 'boolean') return [key, { type: 'boolean' as const }]
  if (type === 'number') {
    if (NUMBER_CHOICES[key]) return [key, { ...pageChoice(NUMBER_CHOICES[key]), ...note }]
    const [min, max] = NUMBER_RANGES[key] ?? (NULLABLE_NUMBERS.has(key) ? [0, Number.MAX_SAFE_INTEGER] : [0, 100000])
    return [key, { ...pageNumber(min, max, NULLABLE_NUMBERS.has(key)), ...note }]
  }
  if (SETTING_CHOICES[key]) return [key, pageChoice(SETTING_CHOICES[key])]
  if (EASINGS.has(key)) return [key, { ...pageText(200), description: 'linear, easeInOutSine, easeOutCubic, easeInOutCubic, easeOutExpo, easeOutBack, easeOutBounce or cubic-bezier(…)' }]
  return [key, { ...pageText(key === 'text' || key === 'template' ? 4000 : 200), ...note }]
})))

/** Page data refuses link-like strings (a note may start with a URL); show those as "(link)" instead of failing the screen. */
export function wallpaperChatValue(value: unknown): ChatPageData {
  if (typeof value === 'string') return /^data:|^https?:\/\//i.test(value.trim()) ? '(link)' : value
  if (Array.isArray(value)) return value.map(wallpaperChatValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wallpaperChatValue(item)]))
  return typeof value === 'number' || typeof value === 'boolean' ? value : null
}

/** What each widget shows and the settings it reads, for data.widgetTypes. */
export function describeWallpaperWidgetTypes(t: (input: TranslationInput) => string): ChatPageData {
  return listWallpaperWidgetDefinitions().map((definition) => ({
    type: definition.type,
    name: t(definition.title),
    shows: t(definition.description),
    settings: Object.keys(definition.defaultSettings),
    defaultSize: { w: definition.defaultSize.w, h: definition.defaultSize.h },
  }))
}

function requireColor(value: string, key: string): string | null {
  if (value === '') return null
  if (!WALLPAPER_HEX_COLOR.test(value)) throw new Error(`${key}: 색은 #RRGGBB 또는 #RRGGBBAA 형식이어야 해.`)
  return value
}

/** A chat style patch merged onto the widget's style. */
export function patchWallpaperWidgetStyle(widget: WallpaperWidgetInstance, raw: Record<string, ChatPageData>): WallpaperWidgetStyle {
  const patch: Record<string, unknown> = { ...raw }
  for (const key of ['backgroundColor', 'textColor', 'accentColor']) if (typeof raw[key] === 'string') patch[key] = requireColor(raw[key] as string, key)
  for (const key of ['showFrom', 'showUntil']) {
    if (typeof raw[key] !== 'string') continue
    if (raw[key] !== '' && !CLOCK.test(raw[key] as string)) throw new Error(`${key}: 시간은 HH:MM 형식이어야 해.`)
    patch[key] = raw[key] === '' ? null : raw[key]
  }
  const next = normalizeWallpaperWidgetStyle({ ...widget.style, ...patch }, getWallpaperWidgetDefinition(widget.type).defaultStyle)
  // The normalizer falls back to defaults for null; a cleared color or window must stay cleared.
  for (const key of ['backgroundColor', 'textColor', 'accentColor', 'showFrom', 'showUntil'] as const) if (patch[key] === null) next[key] = null
  return next
}

/** A chat settings patch for one widget: only the keys that widget reads, with their own choices. */
export function patchWallpaperWidgetSettings(widget: WallpaperWidgetInstance, raw: Record<string, ChatPageData>, scheduleNames: Map<number, string>) {
  const defaults = getWallpaperWidgetDefinition(widget.type).defaultSettings as unknown as Record<string, unknown>
  const current = widget.settings as unknown as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    const known = key in defaults || key in current || (isWallpaperPreviewableImageWidget(widget) && IMAGE_OPTIONAL_KEYS.includes(key))
    if (!known) throw new Error(`${widget.type} 위젯에는 ${key} 설정이 없어. data.widgetTypes에서 그 위젯의 설정을 확인해.`)
    const choices = TYPE_CHOICES[widget.type]?.[key]
    if (choices && !choices.includes(String(value))) throw new Error(`${key}: ${widget.type}에서는 ${choices.join(', ')} 중 하나야.`)
    if (NULLABLE_NUMBERS.has(key)) next[key] = value === 0 ? null : value
    else if (key === 'color') next[key] = requireColor(String(value), key)
    else if (NULLABLE_STRINGS.has(key)) next[key] = value === '' ? null : value
    else if (EASINGS.has(key)) next[key] = normalizeWallpaperAnimationEasing(String(value))
    else next[key] = value
  }
  if (widget.type === 'quick-run' && 'scheduleId' in next) next.scheduleName = typeof next.scheduleId === 'number' ? scheduleNames.get(next.scheduleId) ?? '' : ''
  return next
}

export const WALLPAPER_BACKGROUND_SCHEMA = pageObject({
  kind: pageChoice(['theme', 'color', 'gradient', 'image', 'video', 'group-slideshow']),
  color: color('Solid color (kind color).'),
  from: color('Gradient start (kind gradient).'),
  to: color('Gradient end (kind gradient).'),
  angle: pageNumber(0, 360),
  compositeHash: { ...pageText(128), description: 'Library image or video hash (kind image/video).' },
  fit: pageChoice(['cover', 'contain', 'blur-fill']),
  groupId: { ...pageNumber(1, Number.MAX_SAFE_INTEGER, true), description: 'Image group id (kind group-slideshow).' },
  includeChildren: { type: 'boolean' },
  intervalSec: pageNumber(10, 86400, true),
  order: pageChoice(['random', 'latest']),
  transition: pageChoice(['fade', 'zoom', 'slide']),
  dim: pageNumber(0, 80),
  blur: pageNumber(0, 24),
  vignette: pageNumber(0, 100),
  kenBurns: { type: 'boolean', description: 'Slow pan and zoom on still images.' },
})

export function patchWallpaperBackground(current: WallpaperBackground, raw: Record<string, ChatPageData>): WallpaperBackground {
  for (const key of ['color', 'from', 'to']) if (typeof raw[key] === 'string' && raw[key] !== '') requireColor(raw[key] as string, key)
  return normalizeWallpaperBackground({ ...current, ...raw })
}

export const WALLPAPER_OPTIONS_SCHEMA = pageObject({
  themeMode: pageChoice(['dark', 'light', 'auto']),
  accentColor: color('Accent for every widget without its own.'),
  autoAccent: { type: 'boolean', description: 'Take the accent from the background image.' },
  textColor: color('Text color for every widget without its own.'),
  fontFamily: pageChoice(FONTS),
  particles: pageChoice(['none', 'snow', 'sakura', 'rain', 'dust', 'fireflies']),
  particleAmount: pageNumber(0, 100),
  parallax: { ...pageNumber(0, 100), description: 'How far widgets (by their depth) and the background shift with the pointer.' },
  widgetReveal: { ...pageChoice(['always', 'pointer']), description: 'pointer fades widgets until the pointer comes near (clean desktop).' },
  idleOpacity: pageNumber(0, 100),
  fpsLimit: pageChoice([0, 15, 24, 30, 60]),
})

export function patchWallpaperOptions(current: WallpaperPresetOptions | undefined, raw: Record<string, ChatPageData>): { options: WallpaperPresetOptions; themeMode?: WallpaperThemeMode } {
  const { themeMode, ...rest } = raw
  const patch: Record<string, unknown> = { ...rest }
  for (const key of ['accentColor', 'textColor']) if (typeof rest[key] === 'string') patch[key] = requireColor(rest[key] as string, key)
  return { options: resolveWallpaperPresetOptions({ ...resolveWallpaperPresetOptions(current), ...patch }), ...(typeof themeMode === 'string' ? { themeMode: themeMode as WallpaperThemeMode } : {}) }
}

export const WALLPAPER_SCHEDULE_SCHEMA = (presetIds: string[]) => pageObject({
  enabled: { type: 'boolean' },
  entries: pageArray(pageObject({
    presetId: pageChoice(presetIds),
    days: { ...pageArray(pageNumber(0, 6, true), 7), description: '0 = Sunday … 6 = Saturday; empty = every day.' },
    start: clock('Window start.'),
    end: clock('Window end (before start wraps midnight).'),
  }, ['presetId', 'start', 'end']), 48),
}, ['enabled', 'entries'])

/** The full schedule a chat proposes; the upper entry wins where windows overlap. */
export function readWallpaperSchedule(raw: Record<string, ChatPageData>) {
  const entries: WallpaperScheduleEntry[] = (raw.entries as Array<Record<string, ChatPageData>>).map((entry, index) => {
    const start = String(entry.start)
    const end = String(entry.end)
    if (!CLOCK.test(start) || !CLOCK.test(end)) throw new Error('일정 시간은 HH:MM 형식이어야 해.')
    const days = [...new Set(((entry.days ?? []) as number[]).map(Number))].sort((a, b) => a - b)
    return { id: `ws-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`, presetId: String(entry.presetId), days: days.length === 7 ? [] : days, start, end }
  })
  return { enabled: raw.enabled === true, entries }
}

/** Keys of a patch schema for an error message: choices inline, else the type. */
function describeKeys(schema: ChatPageSchema) {
  return Object.entries(schema.properties ?? {}).map(([key, item]) => (item.enum ? `${key}=${item.enum.join('|')}` : `${key}:${item.type}`)).join(', ')
}

/**
 * A JSON argument (sent as text so the operation list the model gets on every request stays small), checked against
 * its full schema here. An object is accepted too.
 */
export function readWallpaperPatch(value: ChatPageData | undefined, schema: ChatPageSchema, what: string, keysHint?: string): Record<string, ChatPageData> {
  if (value === undefined || value === '') return {}
  try {
    return validateChatPageArguments(schema, value, what) as Record<string, ChatPageData>
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A value outside a key's choices names those choices; anything else names the keys.
    let target: ChatPageSchema | undefined = schema
    for (const part of (message.split(':')[0] ?? '').split('.').slice(1)) {
      target = target?.properties?.[part.replace(/(\[\d+\])+$/, '')]
      for (let depth = (part.match(/\[\d+\]/g) ?? []).length; depth > 0; depth -= 1) target = target?.items
    }
    const hint = target?.enum ? `allowed: ${target.enum.join(', ')}` : keysHint ?? `${what}: ${describeKeys(schema)}`
    throw new Error(`${message} (${hint})`, { cause: error })
  }
}

/** Only what differs from the widget type's defaults, so the screen stays small. */
function changedFrom(value: object, base: object) {
  const fallback = base as Record<string, unknown>
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => JSON.stringify(item) !== JSON.stringify(fallback[key])))
}

function compactWidget(widget: WallpaperWidgetInstance) {
  const definition = getWallpaperWidgetDefinition(widget.type)
  const style = changedFrom(widget.style, { ...WALLPAPER_DEFAULT_WIDGET_STYLE, ...definition.defaultStyle })
  const settings = changedFrom(widget.settings, definition.defaultSettings)
  return wallpaperChatValue({
    id: widget.id, type: widget.type, x: widget.x, y: widget.y, w: widget.w, h: widget.h,
    ...(widget.hidden ? { hidden: true } : {}), ...(widget.locked ? { locked: true } : {}), ...(widget.rotation ? { rotation: widget.rotation } : {}),
    ...(Object.keys(style).length ? { style } : {}), ...(Object.keys(settings).length ? { settings } : {}),
  })
}

const STYLE_KEYS = 'variant, backgroundColor, backgroundOpacity, radius, padding, shadow, blur, fontFamily, fontWeight, textColor, accentColor, textAlign, opacity, scale, showTitle, entrance, depth, showFrom, showUntil'
const WIDGET_PATCH_HINT = `x, y, w, h (canvas px), hidden, locked, rotation, style {${STYLE_KEYS}}, settings {keys data.widgetTypes lists for that widget}; colors #RRGGBB, times HH:MM, "" clears`
const LOOK_HINT = 'background {kind=theme|color|gradient|image|video|group-slideshow, color, from, to, angle, compositeHash, fit, groupId, includeChildren, intervalSec, order, transition, dim, blur, vignette, kenBurns}; options {themeMode, accentColor, autoAccent, textColor, fontFamily, particles, particleAmount, parallax, widgetReveal, idleOpacity, fpsLimit}'
export const WALLPAPER_PATCH_HINTS = { widget: WIDGET_PATCH_HINT, look: LOOK_HINT }
export const WALLPAPER_ARRANGE_OPS = ['remove', 'duplicate', 'front', 'back', 'align-left', 'align-hcenter', 'align-right', 'align-top', 'align-vcenter', 'align-bottom', 'distribute-x', 'distribute-y'] as const

/** Everything one widget patch may hold; checked here because the model sends it as JSON text. */
export const WALLPAPER_WIDGET_PATCH_SCHEMA = pageObject({
  x: pageNumber(-WALLPAPER_CANVAS_MAX, WALLPAPER_CANVAS_MAX), y: pageNumber(-WALLPAPER_CANVAS_MAX, WALLPAPER_CANVAS_MAX),
  w: pageNumber(1, WALLPAPER_CANVAS_MAX), h: pageNumber(1, WALLPAPER_CANVAS_MAX), rotation: pageNumber(-360, 360),
  hidden: { type: 'boolean' }, locked: { type: 'boolean' },
  style: WALLPAPER_STYLE_SCHEMA, settings: WALLPAPER_SETTINGS_SCHEMA,
})
export const WALLPAPER_LOOK_SCHEMA = pageObject({ background: WALLPAPER_BACKGROUND_SCHEMA, options: WALLPAPER_OPTIONS_SCHEMA })

export interface WallpaperChatPageInput {
  t: (input: TranslationInput) => string
  layout: WallpaperLayoutPreset
  canvas: { width: number; height: number }
  selectedIds: string[]
  saveTo: string
  canUndo: boolean
  canRedo: boolean
  savedPresets: Array<{ id: string; name: string }>
  activePresetId: string | null
  /** The saved wallpaper the live page shows (server setting); editing never changes it. */
  livePresetId: string | null
  schedule: WallpaperSchedule | undefined
  runtimeKeys: Array<{ id: number; name: string; presetId: string | null }>
  quickRunSchedules: Array<{ id: number; name: string }>
  isAdmin: boolean
}

/**
 * The editor as a connected chat sees it. LLM chats get this view on every request, so it is kept small: widgets list
 * only what differs from their defaults, ids are plain text checked on apply, widget and look patches travel as JSON
 * text with their keys named once, and the widget catalogue (data.widgetTypes) is long enough to be read on demand.
 */
export function buildWallpaperChatPage(input: WallpaperChatPageInput): { fields: ChatPageField[]; data: Record<string, ChatPageData>; actions: ChatPageAction[] } {
  const { t, layout, isAdmin } = input
  const background = changedFrom(layout.background, { dim: 0, blur: 0, vignette: 0, kenBurns: false })
  const options = changedFrom(resolveWallpaperPresetOptions(layout.options), WALLPAPER_DEFAULT_PRESET_OPTIONS)
  const text = (description: string): ChatPageSchema => ({ type: 'string', description })
  const json = (description: string): ChatPageSchema => ({ type: 'string', description: `JSON: ${description}` })
  const hasWidgets = layout.widgets.length > 0
  const hasPresets = input.savedPresets.length > 0
  return {
    fields: [{ id: 'name', label: t({ ko: '배경화면 이름', en: 'Wallpaper name' }), type: 'text', value: layout.name }],
    data: {
      canvas: { presetId: layout.canvasPresetId, width: input.canvas.width, height: input.canvas.height },
      widgets: [...layout.widgets].sort((a, b) => a.zIndex - b.zIndex).map(compactWidget),
      selected: { widgetIds: input.selectedIds, saveTo: input.saveTo, canUndo: input.canUndo, canRedo: input.canRedo },
      background: wallpaperChatValue(background),
      options: wallpaperChatValue({ themeMode: layout.themeMode ?? 'dark', ...options }),
      widgetTypes: describeWallpaperWidgetTypes(t),
      templates: WALLPAPER_TEMPLATES.map((template) => `${template.id}: ${t(template.name)}`),
      savedWallpapers: input.savedPresets.map((preset) => ({ id: preset.id, name: preset.name, ...(preset.id === input.activePresetId ? { open: true } : {}), ...(preset.id === input.livePresetId ? { live: true } : {}) })),
      ...(input.schedule && (input.schedule.enabled || input.schedule.entries.length) ? { schedule: { enabled: input.schedule.enabled, entries: input.schedule.entries.map(({ presetId, days, start, end }) => ({ presetId, days, start, end })) } } : {}),
      ...(isAdmin && input.runtimeKeys.length ? { runtimeKeys: input.runtimeKeys.map((key) => ({ id: key.id, name: key.name, ...(key.presetId ? { presetId: key.presetId } : {}) })) } : {}),
      ...(layout.widgets.some((widget) => widget.type === 'quick-run') ? { quickRunSchedules: input.quickRunSchedules } : {}),
    },
    actions: [
      ...(hasWidgets ? [
        pageAction('wallpaper.select', t({ ko: '위젯 선택', en: 'Select widget' }), t({ ko: '설정 패널을 열어.', en: 'Opens its settings panel.' }), pageObject({ widgetId: text('data.widgets id') }, ['widgetId'])),
        pageAction('wallpaper.update_widget', t({ ko: '위젯 수정', en: 'Edit widget' }), t({ ko: '준 값만 바꿔.', en: 'Changes only given values.' }), pageObject({ widgetId: text('data.widgets id'), patch: json(WIDGET_PATCH_HINT) }, ['widgetId', 'patch'])),
        pageAction('wallpaper.arrange', t({ ko: '위젯 정리', en: 'Arrange widgets' }), t({ ko: '삭제·복제·앞뒤 순서·정렬·간격 맞춤.', en: 'Remove, duplicate, layer order, align, distribute.' }), pageObject({ widgetIds: pageArray(text('data.widgets id'), 64, 1), op: pageChoice([...WALLPAPER_ARRANGE_OPS]) }, ['widgetIds', 'op'])),
      ] : []),
      pageAction('wallpaper.add_widget', t({ ko: '위젯 추가', en: 'Add widget' }), t({ ko: '종류별 내용·설정은 data.widgetTypes. patch는 update_widget과 같고, 위치가 없으면 빈 자리.', en: 'Types: data.widgetTypes. patch as in update_widget; no frame = a free spot.' }), pageObject({ type: pageChoice(listWallpaperWidgetDefinitions().map((definition) => definition.type)), patch: text('JSON') }, ['type'])),
      pageAction('wallpaper.apply_template', t({ ko: '템플릿 적용', en: 'Apply template' }), t({ ko: '초안을 교체해.', en: 'Replaces the draft.' }), pageObject({ templateId: text('data.templates id') }, ['templateId'])),
      pageAction('wallpaper.set_look', t({ ko: '배경·테마·효과', en: 'Background, theme, effects' }), t({ ko: '준 값만 바꿔.', en: 'Changes only given values.' }), pageObject({ patch: json(LOOK_HINT) }, ['patch'])),
      pageAction('wallpaper.set_canvas', t({ ko: '캔버스 크기', en: 'Canvas size' }), t({ ko: `위젯은 비율대로 따라가. custom은 너비·높이(${WALLPAPER_CANVAS_MIN}–${WALLPAPER_CANVAS_MAX}).`, en: `Widgets scale along; custom takes width and height (${WALLPAPER_CANVAS_MIN}–${WALLPAPER_CANVAS_MAX}).` }), pageObject({ canvasPresetId: pageChoice([...listWallpaperCanvasPresets().map((preset) => preset.id), WALLPAPER_CUSTOM_CANVAS_ID]), width: { type: 'number' }, height: { type: 'number' } }, ['canvasPresetId'])),
      pageAction('wallpaper.history', t({ ko: '편집 기록', en: 'Edit history' }), t({ ko: 'new는 같은 크기의 빈 캔버스.', en: 'new = an empty canvas of the same size.' }), pageObject({ step: pageChoice(['undo', 'redo', 'new']) }, ['step'])),
      pageAction('wallpaper.open_dialog', t({ ko: '창 열기', en: 'Open dialog' }), t({ ko: 'export는 JSON 파일 내려받기.', en: 'export downloads the draft as JSON.' }), pageObject({ dialog: pageChoice(isAdmin ? ['templates', 'export', 'schedule', 'lively'] : ['templates', 'export']) }, ['dialog'])),
      ...(hasPresets ? [pageAction('wallpaper.open_preset', t({ ko: '저장본 불러오기', en: 'Load saved wallpaper' }), t({ ko: '편집기로 불러와.', en: 'Loads it into the editor.' }), pageObject({ presetId: text('data.savedWallpapers id') }, ['presetId']))] : []),
      pageAction('wallpaper.save', t({ ko: '배경화면 저장', en: 'Save wallpaper' }), t({ ko: 'asNew면 새 프리셋, 아니면 selected.saveTo에 덮어써.', en: 'asNew = new preset, else overwrite selected.saveTo.' }), pageObject({ asNew: { type: 'boolean' } }), 'save'),
      ...(isAdmin && hasPresets ? [
        pageAction('wallpaper.delete_preset', t({ ko: '프리셋 삭제', en: 'Delete preset' }), t({ ko: '되돌릴 수 없어.', en: 'Cannot be undone.' }), pageObject({ presetId: text('data.savedWallpapers id') }, ['presetId']), 'save'),
        pageAction('wallpaper.save_schedule', t({ ko: '일정 저장', en: 'Save schedule' }), t({ ko: '일정 전체를 바꿔. 겹치면 위가 이겨.', en: 'Replaces the schedule; upper entry wins.' }), pageObject({ enabled: { type: 'boolean' }, entries: json('[{presetId, days (0=Sun…6, []=all), start, end HH:MM}]') }, ['enabled', 'entries']), 'save'),
      ] : []),
      ...(isAdmin ? [
        pageAction('wallpaper.issue_key', t({ ko: '런타임 키 발급', en: 'Issue runtime key' }), t({ ko: '키·URL은 Lively 창에만 보여.', en: 'Key and URL show only in the Lively dialog.' }), pageObject({ name: pageText(60), presetId: text('saved id; omit = active') }, ['name']), 'save'),
        ...(input.runtimeKeys.length ? [pageAction('wallpaper.revoke_key', t({ ko: '런타임 키 폐기', en: 'Revoke runtime key' }), t({ ko: '그 키로 연 화면은 멈춰.', en: 'Screens opened with it stop.' }), pageObject({ keyId: pageChoice(input.runtimeKeys.map((key) => key.id)) }, ['keyId']), 'save')] : []),
      ] : []),
    ],
  }
}
