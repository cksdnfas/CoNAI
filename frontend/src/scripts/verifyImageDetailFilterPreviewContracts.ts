import { equal, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

function verifyImageDetailFilterPreviewStability() {
  const mediaSource = source('src/features/images/components/detail/image-detail-media.tsx')
  const imageNodeCount = mediaSource.match(/<img\b/g)?.length ?? 0

  equal(imageNodeCount, 1, 'detail media should keep one persistent primary <img> so filter toggles do not remount tall images')
  match(mediaSource, /shouldRenderPixelPreview && isPixelPreviewReady && 'opacity-0'/, 'filtered preview should only hide the persistent image after the canvas is ready')
  match(mediaSource, /\{shouldRenderPixelPreview \? \(\s*<canvas[\s\S]*?\) : null\}/, 'pixel preview canvas should be the only filter-specific media branch')
  match(mediaSource, /const fittedMediaSize = useMemo\(\(\) => \{[\s\S]*?naturalMediaSize[\s\S]*?viewportSize[\s\S]*?fitScale[\s\S]*?\}, \[naturalMediaSize, viewportSize\]\)/, 'detail media should derive one fitted media frame from image natural size and current viewport')
  match(mediaSource, /const mediaFitFrameStyle = fittedMediaSize[\s\S]*?width: `\$\{fittedMediaSize\.width\}px`[\s\S]*?height: `\$\{fittedMediaSize\.height\}px`/, 'filter preview should reuse the current fitted image frame instead of intrinsic canvas dimensions')
  match(mediaSource, /className=\{cn\(\s*'col-start-1 row-start-1 block pointer-events-none select-none transition-opacity duration-150'[\s\S]*?fittedMediaSize \? 'h-full w-full object-contain' : cn\('h-auto w-auto', className\)/, 'primary image should fill the measured fit frame when available and keep CSS fallback before image load')
  match(mediaSource, /className=\{cn\('absolute inset-0 h-full w-full pointer-events-none select-none object-contain transition-opacity duration-150'/, 'filter canvas should cover the same fitted frame as the primary image')
}

verifyImageDetailFilterPreviewStability()
console.log('Image detail filter preview contracts verified.')
