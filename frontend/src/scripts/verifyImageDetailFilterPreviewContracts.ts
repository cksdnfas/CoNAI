import { equal, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

function verifyImageDetailFilterPreviewStability() {
  const mediaSource = source('src/features/images/components/detail/image-detail-media.tsx')
  const controlsSource = source('src/features/images/components/detail/image-detail-media-controls.tsx')
  const imageNodeCount = mediaSource.match(/<img\b/g)?.length ?? 0

  equal(imageNodeCount, 1, 'detail media should keep one persistent primary <img> so filter toggles do not remount tall images')
  match(mediaSource, /<ImageDetailAuxiliaryControls[\s\S]*?<ImageDetailTransformControls/, 'detail media should delegate overlay controls instead of embedding all control JSX inline')
  match(controlsSource, /export function ImageDetailAuxiliaryControls/, 'detail media auxiliary controls should live in a dedicated component')
  match(controlsSource, /export function ImageDetailTransformControls/, 'detail media transform controls should live in a dedicated component')
  match(mediaSource, /shouldRenderPixelPreview && isPixelPreviewReady && 'opacity-0'/, 'filtered preview should only hide the persistent image after the canvas is ready')
  match(mediaSource, /\{shouldRenderPixelPreview \? \(\s*<canvas[\s\S]*?\) : null\}/, 'pixel preview canvas should be the only filter-specific media branch')
  match(mediaSource, /const fittedMediaSize = useMemo\(\(\) => \{[\s\S]*?naturalMediaSize[\s\S]*?viewportSize[\s\S]*?fitScale[\s\S]*?\}, \[naturalMediaSize, viewportSize\]\)/, 'detail media should derive one fitted media frame from image natural size and current viewport')
  match(mediaSource, /const mediaFitFrameStyle = fittedMediaSize[\s\S]*?width: `\$\{fittedMediaSize\.width\}px`[\s\S]*?height: `\$\{fittedMediaSize\.height\}px`/, 'filter preview should reuse the current fitted image frame instead of intrinsic canvas dimensions')
  match(mediaSource, /const setOffsetOnAnimationFrame = useCallback/, 'detail media panning should batch offset state updates through requestAnimationFrame')
  match(mediaSource, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?setOffset\(pendingOffset\)/, 'detail media should only publish the latest pending pan offset once per animation frame')
  match(mediaSource, /window\.cancelAnimationFrame\(offsetAnimationFrameRef\.current\)/, 'detail media should cancel pending pan frames when resetting or unmounting')
  match(mediaSource, /className=\{cn\(\s*'col-start-1 row-start-1 block pointer-events-none select-none transition-opacity duration-150'[\s\S]*?fittedMediaSize \? 'h-full w-full object-contain' : cn\('h-auto w-auto', className\)/, 'primary image should fill the measured fit frame when available and keep CSS fallback before image load')
  match(mediaSource, /className=\{cn\('absolute inset-0 h-full w-full pointer-events-none select-none object-contain transition-opacity duration-150'/, 'filter canvas should cover the same fitted frame as the primary image')
}

function verifyImageDetailModelSearchBridge() {
  const metaCardSource = source('src/features/images/components/detail/image-detail-meta-card.tsx')

  match(metaCardSource, /function getImageModelSearchValue\(image: ImageRecord\)[\s\S]*?return typeof modelName === 'string' \? modelName\.trim\(\) : ''/, 'detail metadata should normalize model names before creating search chips')
  match(metaCardSource, /const handleAddModelSearchFilter = \(modelName: string\) => \{[\s\S]*?imageViewModal\?\.closeImageView\(\)[\s\S]*?addScopedTextChip\('model', modelName, \{ apply: true \}\)/, 'detail metadata model action should close modal review and immediately apply a model search filter')
  match(metaCardSource, /aria-label=\{t\(\{ ko: '이 모델로 검색', en: 'Search this model' \}\)\}[\s\S]*?<Search className="h-4 w-4" \/>/, 'detail metadata model search should remain an icon action with accessible label')
}

verifyImageDetailFilterPreviewStability()
verifyImageDetailModelSearchBridge()
console.log('Image detail filter preview contracts verified.')
