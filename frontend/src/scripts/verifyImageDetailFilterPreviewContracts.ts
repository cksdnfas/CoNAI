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
}

verifyImageDetailFilterPreviewStability()
console.log('Image detail filter preview contracts verified.')
