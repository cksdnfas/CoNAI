import { equal, match } from 'node:assert/strict'
import verifyHelpers from '../../../scripts/verify-helpers'
import {
  IMAGE_CONTROLS_COLLAPSED_STORAGE_KEY,
  IMAGE_WHEEL_ZOOM_ENABLED_STORAGE_KEY,
  readImageDetailBooleanPreference,
  writeImageDetailBooleanPreference,
} from '../features/images/components/detail/use-image-detail-media-preferences'

const { createSourceReader, reportVerificationSuccess } = verifyHelpers
const source = createSourceReader(process.cwd())

function verifyImageDetailFilterPreviewStability() {
  const mediaSource = source('src/features/images/components/detail/image-detail-media.tsx')
  const frameSource = source('src/features/images/components/detail/image-detail-media-frame.tsx')
  const controlsSource = source('src/features/images/components/detail/image-detail-media-controls.tsx')
  const toolbarSource = source('src/features/images/components/detail/image-detail-media-toolbar.tsx')
  const gestureSource = source('src/features/images/components/detail/use-image-detail-media-gestures.ts')
  const preferenceSource = source('src/features/images/components/detail/use-image-detail-media-preferences.ts')
  const imageNodeCount = frameSource.match(/<img\b/g)?.length ?? 0

  equal(imageNodeCount, 1, 'detail media should keep one persistent primary <img> so filter toggles do not remount tall images')
  match(mediaSource, /<ImageDetailMediaToolbar/, 'detail media should delegate its overlay toolbar to a focused component')
  match(toolbarSource, /<ImageDetailAuxiliaryControls[\s\S]*?<ImageDetailTransformControls/, 'detail media toolbar should compose auxiliary and transform controls')
  match(mediaSource, /<ImageDetailMediaFrame[\s\S]*?fittedMediaSize=\{fittedMediaSize\}[\s\S]*?mediaFitFrameStyle=\{mediaFitFrameStyle\}/, 'detail media should delegate persistent image/canvas frame rendering to a focused component')
  match(controlsSource, /export function ImageDetailAuxiliaryControls/, 'detail media auxiliary controls should live in a dedicated component')
  match(controlsSource, /export function ImageDetailTransformControls/, 'detail media transform controls should live in a dedicated component')
  match(frameSource, /shouldRenderPixelPreview && isPixelPreviewReady && 'opacity-0'/, 'filtered preview should only hide the persistent image after the canvas is ready')
  match(frameSource, /\{shouldRenderPixelPreview \? \(\s*<canvas[\s\S]*?\) : null\}/, 'pixel preview canvas should be the only filter-specific media branch')
  match(gestureSource, /const fittedMediaSize = useMemo\(\(\) => \{[\s\S]*?naturalMediaSize[\s\S]*?viewportSize[\s\S]*?fitScale[\s\S]*?\}, \[naturalMediaSize, viewportSize\]\)/, 'detail media gesture hook should derive one fitted media frame from image natural size and current viewport')
  match(gestureSource, /const mediaFitFrameStyle = fittedMediaSize \? \{ width: `\$\{fittedMediaSize\.width\}px`, height: `\$\{fittedMediaSize\.height\}px` \} : undefined/, 'filter preview should reuse the current fitted image frame instead of intrinsic canvas dimensions')
  match(gestureSource, /const setOffsetOnAnimationFrame = useCallback/, 'detail media panning should batch offset state updates through requestAnimationFrame')
  match(gestureSource, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?setOffset\(pendingOffset\)/, 'detail media should only publish the latest pending pan offset once per animation frame')
  match(gestureSource, /window\.cancelAnimationFrame\(offsetAnimationFrameRef\.current\)/, 'detail media should cancel pending pan frames when resetting or unmounting')
  match(preferenceSource, /useImageDetailMediaPreferences/, 'detail media preferences should live behind a dedicated hook')
  match(gestureSource, /setPointerCapture\(event\.pointerId\)/, 'gesture hook should capture active pointers')
  match(gestureSource, /hasPointerCapture\(event\.pointerId\)[\s\S]*?releasePointerCapture\(event\.pointerId\)/, 'gesture hook should release captured pointers when interaction finishes')
  match(gestureSource, /pointersRef\.current\.size >= 2[\s\S]*?getPointerDistance\(first, second\)[\s\S]*?applyScale/, 'gesture hook should retain two-pointer pinch scaling')
  match(gestureSource, /addEventListener\('wheel', handleWheel, \{ passive: false \}\)/, 'wheel zoom must keep a non-passive listener so it can prevent page scrolling')
  match(mediaSource, /touchAction: isWheelZoomEnabled \? 'none' : 'pan-y'/, 'detail media should preserve touch scrolling when gesture zoom is disabled')
  match(gestureSource, /setNaturalMediaSize\(null\)[\s\S]*?setScale\(DEFAULT_SCALE\)[\s\S]*?\[cancelPendingOffsetFrame, renderUrl\]/, 'render URL changes should reset fitted size, zoom, rotation, and offset')
  match(toolbarSource, /onToggleWheelZoomEnabled=\{props\.onToggleWheelZoomEnabled\}[\s\S]*?onResetView=\{props\.onResetView\}/, 'toolbar should wire transform preference and reset callbacks through to the focused controls')
  match(mediaSource, /onTogglePixelPreviewEnabled=\{togglePixelPreviewEnabled\}[\s\S]*?onToggleWheelZoomEnabled=\{toggleWheelZoomEnabled\}[\s\S]*?onZoomIn=\{\(\) => zoomBy\(ZOOM_STEP\)\}/, 'detail media should wire preference and gesture actions into its toolbar')
  match(frameSource, /className=\{cn\(\s*'col-start-1 row-start-1 block pointer-events-none select-none transition-opacity duration-150'[\s\S]*?fittedMediaSize \? 'h-full w-full object-contain' : cn\('h-auto w-auto', className\)/, 'primary image should fill the measured fit frame when available and keep CSS fallback before image load')
  match(frameSource, /className=\{cn\('absolute inset-0 h-full w-full pointer-events-none select-none object-contain transition-opacity duration-150'/, 'filter canvas should cover the same fitted frame as the primary image')
}

function verifyImageDetailPreferenceStorageRoundTrip() {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }

  for (const key of [IMAGE_WHEEL_ZOOM_ENABLED_STORAGE_KEY, IMAGE_CONTROLS_COLLAPSED_STORAGE_KEY]) {
    writeImageDetailBooleanPreference(storage, key, true)
    equal(readImageDetailBooleanPreference(storage, key), true, `${key} should round-trip enabled state`)
    writeImageDetailBooleanPreference(storage, key, false)
    equal(readImageDetailBooleanPreference(storage, key), false, `${key} should round-trip disabled state`)
  }
  equal(readImageDetailBooleanPreference(null, IMAGE_WHEEL_ZOOM_ENABLED_STORAGE_KEY), false, 'SSR preference reads should use the disabled default')
}

function verifyImageDetailModelSearchBridge() {
  const metaCardSource = source('src/features/images/components/detail/image-detail-meta-card.tsx')

  match(metaCardSource, /function getImageModelSearchValue\(image: ImageRecord\)[\s\S]*?return typeof modelName === 'string' \? modelName\.trim\(\) : ''/, 'detail metadata should normalize model names before creating search chips')
  match(metaCardSource, /const handleAddModelSearchFilter = \(modelName: string\) => \{[\s\S]*?imageViewModal\?\.closeImageView\(\)[\s\S]*?addScopedTextChip\('model', modelName, \{ apply: true \}\)/, 'detail metadata model action should close modal review and immediately apply a model search filter')
  match(metaCardSource, /aria-label=\{t\(\{ ko: '이 모델로 검색', en: 'Search this model' \}\)\}[\s\S]*?<Search className="h-4 w-4" \/>/, 'detail metadata model search should remain an icon action with accessible label')
}

verifyImageDetailFilterPreviewStability()
verifyImageDetailPreferenceStorageRoundTrip()
verifyImageDetailModelSearchBridge()
reportVerificationSuccess('Image detail filter preview contracts verified.')
