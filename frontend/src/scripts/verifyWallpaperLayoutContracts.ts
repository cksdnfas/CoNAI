import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getWallpaperCanvasPreset, listWallpaperCanvasPresets } from '../features/wallpaper/wallpaper-canvas-presets'
import {
  appendWallpaperWidget,
  buildWallpaperDraftRuntimePath,
  buildWallpaperLayoutDraft,
  buildWallpaperPresetQueryValue,
  buildWallpaperRuntimePath,
  buildWallpaperStarterLayout,
  cloneWallpaperPresetToDraft,
  deleteWallpaperLayoutPreset,
  findWallpaperPresetByQuery,
  getWallpaperWidgetsFrontToBack,
  moveWallpaperWidgetToOrder,
  normalizeWallpaperLayoutPreset,
  reorderWallpaperWidgets,
  upsertWallpaperLayoutPreset,
} from '../features/wallpaper/wallpaper-layout-utils'
import {
  toWallpaperLayoutPresetViewModels,
  toWallpaperLayoutPresetWireModels,
} from '../features/wallpaper/wallpaper-types'
import type {
  WallpaperLayoutPreset as WallpaperLayoutPresetWire,
} from '@conai/shared'
import {
  createWallpaperWidgetInstance,
  getWallpaperWidgetDefinition,
  listWallpaperWidgetDefinitions,
} from '../features/wallpaper/wallpaper-widget-registry'
import type { WallpaperCanvasPreset, WallpaperLayoutPreset, WallpaperWidgetInstance, WallpaperWidgetType } from '../features/wallpaper/wallpaper-types'
import { buildWallpaperTemplateLayout, WALLPAPER_TEMPLATES } from '../features/wallpaper/wallpaper-templates'
import {
  advanceWallpaperFloatingCollageCardMotion,
  resolveWallpaperFloatingCollageVisualBounds,
  shouldSwapWallpaperFloatingCollageImage,
} from '../features/wallpaper/wallpaper-floating-collage-utils'

const expectedWidgetTypes = [
  'clock',
  'queue-status',
  'recent-results',
  'group-image-view',
  'image-showcase',
  'floating-collage',
  'text-note',
] as const satisfies readonly WallpaperWidgetType[]

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function assertUnique(values: string[], label: string) {
  assert(new Set(values).size === values.length, `${label} must be unique`)
}

const wallpaperEditorPageSource = readFileSync(resolve(process.cwd(), 'src/features/wallpaper/wallpaper-editor-page.tsx'), 'utf8')
const wallpaperRuntimePageSource = readFileSync(resolve(process.cwd(), 'src/features/wallpaper/wallpaper-runtime-page.tsx'), 'utf8')
const appRouterSource = readFileSync(resolve(process.cwd(), 'src/app/router.tsx'), 'utf8')
const wallpaperCanvasViewSource = readFileSync(resolve(process.cwd(), 'src/features/wallpaper/wallpaper-canvas-view.tsx'), 'utf8')
const wallpaperWidgetUtilsSource = readFileSync(resolve(process.cwd(), 'src/features/wallpaper/wallpaper-widget-utils.ts'), 'utf8')
const wallpaperClockSource = readFileSync(resolve(process.cwd(), 'src/features/wallpaper/wallpaper-clock-widget-body.tsx'), 'utf8')
const wallpaperLivelyHelpSource = readFileSync(resolve(process.cwd(), 'src/features/wallpaper/wallpaper-lively-help-modal.tsx'), 'utf8')
const wallpaperImageBodiesSource = readFileSync(resolve(process.cwd(), 'src/features/wallpaper/wallpaper-image-widget-bodies.tsx'), 'utf8')
const wallpaperFloatingCollageSource = readFileSync(resolve(process.cwd(), 'src/features/wallpaper/wallpaper-floating-collage-widget-body.tsx'), 'utf8')
const wallpaperInspectorSource = readFileSync(resolve(process.cwd(), 'src/features/wallpaper/wallpaper-widget-inspector.tsx'), 'utf8')
const viteConfigSource = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
const appearanceSettingsRouteSource = readFileSync(resolve(process.cwd(), '../backend/src/routes/settings/appearance.routes.ts'), 'utf8')
assert(
  wallpaperWidgetUtilsSource.includes('useSyncExternalStore'),
  'wallpaper motion widgets should subscribe to a shared ticker instead of owning one interval per widget',
)
assert(
  wallpaperWidgetUtilsSource.includes('const wallpaperMotionListeners = new Set<() => void>()'),
  'wallpaper motion ticker should fan out through one listener set',
)
assert(
  wallpaperWidgetUtilsSource.includes('wallpaperMotionListeners.size === 1')
    && wallpaperWidgetUtilsSource.includes('wallpaperMotionListeners.size === 0'),
  'wallpaper motion ticker should start on the first subscriber and stop after the last subscriber',
)
assert(
  !wallpaperWidgetUtilsSource.includes('setTick((current) => current + 1)\n    }, 90'),
  'wallpaper motion tick should not allocate a 90ms interval per widget instance',
)
assert(
  wallpaperEditorPageSource.includes('const savedPresetById = useMemo(() => new Map(savedPresets.map((preset) => [preset.id, preset])), [savedPresets])'),
  'wallpaper editor should build one saved-preset id index per preset change',
)
assert(
  wallpaperEditorPageSource.includes("handleLoadPreset(event.target.value === '__new__' ? null : event.target.value)"),
  'wallpaper editor preset select should map the unsaved canvas option to null instead of treating it as a missing preset id',
)
assert(
  wallpaperEditorPageSource.includes('const widgetById = useMemo(() => new Map(layoutPreset.widgets.map((widget) => [widget.id, widget])), [layoutPreset.widgets])'),
  'wallpaper editor should build one widget id index per layout widget change',
)
assert(
  !wallpaperEditorPageSource.includes('savedPresets.some((preset) => preset.id === activePresetId)')
    && !wallpaperEditorPageSource.includes('savedPresets.find((preset) => preset.id ==='),
  'wallpaper editor active preset lookup should use the saved-preset id index instead of repeated array scans',
)
assert(
  !wallpaperEditorPageSource.includes('layoutPreset.widgets.some((widget) => widget.id === selectedWidgetId)')
    && !wallpaperEditorPageSource.includes('layoutPreset.widgets.find((widget) => widget.id === effectiveSelectedWidgetId)'),
  'wallpaper editor selected widget lookup should use the widget id index instead of repeated array scans',
)
assert(
  wallpaperClockSource.includes("style === 'glow'")
    && wallpaperClockSource.includes("style === 'split'")
    && wallpaperClockSource.includes("return 'clean'"),
  'rebuilt clock must render legacy saved visual styles through safe replacements',
)
assert(
  wallpaperImageBodiesSource.includes("widget.settings.showBackground === true ? 'bg-surface-low' : 'bg-transparent'"),
  'image showcase must not leave a card surface behind when widget background is disabled',
)
assert(
  wallpaperFloatingCollageSource.includes("widget.settings.showBackground === true ? 'bg-surface-high' : 'bg-transparent'"),
  'floating collage cards must not leave a surface behind when widget background is disabled',
)
assert(
  wallpaperLivelyHelpSource.includes('https://github.com/rocksdanister/lively')
    && wallpaperLivelyHelpSource.includes('runtimeUrl'),
  'wallpaper help must recommend Lively and explain the current unique runtime URL',
)
assert(
  wallpaperEditorPageSource.includes('window.confirm')
    && wallpaperEditorPageSource.includes('handleCopyRuntimeUrl')
    && wallpaperEditorPageSource.includes('activePresetRuntimeUrl'),
  'wallpaper editor should confirm deletion and expose a copyable URL for the active preset',
)
assert(
  wallpaperRuntimePageSource.includes("searchParams.get('draft') === '1'")
    && wallpaperRuntimePageSource.includes('enabled: !isDraftPreview'),
  'wallpaper draft preview should explicitly load the local draft without waiting for server presets',
)
assert(
  viteConfigSource.includes("base: '/'") && !viteConfigSource.includes("base: './'"),
  'nested wallpaper routes must load frontend assets from the application root',
)
assert(
  wallpaperImageBodiesSource.includes("layoutMode === 'filmstrip'")
    && wallpaperImageBodiesSource.includes('pauseOnHover !== false')
    && wallpaperInspectorSource.includes("imageClickAction: event.target.value === 'none' ? 'none' : 'preview'"),
  'image widgets must expose additional presentation and interaction controls',
)
assert(
  appearanceSettingsRouteSource.includes('appearanceSettings.wallpaperActivePresetId === undefined'),
  'appearance updates must preserve an explicit null active wallpaper id so the active preset can be deleted',
)
assert(
  wallpaperCanvasViewSource.includes('const widgetById = useMemo(() => new Map(layoutPreset.widgets.map((widget) => [widget.id, widget])), [layoutPreset.widgets])'),
  'wallpaper canvas should build one widget id index per layout widget change',
)
assert(
  wallpaperCanvasViewSource.includes('const activeWidget = widgetById.get(interaction.widgetId)')
    && !wallpaperCanvasViewSource.includes('layoutPreset.widgets.find((widget) => widget.id === interaction.widgetId)'),
  'wallpaper canvas pointer move should use the widget id index instead of repeated array scans',
)

function assertWidgetWithinCanvas(widget: WallpaperWidgetInstance, canvasPreset: WallpaperCanvasPreset, label: string) {
  assert(widget.w >= 1, `${label}: widget width must be positive`)
  assert(widget.h >= 1, `${label}: widget height must be positive`)
  assert(widget.x >= 0, `${label}: widget x must not be negative`)
  assert(widget.y >= 0, `${label}: widget y must not be negative`)
  assert(widget.w <= canvasPreset.gridColumns, `${label}: widget width must fit the canvas grid`)
  assert(widget.h <= canvasPreset.gridRows, `${label}: widget height must fit the canvas grid`)
  assert(widget.x + widget.w <= canvasPreset.gridColumns, `${label}: widget right edge must fit the canvas grid`)
  assert(widget.y + widget.h <= canvasPreset.gridRows, `${label}: widget bottom edge must fit the canvas grid`)
}

function makePreset(overrides: Partial<WallpaperLayoutPreset> & Pick<WallpaperLayoutPreset, 'id' | 'name'>): WallpaperLayoutPreset {
  const canvasPreset = getWallpaperCanvasPreset(overrides.canvasPresetId ?? 'landscape-1080p')
  return {
    id: overrides.id,
    name: overrides.name,
    canvasPresetId: canvasPreset.id,
    widgets: overrides.widgets ?? [],
    createdAt: overrides.createdAt ?? '2026-05-14T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-14T00:00:00.000Z',
  }
}

const canvasPresets = listWallpaperCanvasPresets()
assert(canvasPresets.length >= 4, 'wallpaper canvas presets should keep desktop and portrait coverage')
assertUnique(canvasPresets.map((preset) => preset.id), 'wallpaper canvas preset ids')

for (const canvasPreset of canvasPresets) {
  assert(canvasPreset.name.trim().length > 0, `${canvasPreset.id}: canvas preset name must be visible`)
  assert(canvasPreset.width > 0, `${canvasPreset.id}: canvas width must be positive`)
  assert(canvasPreset.height > 0, `${canvasPreset.id}: canvas height must be positive`)
  assert(canvasPreset.gridColumns > 0, `${canvasPreset.id}: grid columns must be positive`)
  assert(canvasPreset.gridRows > 0, `${canvasPreset.id}: grid rows must be positive`)
  assert(canvasPreset.aspectRatioLabel.trim().length > 0, `${canvasPreset.id}: aspect ratio label must be visible`)
}

const floatingCard = {
  x: 250,
  y: 120,
  width: 120,
  height: 90,
  vx: 4_000,
  vy: -2_600,
  rotationBase: 0,
  depth: 2,
  wobblePhase: 0.8,
  bounceCount: 0,
}
const floatingMotionStep = advanceWallpaperFloatingCollageCardMotion(floatingCard, 120, 500, 320, 1)
const floatingMotionBounds = resolveWallpaperFloatingCollageVisualBounds({
  ...floatingCard,
  ...floatingMotionStep,
}, 500, 320, 1)
assert(floatingMotionStep.bounceEvents >= 3, 'floating collage must preserve every wall impact during multi-bounce frames')
assert(floatingMotionStep.x >= floatingMotionBounds.minX && floatingMotionStep.x <= floatingMotionBounds.maxX, 'floating collage must remain inside horizontal visual bounds after overshoot')
assert(floatingMotionStep.y >= floatingMotionBounds.minY && floatingMotionStep.y <= floatingMotionBounds.maxY, 'floating collage must remain inside vertical visual bounds after overshoot')
assert(floatingMotionStep.rotationBase !== floatingCard.rotationBase, 'floating collage wall impacts must apply a small rotation impulse')
assert(!shouldSwapWallpaperFloatingCollageImage(8, 'bounce', 0, 12_000, 1, 2, 3), 'floating collage must keep the image before the configured wall-impact count')
assert(shouldSwapWallpaperFloatingCollageImage(8, 'bounce', 0, 12_000, 1, 3, 3), 'floating collage must swap exactly when the configured wall-impact count is reached')
assert(!shouldSwapWallpaperFloatingCollageImage(1, 'bounce', 0, 12_000, 1, 3, 3), 'floating collage must not swap when no alternate image exists')

assert(WALLPAPER_TEMPLATES.length >= 4, 'wallpaper editor should offer multiple useful starter templates')
for (const template of WALLPAPER_TEMPLATES) {
  for (const canvasPreset of canvasPresets) {
    const templateLayout = buildWallpaperTemplateLayout(template.id, canvasPreset.id, template.name.en)
    assert(templateLayout.widgets.length > 0, `${template.id}: template must contain widgets`)
    assert(!templateLayout.widgets.some((widget) => widget.type === 'activity-pulse'), `${template.id}: template must not create deprecated activity pulse widgets`)
    for (const widget of templateLayout.widgets) {
      assertWidgetWithinCanvas(widget, canvasPreset, `${template.id} ${canvasPreset.id} ${widget.type}`)
    }
  }
}

const fallbackCanvasPreset = getWallpaperCanvasPreset('missing-canvas-preset')
assert(fallbackCanvasPreset.id === canvasPresets[0].id, 'unknown canvas preset ids must fall back to the first registered preset')

const widgetDefinitions = listWallpaperWidgetDefinitions()
assert(widgetDefinitions.length === expectedWidgetTypes.length, 'widget registry must expose exactly the supported widget definitions')
assertUnique(widgetDefinitions.map((definition) => definition.type), 'wallpaper widget definition types')
assert(getWallpaperWidgetDefinition('activity-pulse').type === 'activity-pulse', 'deprecated activity pulse must remain readable for saved-layout compatibility')

for (const widgetType of expectedWidgetTypes) {
  const definition = getWallpaperWidgetDefinition(widgetType)
  assert(definition.type === widgetType, `${widgetType}: definition lookup must return the requested type`)
  assert(definition.title.trim().length > 0, `${widgetType}: widget title must be visible`)
  assert(definition.description.trim().length > 0, `${widgetType}: widget description must be visible`)
  assert(definition.defaultSettings.title === definition.title, `${widgetType}: default settings title should match the registry title`)
  assert(typeof definition.defaultSettings.showTitle === 'boolean', `${widgetType}: showTitle must be boolean`)
  assert(typeof definition.defaultSettings.showBackground === 'boolean', `${widgetType}: showBackground must be boolean`)
  assert(definition.minSize.w > 0 && definition.minSize.h > 0, `${widgetType}: min size must be positive`)
  assert(definition.maxSize.w >= definition.minSize.w, `${widgetType}: max width must not be smaller than min width`)
  assert(definition.maxSize.h >= definition.minSize.h, `${widgetType}: max height must not be smaller than min height`)
  assert(definition.defaultSize.w >= definition.minSize.w, `${widgetType}: default width must respect min width`)
  assert(definition.defaultSize.h >= definition.minSize.h, `${widgetType}: default height must respect min height`)
  assert(definition.defaultSize.w <= definition.maxSize.w, `${widgetType}: default width must respect max width`)
  assert(definition.defaultSize.h <= definition.maxSize.h, `${widgetType}: default height must respect max height`)
}

const canvasPreset = getWallpaperCanvasPreset('landscape-1080p')
const clockDefinition = getWallpaperWidgetDefinition('clock')
const clockInstance = createWallpaperWidgetInstance('clock', canvasPreset, 0)
clockInstance.settings.title = 'Changed clock title'
assert(clockDefinition.defaultSettings.title === '시계', 'widget instances must clone default settings instead of mutating registry defaults')

const starterLayout = buildWallpaperStarterLayout(canvasPreset.id)
assert(starterLayout.canvasPresetId === canvasPreset.id, 'starter layout must keep the requested canvas preset')
assert(starterLayout.widgets.map((widget) => widget.type).join(',') === 'clock,queue-status,text-note', 'starter layout must keep the foundation widget set')
for (const widget of starterLayout.widgets) {
  assertWidgetWithinCanvas(widget, canvasPreset, `starter ${widget.type}`)
}

const oversizedWidget = {
  ...createWallpaperWidgetInstance('image-showcase', canvasPreset, 3),
  id: 'oversized-image-showcase',
  x: -12,
  y: 99,
  w: 999,
  h: 999,
}
const normalizedLayout = normalizeWallpaperLayoutPreset(makePreset({
  id: 'oversized-layout',
  name: 'Oversized layout',
  canvasPresetId: canvasPreset.id,
  widgets: [oversizedWidget],
}))
assertWidgetWithinCanvas(normalizedLayout.widgets[0], canvasPreset, 'normalized oversized widget')
assert(normalizedLayout.widgets[0].w === canvasPreset.gridColumns, 'normalization must clamp oversized widget width to the canvas grid')
assert(normalizedLayout.widgets[0].h === canvasPreset.gridRows, 'normalization must clamp oversized widget height to the canvas grid')

const clonedDraft = cloneWallpaperPresetToDraft(makePreset({
  id: 'saved-layout',
  name: 'Saved layout',
  canvasPresetId: canvasPreset.id,
  widgets: [oversizedWidget],
}))
assert(clonedDraft.id === 'wallpaper-layout-draft', 'cloned presets must become the editable draft id')
assertWidgetWithinCanvas(clonedDraft.widgets[0], canvasPreset, 'cloned draft widget')

const appendedLayout = appendWallpaperWidget(buildWallpaperLayoutDraft(canvasPreset.id), 'image-showcase')
assert(appendedLayout.widgets.length === 1, 'append must add one widget')
assert(appendedLayout.widgets[0].type === 'image-showcase', 'append must use the requested widget type')
assertWidgetWithinCanvas(appendedLayout.widgets[0], canvasPreset, 'appended image showcase')

const queryPreset = makePreset({ id: 'Hero-01', name: 'Hero Layout' })
const koreanQueryPreset = makePreset({ id: 'ko-01', name: '대표 월페이퍼' })
const presetQueries = [queryPreset, koreanQueryPreset]
const queryValue = buildWallpaperPresetQueryValue(queryPreset)
assert(queryValue === 'hero-layout--hero-01', `unexpected query value: ${queryValue}`)
assert(buildWallpaperRuntimePath(queryPreset) === '/#/wallpaper/runtime?preset=hero-layout--hero-01', 'saved wallpaper runtime path must target the hash-router runtime route with its stable preset token')
assert(buildWallpaperDraftRuntimePath() === '/#/wallpaper/runtime?draft=1', 'draft wallpaper runtime path must target the hash-router runtime route in local draft mode')
assert(
  appRouterSource.includes("window.location.pathname !== '/wallpaper/runtime'")
    && appRouterSource.includes('`/#/wallpaper/runtime${window.location.search}`'),
  'legacy pathname-based wallpaper URLs must be normalized before the hash router is created',
)
assert(findWallpaperPresetByQuery(presetQueries, 'hero-01')?.id === queryPreset.id, 'preset query must resolve by id case-insensitively')
assert(findWallpaperPresetByQuery(presetQueries, 'HERO-LAYOUT')?.id === queryPreset.id, 'preset query must resolve by slug case-insensitively')
assert(findWallpaperPresetByQuery(presetQueries, queryValue)?.id === queryPreset.id, 'preset query must resolve by slug/id token')
assert(findWallpaperPresetByQuery(presetQueries, buildWallpaperPresetQueryValue(koreanQueryPreset))?.id === koreanQueryPreset.id, 'preset query must preserve Hangul slug tokens')
assert(findWallpaperPresetByQuery(presetQueries, 'missing-preset') === null, 'unknown preset query must return null')

const createdPresetResult = upsertWallpaperLayoutPreset([], buildWallpaperLayoutDraft(canvasPreset.id), {
  presetId: 'preset-a',
  name: '  Named Preset  ',
})
assert(createdPresetResult.presetId === 'preset-a', 'upsert must return the chosen preset id')
assert(createdPresetResult.presets.length === 1, 'upsert must create one preset when the id is new')
assert(createdPresetResult.presets[0].name === 'Named Preset', 'upsert must trim preset names')

const updatedPresetResult = upsertWallpaperLayoutPreset(createdPresetResult.presets, createdPresetResult.presets[0], {
  presetId: 'preset-a',
  name: '   ',
})
assert(updatedPresetResult.presets.length === 1, 'upsert must update existing presets instead of duplicating ids')
assert(updatedPresetResult.presets[0].name === '월페이퍼 프리셋', 'empty preset names must use the default preset label')
assert(deleteWallpaperLayoutPreset(updatedPresetResult.presets, 'preset-a').length === 0, 'delete must remove the selected preset id')

const starterWidgetIds = starterLayout.widgets.map((widget) => widget.id)
const reorderedLayout = reorderWallpaperWidgets(starterLayout, [starterWidgetIds[0], starterWidgetIds[2], starterWidgetIds[1]])
const reorderedFrontToBack = getWallpaperWidgetsFrontToBack(reorderedLayout.widgets)
assert(reorderedFrontToBack.map((widget) => widget.id).join(',') === [starterWidgetIds[0], starterWidgetIds[2], starterWidgetIds[1]].join(','), 'reorder must honor the requested front-to-back ids first')
assert(reorderedFrontToBack.map((widget) => widget.zIndex).join(',') === '3,2,1', 'reorder must keep z-indexes contiguous from front to back')

const movedLayout = moveWallpaperWidgetToOrder(reorderedLayout, starterWidgetIds[1], 1)
const movedFrontToBack = getWallpaperWidgetsFrontToBack(movedLayout.widgets)
assert(movedFrontToBack[0].id === starterWidgetIds[1], 'move to order 1 must place the widget at the front')
assert(moveWallpaperWidgetToOrder(starterLayout, 'missing-widget', 1) === starterLayout, 'moving an unknown widget must leave the layout unchanged')

const futureWidgetPreset: WallpaperLayoutPresetWire = {
  id: 'future-widget-preset',
  name: 'Future widget preset',
  canvasPresetId: canvasPreset.id,
  widgets: [{
    id: 'future-widget',
    type: 'future-weather-widget',
    x: 2,
    y: 3,
    w: 4,
    h: 5,
    zIndex: 7,
    locked: true,
    hidden: false,
    settings: { location: 'Seoul', units: 'metric' },
  }],
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
}
const [futureWidgetViewModel] = toWallpaperLayoutPresetViewModels([futureWidgetPreset])
assert(futureWidgetViewModel.widgets.length === 0, 'unknown wallpaper widgets must stay hidden from an older editor')
assert(futureWidgetViewModel.unsupportedWidgets?.length === 1, 'unknown wallpaper widgets must be retained outside the editable view model')
const [futureWidgetRoundTrip] = toWallpaperLayoutPresetWireModels([futureWidgetViewModel])
assert(futureWidgetRoundTrip.widgets.length === 1, 'opening and saving a preset must not delete unknown wallpaper widgets')
assert(futureWidgetRoundTrip.widgets[0].type === 'future-weather-widget', 'unknown wallpaper widget type must round-trip unchanged')
assert(futureWidgetRoundTrip.widgets[0].settings.location === 'Seoul', 'unknown wallpaper widget settings must round-trip unchanged')
assert(!('unsupportedWidgets' in futureWidgetRoundTrip), 'view-only unsupported widget storage must not leak into the wire payload')

console.log('Wallpaper layout contracts verified.')
